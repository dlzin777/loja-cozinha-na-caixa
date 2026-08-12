"""
Servidor Flask — login + checkout BravoPay PIX.

Rode:
  pip install -r requirements.txt
  python server.py

Abra: http://127.0.0.1:8080

Webhook (produção): cadastre no painel BravoPay
  https://SEU_DOMINIO/api/webhooks/bravopay
"""

from __future__ import annotations

import json
import os
import re
import secrets
import sqlite3
import uuid
from datetime import datetime
from functools import wraps
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, abort, g, jsonify, request, send_from_directory, session
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash

import bravopay
from bravopay import BravoPayError
from security import (
    abort_if_blocked,
    client_ip,
    ensure_csrf_token,
    is_blocked_path,
    limiter,
    origin_ok,
    security_headers,
    validate_csrf,
)

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

IS_PRODUCTION = bool(os.environ.get("RENDER") or os.environ.get("FLASK_ENV") == "production")

# No Render, use disco persistente montado em /var/data (senão o SQLite some no redeploy)
_data_root = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
DB_PATH = _data_root / "loja.db"

# SECRET_KEY forte obrigatória em produção
_secret = (os.environ.get("SECRET_KEY") or "").strip()
if IS_PRODUCTION and (not _secret or _secret == "cnc-bravopay-local-change-me"):
    raise RuntimeError("Defina SECRET_KEY forte nas variáveis de ambiente do Render.")
if not _secret:
    _secret = secrets.token_urlsafe(48)

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")
app.secret_key = _secret
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_NAME"] = "cnc_session"
app.config["PERMANENT_SESSION_LIFETIME"] = 60 * 60 * 12  # 12h
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024  # 64 KB
app.config["JSON_SORT_KEYS"] = False

if IS_PRODUCTION:
    app.config["SESSION_COOKIE_SECURE"] = True
    # Atrás do proxy HTTPS do Render
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

WEBHOOK_SECRET = (os.environ.get("WEBHOOK_SECRET") or "").strip()
ALLOWED_HOSTS = {
    h.strip().lower()
    for h in (os.environ.get("ALLOWED_HOSTS") or "").split(",")
    if h.strip()
}


@app.before_request
def harden_request():
    # Bloqueia download de .env, .py, banco, etc.
    abort_if_blocked()

    # Só APIs JSON/mutating passam pelas checagens abaixo
    if not request.path.startswith("/api/"):
        return None

    # Limite de tamanho já coberto pelo MAX_CONTENT_LENGTH
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        # Webhook tem autenticação própria
        if request.path.startswith("/api/webhooks/"):
            return None

        if not origin_ok(request, ALLOWED_HOSTS):
            return jsonify({"ok": False, "error": "Origem não permitida."}), 403

        # CSRF em todas as mutações autenticadas/públicas da API
        if request.path not in {"/api/csrf"}:
            if not validate_csrf(request):
                return jsonify({"ok": False, "error": "CSRF inválido. Recarregue a página."}), 403

    return None


@app.after_request
def harden_response(response):
    return security_headers(response, production=IS_PRODUCTION)


# ---------------------------------------------------------------------------
# Banco
# ---------------------------------------------------------------------------

def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def _ensure_column(db: sqlite3.Connection, table: str, column: str, typedef: str) -> None:
    cols = {row[1] for row in db.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in cols:
        db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {typedef}")


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            phone TEXT DEFAULT '',
            cpf TEXT DEFAULT '',
            zipcode TEXT DEFAULT '',
            address TEXT DEFAULT '',
            number TEXT DEFAULT '',
            complement TEXT DEFAULT '',
            locality TEXT DEFAULT '',
            city TEXT DEFAULT '',
            state TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            code TEXT NOT NULL UNIQUE,
            items_json TEXT NOT NULL,
            subtotal REAL NOT NULL,
            pix_discount REAL NOT NULL,
            shipping REAL NOT NULL,
            total REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'aguardando_pix',
            bravopay_tx_id TEXT DEFAULT '',
            pix_copy_paste TEXT DEFAULT '',
            customer_name TEXT DEFAULT '',
            customer_email TEXT DEFAULT '',
            customer_phone TEXT DEFAULT '',
            customer_cpf TEXT DEFAULT '',
            utm_json TEXT DEFAULT '{}',
            created_at TEXT NOT NULL,
            paid_at TEXT DEFAULT '',
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        """
    )
    # Migração leve se o banco antigo já existir
    for col, typedef in [
        ("cpf", "TEXT DEFAULT ''"),
    ]:
        _ensure_column(db, "users", col, typedef)

    for col, typedef in [
        ("bravopay_tx_id", "TEXT DEFAULT ''"),
        ("pix_copy_paste", "TEXT DEFAULT ''"),
        ("customer_name", "TEXT DEFAULT ''"),
        ("customer_email", "TEXT DEFAULT ''"),
        ("customer_phone", "TEXT DEFAULT ''"),
        ("customer_cpf", "TEXT DEFAULT ''"),
        ("utm_json", "TEXT DEFAULT '{}'"),
        ("paid_at", "TEXT DEFAULT ''"),
    ]:
        _ensure_column(db, "orders", col, typedef)

    db.commit()
    db.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def user_public(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "phone": row["phone"] or "",
        "cpf": row["cpf"] if "cpf" in row.keys() else "",
        "zipcode": row["zipcode"] or "",
        "address": row["address"] or "",
        "number": row["number"] or "",
        "complement": row["complement"] or "",
        "locality": row["locality"] or "",
        "city": row["city"] or "",
        "state": row["state"] or "",
    }


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return get_db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user():
            return jsonify({"ok": False, "error": "Faça login para continuar."}), 401
        return fn(*args, **kwargs)

    return wrapper


def only_digits(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def valid_cpf(cpf: str) -> bool:
    cpf = only_digits(cpf)
    if len(cpf) != 11 or cpf == cpf[0] * 11:
        return False
    nums = [int(c) for c in cpf]
    s1 = sum(a * b for a, b in zip(nums[:9], range(10, 1, -1)))
    d1 = (s1 * 10 % 11) % 10
    s2 = sum(a * b for a, b in zip(nums[:10], range(11, 1, -1)))
    d2 = (s2 * 10 % 11) % 10
    return nums[9] == d1 and nums[10] == d2


def normalize_phone(phone: str) -> str:
    digits = only_digits(phone)
    if digits.startswith("55"):
        return digits
    if len(digits) in (10, 11):
        return "55" + digits
    return digits


def mark_order_paid(db: sqlite3.Connection, *, code: str | None = None, tx_id: str | None = None) -> None:
    now = datetime.utcnow().isoformat()
    if tx_id:
        db.execute(
            """
            UPDATE orders
            SET status='pago', paid_at=?
            WHERE bravopay_tx_id=? AND status!='pago'
            """,
            (now, tx_id),
        )
    if code:
        db.execute(
            """
            UPDATE orders
            SET status='pago', paid_at=?
            WHERE code=? AND status!='pago'
            """,
            (now, code),
        )
    db.commit()


# ---------------------------------------------------------------------------
# Rotas estáticas
# ---------------------------------------------------------------------------

@app.get("/")
def home():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/obrigado")
@app.get("/obrigado.html")
def thanks_page():
    return send_from_directory(BASE_DIR, "obrigado.html")


@app.get("/api/health")
def health():
    # Em produção não revela detalhes de configuração
    if IS_PRODUCTION:
        return jsonify({"ok": True})
    return jsonify({
        "ok": True,
        "bravopay_configured": bool(os.getenv("BRAVOPAY_API_KEY")),
        "product_id_set": bool((os.getenv("BRAVOPAY_PRODUCT_ID") or "").strip()),
    })


@app.get("/api/csrf")
def csrf():
    """Token anti-CSRF — o front envia em X-CSRF-Token."""
    return jsonify({"ok": True, "csrf_token": ensure_csrf_token()})


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@app.get("/api/me")
def me():
    user = current_user()
    # Garante token CSRF na sessão do visitante
    ensure_csrf_token()
    if not user:
        return jsonify({"ok": True, "user": None, "csrf_token": ensure_csrf_token()})
    return jsonify({"ok": True, "user": user_public(user), "csrf_token": ensure_csrf_token()})


def _password_ok(password: str) -> str | None:
    if len(password) < 8:
        return "A senha precisa ter no mínimo 8 caracteres."
    if password.isalpha() or password.isdigit():
        return "Use letras e números na senha."
    return None


@app.post("/api/register")
def register():
    ip = client_ip()
    if not limiter.allow(f"register:{ip}", limit=8, window_seconds=3600):
        return jsonify({"ok": False, "error": "Muitas tentativas. Tente mais tarde."}), 429

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()[:120]
    email = (data.get("email") or "").strip().lower()[:190]
    password = data.get("password") or ""

    if len(name) < 2:
        return jsonify({"ok": False, "error": "Informe seu nome."}), 400
    if "@" not in email or "." not in email:
        return jsonify({"ok": False, "error": "E-mail inválido."}), 400
    pwd_err = _password_ok(password)
    if pwd_err:
        return jsonify({"ok": False, "error": pwd_err}), 400

    db = get_db()
    if db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone():
        return jsonify({"ok": False, "error": "Já existe uma conta com este e-mail."}), 409

    now = datetime.utcnow().isoformat()
    cur = db.execute(
        "INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
        (name, email, generate_password_hash(password), now),
    )
    db.commit()
    session.clear()
    session["user_id"] = cur.lastrowid
    ensure_csrf_token()
    user = db.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify({"ok": True, "user": user_public(user), "csrf_token": ensure_csrf_token()})


@app.post("/api/login")
def login():
    ip = client_ip()
    if not limiter.allow(f"login:{ip}", limit=10, window_seconds=900):
        return jsonify({"ok": False, "error": "Muitas tentativas. Aguarde 15 minutos."}), 429

    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()[:190]
    password = data.get("password") or ""
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    # Mesma mensagem para não revelar se o e-mail existe
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"ok": False, "error": "E-mail ou senha incorretos."}), 401

    session.clear()
    session["user_id"] = user["id"]
    session.permanent = True
    ensure_csrf_token()
    return jsonify({"ok": True, "user": user_public(user), "csrf_token": ensure_csrf_token()})


@app.post("/api/logout")
def logout():
    session.clear()
    ensure_csrf_token()
    return jsonify({"ok": True, "csrf_token": ensure_csrf_token()})


@app.put("/api/profile")
@login_required
def update_profile():
    user = current_user()
    data = request.get_json(silent=True) or {}
    fields = [
        "name", "phone", "cpf", "zipcode", "address", "number",
        "complement", "locality", "city", "state",
    ]
    values = [(data.get(f) or "").strip() for f in fields]
    if len(values[0]) < 2:
        return jsonify({"ok": False, "error": "Informe seu nome."}), 400

    cpf = only_digits(values[2])
    if cpf and not valid_cpf(cpf):
        return jsonify({"ok": False, "error": "CPF inválido."}), 400
    values[2] = cpf

    db = get_db()
    db.execute(
        """
        UPDATE users
        SET name=?, phone=?, cpf=?, zipcode=?, address=?, number=?, complement=?, locality=?, city=?, state=?
        WHERE id=?
        """,
        (*values, user["id"]),
    )
    db.commit()
    updated = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    return jsonify({"ok": True, "user": user_public(updated)})


@app.get("/api/orders")
@login_required
def list_orders():
    user = current_user()
    rows = get_db().execute(
        """
        SELECT code, items_json, subtotal, pix_discount, shipping, total, status,
               bravopay_tx_id, created_at, paid_at
        FROM orders WHERE user_id = ? ORDER BY id DESC
        """,
        (user["id"],),
    ).fetchall()
    orders = []
    for row in rows:
        orders.append({
            "code": row["code"],
            "items": json.loads(row["items_json"]),
            "subtotal": row["subtotal"],
            "pix_discount": row["pix_discount"],
            "shipping": row["shipping"],
            "total": row["total"],
            "status": row["status"],
            "bravopay_tx_id": row["bravopay_tx_id"],
            "created_at": row["created_at"],
            "paid_at": row["paid_at"],
        })
    return jsonify({"ok": True, "orders": orders})


# ---------------------------------------------------------------------------
# Checkout BravoPay PIX
# ---------------------------------------------------------------------------

@app.post("/api/checkout/pix")
@login_required
def checkout_pix():
    """
    1) Valida cliente + pedido
    2) Salva order no SQLite
    3) Cria cobrança PIX na BravoPay
    4) Devolve copy_paste + tx id pro front gerar QR e fazer polling
    """
    ip = client_ip()
    if not limiter.allow(f"pix:{ip}", limit=15, window_seconds=3600):
        return jsonify({"ok": False, "error": "Limite de cobranças atingido. Tente mais tarde."}), 429

    user = current_user()
    data = request.get_json(silent=True) or {}

    items = data.get("items") or []
    if not items:
        return jsonify({"ok": False, "error": "Carrinho vazio."}), 400

    customer = data.get("customer") or {}
    name = (customer.get("name") or "").strip()
    email = (customer.get("email") or "").strip().lower()
    phone = normalize_phone(customer.get("phone") or "")
    cpf = only_digits(customer.get("cpf") or "")

    if len(name) < 3:
        return jsonify({"ok": False, "error": "Informe o nome completo."}), 400
    if "@" not in email:
        return jsonify({"ok": False, "error": "E-mail inválido."}), 400
    if len(phone) < 12:
        return jsonify({"ok": False, "error": "Telefone inválido. Use DDD + número."}), 400
    if not valid_cpf(cpf):
        return jsonify({"ok": False, "error": "CPF inválido."}), 400

    subtotal = float(data.get("subtotal") or 0)
    pix_discount = float(data.get("pix_discount") or 0)
    shipping = float(data.get("shipping") or 0)
    total = float(data.get("total") or 0)
    if total <= 0:
        return jsonify({"ok": False, "error": "Valor do pedido inválido."}), 400

    amount_cents = int(round(total * 100))
    code = (data.get("code") or f"CNC-{uuid.uuid4().hex[:8].upper()}").strip()
    utm = data.get("utm") or {}
    profile = data.get("profile") or {}

    db = get_db()

    # Atualiza perfil do usuário
    db.execute(
        """
        UPDATE users
        SET name=?, phone=?, cpf=?, zipcode=?, address=?, number=?, complement=?, locality=?, city=?, state=?
        WHERE id=?
        """,
        (
            name,
            phone,
            cpf,
            (profile.get("zipcode") or "").strip(),
            (profile.get("address") or "").strip(),
            (profile.get("number") or "").strip(),
            (profile.get("complement") or "").strip(),
            (profile.get("locality") or "").strip(),
            (profile.get("city") or "").strip(),
            (profile.get("state") or "").strip(),
            user["id"],
        ),
    )

    # Salva pedido local
    db.execute(
        """
        INSERT INTO orders (
            user_id, code, items_json, subtotal, pix_discount, shipping, total, status,
            customer_name, customer_email, customer_phone, customer_cpf, utm_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'aguardando_pix', ?, ?, ?, ?, ?, ?)
        """,
        (
            user["id"],
            code,
            json.dumps(items, ensure_ascii=False),
            subtotal,
            pix_discount,
            shipping,
            total,
            name,
            email,
            phone,
            cpf,
            json.dumps(utm, ensure_ascii=False),
            datetime.utcnow().isoformat(),
        ),
    )
    db.commit()

    # Cria cobrança na BravoPay
    try:
        tx = bravopay.create_pix_transaction(
            amount_cents=amount_cents,
            customer={
                "name": name,
                "email": email,
                "phone": phone,
                "cpf": cpf,
            },
            external_reference=code,
            utm=utm if isinstance(utm, dict) else {},
        )
    except BravoPayError as exc:
        db.execute("UPDATE orders SET status='falha_pagamento' WHERE code=?", (code,))
        db.commit()
        # Em produção não vaza payload interno do gateway
        if IS_PRODUCTION:
            return jsonify({"ok": False, "error": "Não foi possível gerar o Pix. Tente novamente."}), 502
        return jsonify({"ok": False, "error": str(exc), "details": exc.payload}), exc.status_code

    tx_id = tx.get("id") or ""
    pix = tx.get("pix") or {}
    copy_paste = pix.get("copy_paste") or pix.get("qr_code") or ""

    db.execute(
        """
        UPDATE orders
        SET bravopay_tx_id=?, pix_copy_paste=?, status=?
        WHERE code=?
        """,
        (tx_id, copy_paste, (tx.get("status") or "PENDING").lower(), code),
    )
    db.commit()

    return jsonify({
        "ok": True,
        "code": code,
        "transaction_id": tx_id,
        "status": tx.get("status") or "PENDING",
        "amount_cents": amount_cents,
        "pix": {
            "copy_paste": copy_paste,
            "expires_at": pix.get("expires_at"),
        },
    })


@app.get("/api/checkout/pix/<tx_id>")
@login_required
def checkout_pix_status(tx_id: str):
    """Polling do front — consulta BravoPay e atualiza o pedido se PAID."""
    try:
        tx = bravopay.get_transaction(tx_id)
    except BravoPayError as exc:
        return jsonify({"ok": False, "error": str(exc)}), exc.status_code

    status = (tx.get("status") or "").upper()
    db = get_db()

    if status == "PAID":
        mark_order_paid(db, tx_id=tx_id)

    order = db.execute(
        "SELECT code, status FROM orders WHERE bravopay_tx_id=?",
        (tx_id,),
    ).fetchone()

    return jsonify({
        "ok": True,
        "transaction_id": tx_id,
        "status": status,
        "code": order["code"] if order else None,
        "order_status": order["status"] if order else None,
    })


@app.post("/api/webhooks/bravopay")
def bravopay_webhook():
    """
    Webhook BravoPay (fonte da verdade em produção).
    Cadastre no painel:
      URL: https://SEU-DOMINIO/api/webhooks/bravopay
    Header obrigatório:
      X-Webhook-Secret: <mesmo valor de WEBHOOK_SECRET>
    """
    if not WEBHOOK_SECRET:
        if IS_PRODUCTION:
            abort(503)
    else:
        header_secret = request.headers.get("X-Webhook-Secret") or ""
        auth = request.headers.get("Authorization") or ""
        bearer = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        provided = header_secret or bearer
        if not provided or not secrets.compare_digest(provided, WEBHOOK_SECRET):
            abort(401)

    if not limiter.allow(f"wh:{client_ip()}", limit=120, window_seconds=60):
        return jsonify({"ok": False}), 429

    payload = request.get_json(silent=True) or {}
    event = (payload.get("event") or "").lower()
    tx = payload.get("transaction") or {}
    tx_id = tx.get("id") or ""
    external_reference = tx.get("external_reference") or ""

    if not IS_PRODUCTION:
        print(f"[webhook bravopay] event={event} tx={tx_id} ref={external_reference}")

    db = get_db()
    if event in ("transaction.paid", "transaction.payment.paid"):
        mark_order_paid(db, tx_id=tx_id or None, code=external_reference or None)
    elif event in ("transaction.refunded", "transaction.chargeback"):
        if tx_id:
            db.execute(
                "UPDATE orders SET status=? WHERE bravopay_tx_id=?",
                (event.split(".")[-1], tx_id),
            )
            db.commit()
        elif external_reference:
            db.execute(
                "UPDATE orders SET status=? WHERE code=?",
                (event.split(".")[-1], external_reference),
            )
            db.commit()

    return jsonify({"ok": True}), 200


# Compat: endpoint antigo (não cria Pix)
@app.post("/api/orders")
@login_required
def create_order_legacy():
    return jsonify({
        "ok": False,
        "error": "Use /api/checkout/pix para gerar a cobrança BravoPay.",
    }), 400


# Erros genéricos em produção (não vaza stack)
@app.errorhandler(404)
def not_found(_e):
    if request.path.startswith("/api/") or is_blocked_path(request.path):
        return jsonify({"ok": False, "error": "Não encontrado."}), 404
    return "Não encontrado", 404


@app.errorhandler(500)
def server_error(_e):
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "Erro interno."}), 500
    return "Erro interno", 500


init_db()


if __name__ == "__main__":
    print("Loja + BravoPay em http://127.0.0.1:8080")
    print(f"Banco: {DB_PATH}")
    if not IS_PRODUCTION:
        print(f"Product ID UTMify: {(os.getenv('BRAVOPAY_PRODUCT_ID') or '(vazio — cole no .env)')}")
    print("Webhook: POST /api/webhooks/bravopay (header X-Webhook-Secret)")
    # debug=False evita expor o debugger interativo
    app.run(host="127.0.0.1", port=8080, debug=False)

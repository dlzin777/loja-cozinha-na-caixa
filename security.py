"""
Camada de proteção: rate limit, arquivos sensíveis, CSRF, headers.
"""

from __future__ import annotations

import secrets
import time
from collections import defaultdict, deque
from threading import Lock
from typing import Deque

from flask import Request, abort, request, session


# Extensões que o site pode servir publicamente
ALLOWED_STATIC_EXT = {
    ".html",
    ".css",
    ".js",
    ".json",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".ico",
    ".svg",
    ".woff",
    ".woff2",
    ".ttf",
    ".map",
}

# Arquivos/pastas que NUNCA podem ser baixados pela URL
BLOCKED_NAMES = {
    ".env",
    ".env.example",
    ".gitignore",
    "server.py",
    "bravopay.py",
    "security.py",
    "requirements.txt",
    "procfile",
    "runtime.txt",
    "render.yaml",
    "dockerfile",
    "docker-compose.yml",
    "source-raw.html",
    "original-clone.html",
    "checkout-source.html",
    "checkout-next-source.html",
    "checkout-data.json",
}

BLOCKED_PREFIXES = (
    "data/",
    ".git/",
    ".venv/",
    "venv/",
    "__pycache__/",
    ".cursor/",
)

BLOCKED_SUFFIXES = (
    ".py",
    ".db",
    ".sqlite",
    ".sqlite3",
    ".log",
    ".pem",
    ".key",
    ".env",
)


class RateLimiter:
    """Limiter simples em memória (por IP + rota)."""

    def __init__(self) -> None:
        self._hits: dict[str, Deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str, limit: int, window_seconds: int) -> bool:
        now = time.time()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window_seconds:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True


limiter = RateLimiter()


def client_ip() -> str:
    # Render / proxies
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "unknown"


def is_blocked_path(path: str) -> bool:
    clean = path.lstrip("/").replace("\\", "/").lower()
    if not clean or clean == "/":
        return False
    # Path traversal
    if ".." in clean.split("/"):
        return True
    name = clean.split("/")[-1]
    if name in BLOCKED_NAMES or clean in BLOCKED_NAMES:
        return True
    if any(clean.startswith(p) for p in BLOCKED_PREFIXES):
        return True
    if any(clean.endswith(s) for s in BLOCKED_SUFFIXES):
        return True
    # Só libera estáticos com extensão conhecida (APIs passam antes)
    if clean.startswith("api/"):
        return False
    # Arquivos na raiz sem extensão conhecida
    if "." in name:
        ext = "." + name.rsplit(".", 1)[-1]
        if ext not in ALLOWED_STATIC_EXT:
            return True
    return False


def ensure_csrf_token() -> str:
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def validate_csrf(req: Request) -> bool:
    sent = req.headers.get("X-CSRF-Token") or ""
    expected = session.get("csrf_token") or ""
    if not sent or not expected:
        return False
    return secrets.compare_digest(sent, expected)


def origin_ok(req: Request, allowed_hosts: set[str]) -> bool:
    """Bloqueia POST cross-site óbvios."""
    if req.method in ("GET", "HEAD", "OPTIONS"):
        return True
    # Webhook tem auth própria
    if req.path.startswith("/api/webhooks/"):
        return True

    origin = req.headers.get("Origin") or ""
    referer = req.headers.get("Referer") or ""
    host = (req.host or "").split(":")[0].lower()

    # Se não tem Origin/Referer (alguns clients), libera só same-site cookie + CSRF
    if not origin and not referer:
        return True

    def host_from(url: str) -> str:
        try:
            # https://x.com/path -> x.com
            return url.split("://", 1)[1].split("/", 1)[0].split(":")[0].lower()
        except Exception:
            return ""

    source = host_from(origin) if origin else host_from(referer)
    if not source:
        return False
    if source == host or source in allowed_hosts:
        return True
    # localhost aliases
    if host in {"127.0.0.1", "localhost"} and source in {"127.0.0.1", "localhost"}:
        return True
    return False


def security_headers(response, *, production: bool):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    # CSP: locais + fonts + QRCode CDN + Meta Pixel + ViaCEP
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://connect.facebook.net; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "img-src 'self' data: https: blob:; "
        "connect-src 'self' https://www.facebook.com https://connect.facebook.net https://viacep.com.br; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'"
    )
    if production:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    # Não vazar stack/framework
    response.headers["Server"] = "secure"
    return response


def abort_if_blocked():
    path = request.path
    if path.startswith("/api/"):
        return
    if is_blocked_path(path):
        abort(404)

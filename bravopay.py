"""
Cliente BravoPay — cria cobrança PIX e consulta status.
A API key fica só no backend (.env).
"""

from __future__ import annotations

import os
from typing import Any

import requests

BASE_URL = os.getenv("BRAVOPAY_BASE_URL", "https://bravopay.club/api/v1").rstrip("/")


class BravoPayError(Exception):
    def __init__(self, message: str, status_code: int = 400, payload: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


def _headers() -> dict[str, str]:
    api_key = (os.getenv("BRAVOPAY_API_KEY") or "").strip()
    if not api_key:
        raise BravoPayError("BRAVOPAY_API_KEY não configurada no .env", 500)
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def create_pix_transaction(
    *,
    amount_cents: int,
    customer: dict,
    external_reference: str,
    utm: dict | None = None,
    product_id: str | None = None,
) -> dict:
    """
    POST /transactions — cria cobrança PIX.
    product_id opcional; se usar UTMify, configure BRAVOPAY_PRODUCT_ID no .env.
    """
    body: dict[str, Any] = {
        "amount_cents": int(amount_cents),
        "method": "pix",
        "customer": customer,
        "external_reference": external_reference,
    }

    # product_id real evita cair no produto "ghost" da UTMify
    pid = (product_id or os.getenv("BRAVOPAY_PRODUCT_ID") or "").strip()
    if pid:
        body["product_id"] = pid

    if utm:
        clean = {k: v for k, v in utm.items() if v}
        if clean:
            body["utm"] = clean

    resp = requests.post(
        f"{BASE_URL}/transactions",
        headers=_headers(),
        json=body,
        timeout=30,
    )

    data = _safe_json(resp)
    if resp.status_code >= 400:
        msg = _extract_error(data) or f"Erro BravoPay ({resp.status_code})"
        raise BravoPayError(msg, resp.status_code, data)
    return data


def get_transaction(tx_id: str) -> dict:
    """GET /transactions/{id} — consulta status da cobrança."""
    resp = requests.get(
        f"{BASE_URL}/transactions/{tx_id}",
        headers=_headers(),
        timeout=20,
    )
    data = _safe_json(resp)
    if resp.status_code >= 400:
        msg = _extract_error(data) or f"Erro ao consultar transação ({resp.status_code})"
        raise BravoPayError(msg, resp.status_code, data)
    return data


def _safe_json(resp: requests.Response) -> Any:
    try:
        return resp.json()
    except Exception:
        return {"raw": resp.text}


def _extract_error(data: Any) -> str:
    if not isinstance(data, dict):
        return ""
    for key in ("message", "error", "detail"):
        val = data.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    if isinstance(data.get("errors"), list) and data["errors"]:
        return str(data["errors"][0])
    return ""

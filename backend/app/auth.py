"""Shared-password sign-in.

The password lives in TG_APP_PASSWORD. POST /api/login exchanges it for two tokens:
  * an access token (minutes) that every other API route needs as `Authorization: Bearer <token>`;
  * a refresh token (days) that POST /api/refresh trades for a fresh pair, so the user stays signed
    in without retyping the password. Each refresh rotates it, so the window slides with use.
Tokens are stateless: a base64 payload (type, expiry) and an HMAC-SHA256 signature, keyed by
TG_AUTH_SECRET or, when that is unset, by a key derived from the password (so changing the password
signs everyone out). With no password set, auth is off, which is meant for local development only.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from fastapi import HTTPException, Request

from .config import get_settings

# Reachable without an access token: signing in, refreshing, and the check that tells the UI whether to ask.
PUBLIC = {"/api/login", "/api/refresh", "/api/auth"}


def enabled() -> bool:
    return bool(get_settings().app_password)


def _key() -> bytes:
    s = get_settings()
    if s.auth_secret:
        return s.auth_secret.encode()
    return hashlib.sha256(b"truthgraph-auth|" + s.app_password.encode()).digest()


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def check_password(password: str) -> bool:
    return enabled() and hmac.compare_digest(password.encode(), get_settings().app_password.encode())


def _sign(typ: str, ttl_s: int) -> tuple[str, int]:
    exp = int(time.time()) + ttl_s
    payload = _b64(json.dumps({"typ": typ, "exp": exp}, separators=(",", ":")).encode())
    sig = _b64(hmac.new(_key(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}", exp


def issue() -> dict:
    """A new access + refresh pair."""
    s = get_settings()
    access, access_exp = _sign("access", s.auth_access_minutes * 60)
    refresh, refresh_exp = _sign("refresh", s.auth_refresh_days * 86400)
    return {"access": access, "access_expires": access_exp, "refresh": refresh, "refresh_expires": refresh_exp}


def mcp_token() -> tuple[str, int]:
    """A bearer token for MCP clients only (valid at /mcp, not the rest of the API), lasting days, since
    those clients can't refresh."""
    return _sign("mcp", get_settings().auth_mcp_days * 86400)


def valid(token: str, typ: str) -> bool:
    """Signature intact, of the expected type (a refresh token can't be used as a bearer), not expired."""
    try:
        payload, sig = token.split(".", 1)
        want = _b64(hmac.new(_key(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, want):
            return False
        claims = json.loads(_unb64(payload))
        return claims["typ"] == typ and claims["exp"] > time.time()
    except (ValueError, KeyError, TypeError):
        return False


async def require(request: Request) -> None:
    """App-wide dependency: every API route except PUBLIC needs a valid bearer token."""
    if not enabled() or request.method == "OPTIONS" or request.url.path in PUBLIC:
        return
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not valid(token, "access"):
        raise HTTPException(401, "Sign in to use TruthGraph", headers={"WWW-Authenticate": "Bearer"})

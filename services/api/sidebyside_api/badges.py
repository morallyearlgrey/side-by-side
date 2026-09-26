"""Owner-managed Core2 credentials, scoped solely to reporting badge status."""

import hashlib
import re
import secrets
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from pydantic import Field, StringConstraints

from .errors import AppError
from .models import StrictModel

HEARTBEAT_SECONDS = 15
LEASE_SECONDS = 45
MAX_SEQUENCE = 9_007_199_254_740_991
TOKEN_PATTERN = re.compile(r"sbs_badge_([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})\Z")
PUBLIC_FIELDS = (
    "device_id", "label", "reported_state", "last_sequence", "last_seen_at",
    "lease_expires_at", "created_at", "revoked_at",
)


class BadgeRegistration(StrictModel):
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)] = "SidebySide badge"


class BadgeReport(StrictModel):
    state: Literal["paused", "available"]
    sequence: Annotated[int, Field(strict=True, ge=1, le=MAX_SEQUENCE)]


def public_badge(row, *, at=None):
    """No credential hashes, owner IDs or other database columns leave this boundary."""
    result = {key: row.get(key) for key in PUBLIC_FIELDS}
    at = at or datetime.now(UTC)
    expires = row.get("lease_expires_at")
    if isinstance(expires, str):
        expires = datetime.fromisoformat(expires.replace("Z", "+00:00"))
    if row.get("revoked_at"):
        effective = "revoked"
    elif not expires or expires <= at:
        effective = "offline"
    else:
        effective = row["reported_state"]
    return {**result, "effective_state": effective}


def rpc_row(value):
    row = value[0] if isinstance(value, list) and value else value
    if not isinstance(row, dict) or not row.get("device_id"):
        raise AppError(503, "badge_sync_unavailable", "Badge status could not be saved. Try again.")
    return row


class Badges:
    def __init__(self, repository):
        self.repo = repository

    async def list(self, user_id):
        rows = await self.repo.select("badge_devices", {"user_id": f"eq.{user_id}"},
                                      columns=",".join(PUBLIC_FIELDS), order="created_at.desc")
        return {"badges": [public_badge(row) for row in rows]}

    async def register(self, user_id, request: BadgeRegistration):
        device_id = str(uuid4())
        token = f"sbs_badge_{device_id}.{secrets.token_urlsafe(32)}"
        rows = await self.repo.insert("badge_devices", {
            "device_id": device_id, "user_id": user_id, "label": request.label,
            "token_hash": hashlib.sha256(token.encode()).hexdigest(),
        })
        return {"badge": public_badge(rpc_row(rows)), "device_token": token}

    async def revoke(self, user_id, device_id):
        try:
            row = rpc_row(await self.repo.rpc("revoke_badge", {
                "p_user_id": user_id, "p_device_id": str(device_id),
            }))
        except AppError as exc:
            if exc.code == "operation_not_allowed":
                raise AppError(404, "badge_not_found", "Badge not found.") from None
            raise
        return {"badge": public_badge(row)}

    async def report(self, credentials, request: BadgeReport):
        if not credentials or credentials.scheme.lower() != "bearer":
            raise AppError(401, "badge_authentication_required", "A badge credential is required.")
        token = credentials.credentials
        match = TOKEN_PATTERN.fullmatch(token)
        try:
            device_id = str(UUID(match[1])) if match else None
        except ValueError:
            device_id = None
        if not device_id:
            raise AppError(401, "invalid_badge_credential", "Register the badge again in Settings.")
        try:
            row = rpc_row(await self.repo.rpc("report_badge_state", {
                "p_device_id": device_id,
                "p_token_hash": hashlib.sha256(token.encode()).hexdigest(),
                "p_sequence": request.sequence,
                "p_state": request.state,
            }))
        except AppError as exc:
            if exc.code == "operation_not_allowed":
                raise AppError(401, "invalid_badge_credential", "Register the badge again in Settings.") from None
            if exc.status == 409:
                raise AppError(409, "stale_badge_report", "This sequence is stale. If device storage was erased, register the badge again.") from None
            raise
        return {**public_badge(row), "heartbeat_seconds": HEARTBEAT_SECONDS, "lease_seconds": LEASE_SECONDS}

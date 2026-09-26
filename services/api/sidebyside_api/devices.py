"""Optional accessory ownership, presence and consent-gated approved AR fields."""

import hashlib
import re
import secrets
import time
from collections import OrderedDict
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request
from pydantic import Field, StrictBool, StringConstraints

from .auth import bearer, current_user
from .badges import MAX_SEQUENCE, BadgeRegistration, rpc_row
from .errors import AppError
from .models import StrictModel

PAIRING = re.compile(r"sbs_pair_([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})\Z")
HEADSET = re.compile(r"sbs_headset_([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})\Z")
FIELDS = ("device_id", "label", "created_at", "revoked_at", "last_seen_at", "lease_expires_at",
          "owner_lease_expires_at", "worn_reported", "app_foreground", "ar_enabled", "camera_ready", "tracker_ready")


class PairingRequest(BadgeRegistration):
    kind: Literal["quest", "core2"]


class HeadsetReport(StrictModel):
    sequence: Annotated[int, Field(strict=True, ge=1, le=MAX_SEQUENCE)]
    worn_reported: StrictBool | None
    app_foreground: StrictBool
    ar_enabled: StrictBool
    camera_ready: StrictBool
    tracker_ready: StrictBool


class DisplayPermission(StrictModel):
    granted: StrictBool
    revision: Annotated[int, Field(strict=True, ge=0, le=MAX_SEQUENCE)]


class TargetObservation(StrictModel):
    session_token: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{16}$")]
    tag_id: Annotated[int, Field(strict=True, ge=0, le=586)]
    marker_size_tenths_mm: Annotated[int, Field(strict=True, ge=1, le=10000)]


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def credential(credentials, pattern):
    match = pattern.fullmatch(credentials.credentials) if credentials and credentials.scheme.lower() == "bearer" else None
    try:
        if match:
            return str(UUID(match[1])), digest(credentials.credentials)
    except ValueError:
        pass
    raise AppError(401, "invalid_device_credential", "Pair this device again in Settings.")


def public_headset(row, at=None):
    result = {key: row.get(key) for key in FIELDS}
    at = at or datetime.now(UTC)
    def fresh(key):
        value = row.get(key)
        if isinstance(value, str):
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value is not None and value > at
    if row.get("revoked_at"):
        state = "revoked"
    elif not fresh("lease_expires_at") or not fresh("owner_lease_expires_at"):
        state = "offline"
    elif row.get("worn_reported") is None:
        state = "connected_unknown"
    elif row["worn_reported"] is False:
        state = "connected_not_worn"
    elif all(row.get(key) is True for key in ("app_foreground", "ar_enabled", "camera_ready", "tracker_ready")):
        state = "ar_ready"
    else:
        state = "ar_unavailable"
    return {**result, "effective_state": state}


class Devices:
    def __init__(self, repo):
        self.repo = repo
        self.claim_attempts = OrderedDict()

    def limit_claim(self, peer):
        # No forwarded headers: a caller cannot choose its rate-limit key.
        now = time.monotonic()
        start, count = self.claim_attempts.pop(peer, (now, 0))
        if now - start >= 60:
            start, count = now, 0
        self.claim_attempts[peer] = (start, count + 1)
        while len(self.claim_attempts) > 4096:
            self.claim_attempts.popitem(last=False)
        if count >= 20:
            raise AppError(429, "pairing_rate_limited", "Wait a minute before trying again.")

    async def pair(self, user_id, body):
        pairing_id = str(uuid4())
        token = f"sbs_pair_{pairing_id}.{secrets.token_urlsafe(32)}"
        result = await self.repo.rpc("approve_device_pairing", {
            "p_user_id": user_id, "p_pairing_id": pairing_id, "p_token_hash": digest(token),
            "p_kind": body.kind, "p_label": body.label,
        })
        return {"pairing_id": pairing_id, "pairing_token": token, "expires_at": result["expires_at"], "kind": body.kind}

    async def claim(self, credentials):
        pairing_id, token_hash = credential(credentials, PAIRING)
        secret = secrets.token_urlsafe(32)
        tokens = {kind: f"sbs_{kind}_{pairing_id}.{secret}" for kind in ("badge", "headset")}
        try:
            result = await self.repo.rpc("claim_device_pairing", {
                "p_pairing_id": pairing_id, "p_token_hash": token_hash,
                "p_badge_hash": digest(tokens["badge"]), "p_headset_hash": digest(tokens["headset"]),
            })
        except AppError as exc:
            if exc.code == "operation_not_allowed":
                raise AppError(401, "pairing_expired", "Pairing expired or was already used. Approve a new pairing.") from None
            raise
        kind = result["kind"]
        return {"device_id": pairing_id, "kind": kind, "device_token": tokens["badge" if kind == "core2" else "headset"]}

    async def report(self, credentials, body):
        device_id, token_hash = credential(credentials, HEADSET)
        try:
            row = rpc_row(await self.repo.rpc("report_headset_state", {
                "p_device_id": device_id, "p_token_hash": token_hash, "p_sequence": body.sequence,
                "p_observation": body.model_dump(exclude={"sequence"}),
            }))
        except AppError as exc:
            if exc.code == "operation_not_allowed":
                raise AppError(401, "invalid_device_credential", "Pair this headset again in Settings.") from None
            raise
        return {**public_headset(row), "heartbeat_seconds": 5, "lease_seconds": 15}

    async def reveal(self, credentials, body, application):
        device_id, token_hash = credential(credentials, HEADSET)
        params = {"p_device_id": device_id, "p_token_hash": token_hash,
                  **{f"p_{key}": value for key, value in body.model_dump().items()}}
        hidden = {"authorized": False, "display": None, "valid_until": None}
        try:
            grant = await self.repo.rpc("authorize_headset_target", params)
            if not grant:
                return hidden
            connection = await self.repo.one("connection_requests", {"request_id": f"eq.{grant['request_id']}"})
            if not connection:
                return hidden
            projection = await application.connection_projection(grant["viewer_id"], connection)
            if projection["status"] != "accepted" or not projection.get("preview"):
                return hidden
            # Recheck after the app's asynchronous projection. A changed permission,
            # connection or wearer cannot authorize a payload read under the old one.
            fresh = await self.repo.rpc("authorize_headset_target", params)
            if not fresh or {k: v for k, v in fresh.items() if k != "valid_until"} != {k: v for k, v in grant.items() if k != "valid_until"}:
                return hidden
        except AppError as exc:
            if exc.code == "operation_not_allowed":
                raise AppError(401, "invalid_device_credential", "Pair this headset again in Settings.") from None
            raise
        preview = projection["preview"]
        # These are the phone's user-approved preview fields, never inference inputs,
        # evidence, raw answers or the full profile. Mutual acceptance is stricter here.
        display = {"display_name": preview.get("display_name", "")[:80],
                   "interests": [str(v)[:60] for v in preview.get("interests", [])[:3]]}
        valid_until = min(datetime.fromisoformat(g["valid_until"].replace("Z", "+00:00")) for g in (grant, fresh))
        lifetime = min(5, (valid_until - datetime.now(UTC)).total_seconds())
        if lifetime <= 0:
            return hidden
        return {"authorized": True, "display": display, "valid_until": valid_until.isoformat(),
                "max_age_seconds": lifetime, **body.model_dump()}


def device_router(repo, application):
    router = APIRouter(prefix="/v1/devices")
    devices = Devices(repo)
    user = Annotated[str, Depends(current_user)]

    @router.post("/pairings", status_code=201)
    async def approve(body: PairingRequest, user_id: user):
        return await devices.pair(user_id, body)

    @router.post("/pairings/claim", status_code=201)
    async def claim(request: Request):
        devices.limit_claim(request.client.host if request.client else "unknown")
        return await devices.claim(await bearer(request))

    @router.delete("/pairings/{pairing_id}")
    async def cancel(pairing_id: UUID, user_id: user):
        await repo.rpc("cancel_device_pairing", {"p_user_id": user_id, "p_pairing_id": str(pairing_id)})
        return {"cancelled": True}

    @router.get("/headsets")
    async def listing(user_id: user):
        rows = await repo.select("headset_devices", {"user_id": f"eq.{user_id}"}, columns=",".join(FIELDS), order="created_at.desc")
        return {"headsets": [public_headset(row) for row in rows]}

    @router.put("/headsets/state")
    async def report(body: HeadsetReport, request: Request):
        return await devices.report(await bearer(request), body)

    @router.put("/headsets/{device_id}/lease")
    async def renew(device_id: UUID, user_id: user):
        row = await repo.rpc("renew_headset_owner_lease", {"p_user_id": user_id, "p_device_id": str(device_id)})
        return public_headset(rpc_row(row))

    @router.delete("/headsets/{device_id}")
    async def revoke(device_id: UUID, user_id: user):
        row = await repo.rpc("revoke_headset", {"p_user_id": user_id, "p_device_id": str(device_id)})
        return public_headset(rpc_row(row))

    @router.post("/signout")
    async def signout(user_id: user):
        await repo.rpc("end_device_sessions", {"p_user_id": user_id})
        return {"ended": True}

    @router.get("/connections/{request_id}/display")
    async def display_permission(request_id: UUID, user_id: user):
        return await repo.rpc("connection_display_permission", {"p_user_id": user_id, "p_request_id": str(request_id)})

    @router.put("/connections/{request_id}/display")
    async def set_display_permission(request_id: UUID, body: DisplayPermission, user_id: user):
        return await repo.rpc("connection_display_permission", {"p_user_id": user_id, "p_request_id": str(request_id),
                               "p_granted": body.granted, "p_revision": body.revision})

    @router.post("/headsets/reveal")
    async def reveal(body: TargetObservation, request: Request):
        return await devices.reveal(await bearer(request), body, application)

    return router

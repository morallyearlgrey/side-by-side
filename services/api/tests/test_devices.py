from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi.security import HTTPAuthorizationCredentials
from sidebyside_api.config import Settings
from sidebyside_api.devices import Devices, TargetObservation, digest, public_headset
from sidebyside_api.errors import AppError
from sidebyside_api.main import create_app


class Auth:
    def __init__(self, owner):
        self.owner = owner

    async def verify(self, credentials):
        if not credentials or credentials.credentials != "account-session":
            raise AppError(401, "invalid_session", "Sign in.")
        return self.owner


@pytest.fixture
async def device_api(repo):
    owner = str(uuid4())
    async with httpx.AsyncClient() as server:
        app = create_app(Settings(_env_file=None, worker_enabled=False), repository=repo, authenticator=Auth(owner), client=server)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="https://test") as client:
            yield client, owner, {"Authorization": "Bearer account-session"}


async def test_approval_uses_authenticated_owner_and_hashes_one_time_secret(repo, device_api):
    client, owner, headers = device_api
    repo.rpc_values["approve_device_pairing"] = {"expires_at": "2026-09-26T12:03:00Z"}
    response = await client.post("/v1/devices/pairings", headers=headers, json={"kind": "quest", "label": "Quest"})
    assert response.status_code == 201
    result = response.json()
    assert response.headers["cache-control"] == "no-store"
    call = repo.calls[-1][2]
    assert call["p_user_id"] == owner and call["p_token_hash"] == digest(result["pairing_token"])
    assert result["pairing_token"] not in str(repo.calls)
    assert "user_id" not in result
    assert (await client.post("/v1/devices/pairings", headers=headers,
        json={"kind": "quest", "user_id": str(uuid4())})).status_code == 422


@pytest.mark.parametrize("kind,prefix", [("core2", "badge"), ("quest", "headset")])
async def test_claim_issues_only_scoped_credentials(repo, device_api, kind, prefix):
    client, _, _ = device_api
    id = str(uuid4())
    repo.rpc_values["claim_device_pairing"] = {"kind": kind}
    token = f"sbs_pair_{id}.{'a' * 43}"
    response = await client.post("/v1/devices/pairings/claim", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 201
    result = response.json()
    assert result["device_token"].startswith(f"sbs_{prefix}_{id}.")
    call = repo.calls[-1][2]
    assert call[f"p_{prefix}_hash"] == digest(result["device_token"])
    assert result["device_token"] not in str(repo.calls)
    assert token not in str(repo.calls)
    headers = {"Authorization": "Bearer " + result["device_token"]}
    assert (await client.get("/v1/connections", headers=headers)).status_code == 401
    assert (await client.post("/v1/devices/pairings", headers=headers, json={"kind": "quest"})).status_code == 401


async def test_headset_reports_require_device_credential_and_strict_sensor_values(repo, device_api):
    client, _, headers = device_api
    body = {"sequence": 1, "worn_reported": None, "app_foreground": True, "ar_enabled": True, "camera_ready": True, "tracker_ready": True}
    assert (await client.put("/v1/devices/headsets/state", headers=headers, json=body)).status_code == 401
    device_id = str(uuid4())
    headers = {"Authorization": f"Bearer sbs_headset_{device_id}.{'a' * 43}"}
    repo.rpc_values["report_headset_state"] = {"device_id": device_id}
    response = await client.put("/v1/devices/headsets/state", headers=headers, json=body)
    assert response.status_code == 200 and response.json()["effective_state"] == "offline"
    for update in ({"user_id": str(uuid4())}, {"worn_reported": "true"}, {"sequence": True}, {"lease_expires_at": "later"}):
        assert (await client.put("/v1/devices/headsets/state", headers=headers, json=body | update)).status_code == 422


def test_presence_distinguishes_unknown_not_worn_unavailable_and_ready():
    now = datetime.now(UTC)
    row = {"lease_expires_at": now + timedelta(seconds=15), "owner_lease_expires_at": now + timedelta(seconds=30),
           "worn_reported": None, "app_foreground": True, "ar_enabled": True, "camera_ready": True, "tracker_ready": True}
    assert public_headset(row, now)["effective_state"] == "connected_unknown"
    row["worn_reported"] = False
    assert public_headset(row, now)["effective_state"] == "connected_not_worn"
    row["worn_reported"] = True
    assert public_headset(row, now)["effective_state"] == "ar_ready"
    row["ar_enabled"] = False
    assert public_headset(row, now)["effective_state"] == "ar_unavailable"
    assert public_headset(row, now + timedelta(seconds=15))["effective_state"] == "offline"
    row["revoked_at"] = now
    assert public_headset(row, now)["effective_state"] == "revoked"


@pytest.mark.parametrize("guard,projection_status", [(None, "accepted"), ({}, "accepted"), (True, "pending"), (True, "revoked"), (True, "profile_changed")])
async def test_reveal_denied_without_both_sql_guard_and_app_acceptance(repo, guard, projection_status):
    grant = {"request_id": str(uuid4()), "viewer_id": str(uuid4()), "valid_until": (datetime.now(UTC)+timedelta(seconds=5)).isoformat()}
    repo.rpc_values["authorize_headset_target"] = grant if guard else guard
    repo.tables["connection_requests"] = [{"request_id": grant["request_id"]}]
    app = SimpleNamespace(connection_projection=AsyncMock(return_value={"status": projection_status, "preview": {"display_name": "Synthetic"}}))
    token = HTTPAuthorizationCredentials(scheme="Bearer", credentials=f"sbs_headset_{uuid4()}.{'a'*43}")
    result = await Devices(repo).reveal(token, TargetObservation(session_token="0011223344556677", tag_id=1, marker_size_tenths_mm=203), app)
    assert result == {"authorized": False, "display": None, "valid_until": None}
    if not guard:
        app.connection_projection.assert_not_called()


async def test_reveal_whitelists_phone_approved_fields_and_rechecks_revocation(repo):
    grant = {"request_id": str(uuid4()), "viewer_id": str(uuid4()), "wearer_id": str(uuid4()), "valid_until": (datetime.now(UTC)+timedelta(seconds=4)).isoformat()}
    repo.rpc_values["authorize_headset_target"] = grant
    repo.tables["connection_requests"] = [{"request_id": grant["request_id"]}]
    app = SimpleNamespace(connection_projection=AsyncMock(return_value={"status": "accepted", "preview": {
        "display_name": "Synthetic", "headline": "Approved", "interests": ["Ceramics"], "raw_answers": "private"},
        "shared_profile": {"facts": [{"details": "not part of minimal AR payload"}]}}))
    token = HTTPAuthorizationCredentials(scheme="Bearer", credentials=f"sbs_headset_{uuid4()}.{'a'*43}")
    target = TargetObservation(session_token="0011223344556677", tag_id=1, marker_size_tenths_mm=203)
    result = await Devices(repo).reveal(token, target, app)
    assert result["authorized"] and 0 < result["max_age_seconds"] <= 4
    assert result["display"] == {"display_name": "Synthetic", "interests": ["Ceramics"]}
    assert "private" not in str(result) and "viewer_id" not in result and "wearer_id" not in result
    repo.rpc = AsyncMock(side_effect=[grant, None])
    assert (await Devices(repo).reveal(token, target, app))["display"] is None


def test_pairing_claim_rate_limit():
    devices = Devices(None)
    for _ in range(20):
        devices.limit_claim("peer")
    with pytest.raises(AppError) as error:
        devices.limit_claim("peer")
    assert error.value.status == 429

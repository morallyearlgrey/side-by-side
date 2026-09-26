import hashlib
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from conftest import iso
from fastapi.security import HTTPAuthorizationCredentials
from sidebyside_api.badges import BadgeReport, Badges, public_badge
from sidebyside_api.config import Settings
from sidebyside_api.errors import AppError
from sidebyside_api.main import create_app
from sidebyside_api.repository import Repository


def badge_row(owner=None, **values):
    return {
        "device_id": str(uuid4()), "user_id": owner or str(uuid4()),
        "token_hash": "1" * 64, "label": "Core2", "reported_state": "paused",
        "last_sequence": 0, "last_seen_at": None, "lease_expires_at": None,
        "created_at": iso(), "revoked_at": None, **values,
    }


class AccountAuth:
    def __init__(self, user_id):
        self.user_id = user_id

    async def verify(self, credentials):
        if not credentials or credentials.credentials != "verified-account-session":
            raise AppError(401, "invalid_session", "Sign in.")
        return self.user_id


@pytest.fixture
async def badge_api(repo):
    owner = str(uuid4())
    settings = Settings(_env_file=None, worker_enabled=False)
    async with httpx.AsyncClient() as server_http:
        app = create_app(settings, repository=repo, authenticator=AccountAuth(owner), client=server_http)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="https://test") as client:
            yield client, owner, {"Authorization": "Bearer verified-account-session"}


async def test_registration_binds_verified_owner_and_returns_secret_only_once(repo, badge_api):
    client, owner, headers = badge_api
    response = await client.post("/v1/badges", json={"label": "  My Core2  "}, headers=headers)
    assert response.status_code == 201
    created = response.json()
    token = created["device_token"]
    row = repo.tables["badge_devices"][0]
    assert row["user_id"] == owner
    assert row["label"] == "My Core2"
    assert token.startswith(f"sbs_badge_{row['device_id']}.")
    assert row["token_hash"] == hashlib.sha256(token.encode()).hexdigest()
    assert token not in str(repo.tables)
    assert "user_id" not in created["badge"] and "token_hash" not in created["badge"]
    assert created["badge"]["effective_state"] == "offline"
    assert response.headers["Cache-Control"] == "no-store"
    listing = await client.get("/v1/badges", headers=headers)
    assert listing.status_code == 200 and token not in listing.text
    assert "token_hash" not in listing.text
    assert "consent_receipts" not in repo.tables


async def test_list_is_owner_scoped_with_expiring_status(repo, badge_api):
    client, owner, headers = badge_api
    own = badge_row(owner, reported_state="available", lease_expires_at=iso(30))
    stale = badge_row(owner, reported_state="available", lease_expires_at=iso(-1))
    repo.tables["badge_devices"] = [own, stale, badge_row()]
    response = await client.get("/v1/badges", headers=headers)
    statuses = {row["device_id"]: row["effective_state"] for row in response.json()["badges"]}
    assert statuses == {own["device_id"]: "available", stale["device_id"]: "offline"}


@pytest.mark.parametrize("payload", [
    {"label": " "}, {"label": "x" * 65}, {"label": "Badge", "user_id": str(uuid4())},
    {"label": "Badge", "token_hash": "1" * 64},
])
async def test_registration_rejects_identity_or_invalid_label(repo, badge_api, payload):
    client, _, headers = badge_api
    assert (await client.post("/v1/badges", json=payload, headers=headers)).status_code == 422
    assert "badge_devices" not in repo.tables


async def test_account_session_cannot_report_badge_and_badge_token_cannot_manage_account(repo, badge_api):
    client, _, headers = badge_api
    response = await client.put("/v1/badges/state", json={"state": "paused", "sequence": 1}, headers=headers)
    assert response.status_code == 401
    token = f"sbs_badge_{uuid4()}.{'x' * 43}"
    device_headers = {"Authorization": f"Bearer {token}"}
    assert (await client.get("/v1/badges", headers=device_headers)).status_code == 401
    assert (await client.post("/v1/badges", json={}, headers=device_headers)).status_code == 401
    assert (await client.patch("/v1/settings", json={"discoverable": True}, headers=device_headers)).status_code == 401
    assert not repo.calls


async def test_report_passes_only_hashed_credential_and_validated_state_to_atomic_rpc(repo, badge_api):
    client, _, _ = badge_api
    row = badge_row(reported_state="available", last_sequence=1025, lease_expires_at=iso(45))
    repo.rpc_values["report_badge_state"] = row
    token = f"sbs_badge_{row['device_id']}.{'x' * 43}"
    response = await client.put("/v1/badges/state", json={"state": "available", "sequence": 1025},
                                headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert repo.calls == [("rpc", "report_badge_state", {
        "p_device_id": row["device_id"], "p_token_hash": hashlib.sha256(token.encode()).hexdigest(),
        "p_state": "available", "p_sequence": 1025,
    })]
    assert response.json()["effective_state"] == "available"
    assert response.json()["lease_seconds"] == 45 and response.json()["heartbeat_seconds"] == 15
    assert token not in response.text and "token_hash" not in response.text and "user_id" not in response.text


@pytest.mark.parametrize("payload", [
    {"state": "available", "sequence": True}, {"state": "available", "sequence": "1"},
    {"state": "available", "sequence": 1.0}, {"state": "available", "sequence": 0},
    {"state": "available", "sequence": 9007199254740992}, {"state": "unknown", "sequence": 1},
    {"state": "paused", "sequence": 1, "user_id": str(uuid4())},
    {"state": "available", "sequence": 1, "lease_expires_at": iso(3600)},
])
async def test_device_cannot_choose_owner_lease_or_invalid_sequence(repo, badge_api, payload):
    client, _, _ = badge_api
    token = f"sbs_badge_{uuid4()}.{'x' * 43}"
    response = await client.put("/v1/badges/state", json=payload, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 422 and not repo.calls


@pytest.mark.parametrize(("sqlcode", "http_status", "status", "code"), [
    ("42501", 403, 401, "invalid_badge_credential"), ("40001", 400, 409, "stale_badge_report"),
    ("PT409", 409, 409, "stale_badge_report"), ("XX000", 500, 503, "database_error"),
])
async def test_sql_auth_and_sequence_failures_have_safe_device_errors(sqlcode, http_status, status, code):
    settings = Settings(_env_file=None, supabase_url="https://test.supabase.co", supabase_service_role_key="server-secret")
    token = f"sbs_badge_{uuid4()}.{'x' * 43}"
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: httpx.Response(http_status, json={"code": sqlcode, "message": "private SQL"}),
    )) as http:
        with pytest.raises(AppError) as error:
            await Badges(Repository(settings, http)).report(
                HTTPAuthorizationCredentials(scheme="Bearer", credentials=token), BadgeReport(state="paused", sequence=1))
    assert error.value.status == status and error.value.code == code
    assert "private SQL" not in str(error.value) and token not in str(error.value)


async def test_revoke_is_owner_scoped_and_never_returns_hash(repo, badge_api):
    client, owner, headers = badge_api
    row = badge_row(owner, revoked_at=iso())
    repo.rpc_values["revoke_badge"] = row
    response = await client.delete(f"/v1/badges/{row['device_id']}", headers=headers)
    assert response.status_code == 200 and response.json()["badge"]["effective_state"] == "revoked"
    assert repo.calls == [("rpc", "revoke_badge", {"p_user_id": owner, "p_device_id": row["device_id"]})]
    assert "token_hash" not in response.text


def test_lease_boundary_and_revocation_override_last_report():
    at = datetime.now(UTC)
    row = badge_row(reported_state="available", lease_expires_at=at.isoformat())
    assert public_badge(row, at=at)["effective_state"] == "offline"
    row["lease_expires_at"] = (at + timedelta(seconds=45)).isoformat()
    row["revoked_at"] = at.isoformat()
    assert public_badge(row, at=at)["effective_state"] == "revoked"

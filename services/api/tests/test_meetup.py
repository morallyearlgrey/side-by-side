from uuid import uuid4

import httpx
import pytest
from conftest import iso
from sidebyside_api.config import Settings
from sidebyside_api.errors import AppError
from sidebyside_api.main import create_app


class AccountAuth:
    def __init__(self, user_id):
        self.user_id = user_id

    async def verify(self, credentials):
        if not credentials or credentials.credentials != "verified-session":
            raise AppError(401, "invalid_session", "Sign in.")
        return self.user_id


@pytest.fixture
async def meetup_api(repo):
    owner, other, request_id = (str(uuid4()) for _ in range(3))
    repo.tables["connection_requests"] = [{"request_id": request_id, "requester_user_id": owner, "recipient_user_id": other}]
    repo.rpc_values["connection_meetup"] = {"status": "waiting", "me": None, "peer": None}
    async with httpx.AsyncClient() as network:
        app = create_app(Settings(_env_file=None, worker_enabled=False), repository=repo,
                         authenticator=AccountAuth(owner), client=network)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="https://test") as client:
            yield client, owner, f"/v1/connections/{request_id}/location", {"Authorization": "Bearer verified-session"}


def point():
    return {"latitude": 40.7128, "longitude": -74.006, "accuracy_m": 10, "observed_at": iso()}


@pytest.mark.parametrize("method,action", [("GET", "read"), ("POST", "start"), ("PATCH", "update"), ("DELETE", "stop")])
async def test_routes_bind_verified_actor_and_never_cache(repo, meetup_api, method, action):
    client, owner, path, headers = meetup_api
    share_id = str(uuid4())
    body = point() if method in ("POST", "PATCH") else {}
    if method in ("PATCH", "DELETE"):
        body["share_id"] = share_id
    response = await client.request(method, path, headers=headers, **({"json": body} if method != "GET" else {}))
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    call = next(call for call in repo.calls if call[:2] == ("rpc", "connection_meetup"))
    assert call[2]["p_user_id"] == owner and call[2]["p_action"] == action
    assert call[2]["p_share_id"] == (share_id if method in ("PATCH", "DELETE") else None)
    assert call[2]["p_point"] is None if method in ("GET", "DELETE") else set(call[2]["p_point"]) == set(point())


@pytest.mark.parametrize("token", [None, "demo-worker-capability", "badge-token"])
async def test_worker_badge_or_anonymous_cannot_read_locations(repo, meetup_api, token):
    client, _, path, _ = meetup_api
    response = await client.get(path, headers={"Authorization": f"Bearer {token}"} if token else {})
    assert response.status_code == 401 and not repo.calls


async def test_outsider_or_missing_connection_is_not_disclosed(repo, meetup_api):
    client, _, path, headers = meetup_api
    repo.tables["connection_requests"][0]["requester_user_id"] = str(uuid4())
    assert (await client.get(path, headers=headers)).status_code == 404
    repo.tables["connection_requests"] = []
    assert (await client.get(path, headers=headers)).status_code == 404
    assert not any(call[:2] == ("rpc", "connection_meetup") for call in repo.calls)


@pytest.mark.parametrize("patch", [{"user_id": str(uuid4())}, {"expires_at": iso(86400)}, {"latitude": 91}, {"longitude": -181}, {"accuracy_m": -1}, {"observed_at": "not-a-date"}])
async def test_client_cannot_choose_identity_or_expiry_or_invalid_point(repo, meetup_api, patch):
    client, _, path, headers = meetup_api
    response = await client.post(path, headers=headers, json={**point(), **patch})
    assert response.status_code == 422 and not repo.calls


@pytest.mark.parametrize("method", ["PATCH", "DELETE"])
async def test_refresh_and_stop_require_lease_identifier(repo, meetup_api, method):
    client, _, path, headers = meetup_api
    response = await client.request(method, path, headers=headers, json=point() if method == "PATCH" else {})
    assert response.status_code == 422 and not repo.calls

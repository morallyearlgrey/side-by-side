from uuid import uuid4

import httpx
import pytest
from sidebyside_api.config import Settings
from sidebyside_api.errors import AppError
from sidebyside_api.location_map import LocationMap
from sidebyside_api.main import create_app


class AccountAuth:
    def __init__(self, user_id):
        self.user_id = user_id

    async def verify(self, credentials):
        if not credentials or credentials.credentials != "verified-session":
            raise AppError(401, "invalid_session", "Sign in.")
        return self.user_id


async def test_map_uses_one_atomic_service_only_privacy_boundary(repo):
    user_id = str(uuid4())
    expected = {"status": "off", "me": None, "items": [], "valid_until": None,
                "refresh_after_seconds": 15}
    repo.rpc_values["discovery_location_map"] = expected
    assert await LocationMap(repo).state(user_id) == expected
    assert repo.calls == [("rpc", "discovery_location_map", {"p_viewer_id": user_id})]


@pytest.fixture
async def map_api(repo):
    owner = str(uuid4())
    repo.rpc_values["discovery_location_map"] = {"status": "off", "me": None, "items": [],
        "valid_until": None, "refresh_after_seconds": 15}
    async with httpx.AsyncClient() as network:
        app = create_app(Settings(_env_file=None, worker_enabled=False), repository=repo,
                         authenticator=AccountAuth(owner), client=network)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="https://test") as client:
            yield client, owner


async def test_route_binds_verified_actor_and_forbids_caching(repo, map_api):
    client, owner = map_api
    response = await client.get("/v1/discovery/location-map", headers={"Authorization": "Bearer verified-session"},
                                params={"user_id": str(uuid4())})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert repo.calls == [("rpc", "discovery_location_map", {"p_viewer_id": owner})]


@pytest.mark.parametrize("token", [None, "model-worker", "badge-token"])
async def test_locations_require_user_session_and_cannot_be_read_by_worker(repo, map_api, token):
    client, _ = map_api
    response = await client.get("/v1/discovery/location-map", headers={"Authorization": f"Bearer {token}"} if token else {})
    assert response.status_code == 401
    assert not repo.calls

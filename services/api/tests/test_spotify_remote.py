from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import httpx
import pytest
from conftest import iso
from cryptography.fernet import Fernet
from sidebyside_api.config import Settings
from sidebyside_api.errors import AppError
from sidebyside_api.jobs import MatchingJobs
from sidebyside_api.matching import PIPELINE, MatchingRuntime
from sidebyside_api.spotify import Spotify


def spotify_settings():
    return Settings(_env_file=None, spotify_client_id="client-id", spotify_redirect_uri="https://api.example.test/v1/integrations/spotify/callback",
                    spotify_token_encryption_key=Fernet.generate_key().decode())


async def test_spotify_missing_config_honestly_unavailable(repo):
    async with httpx.AsyncClient() as client:
        provider = Spotify(repo, Settings(_env_file=None), client)
        assert provider.readiness()["available"] is False
        with pytest.raises(AppError) as error:
            await provider.connect(str(uuid4()))
        assert error.value.code == "spotify_not_configured"


async def test_pkce_state_expiry_replay_encryption_and_disconnect(repo):
    requests = []

    def handler(request):
        requests.append(request)
        if request.url.path == "/api/token":
            return httpx.Response(200, json={"access_token": "provider-access-secret", "refresh_token": "provider-refresh-secret", "scope": "user-read-private", "expires_in": 3600})
        if request.url.path == "/v1/me":
            return httpx.Response(200, json={"id": "spotify-test-user", "display_name": "Owner display", "email": "private@example.com",
                "external_urls": {"spotify": "https://open.spotify.com/user/test"}})
        raise AssertionError("Unexpected external request")

    user_id = str(uuid4())
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = Spotify(repo, spotify_settings(), client)
        auth = await provider.connect(user_id)
        query = parse_qs(urlparse(auth["authorization_url"]).query)
        assert query["code_challenge_method"] == ["S256"]
        assert query["scope"] == ["user-read-private"]
        state = query["state"][0]
        saved = repo.tables["provider_oauth_states"][0]
        assert state not in str(saved)
        assert "code_verifier" not in query
        assert await provider.callback(state, "auth-code") is True
        assert requests[0].url.host == "accounts.spotify.com"
        assert requests[1].url.host == "api.spotify.com"
        encoded = repo.tables["provider_connections"][0]
        assert "provider-access-secret" not in str(encoded)
        assert "provider-refresh-secret" not in str(encoded)
        with pytest.raises(AppError) as error:
            await provider.callback(state, "auth-code")
        assert error.value.code == "invalid_oauth_state"
        owner = await provider.status(user_id)
        assert owner["connected"] and not owner["matching_supported"]
        assert "private@example.com" not in str(owner) and "encrypted_token" not in str(owner)
        await provider.disconnect(user_id)
        assert repo.tables["provider_connections"][0]["encrypted_token"] is None
        assert repo.tables["provider_connections"][0]["display_data"] == {}
        assert not repo.tables["provider_oauth_states"]


async def test_expired_state_never_calls_spotify(repo):
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: pytest.fail("Expired state called provider"))) as client:
        provider = Spotify(repo, spotify_settings(), client)
        authorization = await provider.connect(str(uuid4()))
        state = parse_qs(urlparse(authorization["authorization_url"]).query)["state"][0]
        repo.tables["provider_oauth_states"][0]["expires_at"] = iso(-100)
        with pytest.raises(AppError):
            await provider.callback(state, "code")


async def test_cancelled_oauth_does_not_connect(repo):
    async with httpx.AsyncClient() as client:
        provider = Spotify(repo, spotify_settings(), client)
        authorization = await provider.connect(str(uuid4()))
        state = parse_qs(urlparse(authorization["authorization_url"]).query)["state"][0]
        assert not await provider.callback(state, error="access_denied")
        assert "provider_connections" not in repo.tables


async def test_remote_readiness_requires_fresh_matching_model_heartbeat(repo):
    settings = Settings(_env_file=None, matching_execution="remote")
    jobs = MatchingJobs(repo, MatchingRuntime(settings), settings)
    metadata = await jobs.model_readiness()
    assert not metadata["available"] and metadata["reason"] == "remote_worker_not_connected"
    heartbeat = {"worker_id": str(uuid4()), "model_id": settings.matching_model_id, "model_revision": settings.matching_model_revision,
                 "pipeline_version": PIPELINE, "status": "ready", "reason": None, "updated_at": iso(), "expires_at": iso(60)}
    repo.tables["model_worker_heartbeats"] = [heartbeat]
    metadata = await jobs.model_readiness()
    assert metadata["available"] is True and metadata["execution"] == "remote"
    heartbeat["expires_at"] = iso(-1)
    assert not (await jobs.model_readiness())["available"]
    heartbeat["expires_at"] = iso(60)
    heartbeat["model_revision"] = "old-model"
    assert not (await jobs.model_readiness())["available"]


async def test_api_remote_mode_does_not_warm_or_spawn_local_inference_worker(repo):
    from sidebyside_api.main import create_app

    class ForbiddenRuntime(MatchingRuntime):
        async def warm(self):
            pytest.fail("Remote API attempted to load local weights")
    settings = Settings(_env_file=None, matching_execution="remote", matching_warm_on_startup=True,
                        worker_enabled=True, supabase_url="https://project.test", supabase_service_role_key="key")
    app = create_app(settings, repository=repo, runtime=ForbiddenRuntime(settings))
    async with app.router.lifespan_context(app):
        assert not any(call[:2] == ("rpc", "claim_matching_jobs") for call in repo.calls)

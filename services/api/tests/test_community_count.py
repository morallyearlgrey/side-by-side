"""The home count is live account data and requires an authenticated caller."""

from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from pydantic import SecretStr
from sidebyside_api.config import Settings
from sidebyside_api.errors import AppError
from sidebyside_api.main import create_app
from sidebyside_api.repository import Repository
from test_meetup import AccountAuth


async def test_community_count_requires_auth_and_returns_only_aggregate(repo):
    repo.account_count = AsyncMock(return_value=9)
    app = create_app(Settings(_env_file=None, worker_enabled=False), repository=repo,
        authenticator=AccountAuth(str(uuid4())))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
        assert (await client.get('/v1/community/count')).status_code == 401
        response = await client.get('/v1/community/count', headers={'Authorization': 'Bearer verified-session'})
    assert response.status_code == 200 and response.json() == {'users': 9}
    assert response.headers['cache-control'] == 'no-store'
    repo.account_count.assert_awaited_once()


async def test_repository_reads_exact_count_header_without_profile_rows():
    async def respond(request):
        assert request.method == 'HEAD'
        assert request.url.path == '/rest/v1/profiles'
        assert request.headers['prefer'] == 'count=exact'
        return httpx.Response(200, headers={'Content-Range': '0-8/9'})
    settings = Settings(_env_file=None, supabase_url='https://example.supabase.co',
        supabase_service_role_key=SecretStr('test-key'))
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        assert await Repository(settings, client).account_count() == 9


async def test_repository_fails_when_count_header_is_missing():
    settings = Settings(_env_file=None, supabase_url='https://example.supabase.co',
        supabase_service_role_key=SecretStr('test-key'))
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
        with pytest.raises(AppError) as error:
            await Repository(settings, client).account_count()
    assert error.value.code == 'database_error'

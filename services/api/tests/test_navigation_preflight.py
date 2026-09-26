import json

import httpx
import pytest
from sidebyside_api.config import Settings
from sidebyside_api.errors import AppError
from sidebyside_api.navigation_preflight import PROBE_USER, check_navigation
from sidebyside_api.repository import Repository


def settings():
    return Settings(_env_file=None, supabase_url="https://test.supabase.co",
                    supabase_service_role_key="server-secret")


@pytest.mark.parametrize("code", ["PGRST202", "PGRST205"])
async def test_schema_errors_are_specific_and_sanitized(code):
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda _: httpx.Response(404, json={"code": code, "message": "private SQL",
                                           "hint": "private hint", "details": "private data"}),
    )) as client:
        with pytest.raises(AppError) as error:
            await Repository(settings(), client).rpc("navigation_constellation", {"p_user_id": PROBE_USER})
    assert error.value.status == 503
    assert error.value.code == "database_schema_unavailable"
    assert "database API" in error.value.message
    assert "private" not in error.value.message


@pytest.mark.parametrize("payload", [[], None, "private SQL", {"code": "XX000"}])
async def test_other_errors_keep_generic_sanitized_status(payload):
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda _: httpx.Response(500, content=json.dumps(payload)),
    )) as client:
        with pytest.raises(AppError) as error:
            await Repository(settings(), client).rpc("navigation_constellation", {"p_user_id": PROBE_USER})
    assert error.value.status == 503 and error.value.code == "database_error"
    assert "private" not in error.value.message


@pytest.mark.parametrize("failure", [None, "missing_function", "missing_table", "bad_contract", "probe_exists"])
async def test_read_only_preflight_checks_rest_contract_without_real_profiles(failure):
    calls = []

    def respond(request):
        calls.append(request)
        path = request.url.path
        assert request.headers["authorization"] == "Bearer server-secret"
        if path == "/rest/v1/profiles":
            assert request.method == "GET"
            assert dict(request.url.params) == {
                "select": "user_id", "user_id": f"eq.{PROBE_USER}", "limit": "1",
            }
            return httpx.Response(200, json=[{"user_id": PROBE_USER}] if failure == "probe_exists" else [])
        if path == "/rest/v1/match_preferences":
            assert request.method == "GET"
            assert dict(request.url.params) == {"select": "preference", "limit": "0"}
            return httpx.Response(404, json={"code": "PGRST205"}) if failure == "missing_table" else httpx.Response(200, json=[])
        assert request.method == "POST"
        body = json.loads(request.content)
        if path == "/rest/v1/rpc/navigation_constellation":
            assert body == {"p_user_id": PROBE_USER}
            if failure == "missing_function":
                return httpx.Response(404, json={"code": "PGRST202"})
            return httpx.Response(200, json={} if failure == "bad_contract" else {"nodes": []})
        assert path == "/rest/v1/rpc/navigation_connections_page"
        assert body == {"p_user_id": PROBE_USER, "p_query": "", "p_filter": "all", "p_page": 1}
        return httpx.Response(200, json={"items": [], "page": 1, "pages": 1, "total": 0, "page_size": 6})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        if failure:
            with pytest.raises(AppError) as error:
                await check_navigation(Repository(settings(), client))
            expected = {"missing_function": "database_schema_unavailable", "missing_table": "database_schema_unavailable",
                        "bad_contract": "navigation_contract_mismatch", "probe_exists": "probe_user_exists"}
            assert error.value.code == expected[failure]
        else:
            await check_navigation(Repository(settings(), client))
    assert len(calls) == (1 if failure == "probe_exists" else 2 if failure == "missing_function" else 4)

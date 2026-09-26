import json
from uuid import uuid4

import httpx
import pytest
from conftest import profile_record
from fastapi.security import HTTPAuthorizationCredentials
from sidebyside_api.auth import SupabaseAuthenticator
from sidebyside_api.config import Settings
from sidebyside_api.errors import AppError
from sidebyside_api.main import create_app
from sidebyside_api.models import MessageRequest, MuseReply, ProfileDraft
from sidebyside_api.onboarding import OPENING, MuseProvider, Onboarding, validate_evidence


async def test_user_header_cannot_replace_verified_bearer():
    app = create_app(Settings(_env_file=None, worker_enabled=False))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
        response = await client.get("/v1/me", headers={"X-User-ID": str(uuid4())})
    assert response.status_code == 401


async def test_supabase_verifies_bearer_not_just_decodes_claims():
    user_id = str(uuid4())
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"id": user_id, "is_anonymous": False})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        settings = Settings(_env_file=None, supabase_url="https://project.supabase.co", supabase_anon_key="test-key")
        auth = SupabaseAuthenticator(settings, client)
        result = await auth.verify(HTTPAuthorizationCredentials(scheme="Bearer", credentials="signed-token"))
    assert result == user_id
    assert seen[0].url.path == "/auth/v1/user"
    assert seen[0].headers["Authorization"] == "Bearer signed-token"


@pytest.mark.parametrize("response", [{"id": "invalid"}, {"id": str(uuid4()), "is_anonymous": True}])
async def test_invalid_or_anonymous_auth_rejected(response):
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=response))) as client:
        auth = SupabaseAuthenticator(Settings(_env_file=None, supabase_url="https://example.test", supabase_anon_key="key"), client)
        with pytest.raises(AppError) as error:
            await auth.verify(HTTPAuthorizationCredentials(scheme="Bearer", credentials="token"))
        assert error.value.status == 401


class RetryProvider:
    def __init__(self):
        self.failed = True
        self.calls = 0

    def readiness(self):
        return {"available": True}

    async def next_turn(self, turns, answers):
        self.calls += 1
        if self.failed:
            raise AppError(503, "provider_error", "Retry")
        return MuseReply(question="What would you like to learn next?", question_key="goals", ready_for_review=False, draft=ProfileDraft())


async def test_onboarding_saves_answer_before_failure_and_retries_idempotently(repo):
    provider = RetryProvider()
    onboarding = Onboarding(repo, provider)
    user_id = str(uuid4())
    session = await onboarding.session(user_id)
    assert session["turns"][0]["content"] == OPENING
    request = MessageRequest(message_id=uuid4(), content="I enjoy pottery")
    first = await onboarding.send(user_id, request)
    assert first["error"]["code"] == "provider_error"
    assert len(repo.tables["onboarding_answers"]) == 1
    assert first["turns"][-1]["content"] == request.content
    provider.failed = False
    second = await onboarding.send(user_id, request)
    assert second["turns"][-1]["role"] == "assistant"
    third = await onboarding.send(user_id, request)
    assert len(third["turns"]) == 3
    assert provider.calls == 2
    assert len(repo.tables["onboarding_answers"]) == 1


async def test_retry_uuid_cannot_replace_original_answer(repo):
    onboarding = Onboarding(repo, RetryProvider())
    user_id, message_id = str(uuid4()), uuid4()
    await onboarding.send(user_id, MessageRequest(message_id=message_id, content="Original"))
    with pytest.raises(AppError) as error:
        await onboarding.send(user_id, MessageRequest(message_id=message_id, content="Changed"))
    assert error.value.code == "message_id_reused"


def test_evidence_must_quote_real_owner_answer():
    row = profile_record()
    draft = ProfileDraft.model_validate({key: row[key] for key in ProfileDraft.model_fields})
    validate_evidence(draft, row["onboarding_answers"])
    draft.facts[0].evidence[0].support = "I am a master potter"
    with pytest.raises(AppError, match="exact excerpt"):
        validate_evidence(draft, row["onboarding_answers"])


async def test_muse_contract_real_endpoint_and_no_automatic_confirmation():
    row = profile_record()
    draft = {key: row[key] for key in ProfileDraft.model_fields}
    payload = {"question": "What motivates you?", "question_key": "motivation", "ready_for_review": False, "draft": draft}
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(payload)}}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = MuseProvider(Settings(_env_file=None, muse_api_key="key"), client)
        reply = await provider.next_turn([], row["onboarding_answers"])
    assert str(requests[0].url) == "https://api.meta.ai/v1/chat/completions"
    assert json.loads(requests[0].content)["model"] == "muse-spark-1.3"
    assert reply.draft.facts[0].confirmation == "pending"
    assert not reply.draft.facts[0].matching_allowed
    assert reply.draft.facts[0].sharing_scope == "matching_only"

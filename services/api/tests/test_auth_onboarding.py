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
    draft["conversation_request"] = {"mode": "casual_chat", "goal": row["current_goal"],
        "evidence_requirement": {"version": 1, "kind": "none", "subject": None, "claim": None, "confirmation": "confirmed"}}
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
    assert reply.draft.conversation_request.evidence_requirement.confirmation == "pending"


class ReadyProvider:
    def __init__(self):
        self.calls = 0
        row = profile_record()
        self.draft = ProfileDraft.model_validate({key: row[key] for key in ProfileDraft.model_fields})
        for fact in self.draft.facts:
            fact.confirmation = "pending"
            fact.matching_allowed = False
            fact.sharing_scope = "matching_only"

    def readiness(self):
        return {"available": True}

    async def next_turn(self, turns, answers):
        self.calls += 1
        return MuseReply(question="Your draft is ready to review. Choose what to share on the next screen.",
                         question_key="boundaries", ready_for_review=True, draft=self.draft)


async def test_ready_handoff_resumes_and_ignores_extra_yes_without_mutating_consent(repo):
    import copy

    provider = ReadyProvider()
    onboarding = Onboarding(repo, provider)
    user_id = str(uuid4())
    initial = onboarding.response(await onboarding.session(user_id))
    assert initial["ready_for_review"] is False
    request = MessageRequest(message_id=uuid4(), content="That covers my interests and preferences.")
    ready = await onboarding.send(user_id, request)
    assert ready["status"] == "awaiting_confirmation" and ready["ready_for_review"] is True
    assert provider.calls == 1
    assert ready["draft"]["facts"][0]["confirmation"] == "pending"
    assert ready["draft"]["facts"][0]["matching_allowed"] is False
    assert ready["draft"]["facts"][0]["sharing_scope"] == "matching_only"
    before = copy.deepcopy(repo.tables)

    # A fresh handler instance models resuming after process/app interruption.
    resumed_handler = Onboarding(repo, provider)
    resumed = resumed_handler.response(await resumed_handler.session(user_id))
    assert resumed == ready
    for followup in (request, MessageRequest(message_id=uuid4(), content="yes"),
                     MessageRequest(message_id=uuid4(), content="please save it"),
                     MessageRequest(message_id=uuid4(), content="", skip=True)):
        assert await resumed_handler.send(user_id, followup) == ready
    assert provider.calls == 1
    assert repo.tables == before
    assert "consent_receipts" not in repo.tables and "profile_versions" not in repo.tables
    assert len(repo.tables["onboarding_answers"]) == 1


async def test_review_handoff_keeps_existing_message_id_conflict_protection(repo):
    onboarding = Onboarding(repo, ReadyProvider())
    user_id, message_id = str(uuid4()), uuid4()
    await onboarding.send(user_id, MessageRequest(message_id=message_id, content="Original answer"))
    with pytest.raises(AppError) as error:
        await onboarding.send(user_id, MessageRequest(message_id=message_id, content="Changed answer"))
    assert error.value.code == "message_id_reused"
    assert len(repo.tables["onboarding_answers"]) == 1


async def test_completed_session_still_rejects_chat_without_provider_or_writes(repo):
    provider = ReadyProvider()
    onboarding = Onboarding(repo, provider)
    repo.rpc_values["start_onboarding"] = {"session_id": str(uuid4()), "status": "completed", "turns": [], "draft": {}}
    with pytest.raises(AppError) as error:
        await onboarding.send(str(uuid4()), MessageRequest(message_id=uuid4(), content="yes"))
    assert error.value.code == "onboarding_completed"
    assert provider.calls == 0
    assert not any(call[0] == "insert" for call in repo.calls)
    assert onboarding.response(repo.rpc_values["start_onboarding"])["ready_for_review"] is False


async def test_provider_failure_remains_retryable_before_review_handoff(repo):
    provider = RetryProvider()
    onboarding = Onboarding(repo, provider)
    user_id = str(uuid4())
    request = MessageRequest(message_id=uuid4(), content="I enjoy hiking.")
    failed = await onboarding.send(user_id, request)
    assert failed["ready_for_review"] is False and failed["status"] == "in_progress"
    assert failed["error"] and failed["turns"][-1]["role"] == "user"
    resumed = onboarding.response(await onboarding.session(user_id))
    assert resumed["ready_for_review"] is False
    provider.failed = False
    retried = await onboarding.send(user_id, request)
    assert retried["error"] is None and retried["ready_for_review"] is False
    assert provider.calls == 2 and len(repo.tables["onboarding_answers"]) == 1

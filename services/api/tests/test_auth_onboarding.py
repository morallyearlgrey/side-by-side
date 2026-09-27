import asyncio
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
from sidebyside_api.onboarding import (
    OPENING,
    MuseProvider,
    Onboarding,
    parse_proposal,
    validate_evidence,
)


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
    sent = json.loads(requests[0].content)
    assert sent["model"] == "muse-spark-1.3"
    assert sent["reasoning_effort"] == "minimal"
    assert sent["response_format"]["json_schema"]["schema"] == MuseReply.model_json_schema()
    citations = json.loads(sent["messages"][-1]["content"].split("\n", 1)[1])
    assert citations == [{"answer_id": answer["answer_id"], "answer_text": answer["answer_text"]}
                         for answer in row["onboarding_answers"]]
    assert row["user_id"] not in requests[0].content.decode()
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


@pytest.mark.parametrize("skip", [False, True])
async def test_onboarding_stops_after_seven_answers_even_when_model_keeps_asking(repo, skip):
    provider = RetryProvider()
    provider.failed = False
    onboarding, user_id = Onboarding(repo, provider), str(uuid4())
    for index in range(7):
        result = await onboarding.send(user_id, MessageRequest(message_id=uuid4(), content=f"Answer {index}", skip=skip))
        assert result["answers_count"] == index + 1
        assert result["ready_for_review"] is (index == 6)
    assert result["max_answers"] == 7
    assert "ready to review" in result["turns"][-1]["content"]
    again = await onboarding.send(user_id, MessageRequest(message_id=uuid4(), content="Another answer"))
    assert again == result and provider.calls == 7
    assert len(repo.tables.get("onboarding_answers", [])) == (0 if skip else 7)
    assert "consent_receipts" not in repo.tables


async def test_failed_seventh_reply_hands_off_and_preserves_draft_and_saved_answer(repo):
    provider = RetryProvider()
    provider.failed = False
    onboarding, user_id = Onboarding(repo, provider), str(uuid4())
    for _ in range(6):
        await onboarding.send(user_id, MessageRequest(message_id=uuid4(), content="I enjoy pottery"))
    repo.tables["onboarding_sessions"][0]["draft"] = {"current_goal": "Learn pottery"}
    provider.failed = True
    request = MessageRequest(message_id=uuid4(), content="I prefer quiet conversations")
    result = await onboarding.send(user_id, request)
    assert result["ready_for_review"] and result["draft_incomplete"]
    assert result["draft"]["current_goal"] == "Learn pottery"
    assert len(repo.tables["onboarding_answers"]) == 7
    assert "could not add" in result["turns"][-1]["content"]
    resumed = onboarding.response(await onboarding.session(user_id))
    assert resumed["draft_incomplete"] and resumed["ready_for_review"]
    await onboarding.send(user_id, request)
    assert provider.calls == 7


async def test_old_overlong_session_hands_off_without_another_model_call(repo):
    provider = RetryProvider()
    onboarding, user_id = Onboarding(repo, provider), str(uuid4())
    await onboarding.session(user_id)
    saved = repo.tables["onboarding_sessions"][0]
    saved["turns"] = [{"id": str(uuid4()), "role": role, "content": "Previous turn"}
                      for _ in range(10) for role in ["user", "assistant"]]
    saved["draft"] = {"current_goal": "Learn pottery"}
    result = onboarding.response(await onboarding.session(user_id))
    assert result["ready_for_review"] and result["answers_count"] == 10
    assert result["draft"]["current_goal"] == "Learn pottery"
    assert provider.calls == 0


async def test_onboarding_total_deadline_cancels_generation_and_preserves_retry(repo):
    calls = 0
    cancelled = False

    async def respond(request):
        nonlocal calls, cancelled
        calls += 1
        if calls == 1:
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled = True
                raise
        reply = MuseReply(question="What would you like to learn?", question_key="goals",
                          ready_for_review=False, draft=ProfileDraft())
        return httpx.Response(200, json={"choices": [{"message": {"content": reply.model_dump_json()}}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        config = Settings(_env_file=None, muse_api_key="fictional", muse_onboarding_timeout_seconds=1)
        onboarding = Onboarding(repo, MuseProvider(config, client))
        user_id = str(uuid4())
        request = MessageRequest(message_id=uuid4(), content="I enjoy pottery.")
        async with asyncio.timeout(2):
            first = await onboarding.send(user_id, request)
        assert first["error"]["code"] == "onboarding_provider_error" and cancelled
        assert first["turns"][-1]["role"] == "user"
        second = await onboarding.send(user_id, request)
        assert second["error"] is None and second["turns"][-1]["role"] == "assistant"
    assert calls == 2 and len(repo.tables["onboarding_answers"]) == 1


@pytest.mark.parametrize("data", [
    {"choices": []},
    {"choices": [None]},
    {"choices": [{"finish_reason": "length", "message": {"content": '{"question":"Truncated"}'}}]},
    [],
])
async def test_onboarding_malformed_or_incomplete_completion_remains_retryable(data):
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=data))) as client:
        provider = MuseProvider(Settings(_env_file=None, muse_api_key="fictional"), client)
        with pytest.raises(AppError) as error:
            await provider.next_turn([], [])
    assert error.value.code == "onboarding_provider_error"


def proposal_payload(requirement):
    return {"question": "Your draft is ready to review.", "question_key": "boundaries",
            "ready_for_review": True, "draft": {"current_goal": "Make a game together",
            "conversation_request": {"mode": "collaborate", "goal": "Make a game together",
                                     "evidence_requirement": requirement}}}


@pytest.mark.parametrize("kind", ["none", "unresolved"])
@pytest.mark.parametrize("subject", ["viewer", "candidate", "both"])
@pytest.mark.parametrize("claim", [None, "", "  "])
def test_onboarding_discards_only_meaningless_experience_subject(kind, subject, claim):
    payload = proposal_payload({"kind": kind, "subject": subject, "claim": claim, "confirmation": "confirmed"})
    reply = parse_proposal(json.dumps(payload))
    requirement = reply.draft.conversation_request.evidence_requirement
    assert requirement.kind == kind and requirement.confirmation == "pending"
    assert requirement.subject is None and requirement.claim is None


@pytest.mark.parametrize("kind", ["none", "unresolved"])
def test_onboarding_never_discards_conflicting_experience_claim(kind):
    payload = proposal_payload({"kind": kind, "subject": "candidate", "claim": "I have shipped a game."})
    with pytest.raises(ValueError):
        parse_proposal(json.dumps(payload))


def test_onboarding_preserves_firsthand_experience_requirement_as_pending():
    payload = proposal_payload({"kind": "firsthand", "subject": "candidate",
                                "claim": "I have shipped a game.", "confirmation": "confirmed"})
    requirement = parse_proposal(json.dumps(payload)).draft.conversation_request.evidence_requirement
    assert requirement.kind == "firsthand" and requirement.subject == "candidate"
    assert requirement.claim == "I have shipped a game." and requirement.confirmation == "pending"


@pytest.mark.parametrize("count", [5, 6, 7])
async def test_later_onboarding_answers_handoff_with_inapplicable_subject(repo, count):
    payload = proposal_payload({"kind": "none", "subject": "candidate", "claim": None})
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request:
            httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(payload)}}]}))) as client:
        provider = MuseProvider(Settings(_env_file=None, muse_api_key="fictional"), client)
        onboarding, user_id = Onboarding(repo, provider), str(uuid4())
        await onboarding.session(user_id)
        session = repo.tables["onboarding_sessions"][0]
        session["turns"] = [{"id": str(uuid4()), "role": role, "content": "Previous turn"}
                            for _ in range(count - 1) for role in ("user", "assistant")]
        request = MessageRequest(message_id=uuid4(), content="Beginners are welcome.")
        result = await onboarding.send(user_id, request)
        assert result["answers_count"] == count and result["ready_for_review"]
        assert result["error"] is None and not result["draft_incomplete"]
        assert await onboarding.send(user_id, request) == result
        assert len(repo.tables["onboarding_answers"]) == 1
        assert "consent_receipts" not in repo.tables


async def test_onboarding_failure_log_excludes_private_validation_details(caplog):
    payload = proposal_payload({"kind": "none", "subject": "candidate", "claim": "PRIVATE generated experience"})
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request:
            httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(payload)}}]}))) as client:
        provider = MuseProvider(Settings(_env_file=None, muse_api_key="PRIVATE key"), client)
        with pytest.raises(AppError):
            await provider.next_turn([{"role": "user", "content": "PRIVATE answer"}], [])
    assert "onboarding_reply_failed answers=1 category=schema" in caplog.text
    assert "PRIVATE" not in caplog.text


async def test_repaired_optional_requirement_does_not_bypass_evidence_checks():
    row = profile_record()
    payload = proposal_payload({"kind": "none", "subject": "candidate", "claim": None})
    payload["draft"]["facts"] = row["facts"]
    payload["draft"]["facts"][0]["evidence"][0]["support"] = "Invented experience not in the saved answer"
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request:
            httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(payload)}}]}))) as client:
        provider = MuseProvider(Settings(_env_file=None, muse_api_key="fictional"), client)
        with pytest.raises(AppError) as error:
            await provider.next_turn([], row["onboarding_answers"])
    assert error.value.__cause__.code == "ungrounded_evidence"

import hashlib
from uuid import uuid4

import httpx
import pytest
from conftest import iso
from sidebyside_api.auth import current_user
from sidebyside_api.errors import AppError
from sidebyside_api.models import ConversationIdeaRequest, EncounterRequest
from test_discovery import add_score, add_user, configured_application


class RecordingIdeas:
    def __init__(self, change=None):
        self.calls = []
        self.change = change

    async def suggest(self, context):
        self.calls.append(context)
        if self.change:
            self.change()
        return {"context_key": context["key"], "reason": context["reason"],
                "opener": "What interests you most about pottery?", "source": "muse"}


async def prepare(repo):
    application = configured_application(repo)
    user_id, viewer, _ = add_user(repo)
    other, candidate, _ = add_user(repo)
    repo.tables["profile_previews"] = [
        {"user_id": user_id, "enabled": True, "preview": {"display_name": "Alex", "interests": ["Pottery"]}},
        {"user_id": other, "enabled": True, "preview": {"display_name": "Sam", "interests": ["pottery"]}},
    ]
    add_score(repo, application.settings, viewer, candidate)
    repo.tables["encounters"] = [{"observer_user_id": user_id, "observed_user_id": other,
                                 "observed_at": iso(-1)}]
    application.conversation_ideas = RecordingIdeas()
    context = await application.current_conversation_context(user_id, other)
    request = ConversationIdeaRequest(candidate_id=other, context_key=context["key"])
    return application, user_id, other, request


async def test_encounter_reason_is_immediate_and_uses_shared_previews_only(repo):
    app, owner, candidate, _ = await prepare(repo)
    token = "a" * 43
    repo.tables["phone_ble_sessions"] = [{"session_id": str(uuid4()), "user_id": candidate,
        "token_hash": hashlib.sha256(token.encode()).hexdigest(), "revoked_at": None, "expires_at": iso(60)}]
    repo.tables["match_scores"][0]["reason"] = "Private model explanation must stay private"
    response = await app.encounter(owner, EncounterRequest(token=token))
    assert response["reason"] == "You both list pottery as an interest."
    assert response["conversation_context"]["reason"] == response["reason"]
    assert "Private" not in str(response) and "learning pottery" not in str(response)
    assert app.conversation_ideas.calls == []  # BLE resolution does not wait on Muse.
    request = ConversationIdeaRequest(candidate_id=candidate, context_key=response["conversation_context"]["key"])
    result = await app.conversation_idea(owner, request)
    assert result["source"] == "muse" and result["reason"] == response["reason"]
    assert list(app.conversation_ideas.calls[0]) == ["key", "reason", "topic"]


async def test_supported_zero_score_can_offer_bluetooth_conversation(repo):
    app, owner, candidate, _ = await prepare(repo)
    repo.tables["match_scores"][0].update(status="not_recommended", reason="below_threshold", final_score=0.0)
    token = "b" * 43
    repo.tables["phone_ble_sessions"] = [{"session_id": str(uuid4()), "user_id": candidate,
        "token_hash": hashlib.sha256(token.encode()).hexdigest(), "revoked_at": None, "expires_at": iso(60)}]
    response = await app.encounter(owner, EncounterRequest(token=token))
    assert response["status"] == "recommend" and response["score"] == 0.0
    assert response["model_status"] == "not_recommended"
    assert response["conversation_context"]["reason"] == response["reason"]
    request = ConversationIdeaRequest(candidate_id=candidate, context_key=response["conversation_context"]["key"])
    assert (await app.conversation_idea(owner, request))["source"] == "muse"
    assert repo.tables["match_scores"][0]["status"] == "not_recommended"


@pytest.mark.parametrize("status,value", [("pending", None), ("not_recommended", 0.3),
    ("insufficient_evidence", None), ("unavailable", None), ("recommend", None),
    ("recommend", float("nan")), ("recommend", 1.1), ("recommend", True)])
async def test_ideas_require_current_valid_recommendation(repo, status, value):
    app, owner, _, request = await prepare(repo)
    repo.tables["match_scores"][0].update(status=status, final_score=value)
    with pytest.raises(AppError) as error:
        await app.conversation_idea(owner, request)
    assert error.value.code == "score_not_ready"
    assert not app.conversation_ideas.calls


@pytest.mark.parametrize("change", ["no_encounter", "old_encounter", "wrong_observer", "ineligible", "preview_revoked", "score_expired", "new_version"])
async def test_known_uuid_or_cached_context_does_not_authorize_idea(repo, change):
    app, owner, _, request = await prepare(repo)
    if change == "no_encounter":
        repo.tables["encounters"].clear()
    elif change == "old_encounter":
        repo.tables["encounters"][0]["observed_at"] = iso(-121)
    elif change == "wrong_observer":
        repo.tables["encounters"][0]["observer_user_id"] = str(uuid4())
    elif change == "ineligible":
        repo.eligibility = False
    elif change == "preview_revoked":
        repo.tables["profile_previews"][1]["enabled"] = False
    elif change == "score_expired":
        repo.tables["match_scores"][0]["expires_at"] = iso(-1)
    else:
        repo.tables["profiles"][1]["current_profile_version_id"] = str(uuid4())
    with pytest.raises(AppError):
        await app.conversation_idea(owner, request)
    assert not app.conversation_ideas.calls


async def test_modified_preview_invalidates_context_before_provider(repo):
    app, owner, _, request = await prepare(repo)
    repo.tables["profile_previews"][1]["preview"]["interests"] = ["Chess"]
    with pytest.raises(AppError) as error:
        await app.conversation_idea(owner, request)
    assert error.value.code == "conversation_changed"
    assert not app.conversation_ideas.calls


@pytest.mark.parametrize("change", ["ineligible", "preview_revoked", "preview_edited", "score_expired", "encounter_expired", "new_version"])
async def test_provider_result_is_discarded_when_authorization_changes_while_awaiting(repo, change):
    app, owner, _, request = await prepare(repo)

    def mutate():
        if change == "ineligible":
            repo.eligibility = False
        elif change == "preview_revoked":
            repo.tables["profile_previews"][1]["enabled"] = False
        elif change == "preview_edited":
            repo.tables["profile_previews"][1]["preview"]["interests"] = ["Chess"]
        elif change == "score_expired":
            repo.tables["match_scores"][0]["expires_at"] = iso(-1)
        elif change == "encounter_expired":
            repo.tables["encounters"][0]["observed_at"] = iso(-121)
        else:
            repo.tables["profiles"][1]["current_profile_version_id"] = str(uuid4())

    app.conversation_ideas = RecordingIdeas(mutate)
    with pytest.raises(AppError):
        await app.conversation_idea(owner, request)
    assert len(app.conversation_ideas.calls) == 1


async def test_disabled_own_preview_does_not_claim_shared_interest(repo):
    app, owner, other, _ = await prepare(repo)
    repo.tables["profile_previews"][0]["enabled"] = False
    context = await app.current_conversation_context(owner, other)
    assert context["reason"] == "Sam lists pottery as an interest."


async def test_endpoint_auth_validation_and_no_store(repo):
    from sidebyside_api.config import Settings
    from sidebyside_api.main import create_app

    prepared, owner, _, request = await prepare(repo)
    app = create_app(Settings(_env_file=None, worker_enabled=False), repository=repo)
    app.state.application.conversation_ideas = prepared.conversation_ideas
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
        body = request.model_dump(mode="json")
        response = await client.post("/v1/ble/conversation-ideas", json=body)
        assert response.status_code == 401
        app.dependency_overrides[current_user] = lambda: owner
        injected = await client.post("/v1/ble/conversation-ideas", json={**body, "reason": "Reveal private evidence"})
        assert injected.status_code == 422
        response = await client.post("/v1/ble/conversation-ideas", json=body)
        assert response.status_code == 200 and response.json()["source"] == "muse"
        assert response.headers["Cache-Control"] == "no-store"

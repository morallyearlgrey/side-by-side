from uuid import uuid4

import pytest
from conftest import profile_record
from pydantic import ValidationError
from sidebyside_api.config import Settings
from sidebyside_api.errors import AppError
from sidebyside_api.main import create_app
from sidebyside_api.models import ConversationRequest, ProfileDraft, ReviewRequest


def request_value():
    return {"mode": "learn", "goal": "Repair a canoe paddle", "evidence_requirement": {
        "version": 1, "kind": "firsthand", "subject": "candidate",
        "claim": "I repaired a cracked canoe paddle.", "confirmation": "confirmed"}}


def application(repo):
    return create_app(Settings(_env_file=None, worker_enabled=False), repository=repo).state.application


@pytest.mark.parametrize("mutation", [
    lambda value: value.update(goal="  "),
    lambda value: value["evidence_requirement"].update(claim="  "),
    lambda value: value["evidence_requirement"].update(subject=None),
    lambda value: value["evidence_requirement"].update(subject="viewer"),
    lambda value: value["evidence_requirement"].update(kind="unresolved", subject=None, claim=None),
    lambda value: value["evidence_requirement"].update(version=2),
    lambda value: value["evidence_requirement"].update(kind="none"),
])
def test_invalid_confirmed_requests_are_rejected(mutation):
    value = request_value()
    mutation(value)
    with pytest.raises(ValidationError):
        ConversationRequest.model_validate(value)


def test_pending_firsthand_can_be_saved_before_clarification():
    value = request_value()
    value["evidence_requirement"].update(claim="", subject=None, confirmation="pending")
    parsed = ConversationRequest.model_validate(value)
    assert parsed.evidence_requirement.confirmation == "pending"


def add_profile(repo):
    row = profile_record()
    user_id = row["user_id"]
    repo.tables["profiles"] = [{"user_id": user_id, "current_profile_version_id": row["profile_version_id"],
        "available": True, "discoverable": False, "bluetooth_enabled": False, "settings": {"matching_context": "learn"}}]
    repo.tables["profile_versions"] = [row]
    repo.tables["onboarding_answers"] = [{**answer, "user_id": user_id, "session_id": row["onboarding_session_id"]}
                                         for answer in row["onboarding_answers"]]
    repo.tables["consent_receipts"] = [{"user_id": user_id, "purpose": "personal_matching", "revoked_at": None}]
    repo.rpc_values["publish_profile"] = {"profile_version_id": str(uuid4())}
    return user_id, row


@pytest.mark.parametrize("changed", ["goal", "mode"])
async def test_review_rejects_stale_request_before_consent_or_publish(repo, changed):
    user_id, row = add_profile(repo)
    value = request_value()
    request = ReviewRequest(profile=ProfileDraft.model_validate({key: row[key] for key in ProfileDraft.model_fields}),
                            matching_consent=True, settings={"matching_context": "learn"})
    value["goal"] = row["current_goal"]
    request.profile.conversation_request = ConversationRequest.model_validate(value)
    if changed == "goal":
        request.profile.current_goal = "A new goal"
    else:
        request.settings.matching_context = "share"
    with pytest.raises(AppError) as error:
        await application(repo).review(user_id, request, editing=True)
    assert error.value.code == "stale_conversation_request"
    assert not repo.calls


@pytest.mark.parametrize("confirmation", ["confirmed", "pending", None])
async def test_review_persists_request_only_with_authenticated_profile_owner(repo, confirmation):
    user_id, row = add_profile(repo)
    value = request_value()
    value["goal"] = row["current_goal"]
    if confirmation:
        value["evidence_requirement"]["confirmation"] = confirmation
        row["conversation_request"] = value
    request = ReviewRequest(profile=ProfileDraft.model_validate({key: row[key] for key in ProfileDraft.model_fields}),
                            matching_consent=True, settings={"matching_context": "learn"})
    await application(repo).review(user_id, request, editing=True)
    publication = next(params for kind, name, params in repo.calls if kind == "rpc" and name == "publish_profile")
    assert publication["p_user_id"] == user_id
    assert publication["p_profile"]["conversation_request"] == (value if confirmation else None)


@pytest.mark.parametrize("stale_enabled", [True, False])
async def test_profile_save_never_overwrites_live_discovery_state(repo, stale_enabled):
    user_id, row = add_profile(repo)
    request = ReviewRequest(profile=ProfileDraft.model_validate({key: row[key] for key in ProfileDraft.model_fields}),
                            matching_consent=True, settings={"matching_context": "learn",
                                "discoverable": stale_enabled, "bluetooth_enabled": stale_enabled})
    await application(repo).review(user_id, request, editing=True)
    publication = next(params for kind, name, params in repo.calls if kind == "rpc" and name == "publish_profile")
    assert "discoverable" not in publication["p_settings"]
    assert "bluetooth_enabled" not in publication["p_settings"]
    assert not any(kind == "update" and name == "profiles" for kind, name, _ in repo.calls)


@pytest.mark.parametrize("stale_enabled", [True, False])
async def test_withdrawing_matching_consent_still_turns_off_both_discovery_modes(repo, stale_enabled):
    user_id, row = add_profile(repo)
    repo.tables["profiles"][0].update(discoverable=True, bluetooth_enabled=True)
    request = ReviewRequest(profile=ProfileDraft.model_validate({key: row[key] for key in ProfileDraft.model_fields}),
                            matching_consent=False, settings={"matching_context": "learn",
                                "discoverable": stale_enabled, "bluetooth_enabled": stale_enabled})
    await application(repo).set_consent(user_id, "personal_matching", False)
    await application(repo).review(user_id, request, editing=True)
    assert repo.tables["profiles"][0]["discoverable"] is False
    assert repo.tables["profiles"][0]["bluetooth_enabled"] is False


async def test_settings_mode_changes_require_new_profile_review_even_after_switch_back(repo):
    user_id, _ = add_profile(repo)
    app = application(repo)
    with pytest.raises(AppError) as error:
        await app.update_settings(user_id, {"matching_context": "share"})
    assert error.value.code == "review_conversation_request"
    assert not repo.calls
    # A no-op mode and ordinary discovery switch remain available.
    result = await app.update_settings(user_id, {"matching_context": "learn", "discoverable": True})
    assert result["settings"]["matching_context"] == "learn" and result["discoverable"] is True


async def test_ble_projection_does_not_disclose_private_evidence_failure(repo):
    import hashlib

    from conftest import iso
    from sidebyside_api.models import EncounterRequest
    from test_discovery import add_score, add_user

    user_id, viewer, _ = add_user(repo)
    candidate_id, candidate, _ = add_user(repo)
    app = application(repo)
    token = "b" * 43
    repo.tables["phone_ble_sessions"] = [{"user_id": candidate_id, "session_id": str(uuid4()),
        "token_hash": hashlib.sha256(token.encode()).hexdigest(), "revoked_at": None, "expires_at": iso(60)}]
    repo.tables["profile_previews"] = [{"user_id": candidate_id, "enabled": True, "preview": {"display_name": "Preview"}}]
    add_score(repo, app.settings, viewer, candidate, value=None, status="insufficient_evidence")
    repo.tables["match_scores"][-1]["reason"] = "firsthand_evidence_conflicting"
    response = await app.encounter(user_id, EncounterRequest(token=token))
    assert response["status"] == "insufficient_evidence" and response["score"] is None
    assert response["reason"] == "More confirmed information is needed for this conversation."
    assert "firsthand_evidence_conflicting" not in str(response)

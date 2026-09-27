import hashlib
from datetime import timedelta
from uuid import uuid4

import httpx
import pytest
from conftest import iso, profile_record
from sidebyside_api.config import Settings
from sidebyside_api.errors import AppError
from sidebyside_api.jobs import MatchingJobs, now
from sidebyside_api.main import create_app
from sidebyside_api.matching_policy import PIPELINE, POLICY, POLICY_SHA256
from sidebyside_api.models import ConnectionRequest, EncounterRequest, PresenceRequest, UserSettings


def test_gender_settings_validate_and_default_to_unrestricted():
    assert UserSettings().gender_identity == "undisclosed"
    assert UserSettings().gender_preferences == []
    settings = UserSettings(gender_identity="man", gender_preferences=["woman", "nonbinary"])
    assert settings.model_dump()["gender_preferences"] == ["woman", "nonbinary"]
    with pytest.raises(ValueError):
        UserSettings(gender_preferences=["unknown"])


def configured_application(repo):
    settings = Settings(_env_file=None, worker_enabled=False)
    return create_app(settings, repository=repo).state.application


def add_user(repo):
    version = profile_record()
    user_id = version["user_id"]
    profile = {"user_id": user_id, "current_profile_version_id": version["profile_version_id"],
               "available": True, "discoverable": True, "bluetooth_enabled": True, "settings": {}, "display_name": "Private name"}
    repo.tables.setdefault("profiles", []).append(profile)
    repo.tables.setdefault("profile_versions", []).append(version)
    repo.tables.setdefault("consent_receipts", []).append({"user_id": user_id, "purpose": "personal_matching", "revoked_at": None})
    return user_id, profile, version


def add_score(repo, settings, viewer, candidate, value=0.7, status="recommend"):
    repo.tables.setdefault("match_scores", []).append({
        "viewer_id": viewer["user_id"], "candidate_id": candidate["user_id"],
        "viewer_profile_version_id": viewer["current_profile_version_id"],
        "candidate_profile_version_id": candidate["current_profile_version_id"],
        "expires_at": iso(90), "scored_at": iso(), "model_id": settings.matching_model_id,
        "model_revision": settings.matching_model_revision, "pipeline_version": PIPELINE, "policy": POLICY, "policy_sha256": POLICY_SHA256,
        "final_score": value, "status": status, "reason": None,
    })


async def test_nearby_stable_ties_snapshot_pagination_and_private_projection(repo):
    app = configured_application(repo)
    user_id, viewer, _ = add_user(repo)
    people = [add_user(repo) for _ in range(3)]
    for candidate_id, candidate, _ in people:
        repo.candidates.append({"user_id": candidate_id, "profile_version_id": candidate["current_profile_version_id"],
                                "distance_m": 100, "preview": {"display_name": "Approved preview"}})
        add_score(repo, app.settings, viewer, candidate, 0.9)
    first = await app.jobs.nearby(user_id, limit=2)
    second = await app.jobs.nearby(user_id, cursor=first["next_cursor"], limit=2)
    assert [item["user_id"] for item in first["items"] + second["items"]] == sorted(person[0] for person in people)
    assert all(item["score"] == 0.9 for item in first["items"])
    assert "Private name" not in str(first)
    assert "onboarding_answers" not in str(first)
    assert all(not any(key.startswith("_") for key in item) for item in first["items"])
    repo.candidates.pop()
    with pytest.raises(AppError) as error:
        await app.jobs.nearby(user_id, cursor=first["next_cursor"])
    assert error.value.code == "snapshot_expired"


async def test_snapshot_owned_by_viewer(repo):
    app = configured_application(repo)
    owner, _, _ = add_user(repo)
    other, _, _ = add_user(repo)
    snapshot = await app.jobs.nearby(owner)
    with pytest.raises(AppError):
        await app.jobs.nearby(other, cursor=app.jobs.cursor(snapshot["snapshot_id"], 0))


async def test_non_recommendations_and_deferred_outcomes_are_not_ranked(repo):
    app = configured_application(repo)
    user_id, viewer, _ = add_user(repo)
    for status in ("unavailable", "insufficient_evidence", "not_recommended"):
        candidate_id, candidate, _ = add_user(repo)
        repo.candidates.append({"user_id": candidate_id, "profile_version_id": candidate["current_profile_version_id"],
                                "distance_m": 100, "preview": {}})
        add_score(repo, app.settings, viewer, candidate, 0.2 if status == "not_recommended" else None, status)
    response = await app.jobs.nearby(user_id)
    assert response["items"] == []
    assert response["unavailable_count"] == response["insufficient_evidence_count"] == response["not_recommended_count"] == 1


async def test_job_identity_deduplicates_and_revision_change_requeues(repo):
    app = configured_application(repo)
    viewer, _, _ = add_user(repo)
    candidate, _, _ = add_user(repo)
    repo.tables["matching_invalidations"] = [{"user_id": viewer, "revision": 1}]
    await app.jobs.enqueue(viewer, candidate)
    await app.jobs.enqueue(viewer, candidate)
    assert len(repo.tables["matching_jobs"]) == 1
    repo.tables["matching_invalidations"][0]["revision"] = 2
    await app.jobs.enqueue(viewer, candidate)
    assert len(repo.tables["matching_jobs"]) == 2
    assert all(job["history_version"] == "excluded-v1" for job in repo.tables["matching_jobs"])


async def test_returning_eligible_pair_retries_cancelled_job_without_waiting_for_score_epoch(repo):
    app = configured_application(repo)
    viewer, _, _ = add_user(repo)
    candidate, _, _ = add_user(repo)
    await app.jobs.enqueue(viewer, candidate)
    job = repo.tables['matching_jobs'][0]
    job.update(job_id=str(uuid4()), status='cancelled', attempts=1, lease_token=None)
    await app.jobs.enqueue(viewer, candidate)
    assert len(repo.tables['matching_jobs']) == 1
    assert job['status'] == 'pending' and job['attempts'] == 0
    job.update(status='running', attempts=1, lease_token='active-lease')
    await app.jobs.enqueue(viewer, candidate)
    assert job['status'] == 'running' and job['lease_token'] == 'active-lease'
    job['status'] = 'cancelled'
    repo.eligibility = False
    await app.jobs.enqueue(viewer, candidate)
    assert job['status'] == 'cancelled'


async def test_old_model_job_never_publishes_new_model_under_old_provenance(repo):
    app = configured_application(repo)
    job = {"job_id": str(uuid4()), "lease_token": str(uuid4()), "status": "running",
           "model_id": "old-model", "model_revision": "old-revision", "pipeline_version": PIPELINE,
           "policy": POLICY, "viewer_id": str(uuid4()), "candidate_id": str(uuid4()), "mode": "nearby"}
    repo.tables["matching_jobs"] = [job]
    repo.rpc_values["claim_matching_jobs"] = [job]
    await app.jobs.run_once()
    assert repo.tables["matching_jobs"][0]["status"] == "cancelled"
    assert not any(call[:2] == ("rpc", "publish_matching_result") for call in repo.calls)


async def test_presence_expiry_based_on_observation_not_receipt(repo):
    app = configured_application(repo)
    user_id, _, _ = add_user(repo)
    observed = now() - timedelta(seconds=100)
    request = PresenceRequest(latitude=40, longitude=-73, accuracy_m=10, observed_at=observed)
    await app.presence(user_id, request)
    row = repo.tables["presence"][0]
    assert row["expires_at"] == (observed + timedelta(seconds=300)).isoformat()
    request.observed_at = now() - timedelta(hours=1)
    with pytest.raises(AppError) as error:
        await app.presence(user_id, request)
    assert error.value.code == "stale_location"


async def test_ble_tokens_rotating_opaque_stored_only_as_hash(repo):
    app = configured_application(repo)
    user_id, _, _ = add_user(repo)
    session = await app.start_ble(user_id)
    stored = repo.tables["phone_ble_sessions"][0]
    assert len(session["token"]) == 43
    assert stored["token_hash"] == hashlib.sha256(session["token"].encode()).hexdigest()
    assert session["token"] not in str(stored)
    await app.stop_ble(user_id)
    assert repo.tables["phone_ble_sessions"][0]["revoked_at"]
    assert repo.tables["profiles"][0]["bluetooth_enabled"] is False


async def test_public_ble_token_does_not_override_eligibility(repo):
    app = configured_application(repo)
    user_id, _, _ = add_user(repo)
    token = "a" * 43
    repo.tables["phone_ble_sessions"] = [{"session_id": str(uuid4()), "user_id": str(uuid4()),
        "token_hash": hashlib.sha256(token.encode()).hexdigest(), "revoked_at": None, "expires_at": iso(60)}]
    repo.eligibility = False
    with pytest.raises(AppError) as error:
        await app.encounter(user_id, EncounterRequest(token=token))
    assert error.value.code == "encounter_not_available"
    assert "encounters" not in repo.tables


async def test_known_user_uuid_not_sufficient_for_ble_invitation(repo):
    app = configured_application(repo)
    user_id, _, _ = add_user(repo)
    candidate_id, _, _ = add_user(repo)
    with pytest.raises(AppError) as error:
        await app.request_connection(user_id, ConnectionRequest(candidate_id=candidate_id, mode="ble"))
    assert error.value.code == "candidate_not_available"
    assert not any(call[:2] == ("rpc", "request_connection") for call in repo.calls)


async def test_connection_disclosure_requires_mutual_current_consent(repo):
    app = configured_application(repo)
    user_id, viewer, _ = add_user(repo)
    candidate_id, candidate, version = add_user(repo)
    version["facts"].append({**version["facts"][0], "fact_id": "shared", "details": "Approved shared detail", "sharing_scope": "after_mutual_consent"})
    repo.tables["profile_previews"] = [{"user_id": candidate_id, "enabled": True, "preview": {"display_name": "Public name"}}]
    row = {"request_id": str(uuid4()), "requester_user_id": user_id, "recipient_user_id": candidate_id,
           "requester_profile_version_id": viewer["current_profile_version_id"], "recipient_profile_version_id": candidate["current_profile_version_id"],
           "requester_decision": "accept", "recipient_decision": "pending", "created_at": iso(-10), "expires_at": iso(100)}
    pending = await app.connection_projection(user_id, row)
    assert pending["shared_profile"] is None
    row["recipient_decision"] = "accept"
    accepted = await app.connection_projection(user_id, row)
    assert accepted["shared_profile"] == {"facts": [{"topic": "pottery", "relationship": "learning", "details": "Approved shared detail", "motivation": None}]}
    assert "evidence" not in str(accepted) and "answer_id" not in str(accepted)
    candidate["available"] = False
    unavailable = await app.connection_projection(user_id, row)
    assert unavailable["shared_profile"] is None and unavailable["preview"] is None
    candidate["available"] = True
    candidate["current_profile_version_id"] = str(uuid4())
    changed = await app.connection_projection(user_id, row)
    assert changed["status"] == "profile_changed" and changed["shared_profile"] is None


async def test_partial_settings_cannot_remove_other_settings_or_enable_without_consent(repo):
    app = configured_application(repo)
    user_id, profile, _ = add_user(repo)
    profile["settings"] = {"occupation": "Teacher"}
    await app.update_settings(user_id, {"display_name": "A"})
    assert repo.tables["profiles"][0]["settings"]["occupation"] == "Teacher"
    repo.tables["consent_receipts"] = []
    with pytest.raises(AppError):
        await app.update_settings(user_id, {"discoverable": True})


@pytest.mark.parametrize("cursor", ["junk", "e30", MatchingJobs.cursor(str(uuid4()), -1), MatchingJobs.cursor("not-a-uuid", 0)])
def test_cursor_validation(cursor):
    with pytest.raises(AppError):
        MatchingJobs.parse_cursor(cursor)


async def test_auth_failure_never_calls_service_role_repository(repo):
    class DenyAuth:
        async def verify(self, credentials):
            raise AppError(401, "invalid_session", "Invalid")
    app = create_app(Settings(_env_file=None, worker_enabled=False), repository=repo, authenticator=DenyAuth())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
        response = await client.post("/v1/ble/sessions", headers={"Authorization": "Bearer forged"})
    assert response.status_code == 401
    assert not repo.calls


@pytest.mark.parametrize("field,stale", [("pipeline_version", "online-approved-onboarding-v1"),
    ("policy_sha256", "0" * 64), ("policy", "onboarding-only-v1")])
async def test_old_policy_cache_is_not_reused_and_job_is_cancelled(repo, field, stale):
    app = configured_application(repo)
    viewer_id, viewer, _ = add_user(repo)
    candidate_id, candidate, _ = add_user(repo)
    repo.candidates.append({"user_id": candidate_id, "profile_version_id": candidate["current_profile_version_id"],
                            "distance_m": 100, "preview": {}})
    add_score(repo, app.settings, viewer, candidate)
    repo.tables["match_scores"][0][field] = stale
    response = await app.jobs.nearby(viewer_id)
    assert response["items"] == [] and response["pending_count"] == 1
    queued = repo.tables["matching_jobs"][0]
    assert queued["policy_sha256"] == POLICY_SHA256
    queued.update(job_id=str(uuid4()), lease_token=str(uuid4()), status="running")
    queued[field] = stale
    repo.candidates = []
    repo.rpc_values["claim_matching_jobs"] = [queued]
    await app.jobs.run_once()
    assert repo.tables["matching_jobs"][0]["status"] == "cancelled"
    assert not any(call[:2] == ("rpc", "publish_matching_result") for call in repo.calls)


async def test_snapshot_policy_identity_and_outcome_counts_survive_pagination(repo):
    app = configured_application(repo)
    viewer_id, viewer, _ = add_user(repo)
    for status in ("recommend", "recommend", "not_recommended", "insufficient_evidence"):
        candidate_id, candidate, _ = add_user(repo)
        repo.candidates.append({"user_id": candidate_id, "profile_version_id": candidate["current_profile_version_id"],
                                "distance_m": 100, "preview": {}})
        add_score(repo, app.settings, viewer, candidate, None if status == "insufficient_evidence" else 0.7, status)
    first = await app.jobs.nearby(viewer_id, limit=1)
    second = await app.jobs.nearby(viewer_id, cursor=first["next_cursor"], limit=1)
    assert first["not_recommended_count"] == second["not_recommended_count"] == 1
    assert first["insufficient_evidence_count"] == second["insufficient_evidence_count"] == 1
    assert all(item["status"] == "recommend" for item in first["items"] + second["items"])
    repo.tables["match_snapshots"][0]["policy_sha256"] = "0" * 64
    with pytest.raises(AppError) as error:
        await app.jobs.nearby(viewer_id, cursor=first["next_cursor"])
    assert error.value.code == "snapshot_expired"


@pytest.mark.parametrize("status,value", [("insufficient_evidence", None), ("unavailable", None),
                                         ("not_recommended", 0.2), ("recommend", 0.8)])
async def test_queue_preserves_decision_and_nullable_score_at_database_boundary(repo, status, value):
    from sidebyside_api.matching import ScoreResult
    from sidebyside_api.matching_policy import provenance

    app = configured_application(repo)
    viewer_id, _, _ = add_user(repo)
    candidate_id, _, _ = add_user(repo)
    await app.jobs.enqueue(viewer_id, candidate_id)
    job = repo.tables["matching_jobs"][0]
    job.update(job_id=str(uuid4()), lease_token=str(uuid4()), status="running", attempts=1)
    repo.rpc_values["claim_matching_jobs"] = [job]

    class Runtime:
        async def score(self, viewer, candidate, mode):
            return ScoreResult(status=status, score=value, **provenance(),
                               onboarding_weight=1.0 if value is not None else None,
                               instagram_weight=0.0 if value is not None else None)

    app.jobs.runtime = Runtime()
    await app.jobs.run_once()
    published = next(call[2]["p_result"] for call in repo.calls if call[:2] == ("rpc", "publish_matching_result"))
    assert published["status"] == status and published["final_score"] == value
    assert published["score"] == value and published["policy_sha256"] == POLICY_SHA256
    assert published["evidence_model_revision"] == provenance()["evidence_model_revision"]

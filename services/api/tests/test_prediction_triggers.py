"""Event-to-queue tests: no discovery read, worker sweep, GPS, or real accounts."""
from datetime import timedelta
from uuid import uuid4

from conftest import iso
from sidebyside_api.errors import AppError
from sidebyside_api.jobs import now
from sidebyside_api.models import EncounterRequest, PresenceRequest, ProfileDraft, ReviewRequest
from test_discovery import add_score, add_user, configured_application
from test_encounter_refresh import pair


def nearby_pair(repo):
    app = configured_application(repo)
    owner, viewer, version = add_user(repo)
    peer, candidate, _ = add_user(repo)
    repo.candidates = [{"user_id": peer, "profile_version_id": candidate["current_profile_version_id"],
                        "distance_m": 500, "preview": {}}]
    repo.tables["profile_previews"] = [{"user_id": actor, "enabled": True, "preview": {}}
                                       for actor in (owner, peer)]
    return app, owner, viewer, version, peer, candidate


def observation():
    return PresenceRequest(latitude=40, longitude=-73, accuracy_m=10, observed_at=now())


async def test_new_presence_queues_both_directions_and_repeated_heartbeats_do_not_rerun(repo, monkeypatch):
    app, owner, _, _, peer, _ = nearby_pair(repo)
    monkeypatch.setattr("sidebyside_api.jobs.time.time", lambda: 299)
    await app.presence(owner, observation())
    jobs = repo.tables["matching_jobs"]
    assert {(job["viewer_id"], job["candidate_id"]) for job in jobs} == {(owner, peer), (peer, owner)}
    jobs[0].update(status="running", lease_token="active-lease")
    monkeypatch.setattr("sidebyside_api.jobs.time.time", lambda: 601)
    await app.presence(owner, observation())
    assert len(jobs) == 2
    assert jobs[0]["lease_token"] == "active-lease"


async def test_presence_reuses_completed_insufficient_evidence_until_expiry(repo):
    app, owner, viewer, _, _, candidate = nearby_pair(repo)
    add_score(repo, app.settings, viewer, candidate, None, "insufficient_evidence")
    add_score(repo, app.settings, candidate, viewer, None, "insufficient_evidence")
    await app.presence(owner, observation())
    assert not repo.tables.get("matching_jobs")
    for score in repo.tables["match_scores"]:
        score["expires_at"] = iso(-1)
    await app.presence(owner, observation())
    assert len(repo.tables["matching_jobs"]) == 2


async def test_nearby_event_checks_each_viewers_radius(repo):
    app, owner, viewer, _, peer, _ = nearby_pair(repo)
    viewer["settings"]["discovery_radius_m"] = 200
    await app.presence(owner, observation())
    assert [(job["viewer_id"], job["candidate_id"]) for job in repo.tables["matching_jobs"]] == [(peer, owner)]


async def test_profile_save_queues_new_versions_despite_previous_outcome(repo):
    app, owner, viewer, version, peer, candidate = nearby_pair(repo)
    add_score(repo, app.settings, viewer, candidate, None, "insufficient_evidence")
    add_score(repo, app.settings, candidate, viewer, None, "insufficient_evidence")
    repo.tables["onboarding_answers"] = [{**answer, "session_id": version["onboarding_session_id"]}
                                         for answer in version["onboarding_answers"]]
    new_version = str(uuid4())
    original_rpc = repo.rpc

    async def publish(name, params):
        if name == "publish_profile":
            # Model the atomic RPC's version update, retaining stale scores to
            # prove that they cannot suppress new-version jobs.
            viewer["current_profile_version_id"] = new_version
            return {"profile_version_id": new_version}
        return await original_rpc(name, params)

    repo.rpc = publish
    request = ReviewRequest(profile=ProfileDraft.model_validate({key: version[key] for key in ProfileDraft.model_fields}))
    response = await app.review(owner, request, editing=True)
    assert response["current_version"]["profile_version_id"] == new_version
    jobs = repo.tables["matching_jobs"]
    assert len(jobs) == 2
    forward = next(job for job in jobs if job["viewer_id"] == owner)
    reverse = next(job for job in jobs if job["viewer_id"] == peer)
    assert forward["viewer_version_id"] == reverse["candidate_version_id"] == new_version


async def test_blocked_or_nonconsenting_pairs_cannot_be_queued_from_events(repo):
    app, owner, _, _, _, _ = nearby_pair(repo)
    # Production eligible_pair evaluates blocks, mutual consent, availability,
    # active presence/session, and hard filters. The event never bypasses it.
    repo.eligibility = False
    await app.presence(owner, observation())
    assert not repo.tables.get("matching_jobs")
    assert any(call[:2] == ("rpc", "eligible_pair") for call in repo.calls)


async def test_hidden_preview_is_not_scheduled_as_candidate(repo):
    app, owner, _, _, peer, _ = nearby_pair(repo)
    repo.tables["profile_previews"][0]["enabled"] = False
    await app.presence(owner, observation())
    assert [(job["viewer_id"], job["candidate_id"]) for job in repo.tables["matching_jobs"]] == [(owner, peer)]


async def test_scheduling_outage_does_not_fail_committed_presence(repo, caplog):
    app, owner, _, _, _, _ = nearby_pair(repo)

    async def unavailable(_):
        raise AppError(503, "database_unavailable", "private diagnostic")

    app.jobs.candidates = unavailable
    response = await app.presence(owner, observation())
    assert response["expires_at"] == repo.tables["presence"][0]["expires_at"]
    assert "scheduling deferred" in caplog.text
    assert "private diagnostic" not in caplog.text


async def test_ble_event_only_schedules_genuinely_observed_direction(repo):
    app, owner, peer, token, _ = pair(repo)
    repo.tables["match_scores"] = []
    repo.tables["profile_previews"].append({"user_id": owner, "enabled": True, "preview": {}})
    await app.encounter(owner, EncounterRequest(token=token, observed_at=now()))
    assert [(job["viewer_id"], job["candidate_id"], job["mode"])
            for job in repo.tables["matching_jobs"]] == [(owner, peer, "ble")]
    # A profile edit can schedule each direction only when each has its own
    # genuine fresh reading. Expired readings never fabricate another match.
    repo.tables["encounters"].append({"observer_user_id": peer, "observed_user_id": owner,
                                      "observed_at": (now() - timedelta(minutes=3)).isoformat()})
    await app.jobs.schedule_user(owner, location=False)
    assert len(repo.tables["matching_jobs"]) == 1
    repo.tables["encounters"][-1]["observed_at"] = now().isoformat()
    await app.jobs.schedule_user(owner, location=False)
    assert len(repo.tables["matching_jobs"]) == 2

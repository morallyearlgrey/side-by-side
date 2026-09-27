"""Fictional BLE observations; no radio, account, or database mutations."""
import hashlib
from datetime import timedelta
from uuid import uuid4

import httpx
import pytest
from conftest import iso
from sidebyside_api.config import Settings
from sidebyside_api.errors import AppError
from sidebyside_api.jobs import now
from sidebyside_api.models import EncounterRequest
from sidebyside_api.repository import Repository
from test_discovery import add_score, add_user, configured_application


def pair(repo):
    app = configured_application(repo)
    owner, viewer, _ = add_user(repo)
    other, candidate, _ = add_user(repo)
    token, session_id = "a" * 43, str(uuid4())
    repo.tables["phone_ble_sessions"] = [{
        "session_id": session_id, "user_id": other,
        "token_hash": hashlib.sha256(token.encode()).hexdigest(),
        "issued_at": iso(-60), "expires_at": iso(60), "revoked_at": None,
    }]
    repo.tables["profile_previews"] = [{"user_id": other, "enabled": True,
        "preview": {"display_name": "Fictional Sam", "interests": ["pottery"]}}]
    add_score(repo, app.settings, viewer, candidate, value=None, status="insufficient_evidence")
    return app, owner, other, token, session_id


async def test_repeated_genuine_readings_reach_atomic_recorder_with_actual_observation_times(repo):
    app, owner, _, token, session_id = pair(repo)
    observed = now() - timedelta(seconds=10)
    later = observed + timedelta(seconds=9)
    for at, strength in ((observed, -60), (later, -45)):
        await app.encounter(owner, EncounterRequest(token=token, observed_at=at, rssi=strength))
    records = [call[2] for call in repo.calls if call[:2] == ("rpc", "record_ble_encounter")]
    assert records == [
        {"p_observer_id": owner, "p_session_id": session_id,
         "p_observed_at": observed.isoformat(), "p_rssi": -60},
        {"p_observer_id": owner, "p_session_id": session_id,
         "p_observed_at": later.isoformat(), "p_rssi": -45},
    ]
    # The SQL operation, rather than a blind table upsert, owns ordering and
    # authorization against concurrent revocation or reordered requests.
    assert not any(call[:2] == ("insert", "encounters") for call in repo.calls)
    assert token not in str(records)


async def test_older_clients_without_observation_time_use_receipt_time(repo):
    app, owner, _, token, _ = pair(repo)
    before = now()
    await app.encounter(owner, EncounterRequest(token=token))
    after = now()
    records = [call[2] for call in repo.calls if call[:2] == ("rpc", "record_ble_encounter")]
    assert len(records) == 1
    assert before.isoformat() <= records[0]["p_observed_at"] <= after.isoformat()


@pytest.mark.parametrize("offset", [-121, 31])
async def test_stale_or_future_observations_cannot_refresh_encounters(repo, offset):
    app, owner, _, token, _ = pair(repo)
    with pytest.raises(AppError) as error:
        await app.encounter(owner, EncounterRequest(token=token, observed_at=now() + timedelta(seconds=offset)))
    assert error.value.code == "stale_encounter"
    assert not any(call[:2] == ("rpc", "record_ble_encounter") for call in repo.calls)


async def test_expired_session_cannot_refresh_encounters(repo):
    app, owner, _, token, _ = pair(repo)
    repo.tables["phone_ble_sessions"][0]["expires_at"] = iso(-1)
    with pytest.raises(AppError) as error:
        await app.encounter(owner, EncounterRequest(token=token, observed_at=now()))
    assert error.value.code == "encounter_not_available"
    assert not any(call[:2] == ("rpc", "record_ble_encounter") for call in repo.calls)


@pytest.mark.parametrize("private_reason,message", [
    ("insufficient_support_for_requested_conversation",
     "More approved details are needed to support this conversation, even when interests look similar."),
    ("component_unavailable", "Matching could not finish this check. Please try again shortly."),
    ("input_exceeds_token_limit", "Matching could not finish this check. Please try again shortly."),
    ("Private counterpart boundary or answer", "More confirmed information is needed for this conversation."),
])
async def test_insufficient_results_use_fixed_messages_and_never_publish_diagnostic_scores(repo, private_reason, message):
    app, owner, _, token, _ = pair(repo)
    repo.tables["match_scores"][0].update(reason=private_reason, final_score=0.99)
    response = await app.encounter(owner, EncounterRequest(token=token))
    assert response["status"] == "insufficient_evidence"
    assert response["score"] is None
    assert response["reason"] == message
    assert private_reason not in str(response)
    assert "conversation_context" not in response


@pytest.mark.parametrize('status,db_code,app_code', [
    (404, 'PT404', 'encounter_not_available'), (422, 'PT422', 'stale_encounter'),
])
async def test_atomic_encounter_rejections_do_not_look_like_database_outages(status, db_code, app_code):
    def handler(request):
        return httpx.Response(status, json={'code': db_code, 'message': 'Private database detail'})
    settings = Settings(_env_file=None, supabase_url='https://fictional.supabase.invalid',
                        supabase_service_role_key='fictional-server-key', worker_enabled=False)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(AppError) as error:
            await Repository(settings, client).rpc('record_ble_encounter', {})
    assert error.value.status == status
    assert error.value.code == app_code
    assert 'Private database detail' not in str(error.value)

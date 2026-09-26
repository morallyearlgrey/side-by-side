"""Explicit live-Supabase smoke check using temporary synthetic accounts.

Run intentionally with RUN_LIVE_SMOKE=1. Creates confirmed test accounts without
sending email, uses real Auth JWTs and the actual PostgREST schema, and deletes
all accounts in finally. The injected deterministic scorer is TEST ONLY and is
stored under a test-only model ID/revision; no neural inference is claimed.
"""
import asyncio
import os
import secrets
from datetime import UTC, datetime
from uuid import uuid4

import httpx
from sidebyside_api.config import Settings
from sidebyside_api.main import create_app
from sidebyside_api.matching import MatchingRuntime


class SyntheticIntegrationScorer(MatchingRuntime):
    def metadata(self):
        return {**super().metadata(), "available": True, "reason": None, "test_only": True}

    async def score(self, viewer_row, candidate_row, mode):
        return self.result("scored", score=0.75)


async def run():
    if os.environ.get("RUN_LIVE_SMOKE") != "1":
        raise SystemExit("Explicit RUN_LIVE_SMOKE=1 is required.")
    settings = Settings().model_copy(update={"worker_enabled": False, "matching_warm_on_startup": False,
        "matching_execution": "local", "matching_model_id": "test-only-integration-scorer",
        "matching_model_revision": "synthetic-fixture-v1"})
    created = []
    admin_headers = {"apikey": settings.supabase_service_role_key.get_secret_value(),
                     "Authorization": "Bearer " + settings.supabase_service_role_key.get_secret_value()}
    public_headers = {"apikey": settings.supabase_anon_key.get_secret_value()}
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as network:
        app = create_app(settings, runtime=SyntheticIntegrationScorer(settings), client=network)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://smoke") as client:
            async def call(method, path, index, data=None, expected=200):
                response = await client.request(method, path, headers={"Authorization": "Bearer " + created[index]["token"]}, json=data)
                if response.status_code != expected:
                    try:
                        error = response.json().get("error", {}).get("code")
                    except ValueError:
                        error = "invalid_response"
                    raise AssertionError(f"{method} {path}: {response.status_code}, {error}; expected {expected}")
                return response.json()
            try:
                for index in range(3):
                    email = f"sidebyside-smoke-{uuid4().hex}@example.com"
                    password = secrets.token_urlsafe(32)
                    response = await network.post(settings.supabase_url + "/auth/v1/admin/users", headers=admin_headers,
                        json={"email": email, "password": password, "email_confirm": True, "user_metadata": {"synthetic_integration_test": True}})
                    if response.status_code not in (200, 201):
                        raise AssertionError(f"Admin test account creation failed: {response.status_code}")
                    user_id = response.json()["id"]
                    created.append({"user_id": user_id})
                    login = await network.post(settings.supabase_url + "/auth/v1/token?grant_type=password", headers=public_headers,
                        json={"email": email, "password": password})
                    assert login.status_code == 200, "Real Auth password exchange failed"
                    created[-1]["token"] = login.json()["access_token"]
                    me = await call("GET", "/v1/me", index)
                    assert me["current_version"] is None and not me["profile"]["discoverable"]
                    session = await call("GET", "/v1/onboarding", index)
                    assert session["turns"][0]["content"] == "What makes you YOU?"
                    answer = await call("POST", "/v1/profile/answers", index, {
                        "question_key": "interests", "question_text": "What makes you YOU?", "answer_text": "I am learning pottery and would like a practice partner."})
                    review = {"profile": {"current_goal": "Practice pottery", "conversation_intent": "Practice with another beginner",
                        "facts": [{"fact_id": "pottery", "topic": "pottery", "relationship": "learning", "details": "Learning pottery",
                            "motivation": None, "evidence": [{"source_type": "onboarding_answer", "reference_id": answer["answer_id"],
                                "channel": "self_report", "support": "I am learning pottery"}], "confirmation": "confirmed",
                            "matching_allowed": True, "sharing_scope": "after_mutual_consent"}],
                        "open_to_discussing": ["pottery"], "conversation_preferences": [], "avoid_topics": []},
                        "preview": {"enabled": True, "display_name": f"Synthetic tester {index}", "interests": ["pottery"]},
                        "settings": {"display_name": f"Synthetic tester {index}", "discoverable": True, "matching_context": "find_activity_partner"},
                        "matching_consent": True}
                    created[-1]["review"] = review
                    published = await call("POST", "/v1/onboarding/review", index, review)
                    created[-1]["version_id"] = published["current_version"]["profile_version_id"]
                    assert published["profile"]["discoverable"] is True
                    await call("PUT", "/v1/presence", index, {"latitude": 40.7128 if index < 2 else 40.0,
                        "longitude": -74.006 + index * .001 if index < 2 else -75.0, "accuracy_m": 5,
                        "observed_at": datetime.now(UTC).isoformat()})
                pending = await call("GET", "/v1/nearby", 0)
                assert pending["pending_count"] == 1, "Inside/outside-radius candidate selection failed"
                await app.state.application.jobs.run_once()
                ranked = await call("GET", "/v1/nearby", 0)
                assert len(ranked["items"]) == 1 and ranked["items"][0]["user_id"] == created[1]["user_id"]
                assert "evidence" not in str(ranked)
                invitation = await call("POST", "/v1/connections", 0, {"candidate_id": created[1]["user_id"], "mode": "nearby"})
                assert invitation["shared_profile"] is None
                accepted = await call("PUT", f"/v1/connections/{invitation['request_id']}/decision", 1, {"decision": "accepted"})
                assert accepted["status"] == "accepted" and len(accepted["shared_profile"]["facts"]) == 1
                assert "evidence" not in str(accepted["shared_profile"])
                await call("POST", "/v1/feedback", 0, {"connection_id": invitation["request_id"], "conversation_useful": True, "would_talk_again": None})
                first_session = await call("POST", "/v1/ble/sessions", 0)
                second_session = await call("POST", "/v1/ble/sessions", 1)
                await call("POST", "/v1/connections", 0, {"candidate_id": created[1]["user_id"], "mode": "ble"}, expected=404)
                encounter = await call("POST", "/v1/ble/encounters", 0, {"token": second_session["token"], "rssi": -65})
                assert encounter["candidate_id"] == created[1]["user_id"]
                await call("DELETE", "/v1/ble/sessions", 1)
                await call("POST", "/v1/ble/encounters", 0, {"token": second_session["token"]}, expected=404)
                assert len(first_session["token"]) == 43
                created[1]["review"]["profile"]["current_goal"] = "Practice wheel throwing"
                updated = await call("PATCH", "/v1/profile", 1, created[1]["review"])
                assert updated["current_version"]["profile_version_id"] != created[1]["version_id"]
                connections = await call("GET", "/v1/connections", 0)
                assert connections["items"][0]["status"] == "profile_changed" and connections["items"][0]["shared_profile"] is None
                await call("POST", f"/v1/blocks/{created[1]['user_id']}", 0)
                blocked = await call("GET", "/v1/nearby", 1)
                assert blocked["items"] == [] and blocked["pending_count"] == 0
                await call("POST", "/v1/consents", 0, {"purpose": "personal_matching", "granted": False})
                disabled = await call("GET", "/v1/me", 0)
                assert not disabled["matching_consent"] and not disabled["profile"]["bluetooth_enabled"]
                # Direct anon and real authenticated clients cannot access another person's private rows.
                private = await network.get(settings.supabase_url + "/rest/v1/onboarding_answers", params={"user_id": f"eq.{created[1]['user_id']}"},
                    headers={**public_headers, "Authorization": "Bearer " + created[0]["token"]})
                assert private.status_code == 200 and private.json() == []
                print("PASS live Supabase: real JWTs, resumable session, evidence review, immutable edits, 2-mile radius, queued synthetic scorer, private previews, mutual consent, BLE token lifecycle, blocks, consent revocation, direct RLS.")
            finally:
                failures = 0
                for account in created:
                    deleted = await network.delete(settings.supabase_url + "/auth/v1/admin/users/" + account["user_id"], headers=admin_headers)
                    if deleted.status_code != 200:
                        failures += 1
                print(f"Temporary synthetic account cleanup: {len(created) - failures}/{len(created)} deleted.")
                if failures:
                    raise AssertionError("Temporary test account cleanup incomplete")


if __name__ == "__main__":
    asyncio.run(run())

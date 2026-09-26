"""Explicit badge check against local API + live Supabase; all test users are deleted.

Run from the repo root with RUN_LIVE_BADGE_SMOKE=1 and PYTHONPATH=services/api.
No physical device or neural model is used. Never print temporary credentials.
"""

import asyncio
import os
import secrets
from datetime import datetime
from uuid import uuid4

import httpx
from sidebyside_api.config import Settings


async def run():
    if os.environ.get("RUN_LIVE_BADGE_SMOKE") != "1":
        raise SystemExit("Explicit RUN_LIVE_BADGE_SMOKE=1 is required.")
    config = Settings()
    base = "http://127.0.0.1:8000"
    admin = {"apikey": config.supabase_service_role_key.get_secret_value(),
             "Authorization": "Bearer " + config.supabase_service_role_key.get_secret_value()}
    public = {"apikey": config.supabase_anon_key.get_secret_value()}
    accounts = []
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as http:
        async def call(method, path, token, body=None, status=200):
            response = await http.request(method, base + path, json=body,
                                          headers={"Authorization": "Bearer " + token})
            assert response.status_code == status, f"{method} {path}: {response.status_code}; expected {status}"
            return response.json()

        try:
            for _ in range(2):
                email = f"sidebyside-badge-smoke-{uuid4().hex}@example.com"
                password = secrets.token_urlsafe(32)
                response = await http.post(config.supabase_url + "/auth/v1/admin/users", headers=admin,
                    json={"email": email, "password": password, "email_confirm": True,
                          "user_metadata": {"synthetic_integration_test": True}})
                assert response.status_code in (200, 201), "Synthetic account creation failed"
                accounts.append({"user_id": response.json()["id"]})
                login = await http.post(config.supabase_url + "/auth/v1/token?grant_type=password", headers=public,
                                         json={"email": email, "password": password})
                assert login.status_code == 200, "Synthetic account login failed"
                accounts[-1]["token"] = login.json()["access_token"]
            owner, other = [account["token"] for account in accounts]
            before = await call("GET", "/v1/me", owner)
            issued = await call("POST", "/v1/badges", owner, {"label": "Synthetic Core2"}, status=201)
            device_id, device_token = issued["badge"]["device_id"], issued["device_token"]
            assert issued["badge"]["effective_state"] == "offline"
            own = await call("GET", "/v1/badges", owner)
            assert len(own["badges"]) == 1 and device_token not in str(own) and "token_hash" not in str(own)
            assert (await call("GET", "/v1/badges", other))["badges"] == []
            await call("DELETE", f"/v1/badges/{device_id}", other, status=404)
            await call("GET", "/v1/me", device_token, status=401)
            await call("PUT", "/v1/badges/state", owner, {"state": "paused", "sequence": 1}, status=401)
            paused = await call("PUT", "/v1/badges/state", device_token, {"state": "paused", "sequence": 1})
            assert paused["effective_state"] == "paused"
            available = await call("PUT", "/v1/badges/state", device_token, {"state": "available", "sequence": 2})
            assert available["effective_state"] == "available" and available["last_sequence"] == 2
            lease = datetime.fromisoformat(available["lease_expires_at"]) - datetime.fromisoformat(available["last_seen_at"])
            assert lease.total_seconds() == 45
            retry = await call("PUT", "/v1/badges/state", device_token, {"state": "available", "sequence": 2})
            assert retry["lease_expires_at"] == available["lease_expires_at"]
            for state, sequence in [("paused", 1), ("paused", 2)]:
                await call("PUT", "/v1/badges/state", device_token, {"state": state, "sequence": sequence}, status=409)
            await call("PUT", "/v1/badges/state", device_token, {"state": "paused", "sequence": 3})
            current = await call("GET", "/v1/me", owner)
            assert current["profile"] == before["profile"]
            assert current["matching_consent"] == before["matching_consent"]
            private = await http.get(config.supabase_url + "/rest/v1/badge_devices",
                                      headers={**public, "Authorization": "Bearer " + owner})
            assert private.status_code in (401, 403), "Registry is directly readable"
            revoked = await call("DELETE", f"/v1/badges/{device_id}", owner)
            assert revoked["badge"]["effective_state"] == "revoked"
            await call("PUT", "/v1/badges/state", device_token, {"state": "available", "sequence": 4}, status=401)
            print("PASS live badge API: real account JWTs, private provisioning/listing, scoped credentials, pause/resume, exact lease, replay/conflict rejection, unchanged profiles/consent, direct RLS, revocation.")
        finally:
            failures = 0
            for account in accounts:
                try:
                    deleted = await http.delete(config.supabase_url + "/auth/v1/admin/users/" + account["user_id"], headers=admin)
                    if deleted.status_code != 200:
                        failures += 1
                except httpx.HTTPError:
                    failures += 1
            print(f"Temporary badge test accounts deleted: {len(accounts) - failures}/{len(accounts)}.")
            if failures:
                raise AssertionError("Temporary account cleanup incomplete")


if __name__ == "__main__":
    asyncio.run(run())

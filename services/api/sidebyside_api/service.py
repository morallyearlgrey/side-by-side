import hashlib
import secrets
from datetime import datetime, timedelta
from uuid import uuid4

from .errors import AppError
from .jobs import now, row_value
from .models import UserSettings
from .onboarding import validate_evidence


class Application:
    def __init__(self, repo, onboarding, jobs, spotify, settings):
        self.repo, self.onboarding, self.jobs, self.spotify, self.settings = repo, onboarding, jobs, spotify, settings

    async def ensure_profile(self, user_id):
        profile = await self.repo.one("profiles", {"user_id": f"eq.{user_id}"})
        if not profile:
            await self.repo.insert("profiles", {"user_id": user_id}, on_conflict="user_id", ignore=True)
            profile = await self.repo.one("profiles", {"user_id": f"eq.{user_id}"})
        return profile

    async def consent(self, user_id, purpose="personal_matching"):
        return bool(await self.repo.one("consent_receipts", {"user_id": f"eq.{user_id}", "purpose": f"eq.{purpose}", "revoked_at": "is.null"}))

    async def me(self, user_id):
        profile = await self.ensure_profile(user_id)
        profile = {**profile, "settings": UserSettings.model_validate({**profile.get("settings", {}),
            "display_name": profile.get("display_name", ""), "discoverable": profile["discoverable"],
            "bluetooth_enabled": profile["bluetooth_enabled"]}).model_dump()}
        version = await self.repo.one("profile_versions", {"user_id": f"eq.{user_id}",
            "profile_version_id": f"eq.{profile['current_profile_version_id']}"}) if profile["current_profile_version_id"] else None
        if version:
            version["current_goal"] = version.get("current_goal") or ""
        preview = await self.repo.one("profile_previews", {"user_id": f"eq.{user_id}"})
        session = await self.repo.one("onboarding_sessions", {"user_id": f"eq.{user_id}", "status": "neq.completed"}, order="started_at.desc")
        return {"profile": profile, "current_version": version,
                "preview": {"enabled": preview["enabled"], **preview["preview"]} if preview else {"enabled": False, "display_name": "", "interests": []},
                "matching_consent": await self.consent(user_id),
                "onboarding": self.onboarding.response(session) if session else None,
                "readiness": {"muse": self.onboarding.provider.readiness(), "matching": await self.jobs.model_readiness(),
                              "spotify": self.spotify.readiness()}}

    async def set_consent(self, user_id, purpose, granted):
        await self.ensure_profile(user_id)
        if granted:
            if not await self.consent(user_id, purpose):
                await self.repo.insert("consent_receipts", {"user_id": user_id, "purpose": purpose,
                    "policy_version": "sidebyside-consent-v1", "source_ref": "app-explicit-choice"})
        else:
            await self.repo.update("consent_receipts", {"user_id": f"eq.{user_id}", "purpose": f"eq.{purpose}", "revoked_at": "is.null"}, {"revoked_at": now().isoformat()})
            if purpose == "personal_matching":
                await self.repo.update("profiles", {"user_id": f"eq.{user_id}"}, {"discoverable": False, "bluetooth_enabled": False})
                await self.stop_ble(user_id)
        return {"purpose": purpose, "granted": granted}

    async def review(self, user_id, request, *, editing=False):
        profile = await self.ensure_profile(user_id)
        if editing and profile["current_profile_version_id"]:
            current = await self.repo.one("profile_versions", {"user_id": f"eq.{user_id}", "profile_version_id": f"eq.{profile['current_profile_version_id']}"})
            session_id = current["onboarding_session_id"]
        else:
            session_id = (await self.onboarding.session(user_id))["session_id"]
        answers = await self.repo.select("onboarding_answers", {"user_id": f"eq.{user_id}", "session_id": f"eq.{session_id}"})
        validate_evidence(request.profile, answers)
        conversation = request.profile.conversation_request
        if conversation and (conversation.mode != request.settings.matching_context
                             or conversation.goal != request.profile.current_goal):
            raise AppError(422, "stale_conversation_request", "Review your conversation request after changing your goal or conversation mode.")
        if any(fact.matching_allowed and fact.confirmation != "confirmed" for fact in request.profile.facts):
            raise AppError(422, "unconfirmed_facts", "Confirm each fact before enabling it for matching.")
        await self.set_consent(user_id, "personal_matching", request.matching_consent)
        version = row_value(await self.repo.rpc("publish_profile", {
            "p_user_id": user_id, "p_session_id": session_id,
            "p_profile": {**request.profile.model_dump(mode="json"), "current_goal": request.profile.current_goal or None},
            "p_preview": request.preview.model_dump(mode="json"),
            # Availability belongs to the explicit Nearby/Bluetooth controls. Omitting
            # these keys lets the locked RPC preserve current state, not a stale form.
            "p_settings": request.settings.model_dump(mode="json", exclude={"discoverable", "bluetooth_enabled"}),
        }))
        return {"profile": await self.ensure_profile(user_id), "current_version": version,
                "matching_consent": request.matching_consent}

    async def add_answer(self, user_id, request):
        profile = await self.ensure_profile(user_id)
        current = await self.repo.one("profile_versions", {"user_id": f"eq.{user_id}", "profile_version_id": f"eq.{profile['current_profile_version_id']}"}) if profile["current_profile_version_id"] else None
        session_id = current["onboarding_session_id"] if current else (await self.onboarding.session(user_id))["session_id"]
        rows = await self.repo.insert("onboarding_answers", {"answer_id": str(uuid4()), "session_id": session_id,
            "user_id": user_id, **request.model_dump(mode="json")})
        return rows[0]

    async def update_settings(self, user_id, patch):
        profile = await self.ensure_profile(user_id)
        existing = {**profile.get("settings", {}), "discoverable": profile["discoverable"], "bluetooth_enabled": profile["bluetooth_enabled"]}
        # Reject unknown settings through the complete typed schema.
        try:
            settings = UserSettings.model_validate({**existing, **patch})
        except ValueError as exc:
            raise AppError(422, "invalid_settings", "Check the settings fields and values.") from exc
        if settings.matching_context != existing.get("matching_context", "casual_chat"):
            raise AppError(422, "review_conversation_request", "Review and save your profile to change your conversation mode and confirm its experience requirement.")
        if (settings.discoverable or settings.bluetooth_enabled) and (
                not profile["current_profile_version_id"] or not await self.consent(user_id)):
            raise AppError(409, "profile_and_consent_required", "Confirm your profile and enable matching consent first.")
        rows = await self.repo.update("profiles", {"user_id": f"eq.{user_id}"}, {
            "settings": settings.model_dump(), "display_name": settings.display_name,
            "discoverable": settings.discoverable, "bluetooth_enabled": settings.bluetooth_enabled,
        })
        if not settings.bluetooth_enabled:
            await self.repo.update("phone_ble_sessions", {"user_id": f"eq.{user_id}", "revoked_at": "is.null"}, {"revoked_at": now().isoformat()})
        return rows[0]

    async def presence(self, user_id, request):
        profile = await self.ensure_profile(user_id)
        if not profile["discoverable"] or not await self.consent(user_id):
            raise AppError(409, "location_discovery_disabled", "Enable Nearby discovery first.")
        age = (now() - request.observed_at).total_seconds()
        if age < -5 or age > self.settings.presence_ttl_seconds:
            raise AppError(422, "stale_location", "Send a recent location observation.")
        if request.accuracy_m > self.settings.presence_max_accuracy_m:
            raise AppError(422, "location_inaccurate", "Wait for a more accurate location.")
        previous = await self.repo.one("presence", {"user_id": f"eq.{user_id}"})
        if previous and datetime.fromisoformat(previous["observed_at"].replace("Z", "+00:00")) > request.observed_at:
            raise AppError(409, "older_location", "A newer location is already stored.")
        expires = request.observed_at + timedelta(seconds=self.settings.presence_ttl_seconds)
        await self.repo.insert("presence", {"user_id": user_id, **request.model_dump(mode="json"), "expires_at": expires.isoformat()}, on_conflict="user_id")
        return {"expires_at": expires.isoformat(), "refresh_after_seconds": 60}

    async def start_ble(self, user_id):
        profile = await self.ensure_profile(user_id)
        if not profile["current_profile_version_id"] or not await self.consent(user_id) or not profile["available"]:
            raise AppError(409, "profile_and_consent_required", "Confirm your profile and enable matching first.")
        recent = await self.repo.one("phone_ble_sessions", {"user_id": f"eq.{user_id}",
            "issued_at": f"gt.{(now() - timedelta(seconds=10)).isoformat()}"})
        if recent:
            raise AppError(429, "ble_rotation_too_fast", "Wait a few seconds before starting again.")
        if not profile["bluetooth_enabled"]:
            settings = {**profile.get("settings", {}), "bluetooth_enabled": True}
            await self.repo.update("profiles", {"user_id": f"eq.{user_id}"}, {"bluetooth_enabled": True, "settings": settings})
        await self.repo.update("phone_ble_sessions", {"user_id": f"eq.{user_id}", "revoked_at": "is.null"}, {"revoked_at": now().isoformat()})
        token, session_id = secrets.token_urlsafe(32), str(uuid4())
        expires_at = (now() + timedelta(seconds=min(120, self.settings.ble_token_ttl_seconds))).isoformat()
        await self.repo.insert("phone_ble_sessions", {"session_id": session_id, "user_id": user_id,
            "token_hash": hashlib.sha256(token.encode()).hexdigest(), "expires_at": expires_at})
        return {"session_id": session_id, "token": token, "expires_at": expires_at}

    async def stop_ble(self, user_id):
        profile = await self.ensure_profile(user_id)
        await self.repo.update("phone_ble_sessions", {"user_id": f"eq.{user_id}", "revoked_at": "is.null"}, {"revoked_at": now().isoformat()})
        await self.repo.update("profiles", {"user_id": f"eq.{user_id}"}, {"bluetooth_enabled": False,
            "settings": {**profile.get("settings", {}), "bluetooth_enabled": False}})
        return {"live": False}

    async def encounter(self, user_id, request):
        if request.observed_at is not None:
            if request.observed_at.tzinfo is None or not -30 <= (now() - request.observed_at).total_seconds() <= 120:
                raise AppError(422, "stale_encounter", "The Bluetooth observation is no longer fresh.")
        recent = await self.repo.select("encounters", {"observer_user_id": f"eq.{user_id}",
            "observed_at": f"gt.{(now() - timedelta(minutes=1)).isoformat()}"}, limit=61)
        if len(recent) >= 60:
            raise AppError(429, "encounter_rate_limit", "Please wait before checking more Bluetooth encounters.")
        session = await self.repo.one("phone_ble_sessions", {"token_hash": f"eq.{hashlib.sha256(request.token.encode()).hexdigest()}",
            "revoked_at": "is.null", "expires_at": f"gt.{now().isoformat()}"})
        if not session or not await self.jobs.eligible(user_id, session["user_id"], "ble"):
            raise AppError(404, "encounter_not_available", "This encounter is not available.")
        other = session["user_id"]
        await self.repo.insert("encounters", {"observer_user_id": user_id, "observed_user_id": other,
            "observed_session_id": session["session_id"], "rssi": request.rssi},
            on_conflict="observer_user_id,observed_session_id", ignore=True)
        preview = await self.repo.one("profile_previews", {"user_id": f"eq.{other}", "enabled": "eq.true"})
        if not preview:
            return {"status": "insufficient_evidence", "score": None, "reason": "preview_not_available"}
        viewer, candidate = await self.jobs.profile(user_id), await self.jobs.profile(other)
        score = await self.jobs.latest_score(user_id, other, viewer["current_profile_version_id"], candidate["current_profile_version_id"])
        if score is None:
            await self.jobs.enqueue(user_id, other, "ble")
        return {"status": score["status"] if score else "pending", "candidate_id": other,
                "preview": preview["preview"], "score": score["final_score"] if score else None,
                "reason": {"recommend": "This conversation fits your approved request.",
                           "not_recommended": "This conversation is not currently recommended.",
                           "insufficient_evidence": "More confirmed information is needed for this conversation.",
                           "unavailable": "Matching is temporarily unavailable."}.get(score["status"]) if score else None}

    async def request_connection(self, user_id, request):
        candidate_id = str(request.candidate_id)
        if not await self.jobs.eligible(user_id, candidate_id, request.mode):
            raise AppError(404, "candidate_not_available", "This person is no longer available.")
        if request.mode == "ble" and not await self.repo.one("encounters", {
                "observer_user_id": f"eq.{user_id}", "observed_user_id": f"eq.{candidate_id}",
                "observed_at": f"gt.{(now() - timedelta(minutes=2)).isoformat()}"}):
            raise AppError(404, "candidate_not_available", "A recent Bluetooth encounter is required.")
        viewer, candidate = await self.jobs.profile(user_id), await self.jobs.profile(candidate_id)
        score = await self.jobs.latest_score(user_id, candidate_id, viewer["current_profile_version_id"], candidate["current_profile_version_id"])
        if not score or score["status"] != "recommend":
            raise AppError(409, "score_not_ready", "Matching is not ready for this invitation.")
        connection = row_value(await self.repo.rpc("request_connection", {"p_requester_id": user_id,
            "p_recipient_id": candidate_id, "p_lifetime_seconds": 86400, "p_mode": request.mode}))
        return await self.connection_projection(user_id, connection)

    async def connection_projection(self, user_id, row):
        if user_id not in (row["requester_user_id"], row["recipient_user_id"]):
            raise AppError(404, "connection_not_found", "Connection not found.")
        is_requester = row["requester_user_id"] == user_id
        other = row["recipient_user_id"] if is_requester else row["requester_user_id"]
        decisions = {"accept": "accepted", "decline": "declined", "revoke": "revoked", "pending": "pending"}
        result = {"request_id": row["request_id"], "requester_id": row["requester_user_id"],
                  "recipient_id": row["recipient_user_id"], "requester_decision": decisions[row["requester_decision"]],
                  "recipient_decision": decisions[row["recipient_decision"]], "expires_at": row["expires_at"],
                  "created_at": row["created_at"], "status": "pending", "preview": None, "shared_profile": None}
        blocked = await self.repo.one("user_blocks", {"or": f"(and(blocker_user_id.eq.{user_id},blocked_user_id.eq.{other}),and(blocker_user_id.eq.{other},blocked_user_id.eq.{user_id}))"})
        profile = await self.jobs.profile(other)
        own_profile = await self.jobs.profile(user_id)
        expired = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00")) <= now()
        if (blocked or not profile or not own_profile or expired or not profile["available"] or not own_profile["available"]
                or not await self.consent(other) or not await self.consent(user_id)
                or not await self.jobs.eligible(user_id, other, "connection")):
            result["status"] = "unavailable"
            return result
        own_version = row["requester_profile_version_id"] if is_requester else row["recipient_profile_version_id"]
        other_version = row["recipient_profile_version_id"] if is_requester else row["requester_profile_version_id"]
        if own_profile["current_profile_version_id"] != own_version or profile["current_profile_version_id"] != other_version:
            result["status"] = "profile_changed"
            return result
        preview = await self.repo.one("profile_previews", {"user_id": f"eq.{other}", "enabled": "eq.true"})
        result["preview"] = preview["preview"] if preview else None
        if "revoke" in (row["requester_decision"], row["recipient_decision"]):
            result["status"] = "revoked"
        elif "decline" in (row["requester_decision"], row["recipient_decision"]):
            result["status"] = "declined"
        elif row["requester_decision"] == row["recipient_decision"] == "accept":
            result["status"] = "accepted"
            version = await self.repo.one("profile_versions", {"user_id": f"eq.{other}", "profile_version_id": f"eq.{other_version}"})
            result["shared_profile"] = {"facts": [{key: fact.get(key) for key in ("topic", "relationship", "details", "motivation")}
                for fact in version["facts"] if fact["confirmation"] == "confirmed" and fact["sharing_scope"] == "after_mutual_consent"]}
        return result

    async def connections(self, user_id):
        rows = await self.repo.select("connection_requests", {"or": f"(requester_user_id.eq.{user_id},recipient_user_id.eq.{user_id})"}, order="created_at.desc", limit=100)
        return {"items": [await self.connection_projection(user_id, row) for row in rows]}

    async def decide(self, user_id, request_id, decision):
        mapped = {"accepted": "accept", "declined": "decline", "revoked": "revoke"}[decision]
        row = row_value(await self.repo.rpc("decide_connection", {"p_user_id": user_id, "p_request_id": str(request_id), "p_decision": mapped}))
        return await self.connection_projection(user_id, row)

    async def feedback(self, user_id, request):
        row = await self.repo.one("connection_requests", {"request_id": f"eq.{request.connection_id}",
            "or": f"(requester_user_id.eq.{user_id},recipient_user_id.eq.{user_id})"})
        if not row or (await self.connection_projection(user_id, row))["status"] != "accepted":
            raise AppError(409, "connection_not_available", "Feedback requires an accepted connection.")
        requester = row["requester_user_id"] == user_id
        rows = await self.repo.insert("feedback", {"user_id": user_id,
            "viewer_profile_version_id": row["requester_profile_version_id"] if requester else row["recipient_profile_version_id"],
            "candidate_profile_version_id": row["recipient_profile_version_id"] if requester else row["requester_profile_version_id"],
            "context": "app-connection", "outcomes": {"connection_accepted": None,
                "conversation_useful": request.conversation_useful, "would_talk_again": request.would_talk_again}})
        return {"feedback_id": rows[0]["feedback_id"]}

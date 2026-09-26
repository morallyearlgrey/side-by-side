import asyncio
import base64
import hashlib
import json
import logging
import time
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from .errors import AppError
from .matching_policy import PIPELINE, POLICY, POLICY_SHA256

logger = logging.getLogger(__name__)


def now():
    return datetime.now(UTC)


def row_value(value):
    return value[0] if isinstance(value, list) and value else value


class MatchingJobs:
    def __init__(self, repo, runtime, settings):
        self.repo, self.runtime, self.settings = repo, runtime, settings
        self.seen_revisions = {}
        self.last_sweep = 0.0
        self.closed = False

    async def model_readiness(self, user_id=None):
        metadata = self.runtime.metadata()
        if metadata.get("reason") == "unsupported_evidence_pipeline_configuration":
            return metadata
        if self.settings.matching_execution == "remote":
            if self.settings.matching_demo_worker_enabled:
                heartbeat = await self.repo.rpc("demo_worker_readiness", {"p_user_id": user_id}) if user_id else None
                heartbeat = row_value(heartbeat) or {}
                ready = heartbeat.get("status") == "ready"
                return {**metadata, "available": ready, "reason": None if ready else "demo_worker_not_connected",
                        "scope": "fictional_demo_only"}
            heartbeat = await self.repo.one("model_worker_heartbeats", {
                "model_id": f"eq.{self.settings.matching_model_id}", "model_revision": f"eq.{self.settings.matching_model_revision}",
                "pipeline_version": f"eq.{PIPELINE}", "policy": f"eq.{POLICY}",
                "policy_sha256": f"eq.{POLICY_SHA256}", "expires_at": f"gt.{now().isoformat()}"}, order="updated_at.desc")
            ready = bool(heartbeat and heartbeat.get("status") == "ready")
            return {**metadata, "available": ready,
                    "reason": None if ready else (heartbeat or {}).get("reason") or "remote_worker_not_connected"}
        return metadata

    async def profile(self, user_id):
        return await self.repo.one("profiles", {"user_id": f"eq.{user_id}"})

    async def candidates(self, viewer_id):
        if self.settings.matching_demo_worker_enabled:
            return await self.repo.rpc("demo_worker_candidates", {"p_viewer_id": viewer_id})
        return await self.repo.rpc("nearby_candidates", {"p_viewer_id": viewer_id, "p_radius_m": 3218.688})

    async def eligible(self, viewer_id, candidate_id, mode="nearby"):
        if self.settings.matching_demo_worker_enabled and not await self.repo.rpc("demo_worker_pair_supported", {
            "p_viewer_id": viewer_id, "p_candidate_id": candidate_id}):
            return False
        return bool(await self.repo.rpc("eligible_pair", {
            "p_viewer_id": viewer_id, "p_candidate_id": candidate_id, "p_mode": mode}))

    async def enqueue(self, viewer_id, candidate_id, mode="nearby"):
        if not await self.eligible(viewer_id, candidate_id, mode):
            return
        viewer, candidate = await asyncio.gather(self.profile(viewer_id), self.profile(candidate_id))
        if not viewer or not candidate:
            return
        revisions = await self.repo.select("matching_invalidations", {"user_id": f"in.({viewer_id},{candidate_id})"})
        versions = sorted((row["user_id"], row["revision"]) for row in revisions)
        context = viewer.get("settings", {}).get("matching_context", "casual_chat")
        identity = {"viewer_id": viewer_id, "candidate_id": candidate_id,
                    "viewer_version_id": viewer["current_profile_version_id"],
                    "candidate_version_id": candidate["current_profile_version_id"],
                    "context": context, "history_version": "excluded-v1", "mode": mode,
                    "model_id": self.settings.matching_model_id, "model_revision": self.settings.matching_model_revision,
                    "pipeline_version": PIPELINE, "policy": POLICY, "policy_sha256": POLICY_SHA256}
        digest = hashlib.sha256(json.dumps({**identity, "revisions": versions,
            "refresh_epoch": int(time.time() // self.settings.score_ttl_seconds)}, sort_keys=True).encode()).hexdigest()
        await self.repo.insert("matching_jobs", {**identity, "identity_hash": digest,
                               "history_cutoff_at": now().isoformat(), "status": "pending"},
                               on_conflict="identity_hash", ignore=True)

    async def invalidate(self, user_id):
        # SQL triggers also call this; explicit requests cover model-policy reconciliation.
        await self.repo.rpc("invalidate_user_matches", {"p_user_id": user_id})

    async def reconcile(self):
        sweep = time.monotonic() - self.last_sweep >= self.settings.score_ttl_seconds
        if sweep:
            self.last_sweep = time.monotonic()
        events = await self.repo.select("matching_invalidations", order="updated_at.desc", limit=1000)
        for event in events:
            user_id, revision = event["user_id"], event["revision"]
            if self.seen_revisions.get(user_id) == revision and not sweep:
                continue
            for candidate in await self.candidates(user_id):
                candidate_id = candidate["user_id"]
                await self.enqueue(user_id, candidate_id)
                await self.enqueue(candidate_id, user_id)
            # Previously observed BLE pairs can refresh while both Live tokens remain active.
            encounters = await self.repo.select("encounters", {
                "or": f"(observer_user_id.eq.{user_id},observed_user_id.eq.{user_id})",
                "observed_at": f"gte.{(now() - timedelta(minutes=2)).isoformat()}"}, limit=100)
            for encounter in encounters:
                other = encounter["observed_user_id"] if encounter["observer_user_id"] == user_id else encounter["observer_user_id"]
                await self.enqueue(user_id, other, "ble")
                await self.enqueue(other, user_id, "ble")
            self.seen_revisions[user_id] = revision
        # Periodic fresh candidate enumeration handles model changes, retries and score expiry.
        if len(self.seen_revisions) > 10000:
            self.seen_revisions.clear()

    async def run_once(self):
        await self.reconcile()
        jobs = await self.repo.rpc("claim_matching_jobs", {
            "p_limit": self.settings.matching_batch_size, "p_lease_seconds": 300})
        for job in jobs:
            try:
                if (job["model_id"] != self.settings.matching_model_id or job["model_revision"] != self.settings.matching_model_revision
                        or job["pipeline_version"] != PIPELINE or job["policy"] != POLICY
                        or job.get("policy_sha256") != POLICY_SHA256
                        or not await self.eligible(job["viewer_id"], job["candidate_id"], job["mode"])):
                    await self.repo.update("matching_jobs", {"job_id": f"eq.{job['job_id']}", "lease_token": f"eq.{job['lease_token']}",
                        "status": "eq.running"}, {"status": "cancelled", "lease_token": None, "lease_expires_at": None})
                    continue
                viewer = await self.repo.one("profile_versions", {"profile_version_id": f"eq.{job['viewer_version_id']}", "user_id": f"eq.{job['viewer_id']}"})
                candidate = await self.repo.one("profile_versions", {"profile_version_id": f"eq.{job['candidate_version_id']}", "user_id": f"eq.{job['candidate_id']}"})
                if not viewer or not candidate:
                    raise AppError(409, "profile_removed", "Profile was removed")
                result = await self.runtime.score(viewer, candidate, job["context"])
                payload = result.model_dump()
                payload["final_score"] = result.score
                await self.repo.rpc("publish_matching_result", {
                    "p_job_id": job["job_id"], "p_lease_token": job["lease_token"],
                    "p_result": payload, "p_ttl_seconds": self.settings.score_ttl_seconds})
            except AppError:
                await self.repo.rpc("fail_matching_job", {"p_job_id": job["job_id"],
                    "p_lease_token": job["lease_token"], "p_error": "processing_failed",
                    "p_retry_seconds": min(300, 10 * 2 ** min(job["attempts"], 5))})

    async def run(self):
        while not self.closed:
            try:
                await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                # Never log profiles, bearer tokens, provider payloads or database details.
                logger.warning("Matching worker iteration failed; retrying.")
            await asyncio.sleep(self.settings.worker_interval_seconds)

    async def latest_score(self, viewer_id, candidate_id, viewer_version, candidate_version):
        return await self.repo.one("match_scores", {
            "viewer_id": f"eq.{viewer_id}", "candidate_id": f"eq.{candidate_id}",
            "viewer_profile_version_id": f"eq.{viewer_version}", "candidate_profile_version_id": f"eq.{candidate_version}",
            "expires_at": f"gt.{now().isoformat()}", "model_id": f"eq.{self.settings.matching_model_id}",
            "model_revision": f"eq.{self.settings.matching_model_revision}", "pipeline_version": f"eq.{PIPELINE}",
            "policy": f"eq.{POLICY}", "policy_sha256": f"eq.{POLICY_SHA256}"}, order="scored_at.desc")

    @staticmethod
    def cursor(snapshot_id, offset):
        return base64.urlsafe_b64encode(json.dumps([snapshot_id, offset]).encode()).decode().rstrip("=")

    @staticmethod
    def parse_cursor(cursor):
        try:
            snapshot_id, offset = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
            if not isinstance(offset, int) or not 0 <= offset <= 10000:
                raise ValueError("Bad offset")
            return str(UUID(snapshot_id)), offset
        except (ValueError, TypeError, UnicodeDecodeError) as exc:
            raise AppError(400, "invalid_cursor", "Refresh the nearby list.") from exc

    async def nearby(self, user_id, cursor=None, limit=20):
        candidates = await self.candidates(user_id)
        eligible = {candidate["user_id"]: candidate for candidate in candidates}
        if cursor:
            snapshot_id, offset = self.parse_cursor(cursor)
            snapshot = await self.repo.one("match_snapshots", {
                "snapshot_id": f"eq.{snapshot_id}", "viewer_id": f"eq.{user_id}",
                "expires_at": f"gt.{now().isoformat()}", "pipeline_version": f"eq.{PIPELINE}",
                "policy": f"eq.{POLICY}", "policy_sha256": f"eq.{POLICY_SHA256}",
                "model_id": f"eq.{self.settings.matching_model_id}",
                "model_revision": f"eq.{self.settings.matching_model_revision}"})
            if not snapshot:
                raise AppError(409, "snapshot_expired", "Nearby matches changed. Refresh the list.")
            items = snapshot["items"]
            # A membership/consent change invalidates the cursor; do not silently compress pages.
            if any(item["user_id"] not in eligible or item.get("_model_id") != self.settings.matching_model_id
                   or item.get("_model_revision") != self.settings.matching_model_revision
                   or item.get("_pipeline") != PIPELINE or item.get("_policy_sha256") != POLICY_SHA256 for item in items):
                raise AppError(409, "snapshot_expired", "Nearby matches changed. Refresh the list.")
            counts = snapshot["counts"]
        else:
            viewer = await self.profile(user_id)
            counts = {"pending_count": 0, "not_recommended_count": 0, "insufficient_evidence_count": 0, "unavailable_count": 0}
            items = []
            expiries = [now() + timedelta(seconds=self.settings.snapshot_ttl_seconds)]
            for candidate in candidates:
                candidate_id = candidate["user_id"]
                score = await self.latest_score(user_id, candidate_id, viewer["current_profile_version_id"], candidate["profile_version_id"])
                if score is None:
                    counts["pending_count"] += 1
                    await self.enqueue(user_id, candidate_id)
                elif score["status"] in ("not_recommended", "insufficient_evidence", "unavailable"):
                    counts[f"{score['status']}_count"] += 1
                    expiries.append(datetime.fromisoformat(score["expires_at"].replace("Z", "+00:00")))
                elif score["status"] == "recommend" and score["final_score"] is not None:
                    expiries.append(datetime.fromisoformat(score["expires_at"].replace("Z", "+00:00")))
                    items.append({"user_id": candidate_id, "_model_id": self.settings.matching_model_id,
                                  "_model_revision": self.settings.matching_model_revision, "_pipeline": PIPELINE,
                                  "_policy_sha256": POLICY_SHA256, "preview": candidate["preview"],
                                  "score": score["final_score"], "status": "recommend",
                                  "distance_m": round(candidate["distance_m"]),
                                  "reason": "Based on your approved conversation interests and goals."})
                else:
                    counts["pending_count"] += 1
                    await self.enqueue(user_id, candidate_id)
            items.sort(key=lambda item: (-item["score"], item["user_id"]))
            snapshot_id, offset = str(uuid4()), 0
            await self.repo.insert("match_snapshots", {"snapshot_id": snapshot_id, "viewer_id": user_id,
                "items": items, "counts": counts, "pipeline_version": PIPELINE, "policy": POLICY,
                "policy_sha256": POLICY_SHA256, "model_id": self.settings.matching_model_id,
                "model_revision": self.settings.matching_model_revision, "expires_at": min(expiries).isoformat()})
        page = [{key: value for key, value in item.items() if not key.startswith("_")}
                for item in items[offset:offset + limit]]
        end = offset + len(page)
        return {"items": page, "snapshot_id": snapshot_id,
                "next_cursor": self.cursor(snapshot_id, end) if end < len(items) else None,
                **counts, "model": await self.model_readiness(user_id), "refresh_after_seconds": 15}

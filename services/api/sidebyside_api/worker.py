"""Standalone persistent-queue inference worker; no public HTTP or Muse/Spotify keys."""
import asyncio
import logging
from contextlib import suppress
from datetime import timedelta
from uuid import uuid4

import httpx

from .config import Settings
from .jobs import MatchingJobs, now
from .matching import MatchingRuntime
from .matching_policy import PIPELINE, POLICY, POLICY_SHA256
from .repository import Repository
from .intake_jobs import IntakeMatchingJobs
from ml.intake_matching import MODEL_ID as INTAKE_MODEL_ID
from ml.intake_matching import MODEL_REVISION as INTAKE_MODEL_REVISION
from ml.intake_matching import PIPELINE_VERSION as INTAKE_PIPELINE

logger = logging.getLogger(__name__)


async def serve():
    config = Settings().model_copy(update={"matching_execution": "local"})
    if not config.database_configured:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
    runtime = MatchingRuntime(config)
    if not runtime.compatible_configuration():
        raise SystemExit("The evidence worker requires the pinned Qwen 4B configuration; no heartbeat or job was written.")
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
        repo = Repository(config, client)
        worker_id = str(uuid4())
        intake_jobs = IntakeMatchingJobs(repo, runtime, config) if config.intake_matching_enabled else None

        async def heartbeat():
            metadata = runtime.metadata()
            await repo.insert("model_worker_heartbeats", {
                "worker_id": worker_id, "model_id": config.matching_model_id,
                "model_revision": config.matching_model_revision, "pipeline_version": PIPELINE,
                "policy": POLICY, "policy_sha256": POLICY_SHA256, "provenance": metadata,
                "status": "ready" if metadata["available"] else "unavailable", "reason": metadata["reason"],
                "updated_at": now().isoformat(), "expires_at": (now() + timedelta(seconds=90)).isoformat(),
            }, on_conflict="worker_id")
            if intake_jobs:
                await repo.insert("pilot_intake_match_workers", {
                    "worker_id": worker_id, "model_id": INTAKE_MODEL_ID,
                    "model_revision": INTAKE_MODEL_REVISION,
                    "pipeline_version": INTAKE_PIPELINE,
                    "status": "ready" if metadata["available"] else "unavailable",
                    "reason": None if metadata["available"] else "model_loading",
                    "updated_at": now().isoformat(),
                    "expires_at": (now() + timedelta(seconds=90)).isoformat(),
                }, on_conflict="worker_id")

        # First heartbeat reports loading/unavailable; no placeholder scores are claimed.
        await heartbeat()
        await runtime.warm()
        await heartbeat()
        if not runtime.assets_ready:
            raise SystemExit("Matching model is unavailable. Check pinned cached weights, device and dependencies; no jobs were scored.")
        jobs = MatchingJobs(repo, runtime, config)

        async def pulse():
            while True:
                try:
                    await heartbeat()
                except Exception:
                    logger.warning("Worker heartbeat failed; database connection will be retried.")
                await asyncio.sleep(20)

        task = asyncio.create_task(pulse())

        async def process_intake_batches():
            while True:
                try:
                    await intake_jobs.run_once()
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.warning("Private intake queue check failed; retrying.")
                await asyncio.sleep(config.worker_interval_seconds)

        intake_task = asyncio.create_task(process_intake_batches()) if intake_jobs else None
        try:
            await jobs.run()
        finally:
            jobs.closed = True
            if intake_task:
                intake_task.cancel()
                with suppress(asyncio.CancelledError):
                    await intake_task
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            await repo.delete("model_worker_heartbeats", {"worker_id": f"eq.{worker_id}"})
            if intake_jobs:
                await repo.delete("pilot_intake_match_workers", {"worker_id": f"eq.{worker_id}"})


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

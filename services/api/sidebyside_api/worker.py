"""Standalone persistent-queue inference worker; no public HTTP or Muse/Spotify keys."""
import asyncio
import logging
from contextlib import suppress
from datetime import timedelta
from uuid import uuid4

import httpx

from .config import Settings
from .jobs import MatchingJobs, now
from .matching import PIPELINE, MatchingRuntime
from .repository import Repository

logger = logging.getLogger(__name__)


async def serve():
    config = Settings().model_copy(update={"matching_execution": "local"})
    if not config.database_configured:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
    runtime = MatchingRuntime(config)
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
        repo = Repository(config, client)
        worker_id = str(uuid4())

        async def heartbeat():
            metadata = runtime.metadata()
            await repo.insert("model_worker_heartbeats", {
                "worker_id": worker_id, "model_id": config.matching_model_id,
                "model_revision": config.matching_model_revision, "pipeline_version": PIPELINE,
                "status": "ready" if metadata["available"] else "unavailable", "reason": metadata["reason"],
                "updated_at": now().isoformat(), "expires_at": (now() + timedelta(seconds=90)).isoformat(),
            }, on_conflict="worker_id")

        # First heartbeat reports loading/unavailable; no placeholder scores are claimed.
        await heartbeat()
        await runtime.warm()
        await heartbeat()
        if runtime.model is None:
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
        try:
            await jobs.run()
        finally:
            jobs.closed = True
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            await repo.delete("model_worker_heartbeats", {"worker_id": f"eq.{worker_id}"})


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

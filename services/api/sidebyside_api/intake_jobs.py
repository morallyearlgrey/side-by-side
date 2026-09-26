"""Scoped queue consumer for the private opt-in HackGT intake pilot."""

import asyncio
import logging
from uuid import UUID

from .errors import AppError
from ml.intake_matching import (
    MODEL_ID,
    MODEL_REVISION,
    PIPELINE_VERSION,
    review_record,
    score_intake_batch,
)

logger = logging.getLogger(__name__)


class IntakeMatchingJobs:
    def __init__(self, repo, runtime, settings):
        self.repo, self.runtime, self.settings = repo, runtime, settings

    async def run_once(self):
        jobs = await self.repo.rpc("claim_pilot_intake_match_batches", {
            "p_limit": 1, "p_lease_seconds": 1800,
        })
        for job in jobs or []:
            try:
                ids = [str(UUID(value)) for value in job["participant_receipt_ids"]]
                query = {"receipt_id": f"in.({','.join(ids)})"}
                rows = await self.repo.select(
                    "pilot_intake_responses", query,
                    columns="receipt_id,created_at,payload",
                )
                if len(rows) != len(ids):
                    raise ValueError("consent_or_response_unavailable")
                records = [review_record(row) for row in rows]
                if {record["participant_id"] for record in records} != set(ids):
                    raise ValueError("consent_or_response_unavailable")
                if not self.runtime.assets_ready or self.runtime.model is None:
                    raise AppError(503, "model_unavailable", "The model is unavailable.")
                async with self.runtime.lock:
                    result = await asyncio.to_thread(score_intake_batch, records, self.runtime.model)
                provenance = {
                    "model_id": MODEL_ID,
                    "model_revision": MODEL_REVISION,
                    "pipeline_version": PIPELINE_VERSION,
                    "prompt_version": "pilot-intake-relevance-v1",
                    "score_interpretation": "uncalibrated relative ranking score, not a compatibility probability",
                    "weights_frozen": True,
                    "training_performed": False,
                }
                await self.repo.rpc("complete_pilot_intake_match_batch", {
                    "p_batch_id": job["batch_id"],
                    "p_lease_token": job["lease_token"],
                    "p_result": result,
                    "p_model_provenance": provenance,
                })
            except Exception as exc:
                reason = "consent_or_response_unavailable" if str(exc) == "consent_or_response_unavailable" else (
                    "model_unavailable" if isinstance(exc, AppError) and exc.code == "model_unavailable" else "inference_failed"
                )
                try:
                    await self.repo.rpc("fail_pilot_intake_match_batch", {
                        "p_batch_id": job["batch_id"],
                        "p_lease_token": job["lease_token"],
                        "p_error_code": reason,
                    })
                except Exception:
                    logger.warning("Could not update private intake batch state.")
                logger.warning("Private intake batch processing failed (%s).", reason)

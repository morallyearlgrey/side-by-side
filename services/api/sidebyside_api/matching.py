"""Online, consent-gated inference adapters; never forge a synthetic research bundle."""

import asyncio
import hashlib
import json
import math
import re
import unicodedata
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from .errors import AppError
from .models import ConversationMode, ProfileDraft
from .onboarding import validate_evidence

POLICY = "onboarding-only-v1"
PIPELINE = "online-approved-onboarding-v1"
QWEN_PROMPT = "directional-approved-text-v1"
MINILM_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"


def canonical(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).replace("<", "\\u003c").replace(">", "\\u003e")


def normalized(text):
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


class OnlineProfile(ProfileDraft):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)
    user_id: UUID
    profile_version_id: UUID
    data_origin: Literal["real_opt_in"]
    onboarding_answers: list[dict]
    valid_from: datetime

    @classmethod
    def from_record(cls, row):
        profile = cls.model_validate({**row, "current_goal": row.get("current_goal") or ""})
        if profile.valid_from.tzinfo is None or profile.valid_from > datetime.now(UTC):
            raise ValueError("Profile version time is invalid")
        for answer in profile.onboarding_answers:
            if str(answer.get("user_id", profile.user_id)) != str(profile.user_id):
                raise ValueError("Evidence ownership mismatch")
            recorded = answer.get("answered_at") or answer.get("created_at")
            if recorded and datetime.fromisoformat(recorded.replace("Z", "+00:00")) > profile.valid_from:
                raise ValueError("Evidence follows profile snapshot")
        validate_evidence(profile, profile.onboarding_answers)
        return profile


def approved_facts(profile):
    seen, facts = set(), []
    for fact in profile.facts:
        if fact.confirmation != "confirmed" or not fact.matching_allowed:
            continue
        text = ". ".join(value for value in (fact.topic, fact.details, fact.motivation) if value)
        key = (fact.relationship, normalized(text))
        if key not in seen:
            seen.add(key)
            facts.append(fact)
    return sorted(facts, key=lambda fact: (fact.relationship, normalized(". ".join(
        value for value in (fact.topic, fact.details, fact.motivation) if value))))


def evidence_gate(viewer, candidate):
    if viewer.avoid_topics or candidate.avoid_topics:
        return "boundary_review_required"
    if not candidate.open_to_discussing:
        return "candidate_openness_missing"
    if not approved_facts(viewer) or not approved_facts(candidate):
        return "insufficient_approved_facts"
    return None


def approved_text(profile):
    return {"current_goal": profile.current_goal, "conversation_intent": profile.conversation_intent,
            "open_to_discussing": profile.open_to_discussing,
            "conversation_preferences": profile.conversation_preferences,
            "approved_facts": [{"role": fact.relationship, "topic": fact.topic, "details": fact.details,
                                "motivation": fact.motivation} for fact in approved_facts(profile)]}


def pair_text(viewer, candidate, mode: ConversationMode):
    # Exact onboarding_only research prompt semantics. No historical outcomes enter v1.
    return canonical({"requested_conversation": {"mode": mode, "goal": viewer.current_goal},
                      "viewer": approved_text(viewer), "earlier_feedback": []}), canonical(approved_text(candidate))


class ScoreResult(BaseModel):
    status: Literal["scored", "abstained", "unavailable"]
    score: float | None = None
    reason: str | None = None
    model_id: str
    model_revision: str
    pipeline_version: str = PIPELINE
    policy: str = POLICY
    prompt_version: str | None = None
    feature_version: str | None = None
    onboarding_weight: float | None = None
    instagram_weight: float | None = None


class MatchingRuntime:
    """One model per process, serialized inference, bounded by persistent job claims."""

    def __init__(self, settings):
        self.settings = settings
        self.model = None
        self.reason = "model_not_loaded"
        self.lock = asyncio.Lock()
        self.checkpoint = None
        self.remote_status = None

    def metadata(self):
        remote = self.settings.matching_execution == "remote"
        ready = bool(self.remote_status and self.remote_status.get("status") == "ready") if remote else self.model is not None
        reason = (self.remote_status or {}).get("reason") or "remote_worker_not_connected" if remote else self.reason
        return {"available": ready, "reason": None if ready else reason, "execution": self.settings.matching_execution,
                "provider": self.settings.matching_provider, "model_id": self.settings.matching_model_id,
                "model_revision": self.settings.matching_model_revision,
                "pipeline_version": PIPELINE, "policy": POLICY,
                "score_description": "Uncalibrated directional conversational relevance"}

    def result(self, status, score=None, reason=None):
        return ScoreResult(status=status, score=score, reason=reason,
                           model_id=self.settings.matching_model_id, model_revision=self.settings.matching_model_revision,
                           prompt_version=QWEN_PROMPT if self.settings.matching_provider == "qwen" else None,
                           feature_version="directional-semantic-v1" if self.settings.matching_provider == "minilm" else None,
                           onboarding_weight=1.0 if status == "scored" else None,
                           instagram_weight=0.0 if status == "scored" else None)

    async def warm(self):
        async with self.lock:
            try:
                await asyncio.to_thread(self._load)
                self.reason = None
            except (ImportError, OSError, ValueError, RuntimeError, KeyError, AppError):
                self.model = None
                self.reason = "missing_or_incompatible_model_assets"

    def _load(self):
        if self.settings.matching_provider == "qwen":
            from ml.reranker import MODEL_REVISIONS, QwenReranker
            model_id, revision = self.settings.matching_model_id, self.settings.matching_model_revision
            if MODEL_REVISIONS.get(model_id) != revision:
                raise ValueError("Application Qwen requires a supported pinned revision")
            self.model = QwenReranker(model_id=model_id, revision=revision,
                                     device=self.settings.matching_device, dtype=self.settings.matching_dtype)
        elif self.settings.matching_provider == "minilm":
            self._load_minilm()
        else:
            raise ValueError("Unsupported matching provider")

    def _load_minilm(self):
        import numpy as np
        import torch
        from sentence_transformers import SentenceTransformer

        from ml.features import ENCODER_ID, FEATURE_VERSION, feature_names
        from ml.model import Matcher

        directory = Path(self.settings.matching_model_dir)
        config = json.loads((directory / "config.json").read_text())
        if (config["feature_version"] != FEATURE_VERSION or config["feature_names"] != feature_names()
                or config["input_dim"] != 71 or config["mode"] != "onboarding_only"
                or config["encoder"]["id"] != ENCODER_ID
                or config["encoder"]["revision"] != MINILM_REVISION
                or self.settings.matching_model_id != ENCODER_ID
                or not re.fullmatch(r"[0-9a-f]{64}", self.settings.matching_model_revision)):
            raise ValueError("MiniLM requires the pinned onboarding-only feature/checkpoint contract")
        checkpoint_bytes = (directory / "matcher.pt").read_bytes()
        actual_revision = hashlib.sha256(checkpoint_bytes).hexdigest()
        if actual_revision != self.settings.matching_model_revision:
            raise ValueError("Checkpoint SHA256 differs from configured model revision")
        device = self.settings.matching_device
        model = SentenceTransformer(ENCODER_ID, revision=MINILM_REVISION, device=device,
                                    local_files_only=True, trust_remote_code=False,
                                    model_kwargs={"use_safetensors": True}, token=False)
        model.max_seq_length = 256
        model.eval()

        class Encoder:
            dimension = 384

            def encode(self, texts):
                nonempty = [text for text in texts if text]
                result = model.encode(nonempty, normalize_embeddings=True, convert_to_numpy=True) if nonempty else []
                iterator = iter(result)
                return np.array([next(iterator) if text else np.zeros(384, dtype=np.float32) for text in texts])

        from ml.features import TextEncoder
        # Match the research encoder metadata without constructing its downloading loader.
        encoder = Encoder()
        encoder.revision = MINILM_REVISION
        encoder.model = model
        if TextEncoder.metadata(encoder) != config["encoder"]:
            raise ValueError("Encoder metadata differs from training")
        state = torch.load(directory / "matcher.pt", map_location="cpu", weights_only=True)
        mean, scale = state["mean"].numpy(), state["scale"].numpy()
        if mean.shape != (71,) or scale.shape != (71,) or not np.isfinite(mean).all() or not np.isfinite(scale).all() or not (scale > 0).all():
            raise ValueError("Invalid normalization")
        self.model = Matcher(71).to(device)
        self.model.load_state_dict(state["state_dict"], strict=True)
        self.model.eval()
        self.checkpoint = (encoder, config, mean, scale)

    def _score(self, viewer, candidate, mode):
        if self.settings.matching_provider == "qwen":
            query, document = pair_text(viewer, candidate, mode)
            result = self.model.score(query, document)
            # Cache lives in Postgres; do not retain unbounded private prompt hashes in RAM.
            self.model.cache.clear()
            return result["uncalibrated_relevance_score"], result["abstain_reason"]
        from ml.features import FeatureBuilder
        from ml.model import predict_scores
        encoder, config, mean, scale = self.checkpoint
        # FeatureBuilder accepts validated profiles; do not invoke score_pairs or its synthetic guard.
        profiles = [profile.model_dump(mode="json") for profile in (viewer, candidate)]
        pair = {"viewer_profile_version_id": str(viewer.profile_version_id),
                "candidate_profile_version_id": str(candidate.profile_version_id),
                "context": {"mode": mode, "goal": viewer.current_goal}, "prior_feedback_ids": []}
        builder = FeatureBuilder({"profiles": profiles, "feedback": []}, encoder,
                                 mode="onboarding_only", top_k=config["top_k"])
        features = (builder.build(pair) - mean) / scale
        score = float(predict_scores(self.model, features[None, :], self.settings.matching_device)[0])
        return score, None

    async def score(self, viewer_row, candidate_row, mode):
        try:
            viewer, candidate = OnlineProfile.from_record(viewer_row), OnlineProfile.from_record(candidate_row)
        except (ValueError, KeyError, TypeError, AppError):
            return self.result("abstained", reason="invalid_or_unsupported_profile_evidence")
        gate = evidence_gate(viewer, candidate)
        if gate:
            return self.result("abstained", reason=gate)
        if self.model is None:
            return self.result("unavailable", reason=self.reason)
        async with self.lock:
            try:
                score, reason = await asyncio.to_thread(self._score, viewer, candidate, mode)
                if reason:
                    return self.result("abstained", reason=reason)
                if score is None or not math.isfinite(score) or not 0 <= score <= 1:
                    raise ValueError("Invalid model score")
                return self.result("scored", score=score)
            except (OSError, RuntimeError, ValueError, KeyError):
                return self.result("unavailable", reason="inference_error")

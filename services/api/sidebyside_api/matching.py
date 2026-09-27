"""Online, consent-gated inference adapters; never forge a synthetic research bundle."""

import asyncio
import json
import logging
import unicodedata
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, model_validator

from .errors import AppError
from .matching_policy import (
    EVIDENCE_MODEL_ID,
    EVIDENCE_REVISION,
    FEATURE_VERSION,
    FORMAT_ENCODER_ID,
    MINILM_REVISION,
    QWEN_MODEL_ID,
    QWEN_REVISION,
    load_policy,
    provenance,
)
from .matching_policy import (
    PIPELINE as PIPELINE,
)
from .matching_policy import (
    POLICY as POLICY,
)
from .matching_policy import (
    POLICY_SHA256 as POLICY_SHA256,
)
from .matching_policy import (
    QWEN_PROMPT as QWEN_PROMPT,
)
from .models import ConversationMode, ProfileDraft
from .onboarding import validate_evidence
from .score_decision import decide_score
from .topic_boundaries import (
    BoundaryAwareReranker,
    scoped_profiles,
    semantic_boundary_gate,
    topic_boundaries,
)

logger = logging.getLogger(__name__)


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
        answer_ids = [str(answer["answer_id"]) for answer in profile.onboarding_answers]
        if len(answer_ids) != len(set(answer_ids)):
            raise ValueError("Duplicate evidence IDs")
        for answer in profile.onboarding_answers:
            # Legacy server snapshots bind ownership through their enclosing immutable version.
            if str(answer.get("user_id", profile.user_id)) != str(profile.user_id):
                raise ValueError("Evidence ownership mismatch")
            recorded = answer.get("answered_at") or answer.get("created_at")
            if not recorded:
                raise ValueError("Evidence time is missing")
            answered_at = datetime.fromisoformat(recorded.replace("Z", "+00:00"))
            if answered_at.tzinfo is None or answered_at > profile.valid_from:
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
    scoped, boundary_reason = scoped_profiles(viewer.model_dump(mode="json"), candidate.model_dump(mode="json"))
    if boundary_reason:
        return boundary_reason
    viewer, candidate = (OnlineProfile.model_validate(p) for p in scoped)
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


class OnlineEvidenceBuilder:
    """Dedicated real-opt-in boundary, sharing only validated low-level research logic.

    No synthetic bundle, training label, or synthetic validator bypass is involved.
    The immutable profile snapshot supplies the authenticated request confirmation.
    """

    def __init__(self, viewer: OnlineProfile, candidate: OnlineProfile, mode):
        if viewer.user_id == candidate.user_id:
            raise ValueError("A person cannot match themselves")
        scoped, reason = scoped_profiles(viewer.model_dump(mode="json"), candidate.model_dump(mode="json"))
        self.boundary_reason = reason
        if scoped:
            viewer, candidate = (OnlineProfile.model_validate(p) for p in scoped)
        self.viewer, self.candidate = viewer, candidate
        self.include_social = False
        self.posts = {}
        self.profiles = {str(p.profile_version_id): p.model_dump(mode="json") for p in (viewer, candidate)}
        if len(self.profiles) != 2:
            raise ValueError("Profile version identities must differ")
        request = viewer.conversation_request
        self.pair = {
            "example_id": "online-directional-pair",
            "viewer_profile_version_id": str(viewer.profile_version_id),
            "candidate_profile_version_id": str(candidate.profile_version_id),
            "as_of": viewer.valid_from.isoformat(),
            "context": {"mode": mode, "goal": viewer.current_goal,
                        "evidence_requirement": request.evidence_requirement.model_dump() if request else None},
        }
        self.pairs = {self.pair["example_id"]: self.pair}

    def build(self, pair):
        from ml.matching_v3 import profile_text, source_facts
        from ml.reranker import json_data

        if pair != self.pair:
            raise ValueError("Pair must belong to the validated online request")
        gate = self.boundary_reason or evidence_gate(self.viewer, self.candidate) or request_gate(self.viewer, pair["context"]["mode"])
        if gate:
            return {"abstain_reason": gate, "tasks": [], "history_used": 0, "history_omitted": 0}
        viewer = self.profiles[pair["viewer_profile_version_id"]]
        candidate = self.profiles[pair["candidate_profile_version_id"]]
        context = {key: pair["context"][key] for key in ("mode", "goal")}
        left = {"requested_conversation": context,
                "viewer": profile_text(viewer, source_facts(viewer)["onboarding"])}
        right = profile_text(candidate, source_facts(candidate)["onboarding"])
        # The confirmed requirement is enforced by score_evidence_aware before
        # ranking. Do not ask a second generic classifier to invent additional
        # evidence requirements and veto this approved conversation contract.
        tasks = [{"name": "onboarding", "instruction": "relevance",
                  "query": json_data(left), "document": json_data(right)}]
        if viewer["conversation_preferences"] and candidate["conversation_preferences"]:
            tasks.append({"name": "style", "instruction": "format_affinity",
                          "query": json_data({"requested_conversation": context,
                                              "current_preferences": viewer["conversation_preferences"],
                                              "earlier_feedback": []}),
                          "document": json_data({"candidate_preferences": candidate["conversation_preferences"]})})
        return {"abstain_reason": None, "tasks": tasks, "history_used": 0, "history_omitted": 0}


def request_gate(viewer, mode):
    request = viewer.conversation_request
    if request is None:
        return "evidence_requirement_missing"
    if request.mode != mode or request.goal != viewer.current_goal:
        return "evidence_requirement_stale"
    if request.evidence_requirement.confirmation != "confirmed" or request.evidence_requirement.kind == "unresolved":
        return "evidence_requirement_unresolved"
    return None


class ScoreResult(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    status: Literal["recommend", "not_recommended", "insufficient_evidence", "unavailable"]
    score: float | None = None
    reason: str | None = None
    model_id: str
    model_revision: str
    pipeline_version: str = PIPELINE
    policy: str = POLICY
    policy_sha256: str = POLICY_SHA256
    evidence_model_id: str = EVIDENCE_MODEL_ID
    evidence_model_revision: str = EVIDENCE_REVISION
    format_encoder_id: str = FORMAT_ENCODER_ID
    format_encoder_revision: str = MINILM_REVISION
    prompt_version: str = QWEN_PROMPT
    feature_version: str = FEATURE_VERSION
    onboarding_weight: float | None = None
    instagram_weight: float | None = None

    @model_validator(mode="after")
    def score_state(self):
        if self.status in ("recommend", "not_recommended"):
            if self.score is None or not 0 <= self.score <= 1:
                raise ValueError("A scored decision needs a finite relevance score")
        elif self.score is not None:
            raise ValueError("Missing evidence and unavailable models do not have ranking scores")
        return self


class MatchingRuntime:
    """Pinned, onboarding-only evidence pilot; no model-size or legacy fallback."""

    def __init__(self, settings):
        self.settings = settings
        self.model = self.evidence_model = self.format_encoder = None
        self.policy = None
        self.reason = "model_not_loaded"
        self.lock = asyncio.Lock()
        self.remote_status = None

    @property
    def assets_ready(self):
        return all(asset is not None for asset in (self.model, self.evidence_model, self.format_encoder, self.policy))

    def compatible_configuration(self):
        return (self.settings.matching_provider == "qwen"
                and self.settings.matching_model_id == QWEN_MODEL_ID
                and self.settings.matching_model_revision == QWEN_REVISION)

    def metadata(self):
        remote = self.settings.matching_execution == "remote"
        ready = bool(self.remote_status and self.remote_status.get("status") == "ready") if remote else self.assets_ready
        reason = ((self.remote_status or {}).get("reason") or "remote_worker_not_connected") if remote else self.reason
        if not self.compatible_configuration():
            ready, reason = False, "unsupported_evidence_pipeline_configuration"
        return {**provenance(), "available": ready, "reason": None if ready else reason,
                "execution": self.settings.matching_execution, "provider": self.settings.matching_provider,
                "score_description": "Synthetic-calibrated directional conversational relevance; not a compatibility probability",
                "scope": "approved_onboarding_only", "independently_validated": False}

    def result(self, status, score=None, reason=None):
        scored = status in ("recommend", "not_recommended")
        return ScoreResult(status=status, score=score, reason=reason, **provenance(),
                           onboarding_weight=1.0 if scored else None, instagram_weight=0.0 if scored else None)

    async def warm(self):
        async with self.lock:
            if not self.compatible_configuration():
                self.model = self.evidence_model = self.format_encoder = self.policy = None
                self.reason = "unsupported_evidence_pipeline_configuration"
                return
            try:
                await asyncio.to_thread(self._load)
                self.reason = None
            except (ImportError, OSError, ValueError, RuntimeError, KeyError, AppError):
                self.model = self.evidence_model = self.format_encoder = self.policy = None
                self.reason = "missing_or_incompatible_model_assets"

    def _load(self):
        from ml.evidence import EvidenceVerifier
        from ml.reranker import QwenReranker

        if not self.compatible_configuration():
            raise ValueError("The evidence pipeline requires the pinned Qwen 4B checkpoint")
        policy = load_policy()
        # Offline loaders only. A missing cache never triggers startup downloads.
        evidence = EvidenceVerifier(device="cpu")
        encoder = self._load_format_encoder()
        model = QwenReranker(model_id=QWEN_MODEL_ID, revision=QWEN_REVISION,
                             device=self.settings.matching_device, dtype=self.settings.matching_dtype)
        self.model, self.evidence_model, self.format_encoder, self.policy = model, evidence, encoder, policy

    @staticmethod
    def _load_format_encoder():
        import numpy as np
        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer(FORMAT_ENCODER_ID, revision=MINILM_REVISION, device="cpu",
                                    local_files_only=True, trust_remote_code=False,
                                    model_kwargs={"use_safetensors": True}, token=False)
        if model.get_sentence_embedding_dimension() != 384:
            raise ValueError("Unexpected format encoder dimensions")
        model.max_seq_length = 256
        model.eval()

        class Encoder:
            def encode(self, texts):
                nonempty = [text for text in texts if text]
                values = model.encode(nonempty, normalize_embeddings=True, convert_to_numpy=True,
                                      show_progress_bar=False) if nonempty else []
                iterator = iter(values)
                return np.array([next(iterator) if text else np.zeros(384, dtype=np.float32) for text in texts])

        return Encoder()

    def _score(self, viewer, candidate, mode):
        from ml.matching_v4 import score_evidence_aware

        builder = OnlineEvidenceBuilder(viewer, candidate, mode)
        try:
            boundaries = topic_boundaries(*builder.profiles.values())
            boundary_reason = semantic_boundary_gate(self.model, boundaries,
                [{**approved_text(p), "evidence_requirement": p.conversation_request.evidence_requirement.model_dump()
                  if p.conversation_request else None} for p in (builder.viewer, builder.candidate)],
                self.policy["topic_boundaries"])
            if boundary_reason:
                return self.result("insufficient_evidence", reason=boundary_reason)
            model = BoundaryAwareReranker(self.model, boundaries)
            records, _private_audit = score_evidence_aware(builder, [builder.pair], model,
                                                         evidence_model=self.evidence_model,
                                                         format_encoder=self.format_encoder)
            decision = decide_score(records[0], self.policy["calibration"], self.policy["policy"])
            status = decision["decision"]
            reason = decision["reason"]
            if reason == "component_unavailable" and any(
                component.get("abstain_reason") == "input_exceeds_token_limit"
                for component in records[0]["components"].values()
            ):
                # Keep the known input-limit diagnosis instead of suggesting
                # missing profile facts. Never forward arbitrary model errors
                # or private prompt contents through the public score reason.
                reason = "input_exceeds_token_limit"
            score = decision["score"] if status in ("recommend", "not_recommended") else None
            result = self.result(status, score, reason)
            components = records[0]["components"]
            # Server diagnostics distinguish a high relevance output from the
            # final decision without retaining identities, prompts or evidence.
            # These component numbers never enter the public ScoreResult.
            logger.info("Matching decision %s", json.dumps({
                "relevance_score": components.get("onboarding", {}).get("uncalibrated_relevance_score"),
                "format_score": components.get("style", {}).get("uncalibrated_relevance_score"),
                "diagnostic_calibrated_score": decision["diagnostic_calibrated_score"],
                "ranking_score": result.score,
                "decision": result.status,
                "reason": result.reason,
                "decision_threshold": self.policy["policy"]["decision_threshold"],
                "evidence_contract": "confirmed_request_and_verified_approved_sources",
                "pipeline_version": PIPELINE,
                "policy_sha256": POLICY_SHA256,
                "score_is_compatibility_probability": False,
            }, allow_nan=False, sort_keys=True))
            return result
        finally:
            for model in (self.model, self.evidence_model):
                cache = getattr(model, "cache", None)
                if cache is not None:
                    cache.clear()

    async def score(self, viewer_row, candidate_row, mode):
        try:
            viewer, candidate = OnlineProfile.from_record(viewer_row), OnlineProfile.from_record(candidate_row)
        except (ValueError, KeyError, TypeError, AppError):
            return self.result("insufficient_evidence", reason="invalid_or_unsupported_profile_evidence")
        gate = evidence_gate(viewer, candidate) or request_gate(viewer, mode)
        if gate:
            return self.result("insufficient_evidence", reason=gate)
        if not self.compatible_configuration():
            return self.result("unavailable", reason="unsupported_evidence_pipeline_configuration")
        if not self.assets_ready:
            return self.result("unavailable", reason=self.reason)
        async with self.lock:
            try:
                return await asyncio.to_thread(self._score, viewer, candidate, mode)
            except (ImportError, OSError, RuntimeError, ValueError, KeyError, TypeError, AppError):
                return self.result("unavailable", reason="inference_error")

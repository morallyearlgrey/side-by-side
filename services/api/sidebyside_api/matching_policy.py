"""Versioned identity for the onboarding-only online evidence pilot."""

import hashlib
import json
from pathlib import Path

PIPELINE = "online-approved-onboarding-contract-v5"
POLICY = "onboarding-contract-v5"
POLICY_SHA256 = "09a7d11ed360101af2acdffa68e1504a1cb398b29e80691eb0a4004821502d8f"
QWEN_MODEL_ID = "Qwen/Qwen3-Reranker-4B"
QWEN_REVISION = "22e683669bc0f0bd69640a1354a6d0aebcfeede5"
EVIDENCE_MODEL_ID = "MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"
EVIDENCE_REVISION = "eb8b17b1983bca679126ea69b12b5d28c5fe9b9a"
FORMAT_ENCODER_ID = "sentence-transformers/all-MiniLM-L6-v2"
MINILM_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
QWEN_PROMPT = "source-aware-relevance-contract-v5"
FEATURE_VERSION = "onboarding-format-contract-v5"
POLICY_PATH = Path(__file__).resolve().parents[3] / "ml/policies/online-contract-evidence-v5.json"


def load_policy():
    """A changed policy requires a new identity and cache migration, never hot retuning."""
    content = POLICY_PATH.read_bytes()
    if hashlib.sha256(content).hexdigest() != POLICY_SHA256:
        raise ValueError("The frozen matching policy does not match its pinned fingerprint")
    selected = json.loads(content)
    if selected["recommended_variant"] != "source_aware_tuned":
        raise ValueError("Unsupported base matching policy")
    return selected


def provenance():
    return {"pipeline_version": PIPELINE, "policy": POLICY, "policy_sha256": POLICY_SHA256,
            "model_id": QWEN_MODEL_ID, "model_revision": QWEN_REVISION,
            "evidence_model_id": EVIDENCE_MODEL_ID, "evidence_model_revision": EVIDENCE_REVISION,
            "format_encoder_id": FORMAT_ENCODER_ID, "format_encoder_revision": MINILM_REVISION,
            "prompt_version": QWEN_PROMPT, "feature_version": FEATURE_VERSION}

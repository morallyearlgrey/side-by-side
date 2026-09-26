"""The shareable policy snapshot must preserve the evaluated calibration."""

import hashlib
import json
from pathlib import Path

from ml.matching_v3 import FORMAT_ENCODER_REVISION
from ml.reranker import MODEL_REVISIONS


DIRECTORY = Path(__file__).resolve().parents[1] / "policies/newton-matching-v3-852098"


def test_frozen_policy_snapshot_keeps_evaluated_settings_and_readiness():
    data = (DIRECTORY / "selected_policy.json").read_bytes()
    assert hashlib.sha256(data).hexdigest() == "b1e4b4ef1c58f17007400f5064ef97b12d19489d1a78698ca177e2792080bf57"
    selected = json.loads(data)
    protocol = json.loads((DIRECTORY / "protocol.json").read_text())
    status = json.loads((DIRECTORY / "status.json").read_text())
    assert status["state"] == "completed"
    assert selected["ready_for_live_profiles"] is False
    assert selected["recommended_variant"] == "source_aware_tuned"
    assert selected["policy"] == {"decision_threshold": 0.5, "evidence_threshold": 0.3, "style_threshold": 0.5}
    assert selected["calibration"]["human_calibrated"] is False
    assert protocol["model"]["id"] == "Qwen/Qwen3-Reranker-4B"
    assert protocol["model"]["revision"] == MODEL_REVISIONS[protocol["model"]["id"]]
    assert protocol["format_encoder"]["revision"] == FORMAT_ENCODER_REVISION

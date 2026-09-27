"""Application decisions after approved-source and explicit experience checks."""

import math


def decide_score(record, calibration, policy):
    from ml.tune_matching_v3 import calibrated

    result = {"decision": "insufficient_evidence", "score": None,
              "diagnostic_calibrated_score": None, "reason": record["abstain_reason"]}
    # score_evidence_aware already checks the confirmed request contract and
    # required firsthand sources. A failed check cannot be overridden by a score.
    if result["reason"]:
        return result
    components = record["components"]
    relevance = components.get("onboarding", {}).get("uncalibrated_relevance_score")
    if (isinstance(relevance, bool) or not isinstance(relevance, (float, int))
            or not math.isfinite(relevance) or not 0 <= relevance <= 1):
        result["reason"] = "component_unavailable"
        return result
    # Embedding dissimilarity is not evidence of an explicit style conflict.
    # The style component remains available for diagnostics, not a veto or multiplier.
    score = calibrated(relevance, calibration)
    result.update(score=score, diagnostic_calibrated_score=score)
    if score >= policy["decision_threshold"]:
        result.update(decision="recommend", reason="above_threshold")
    else:
        result.update(decision="not_recommended", reason="below_threshold")
    return result

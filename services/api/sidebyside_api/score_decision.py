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
    style = components.get("style")
    affinity = style.get("uncalibrated_relevance_score") if style else 1.0
    if any(isinstance(value, bool) or not isinstance(value, (float, int))
           or not math.isfinite(value) or not 0 <= value <= 1 for value in (relevance, affinity)):
        result["reason"] = "component_unavailable"
        return result
    score = calibrated(relevance * affinity, calibration)
    result.update(score=score, diagnostic_calibrated_score=score)
    if style and affinity < policy["style_threshold"]:
        result.update(decision="not_recommended", reason="supported_format_conflict")
    elif score >= policy["decision_threshold"]:
        result.update(decision="recommend", reason="above_threshold")
    else:
        result.update(decision="not_recommended", reason="below_threshold")
    return result

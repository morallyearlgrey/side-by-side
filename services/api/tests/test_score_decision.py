"""Application score decisions after the explicit evidence contract check."""

import pytest
from sidebyside_api.matching_policy import load_policy
from sidebyside_api.score_decision import decide_score


def record(relevance=0.99, *, failure=None, style=None):
    components = {"onboarding": {"uncalibrated_relevance_score": relevance}}
    if style is not None:
        components["style"] = {"uncalibrated_relevance_score": style}
    return {"abstain_reason": failure, "components": components}


def decide(value):
    selected = load_policy()
    return decide_score(value, selected["calibration"], selected["policy"])


def test_99_percent_score_becomes_recommendation_after_valid_contract():
    result = decide(record())
    assert result["decision"] == "recommend"
    assert result["score"] > 0.99


@pytest.mark.parametrize("reason", ["evidence_requirement_missing", "boundary_review_required",
    "required_firsthand_experience_missing", "required_firsthand_experience_unsupported",
    "firsthand_evidence_conflicting", "insufficient_approved_facts"])
def test_high_score_cannot_override_failed_explicit_evidence_check(reason):
    result = decide(record(failure=reason))
    assert result["decision"] == "insufficient_evidence"
    assert result["reason"] == reason and result["score"] is None


@pytest.mark.parametrize("score", [None, float("nan"), float("inf"), -0.1, 1.1, "0.99", True])
def test_invalid_or_absent_scores_never_become_matches(score):
    result = decide(record(score))
    assert result["decision"] == "insufficient_evidence"
    assert result["reason"] == "component_unavailable" and result["score"] is None


def test_low_relevance_stays_negative():
    assert decide(record(0.01))["decision"] == "not_recommended"


@pytest.mark.parametrize("style", [0.0, 0.1, 0.9, 1.0])
def test_different_style_descriptions_do_not_veto_supported_relevance(style):
    result = decide(record(style=style))
    assert result["decision"] == "recommend"
    assert result["reason"] == "above_threshold"
    assert result["score"] == decide(record())["score"]

"""Fixture-only parity with Bryan's untouched synthetic research contracts."""
import copy
from uuid import uuid4

import numpy as np
import pytest
from sidebyside_api.matching import OnlineProfile, pair_text

pytest.importorskip("torch")

from ml.features import FeatureBuilder, approved_facts  # noqa: E402
from ml.reranker import PairTextBuilder  # noqa: E402
from ml.tests.test_pipeline import TestEncoder  # noqa: E402
from ml.validation import ROOT, read_json, validate_bundle  # noqa: E402


def fixture_as_online(profile):
    """Synthetic test data adapted to the runtime shape; never used in production."""
    row = copy.deepcopy(profile)
    row.update(user_id=str(uuid4()), profile_version_id=str(uuid4()), data_origin="real_opt_in")
    answer_ids = {answer["answer_id"]: str(uuid4()) for answer in row["onboarding_answers"]}
    for answer in row["onboarding_answers"]:
        answer["answer_id"] = answer_ids[answer["answer_id"]]
        answer["user_id"] = row["user_id"]
    row["facts"] = copy.deepcopy(approved_facts(profile, "onboarding_only"))
    for fact in row["facts"]:
        for evidence in fact["evidence"]:
            evidence["reference_id"] = answer_ids[evidence["reference_id"]]
    return OnlineProfile.from_record(row)


def test_online_qwen_text_matches_research_onboarding_ablation():
    bundle = read_json(ROOT / "data/samples/v2/italy-example.json")
    pair = bundle["training_pairs"][0]
    viewer, candidate = [profile for profile in bundle["profiles"][:2]]
    pair["context"]["goal"] = viewer["current_goal"]
    research = PairTextBuilder(bundle, mode="onboarding_only").build(pair)
    online_viewer, online_candidate = fixture_as_online(viewer), fixture_as_online(candidate)
    query, document = pair_text(online_viewer, online_candidate, pair["context"]["mode"])
    assert query == research["query"]
    assert document == research["document"]


def test_online_minilm_feature_order_and_values_match_research():
    bundle = read_json(ROOT / "data/samples/v2/italy-example.json")
    pair = bundle["training_pairs"][0]
    viewer, candidate = bundle["profiles"][:2]
    pair["context"]["goal"] = viewer["current_goal"]
    research = FeatureBuilder(bundle, TestEncoder(), mode="onboarding_only").build(pair)
    online_viewer, online_candidate = fixture_as_online(viewer), fixture_as_online(candidate)
    online_pair = {"viewer_profile_version_id": str(online_viewer.profile_version_id),
                   "candidate_profile_version_id": str(online_candidate.profile_version_id),
                   "context": pair["context"], "prior_feedback_ids": []}
    online = FeatureBuilder({"profiles": [profile.model_dump(mode="json") for profile in (online_viewer, online_candidate)],
                             "feedback": []}, TestEncoder(), mode="onboarding_only").build(online_pair)
    assert online.shape == (71,)
    np.testing.assert_array_equal(online, research)


def test_research_synthetic_guard_is_preserved():
    bundle = read_json(ROOT / "data/samples/v2/italy-example.json")
    bundle["training_basis"] = "mixed_authorized"
    with pytest.raises(ValueError, match="consent"):
        validate_bundle(bundle)


@pytest.mark.parametrize("role,requirement_kind", [("experienced", "firsthand"), ("wants_to_try", "firsthand"),
                                                  ("wants_to_try", "none")])
def test_contract_adapter_preserves_v4_relevance_inputs_and_explicit_experience_checks(role, requirement_kind):
    from sidebyside_api.matching import OnlineEvidenceBuilder
    from sidebyside_api.models import ConversationRequest
    from sidebyside_api.score_decision import decide_score
    from test_matching import loaded_runtime

    from ml.matching_v3 import SourceAwareBuilder
    from ml.matching_v4 import score_evidence_aware
    from ml.tests.test_matching_v4 import fixture

    bundle, pair, viewer, candidate = fixture(role)
    if requirement_kind == "none":
        pair["context"]["evidence_requirement"].update(kind="none", subject=None, claim=None)
    # Current intent and request are identical in both independent adapters.
    viewer["current_goal"] = pair["context"]["goal"]
    online_viewer, online_candidate = fixture_as_online(viewer), fixture_as_online(candidate)
    online_viewer.conversation_request = ConversationRequest.model_validate(pair["context"])
    runtime = loaded_runtime()
    research_builder = SourceAwareBuilder(bundle, include_social=False, include_history=False)
    online_builder = OnlineEvidenceBuilder(online_viewer, online_candidate, pair["context"]["mode"])
    assert online_builder.build(online_builder.pair)["tasks"] == [
        task for task in research_builder.build(pair)["tasks"] if task["name"] != "sufficiency"]
    records, _ = score_evidence_aware(research_builder, [pair], runtime.model,
                                     evidence_model=runtime.evidence_model, format_encoder=runtime.format_encoder)
    expected = decide_score(records[0], runtime.policy["calibration"], runtime.policy["policy"])
    actual = runtime._score(online_viewer, online_candidate, pair["context"]["mode"])
    assert actual.status == expected["decision"]
    assert actual.score == (expected["score"] if expected["decision"] != "insufficient_evidence" else None)
    assert actual.reason == expected["reason"]

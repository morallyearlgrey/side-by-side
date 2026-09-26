import copy
import hashlib
import json

import pytest
import numpy as np

from ml.matching_v3 import (INSTRUCTIONS, SourceAwareBuilder, blended_score, score_components,
                            source_facts, format_compatibility)
from ml.reranker import INSTRUCTION, prompt_text
from ml.splits import partition_pairs
from ml.synthetic_v3 import generate
from ml.tune_matching_v3 import (DEFAULT_POLICY, IDENTITY, calibrated, choose_policy, decide,
                                decision_metrics, fit_calibration, run_experiment)
from ml.validation import read_json, write_json


@pytest.fixture(scope="module")
def generated():
    return generate()


class FakeModel:
    """Deterministic plumbing double, NOT evidence of semantic model quality."""
    def __init__(self):
        self.calls = []

    def metadata(self):
        return {"id": "test-double-not-qwen"}

    def score(self, query, document, *, instruction=INSTRUCTION):
        text = prompt_text(query, document, instruction)
        key = hashlib.sha256(text.encode()).hexdigest()
        self.calls.append(text)
        return {"uncalibrated_relevance_score": int(key[:4], 16) / 65535,
                "abstain_reason": None, "cache_hit": False, "elapsed_seconds": 0.01,
                "input_tokens": 100, "prompt_sha256": key}


def row(score=0.8, social=None, sufficiency=0.9, style=None):
    component = lambda value: {"uncalibrated_relevance_score": value, "abstain_reason": None}
    result = {"example_id": "example", "abstain_reason": None,
              "components": {"onboarding": component(score), "sufficiency": component(sufficiency)}}
    if social is not None:
        result["components"]["social_candidate"] = component(social)
    if style is not None:
        result["components"]["style"] = component(style)
    return result


def test_new_data_is_synthetic_and_family_disjoint(generated):
    bundle, manifest, cases = generated
    splits = partition_pairs(bundle, manifest)
    assert {s: len(p) for s, p in splits.items()} == {"train": 120, "validation": 60, "test": 60}
    assert len(cases) == len(bundle["training_pairs"]) == 240
    assert all(not p["label"]["human_reviewed"] for p in bundle["training_pairs"])
    assert all(p["label"]["source"] == "synthetic_draft" for p in bundle["training_pairs"])
    for split, pairs in splits.items():
        assert {cases[p["example_id"]]["split"] for p in pairs} == {split}
        assert {p["label"]["relevant_connection"] for p in pairs} == {0, 1, None}


def test_sources_deduplicate_without_leaking_mixed_claims(generated):
    profile = copy.deepcopy(generated[0]["profiles"][2])
    original = profile["facts"][0]
    duplicate = copy.deepcopy(original)
    duplicate["fact_id"] += "_duplicate"
    duplicate["evidence"][0]["source_type"] = "owned_post"
    profile["facts"].insert(0, duplicate)
    assert len(source_facts(profile)["onboarding"]) == 2
    assert source_facts(profile)["social"] == []
    original["evidence"].append(copy.deepcopy(duplicate["evidence"][0]))
    assert len(source_facts(profile)["onboarding"]) == 2
    profile["facts"] = [original]
    for evidence in original["evidence"]:
        evidence["support"] = "A partial fragment"
    assert source_facts(profile) == {"onboarding": [], "social": []}


def test_builder_omits_annotations_ids_and_unapproved_text(generated):
    bundle = copy.deepcopy(generated[0])
    pair = bundle["training_pairs"][0]
    before = SourceAwareBuilder(bundle).build(pair)
    pair["label"]["reason"] = "SECRET_LABEL_REASON"
    pair["example_id"] = "SECRET_PAIR_ID"
    hidden = copy.deepcopy(bundle["profiles"][0]["facts"][0])
    hidden.update(fact_id="hidden", details="SECRET_UNAPPROVED", confirmation="pending",
                  matching_allowed=False, sharing_scope="matching_only")
    bundle["profiles"][0]["facts"].append(hidden)
    assert SourceAwareBuilder(bundle).build(pair) == before
    model = FakeModel()
    score_components(SourceAwareBuilder(bundle), [pair], model)
    assert "SECRET" not in str(model.calls)


def test_real_data_and_foreign_pairs_fail(generated):
    bundle = copy.deepcopy(generated[0])
    builder = SourceAwareBuilder(bundle)
    with pytest.raises(ValueError, match="validated bundle"):
        builder.build({**bundle["training_pairs"][0], "prior_feedback_ids": ["unvalidated"]})
    bundle["training_basis"] = "mixed_authorized"
    with pytest.raises(ValueError, match="consent"):
        SourceAwareBuilder(bundle)


def test_source_weights_and_missing_irrelevant_social():
    assert blended_score(row())[0] == 0.8
    assert blended_score(row())[1] == {"onboarding": 1.0, "social": 0.0}
    assert blended_score(row(social=0.1)) == blended_score(row())
    score, weights = blended_score(row(score=0.8, social=0.6))
    assert score == pytest.approx(0.74)
    assert weights == {"onboarding": 0.7, "social": 0.3}
    assert score <= 0.7 * 0.8 + 0.3


def test_structural_gates_prevent_model_calls(generated):
    bundle, _, cases = generated
    pair = next(p for p in bundle["training_pairs"] if cases[p["example_id"]]["case"] == "onboarding_missing")
    model = FakeModel()
    records, prompts = score_components(SourceAwareBuilder(bundle), [pair], model)
    assert not model.calls and not prompts
    assert records[0]["abstain_reason"] == "insufficient_onboarding_facts"
    assert decide(records[0], IDENTITY, DEFAULT_POLICY)["decision"] == "insufficient_evidence"


def test_boundary_and_openness_gates(generated):
    for field, value, reason in (("avoid_topics", ["private topic"], "boundary_review_required"),
                                 ("open_to_discussing", [], "candidate_openness_missing")):
        bundle = copy.deepcopy(generated[0])
        bundle["profiles"][2][field] = value
        assert SourceAwareBuilder(bundle).build(bundle["training_pairs"][0])["abstain_reason"] == reason


def test_current_intent_preserved_and_social_is_separate(generated):
    bundle, _, cases = generated
    builder = SourceAwareBuilder(bundle)
    for case, social_key in (("social_experience_bridge", "social_candidate"), ("viewer_social_experience", "social_viewer")):
        pair = next(p for p in bundle["training_pairs"] if cases[p["example_id"]]["case"] == case)
        tasks = {t["name"]: t for t in builder.build(pair)["tasks"]}
        assert social_key in tasks
        assert json.loads(tasks["onboarding"]["query"])["requested_conversation"] == pair["context"]
        assert not any(t["name"].startswith("social") for t in SourceAwareBuilder(bundle, include_social=False).build(pair)["tasks"])


def test_null_ratings_do_not_create_style_signal(generated):
    bundle, _, cases = generated
    pair = next(p for p in bundle["training_pairs"] if cases[p["example_id"]]["case"] == "null_feedback_not_dislike")
    result = SourceAwareBuilder(bundle).build(pair)
    assert result["history_used"] == 0
    assert "style" not in {t["name"] for t in result["tasks"]}


def test_style_prompt_excludes_topic_facts_ids_and_acceptance(generated):
    bundle, _, cases = generated
    pair = next(p for p in bundle["training_pairs"] if cases[p["example_id"]]["case"] == "history_counterfactual")
    task = next(t for t in SourceAwareBuilder(bundle).build(pair)["tasks"] if t["name"] == "style")
    query = json.loads(task["query"])
    assert len(query["earlier_feedback"]) == 2
    assert all(set(h) == {"context", "explicit_ratings", "format"} for h in query["earlier_feedback"])
    assert "connection_accepted" not in task["query"] and "approved_facts" not in task["query"]
    assert set(json.loads(task["document"])) == {"candidate_preferences"}


class OrthogonalEncoder:
    """Text identity only, to verify aggregation independent of model semantics."""
    def encode(self, texts):
        return np.eye(len(texts), dtype=float)


def test_format_feedback_uses_ratings_not_topic_overlap():
    task = {"query": json.dumps({"requested_conversation": {"goal": "practice"},
            "current_preferences": [], "earlier_feedback": [
                {"context": "practice", "format": ["hands-on"], "explicit_ratings": {"conversation_useful": True, "would_talk_again": True}},
                {"context": "practice", "format": ["lecture"], "explicit_ratings": {"conversation_useful": False, "would_talk_again": True}}]}),
            "document": json.dumps({"candidate_preferences": ["lecture"]})}
    assert format_compatibility(task, OrthogonalEncoder())["uncalibrated_relevance_score"] == 0
    task["document"] = json.dumps({"candidate_preferences": ["hands-on"]})
    assert format_compatibility(task, OrthogonalEncoder())["uncalibrated_relevance_score"] == 1
    query = json.loads(task["query"])
    query["current_preferences"] = ["lecture"]
    task["query"] = json.dumps(query)
    task["document"] = json.dumps({"candidate_preferences": ["lecture"]})
    assert format_compatibility(task, OrthogonalEncoder())["basis"] == "current_explicit_preferences"
    assert format_compatibility(task, OrthogonalEncoder())["uncalibrated_relevance_score"] == 1


def test_irrelevant_context_is_not_a_style_penalty():
    task = {"query": json.dumps({"requested_conversation": {"goal": "practice"},
            "current_preferences": [], "earlier_feedback": [
                {"context": "parking", "format": ["lecture"], "explicit_ratings": {"conversation_useful": False, "would_talk_again": False}}]}),
            "document": json.dumps({"candidate_preferences": ["lecture"]})}
    result = format_compatibility(task, OrthogonalEncoder())
    assert result["basis"] == "no_relevant_format_evidence"
    assert result["uncalibrated_relevance_score"] == 1


def test_instruction_participates_in_cache_hash():
    from ml.tests.test_reranker import fake_engine
    engine, calls = fake_engine()
    one = engine.score("viewer", "candidate")
    two = engine.score("viewer", "candidate", instruction=INSTRUCTIONS["sufficiency"])
    three = engine.score("viewer", "candidate", instruction=INSTRUCTIONS["sufficiency"])
    assert len(calls) == 2 and three["cache_hit"]
    assert one["prompt_sha256"] != two["prompt_sha256"]


def test_gate_decisions_distinguish_unknown_from_negative():
    assert decide(row(sufficiency=0.1), IDENTITY, DEFAULT_POLICY)["decision"] == "insufficient_evidence"
    assert decide(row(style=0.1), IDENTITY, DEFAULT_POLICY)["decision"] == "not_recommended"
    assert decide(row(), IDENTITY, DEFAULT_POLICY)["decision"] == "recommend"
    assert decide(row(score=0.1), IDENTITY, DEFAULT_POLICY)["decision"] == "not_recommended"
    assert decide(row(sufficiency=None), IDENTITY, DEFAULT_POLICY)["reason"] == "component_unavailable"


def test_abstaining_on_positives_cannot_inflate_recall():
    pairs = [{"example_id": str(i), "label": {"relevant_connection": label}} for i, label in enumerate([1, 0, None])]
    decisions = [{"example_id": p["example_id"], "decision": "insufficient_evidence"} for p in pairs]
    metrics = decision_metrics(pairs, decisions)
    assert metrics["recall"] == 0 and metrics["known_coverage"] == 0
    assert metrics["positive_abstentions"] == 1 and metrics["unknown_abstentions"] == 1
    assert metrics["selection_cost"] > 0


def test_calibration_excludes_unknowns_and_preserves_order():
    pairs = [{"example_id": str(i), "label": {"relevant_connection": label}} for i, label in enumerate([0, 0, 1, 1, None])]
    records = [{**row(score), "example_id": str(i)} for i, score in enumerate([0.1, 0.2, 0.8, 0.9, 0.99])]
    result = fit_calibration(pairs, records)
    assert result["fit_examples"] == 4 and not result["human_calibrated"]
    assert calibrated(0.8, result) > calibrated(0.2, result)
    selected, trials = choose_policy(pairs, records, result)
    assert len(trials) == 180
    assert set(selected) == set(DEFAULT_POLICY)


def test_end_to_end_test_labels_never_affect_selected_policy(tmp_path, generated):
    bundle, manifest, cases = generated
    # Keep a small balanced slice per split to test orchestration, not quality.
    bundle = copy.deepcopy(bundle)
    kept = []
    for split in ("train", "validation", "test"):
        kept += partition_pairs(bundle, manifest)[split][:6]
    bundle["training_pairs"] = kept
    cases = {p["example_id"]: cases[p["example_id"]] for p in kept}
    paths = [tmp_path / name for name in ("dataset.json", "splits.json", "cases.json")]
    for p, value in zip(paths, (bundle, manifest, cases)):
        write_json(p, value)
    model = FakeModel()
    report = run_experiment(*paths, tmp_path / "one", model)
    assert read_json(tmp_path / "one/status.json")["state"] == "completed"
    assert report["selected"]["test_used_for_selection"] is False
    for pair in bundle["training_pairs"]:
        if cases[pair["example_id"]]["split"] == "test" and pair["label"]["relevant_connection"] is not None:
            pair["label"]["relevant_connection"] = 1 - pair["label"]["relevant_connection"]
            pair["label"]["rubric"] = dict.fromkeys(pair["label"]["rubric"], "yes")
            if pair["label"]["relevant_connection"] == 0:
                pair["label"]["rubric"]["intent_fit"] = "no"
    changed = tmp_path / "changed.json"
    write_json(changed, bundle)
    other = run_experiment(changed, paths[1], paths[2], tmp_path / "two", FakeModel())
    assert report["selected"] == other["selected"]
    with pytest.raises(ValueError, match="already exists"):
        run_experiment(*paths, tmp_path / "one", FakeModel())

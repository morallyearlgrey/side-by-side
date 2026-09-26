import copy
import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
from jsonschema import ValidationError

from ml.features import (FeatureBuilder, approved_facts, eligibility_reason,
                         feature_names)
from ml.compare_runs import compare_runs
from ml.metrics import evaluate
from ml.inspect_pair import inspect_pair
from ml.predict import score_pairs
from ml.splits import partition_pairs
from ml.synthetic import generate
from ml.train import select_rows, train_run
from ml.validation import ROOT, read_json, validate_bundle, write_json


class TestEncoder:
    """Deterministic test double only. Never used by the training CLI."""

    __test__ = False
    dimension = 32

    def encode(self, texts):
        rows = []
        for text in texts:
            row = np.zeros(self.dimension, dtype=np.float32)
            for word in text.lower().split():
                digest = hashlib.sha256(word.encode()).digest()
                row[int.from_bytes(digest[:2], "big") % self.dimension] += 1 if digest[2] % 2 else -1
            row /= max(float(np.linalg.norm(row)), 1e-8)
            rows.append(row)
        return np.asarray(rows)

    def metadata(self):
        return {"id": "test-only-hashed-words", "revision": "test", "dimension": self.dimension}


@pytest.fixture
def pilot():
    return generate()


@pytest.fixture
def italy():
    return read_json(ROOT / "data/samples/v2/italy-example.json")


def test_existing_v2_example_is_valid(italy):
    validate_bundle(italy)


def test_pilot_counts_splits_and_repeatability(pilot):
    bundle, manifest = pilot
    assert generate() == pilot
    assert len(bundle["profiles"]) == 120
    assert len(bundle["training_pairs"]) == 270
    partitions = partition_pairs(bundle, manifest)
    rows, counts = select_rows(bundle, partitions)
    assert sum(len(group) for group in rows.values()) == 240
    assert sum(count["unknown_label"] for count in counts.values()) == 30
    users = {}
    for split, pairs in partitions.items():
        users[split] = {pair[key] for pair in pairs for key in ("viewer_profile_version_id", "candidate_profile_version_id")}
    assert not users["train"] & users["test"]
    assert not users["train"] & users["validation"]
    assert not users["test"] & users["validation"]


@pytest.mark.parametrize("field,value", [("relevant_connection", 0.8), ("human_reviewed", "yes")])
def test_bad_labels_rejected(italy, field, value):
    italy["training_pairs"][0]["label"][field] = value
    with pytest.raises(ValidationError):
        validate_bundle(italy)


def test_positive_rubric_must_agree(italy):
    italy["training_pairs"][0]["label"]["rubric"]["intent_fit"] = "no"
    with pytest.raises(ValidationError):
        validate_bundle(italy)


@pytest.mark.parametrize("value", ["tomorrow", "2026-09-25T10:00:00", "2026-02-31T10:00:00Z"])
def test_timestamp_assertions_work_without_optional_format_packages(italy, value):
    italy["profiles"][0]["valid_from"] = value
    with pytest.raises(ValidationError):
        validate_bundle(italy)


def test_pending_fact_cannot_be_matching_allowed(italy):
    italy["profiles"][0]["facts"][0]["confirmation"] = "pending"
    with pytest.raises(ValidationError):
        validate_bundle(italy)


def test_unauthorized_real_data_fails_closed(italy):
    italy["training_basis"] = "mixed_authorized"
    with pytest.raises(ValueError, match="consent"):
        validate_bundle(italy)


def test_mislabeled_synthetic_bundle_rejected(italy):
    italy["profiles"][0]["data_origin"] = "real_opt_in"
    with pytest.raises(ValueError, match="Non-synthetic"):
        validate_bundle(italy)


def test_duplicate_ids_rejected(italy):
    italy["posts"].append(copy.deepcopy(italy["posts"][0]))
    with pytest.raises(ValueError, match="Duplicate"):
        validate_bundle(italy)


def test_other_person_post_rejected(italy):
    italy["posts"][0]["owner_user_id"] = "jane"
    with pytest.raises(ValueError, match="owner mismatch"):
        validate_bundle(italy)


def test_future_post_rejected(italy):
    italy["posts"][0]["available_at"] = "2026-09-26T00:00:00Z"
    with pytest.raises(ValueError, match="postdates"):
        validate_bundle(italy)


def test_future_answer_rejected(italy):
    italy["profiles"][0]["onboarding_answers"][0]["answered_at"] = "2026-09-26T00:00:00Z"
    with pytest.raises(ValueError, match="postdates"):
        validate_bundle(italy)


def test_stale_snapshot_rejected(italy):
    new = copy.deepcopy(italy["profiles"][0])
    new.update(profile_version_id="jane_v3", valid_from="2026-09-25T11:00:00Z", avoid_topics=["travel"])
    italy["profiles"].append(new)
    with pytest.raises(ValueError, match="Stale"):
        validate_bundle(italy)


def test_unsupported_quote_rejected(italy):
    italy["profiles"][0]["facts"][0]["evidence"][0]["support"] = "I went to the moon."
    with pytest.raises(ValueError, match="excerpt"):
        validate_bundle(italy)


def test_image_evidence_not_silently_accepted(italy):
    italy["profiles"][1]["facts"][0]["evidence"][0]["channel"] = "image"
    with pytest.raises(ValueError, match="Image evidence"):
        validate_bundle(italy)


def test_missing_profile_and_self_pair_rejected(italy):
    pair = italy["training_pairs"][0]
    pair["candidate_profile_version_id"] = "missing"
    with pytest.raises(ValueError, match="Unknown profile"):
        validate_bundle(italy)
    pair["candidate_profile_version_id"] = pair["viewer_profile_version_id"]
    with pytest.raises(ValueError, match="Self-pair"):
        validate_bundle(italy)


def test_duplicate_prediction_opportunity_rejected(italy):
    clone = copy.deepcopy(italy["training_pairs"][0])
    clone["example_id"] = "different_id_same_prediction"
    italy["training_pairs"].append(clone)
    with pytest.raises(ValueError, match="Duplicate directional"):
        validate_bundle(italy)


def test_future_history_rejected(pilot):
    bundle, _ = pilot
    bundle["feedback"][0]["observed_at"] = bundle["training_pairs"][0]["as_of"]
    with pytest.raises(ValueError, match="precede"):
        validate_bundle(bundle)


def test_foreign_history_rejected(pilot):
    bundle, _ = pilot
    bundle["training_pairs"][1]["prior_feedback_ids"] = bundle["training_pairs"][0]["prior_feedback_ids"]
    with pytest.raises(ValueError, match="another viewer"):
        validate_bundle(bundle)


def test_history_partner_cannot_cross_splits(pilot):
    bundle, manifest = pilot
    user = bundle["feedback"][0]["candidate_profile_version_id"].removesuffix("_v1")
    original = manifest["group_splits"][manifest["user_groups"][user]]
    manifest["user_groups"][user] = "held_out_history"
    manifest["group_splits"]["held_out_history"] = "test" if original != "test" else "train"
    with pytest.raises(ValueError, match="crosses"):
        partition_pairs(bundle, manifest)


def test_incomplete_manifest_rejected(pilot):
    bundle, manifest = pilot
    manifest["user_groups"].pop(next(iter(manifest["user_groups"])))
    with pytest.raises(ValueError, match="Every user"):
        partition_pairs(bundle, manifest)


def test_unknown_labels_are_excluded(pilot):
    bundle, manifest = pilot
    rows, _ = select_rows(bundle, partition_pairs(bundle, manifest))
    assert all(pair["label"]["relevant_connection"] is not None for group in rows.values() for pair in group)


def test_labels_and_identifiers_are_not_features(italy):
    builder = FeatureBuilder(italy, TestEncoder())
    pair = italy["training_pairs"][0]
    before = builder.build(pair)
    modified = copy.deepcopy(pair)
    modified["label"] = {"reason": "BAD LABEL SHOULD NEVER REACH ENCODER", "relevant_connection": 0}
    modified["example_id"] = "prediction_with_another_name"
    assert np.array_equal(before, builder.build(modified))
    assert len(before) == len(feature_names()) == 71


def test_unapproved_and_duplicate_facts_do_not_change_features(italy):
    pair = italy["training_pairs"][0]
    before = FeatureBuilder(italy, TestEncoder()).build(pair)
    facts = italy["profiles"][1]["facts"]
    duplicate = copy.deepcopy(facts[0])
    duplicate["fact_id"] = "duplicate"
    facts.append(duplicate)
    pending = copy.deepcopy(facts[0])
    pending.update(fact_id="pending", details="Unapproved hidden interest", confirmation="pending",
                   matching_allowed=False, sharing_scope="matching_only")
    facts.append(pending)
    assert np.array_equal(before, FeatureBuilder(italy, TestEncoder()).build(pair))


def test_directions_are_different(italy):
    builder = FeatureBuilder(italy, TestEncoder())
    assert not np.array_equal(*[builder.build(pair) for pair in italy["training_pairs"]])


def test_social_ablation_really_removes_post_facts(italy):
    john = italy["profiles"][1]
    assert len(approved_facts(john, "onboarding_only")) == 2
    assert len(approved_facts(john, "with_posts")) == 3
    pair = italy["training_pairs"][0]
    a = FeatureBuilder(italy, TestEncoder(), mode="onboarding_only").build(pair)
    b = FeatureBuilder(italy, TestEncoder(), mode="with_posts").build(pair)
    assert a[feature_names().index("candidate_has:experienced")] == 0
    assert b[feature_names().index("candidate_has:experienced")] == 1


def test_missing_feedback_not_negative_and_acceptance_not_usefulness(pilot):
    bundle, _ = pilot
    pair = bundle["training_pairs"][0]
    result = FeatureBuilder(bundle, TestEncoder()).build(pair)
    names = feature_names()
    assert result[names.index("history:conversation_useful:True:present")] == 1
    assert result[names.index("history:conversation_useful:False:present")] == 1
    assert result[names.index("history:would_talk_again:False:present")] == 0
    for history in bundle["feedback"]:
        history["outcomes"] = {"connection_accepted": False, "conversation_useful": None, "would_talk_again": None}
    result = FeatureBuilder(bundle, TestEncoder()).build(pair)
    assert all(result[i] == 0 for i, name in enumerate(names) if name.startswith("history:"))


def test_history_ablation_and_comments(pilot):
    bundle, _ = pilot
    pair = bundle["training_pairs"][0]
    before = FeatureBuilder(bundle, TestEncoder()).build(pair)
    bundle["feedback"][0]["explicit_comment"] = "Potential label leakage must not enter features"
    assert np.array_equal(before, FeatureBuilder(bundle, TestEncoder()).build(pair))
    without = FeatureBuilder(bundle, TestEncoder(), mode="with_posts").build(pair)
    assert all(without[i] == 0 for i, name in enumerate(feature_names()) if name.startswith("history:"))


def test_boundaries_fail_closed(italy):
    viewer, candidate = italy["profiles"]
    candidate["avoid_topics"] = ["travel"]
    assert eligibility_reason(viewer, candidate, "with_history") == "boundary_review_required"
    candidate["avoid_topics"] = []
    candidate["open_to_discussing"] = []
    assert eligibility_reason(viewer, candidate, "with_history") == "candidate_openness_missing"


def test_ranking_does_not_reward_all_positive_pools(italy):
    report = evaluate(italy["training_pairs"], np.array([1, 1]), np.array([0.9, 0.8]), 0.5)
    assert report["ranking"]["eligible_queries"] == 0
    assert report["ranking"]["ndcg_at_3"] is None
    assert report["roc_auc"] is None


def test_training_guard_and_checkpoint_roundtrip(tmp_path, pilot):
    bundle, manifest = pilot
    dataset, splits = tmp_path / "dataset.json", tmp_path / "splits.json"
    write_json(dataset, bundle)
    write_json(splits, manifest)
    out = tmp_path / "run"
    with pytest.raises(ValueError, match="Unreviewed"):
        train_run(dataset, splits, out, encoder=TestEncoder(), epochs=2)
    report = train_run(dataset, splits, out, encoder=TestEncoder(), epochs=2, patience=1,
                       modes=("with_history",), allow_unreviewed=True)
    assert report["counts"]["test"]["used"] == 48
    coverage = read_json(out / "with_history/feature_coverage.json")
    assert [row["feature"] for row in coverage] == feature_names()
    comparison_path = tmp_path / "comparison.json"
    comparison = compare_runs(dataset, splits, [out], comparison_path, encoder=TestEncoder())
    result = comparison["runs"][str(out)]["with_history"]
    assert comparison["unknown_labels"] == 6
    expected = report["ablation_results"]["with_history"]["neural"]["test"]
    for key, value in result["models"]["neural"]["all"].items():
        assert value == (pytest.approx(expected[key], abs=1e-6) if isinstance(value, float) else expected[key])
    assert result["models"]["logistic"]["all"]["f1"] == report["ablation_results"]["with_history"]["logistic"]["test"]["f1"]
    assert result["thresholds"]["neural"] == read_json(out / "with_history/config.json")["threshold"]
    with pytest.raises(ValueError, match="already exists"):
        compare_runs(dataset, splits, [out], comparison_path, encoder=TestEncoder())
    scores = score_pairs(bundle, out / "with_history", encoder=TestEncoder())
    by_id = {row["example_id"]: row["uncalibrated_relevance_score"] for row in scores}
    for row in read_json(out / "with_history/test_predictions.json"):
        assert by_id[row["example_id"]] == pytest.approx(row["neural_score"], abs=1e-6)
    diagnostic = inspect_pair(bundle, bundle["training_pairs"][0]["example_id"], TestEncoder(),
                              model_dir=out / "with_history")
    assert diagnostic["prediction"]["uncalibrated_relevance_score"] == pytest.approx(
        by_id[diagnostic["example_id"]], abs=1e-6)
    with pytest.raises(ValueError, match="mode must match"):
        inspect_pair(bundle, diagnostic["example_id"], TestEncoder(),
                     model_dir=out / "with_history", mode="onboarding_only")
    bundle["profiles"][0]["avoid_topics"] = ["needs review"]
    assert score_pairs(bundle, out / "with_history", encoder=TestEncoder())[0]["uncalibrated_relevance_score"] is None
    config_path = out / "with_history/config.json"
    config = read_json(config_path)
    config["feature_version"] = "wrong-version"
    config_path.write_text(json.dumps(config))
    with pytest.raises(ValueError, match="contract"):
        score_pairs(bundle, out / "with_history", encoder=TestEncoder())

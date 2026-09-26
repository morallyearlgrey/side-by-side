import json

import numpy as np
import pytest

from ml.features import FeatureBuilder, feature_names
from ml.review_packet import coverage, write_packets
from ml.splits import partition_pairs
from ml.synthetic_v2 import generate
from ml.train import select_rows
from ml.validation import read_json, write_json
from test_pipeline import TestEncoder


@pytest.fixture(scope="module")
def broader():
    return generate()


def test_counts_and_reproducibility(broader):
    bundle, manifest, cases = broader
    assert generate() == broader
    assert len(bundle["profiles"]) == 712
    assert len(bundle["training_pairs"]) == len(cases) == 1480
    rows, counts = select_rows(bundle, partition_pairs(bundle, manifest))
    assert [len(rows[key]) for key in ("train", "validation", "test")] == [1080, 216, 36]
    assert sum(x["unknown_label"] for x in counts.values()) == 148


def test_missingness_and_multiple_interests_have_both_labels(broader):
    report = coverage(*broader[:2])
    for split in ("train", "validation"):
        for side in ("viewer", "candidate"):
            for condition in ("preferences_missing", "preferences_present", "facts_many", "facts_few",
                              "posts_missing", "posts_present"):
                counts = report[split]["slices"][side + "_" + condition]
                assert counts["0"] > 0 and counts["1"] > 0, (split, side, condition)
        for suffix in ("present", "missing"):
            counts = report[split]["slices"]["history_" + suffix]
            assert counts["0"] > 0 and counts["1"] > 0
        assert report[split]["fact_count_min"] == 1
        assert report[split]["fact_count_max"] >= 8


def test_all_modes_have_positive_and_negative_examples(broader):
    counts = coverage(*broader[:2])["train"]["slices"]
    for name, values in counts.items():
        if name.startswith("mode_"):
            assert values["0"] > 0 and values["1"] > 0, name


def test_synthetic_judgments_stay_unreviewed(broader):
    assert all(p["label"]["source"] == "synthetic_draft" and not p["label"]["human_reviewed"]
               for p in broader[0]["training_pairs"])


def test_challenge_is_fixed_and_separate_from_training(broader):
    bundle, manifest, cases = broader
    partitions = partition_pairs(bundle, manifest)
    assert len(partitions["test"]) == 40
    assert {cases[p["example_id"]]["family"] for p in partitions["test"]} == {
        "challenge_zines", "challenge_transit", "challenge_animation", "challenge_language", "challenge_history"}
    users = {key: {p[field] for p in group for field in
                  ("viewer_profile_version_id", "candidate_profile_version_id")}
             for key, group in partitions.items()}
    assert not users["test"] & (users["train"] | users["validation"])
    assert not users["train"] & users["validation"]
    assert not {"jane_v2", "john_v2"} & set.union(*users.values())


def test_history_reversal_requires_history_not_ids(broader):
    bundle, _, cases = broader
    selected = [p for p in bundle["training_pairs"]
                if cases[p["example_id"]] == {"family": "challenge_history", "case": "history_counterfactual", "split": "test"}]
    assert [p["label"]["relevant_connection"] for p in selected] == [1, 0, 0, 1]
    without = FeatureBuilder(bundle, TestEncoder(), mode="with_posts")
    with_history = FeatureBuilder(bundle, TestEncoder(), mode="with_history")
    for i, j in ((0, 2), (1, 3)):
        assert np.array_equal(without.build(selected[i]), without.build(selected[j]))
        a, b = with_history.build(selected[i]), with_history.build(selected[j])
        boundary = next(i for i, name in enumerate(feature_names()) if name.startswith("history:"))
        assert np.array_equal(a[:boundary], b[:boundary])
        assert not np.array_equal(a[boundary:], b[boundary:])


def test_blind_review_packets_do_not_include_draft_answers(tmp_path, broader):
    bundle, manifest, cases = broader
    write_json(tmp_path / "dataset.json", bundle)
    write_packets(bundle, manifest, cases, tmp_path)
    for name in ("training", "challenge"):
        rows = [json.loads(line) for line in (tmp_path / f"review-{name}.jsonl").read_text().splitlines()]
        assert len(rows) == 40
        assert len({row["example_id"] for row in rows}) == 40
        for row in rows:
            assert row["decision"] is None and row["reviewer"] is None
            assert "label" not in row and "draft_label" not in row and "case" not in row
            assert all(value is None for value in row["rubric"].values())
    assert len(read_json(tmp_path / "draft-answer-key.json")) == 80
    assert read_json(tmp_path / "review-manifest.json")["reviewed_by_humans"] is False


def test_nonpositive_replica_count_rejected():
    with pytest.raises(ValueError, match="positive"):
        generate(replicas=0)

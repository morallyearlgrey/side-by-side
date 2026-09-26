import numpy as np
import pytest

from ml.features import FeatureBuilder
from ml.inspect_pair import inspect_pair, render_markdown
from ml.validation import ROOT, read_json
from test_pipeline import TestEncoder


def fixture():
    return read_json(ROOT / "data/samples/v2/italy-example.json")


def test_inspection_matches_production_features_and_role_aggregation():
    bundle, encoder = fixture(), TestEncoder()
    report = inspect_pair(bundle, "jane_to_john_v2", encoder)
    assert report["comparison_count"] == 6
    matrix = np.asarray(report["cosine_matrix"])
    assert matrix.shape == (2, 3)
    actual = FeatureBuilder(bundle, encoder).build(bundle["training_pairs"][0])
    assert np.allclose(list(report["features"].values()), actual)
    for i, viewer in enumerate(report["viewer_facts"]):
        for j, candidate in enumerate(report["candidate_facts"]):
            name = f"role_cosine:{viewer['role']}:{candidate['role']}"
            assert report["features"][name] == pytest.approx(matrix[i, j], abs=1e-6)
    rendered = render_markdown(report)
    assert "6 comparisons" in rendered
    assert "absent" in rendered
    assert "No checkpoint supplied" in rendered
    assert "not an attribution" in rendered


def test_inspection_omits_unapproved_facts():
    bundle = fixture()
    fact = bundle["profiles"][1]["facts"][0]
    fact.update(confirmation="pending", matching_allowed=False, sharing_scope="matching_only")
    report = inspect_pair(bundle, "jane_to_john_v2", TestEncoder())
    assert report["comparison_count"] == 4
    assert all(row["fact_id"] != fact["fact_id"] for row in report["candidate_facts"])


def test_inspection_removes_post_only_evidence_in_ablation():
    report = inspect_pair(fixture(), "jane_to_john_v2", TestEncoder(), mode="onboarding_only")
    assert report["comparison_count"] == 4
    assert not any(row["role"] == "experienced" for row in report["candidate_facts"])


def test_inspection_does_not_pass_labels_to_encoder():
    original, modified = fixture(), fixture()
    modified["training_pairs"][0]["label"]["reason"] = "Changed annotation, not an input feature"
    a = inspect_pair(original, "jane_to_john_v2", TestEncoder())
    b = inspect_pair(modified, "jane_to_john_v2", TestEncoder())
    assert a["features"] == b["features"]
    assert a["cosine_matrix"] == b["cosine_matrix"]


def test_empty_facts_and_boundary_are_explained():
    bundle = fixture()
    bundle["profiles"][1]["facts"] = []
    report = inspect_pair(bundle, "jane_to_john_v2", TestEncoder())
    assert report["comparison_count"] == 0
    assert report["abstain_reason"] == "insufficient_approved_facts"
    assert "No approved facts" in render_markdown(report)
    bundle["profiles"][1]["avoid_topics"] = ["travel"]
    assert inspect_pair(bundle, "jane_to_john_v2", TestEncoder())["abstain_reason"] == "boundary_review_required"


def test_inspection_rejects_missing_example_and_real_data():
    with pytest.raises(ValueError, match="Unknown example"):
        inspect_pair(fixture(), "missing", TestEncoder())
    bundle = fixture()
    bundle["training_basis"] = "mixed_authorized"
    with pytest.raises(ValueError, match="synthetic"):
        inspect_pair(bundle, "jane_to_john_v2", TestEncoder())

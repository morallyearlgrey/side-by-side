"""Evaluator plumbing uses doubles; actual 4B inference happens on Newton."""

import copy

import pytest

from ml import evaluate_v4
from ml.matching_v3 import FORMAT_ENCODER_REVISION, SourceAwareBuilder
from ml.matching_v4 import evidence_plan
from ml.reranker import MODEL_REVISIONS
from ml.synthetic_v4 import export, generate
from ml.tests.test_matching_v3 import OrthogonalEncoder
from ml.tests.test_matching_v4 import ModelDouble, fixture
from ml.tune_matching_v3 import DEFAULT_POLICY, IDENTITY
from ml.validation import read_json, validate_bundle, write_json

SELECTED = {"recommended_variant": "source_aware_tuned", "calibration": IDENTITY, "policy": DEFAULT_POLICY}


class RankerDouble(ModelDouble):
    def metadata(self):
        return {"id": evaluate_v4.MODEL_ID, "revision": MODEL_REVISIONS[evaluate_v4.MODEL_ID], "test_double": True}


def test_new_dataset_is_deterministic_valid_and_separates_regressions(tmp_path):
    bundle, manifest, cases = generate()
    assert (bundle, manifest, cases) == generate()
    validate_bundle(bundle)
    assert len(bundle["training_pairs"]) == 57
    assert sum(c["cohort"] == "known_v3_regression" for c in cases.values()) == 3
    assert sum(c["cohort"] == "fresh_synthetic" for c in cases.values()) == 54
    assert all(p["label"]["human_reviewed"] is False for p in bundle["training_pairs"])
    requests = {}
    builder = SourceAwareBuilder(bundle)
    for pair in bundle["training_pairs"]:
        context = pair["context"]
        key = (pair["viewer_profile_version_id"], pair["as_of"], context["mode"], context["goal"])
        requirement = context["evidence_requirement"]
        assert key not in requests or requests[key] == requirement
        requests[key] = requirement
        if cases[pair["example_id"]]["cohort"] == "known_v3_regression":
            assert evidence_plan(builder, pair)[0] == "required_firsthand_experience_missing"
    export(tmp_path / "dataset")
    with pytest.raises(ValueError, match="already exists"):
        export(tmp_path / "dataset")


def test_comparison_uses_same_policy_and_reports_unknowns_separately():
    bundle, _, cases = generate()
    before = copy.deepcopy(SELECTED)
    result = evaluate_v4.run_evaluation(bundle, cases, SELECTED, RankerDouble(), ModelDouble(), OrthogonalEncoder())
    assert SELECTED == before
    assert not result["report"]["parameters_fitted"]
    assert result["report"]["v4"]["all"]["total"] == 57
    regression = result["report"]["v4"]["cohort"]["known_v3_regression"]
    assert regression["unknown_abstentions"] == 3 and regression["unknown_recommended"] == 0
    assert len(result["v3"]["decisions"]) == len(result["v4"]["decisions"]) == 57
    assert all(r["evidence_policy"] == "source-aware-evidence-v4" for r in result["v4"]["records"])


def test_smaller_checkpoint_rejected_before_scoring():
    bundle, _, cases = generate()
    model = RankerDouble()
    model.metadata = lambda: {"id": "Qwen/Qwen3-Reranker-0.6B", "revision": "wrong"}
    with pytest.raises(ValueError, match="pinned 4B"):
        evaluate_v4.run_evaluation(bundle, cases, SELECTED, model, ModelDouble(), None)
    assert not model.calls


@pytest.fixture
def cli(tmp_path, monkeypatch):
    bundle, pair, _, _ = fixture()
    policy, out = tmp_path / "policy", tmp_path / "out"
    policy.mkdir()
    write_json(tmp_path / "data.json", bundle)
    write_json(tmp_path / "cases.json", {pair["example_id"]: {"cohort": "test_double", "case": "supported"}})
    write_json(policy / "selected_policy.json", SELECTED)
    write_json(policy / "status.json", {"state": "completed"})
    write_json(policy / "protocol.json", {"model": RankerDouble().metadata(),
                                          "format_encoder": {"revision": FORMAT_ENCODER_REVISION}})
    monkeypatch.setattr(evaluate_v4, "QwenReranker", lambda **kw: RankerDouble())
    monkeypatch.setattr(evaluate_v4, "EvidenceVerifier", lambda **kw: RankerDouble())
    monkeypatch.setattr(evaluate_v4, "TextEncoder", lambda **kw: RankerDouble())
    monkeypatch.setattr("sys.argv", ["evaluate_v4", "--dataset", str(tmp_path / "data.json"),
                                    "--cases", str(tmp_path / "cases.json"), "--policy-dir", str(policy),
                                    "--out", str(out)])
    return out


def test_cli_writes_complete_audit_and_never_overwrites(cli):
    evaluate_v4.main()
    assert read_json(cli / "status.json")["state"] == "completed"
    assert read_json(cli / "protocol.json")["model"]["id"] == evaluate_v4.MODEL_ID
    assert read_json(cli / "v4/decisions.json")[0]["decision"] == "recommend"
    assert read_json(cli / "report.json")["parameters_fitted"] is False
    with pytest.raises(ValueError, match="Output exists"):
        evaluate_v4.main()


def test_loading_failure_is_recorded_not_reported_complete(cli, monkeypatch):
    def fail(**kwargs):
        raise RuntimeError("test loading failure")
    monkeypatch.setattr(evaluate_v4, "QwenReranker", fail)
    with pytest.raises(RuntimeError, match="test loading failure"):
        evaluate_v4.main()
    assert read_json(cli / "status.json")["state"] == "failed"
    assert not (cli / "report.json").exists()

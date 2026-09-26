import json
from pathlib import Path
from types import SimpleNamespace

import pytest
import torch

from ml.benchmark_reranker import run_benchmark
from ml.reranker import MODEL_ID, MODEL_REVISION, MODEL_REVISIONS, QwenReranker, prompt_text
from ml.reranker_suite import MODES, SIZES, download_model, model_id, run_suite, summarize_runs
from ml.validation import ROOT, read_json, write_json


@pytest.mark.parametrize("name", list(MODEL_REVISIONS))
def test_selected_model_loads_its_own_pin_offline(monkeypatch, name):
    calls = []

    class Tokenizer:
        def convert_tokens_to_ids(self, text):
            return {"no": 1, "yes": 2}[text]

        def encode(self, text, **kwargs):
            return [self.convert_tokens_to_ids(text)]

    class Model:
        def to(self, device):
            assert device == "cpu"
            return self

        def eval(self):
            return self

        def requires_grad_(self, enabled):
            assert enabled is False

    def loader(kind, result):
        def load(repo_id, **kwargs):
            calls.append((kind, repo_id, kwargs))
            return result
        return load

    monkeypatch.setattr("transformers.AutoTokenizer.from_pretrained", loader("tokenizer", Tokenizer()))
    monkeypatch.setattr("transformers.AutoModelForCausalLM.from_pretrained", loader("model", Model()))
    engine = QwenReranker(model_id=name)
    assert engine.metadata()["id"] == name
    assert engine.metadata()["revision"] == MODEL_REVISIONS[name]
    assert engine.runtime_statistics()["peak_gpu_allocated_bytes"] is None
    for kind, repo_id, kwargs in calls:
        assert repo_id == name and kwargs["revision"] == MODEL_REVISIONS[name]
        assert kwargs["local_files_only"] is True and kwargs["trust_remote_code"] is False
        assert kwargs["token"] is False
        if kind == "model":
            assert kwargs["use_safetensors"] is True and kwargs["dtype"] == torch.float32
    assert MODEL_REVISIONS[MODEL_ID] == MODEL_REVISION


def test_unapproved_model_and_unpinned_revision_rejected():
    with pytest.raises(ValueError, match="Unsupported reranker"):
        QwenReranker(model_id="another/model")
    with pytest.raises(ValueError, match="complete commit"):
        QwenReranker(revision="main")


def test_downloads_only_allowlisted_files_for_pinned_public_models(monkeypatch):
    calls = []
    monkeypatch.setattr("huggingface_hub.snapshot_download", lambda **kwargs: calls.append(kwargs))
    for size in SIZES:
        download_model(size)
    for size, call in zip(SIZES, calls):
        assert call["repo_id"] == model_id(size)
        assert call["revision"] == MODEL_REVISIONS[model_id(size)]
        assert call["token"] is False
        assert "*.safetensors" in call["allow_patterns"]
        assert not any(pattern in call["allow_patterns"] for pattern in ("*", "*.py", "*.bin", "*.pt"))


@pytest.fixture
def suite_args(tmp_path):
    bundle = read_json(ROOT / "data/samples/v2/italy-example.json")
    bundle["training_pairs"][0]["label"]["relevant_connection"] = None
    bundle["training_pairs"][0]["label"]["rubric"]["evidence_sufficient"] = "unknown"
    manifest = {"version": 1, "dataset_id": bundle["dataset_id"],
                "user_groups": {p["user_id"]: "italy" for p in bundle["profiles"]},
                "group_splits": {"italy": "test"}}
    dataset, splits = tmp_path / "dataset.json", tmp_path / "splits.json"
    write_json(dataset, bundle)
    write_json(splits, manifest)
    return SimpleNamespace(dataset=dataset, splits=splits, cases=None, baselines=None, diagnostic=None,
                           out=tmp_path / "suite", sizes=list(SIZES), device="cpu", dtype="float32",
                           max_tokens=4096, download=False)


def fake_worker(command, *, env, check):
    """Exercise real report creation; deliberately fake model predictions."""
    import hashlib

    assert env["HF_HUB_OFFLINE"] == "1" and env["HF_HUB_DISABLE_TELEMETRY"] == "1"
    assert check is False
    options = dict(zip(command[3::2], command[4::2]))

    class Model:
        def metadata(self):
            return {"id": options["--model-id"], "revision": options["--revision"],
                    "device": "cpu", "dtype": "float32", "attention": "sdpa", "max_tokens": 4096,
                    "batch_size": 1, "hardware": {}}

        def score(self, query, document):
            return {"uncalibrated_relevance_score": 0.7, "abstain_reason": None, "cache_hit": False,
                    "input_tokens": 100, "elapsed_seconds": 0.01,
                    "prompt_sha256": hashlib.sha256(prompt_text(query, document).encode()).hexdigest()}

    run_benchmark(Path(options["--dataset"]), Path(options["--splits"]), Path(options["--out"]), Model())
    return SimpleNamespace(returncode=0)


def test_suite_compares_three_sizes_without_training_or_downloads(suite_args, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("No download, training, or threshold fitting allowed")

    monkeypatch.setattr("ml.reranker_suite.subprocess.run", fake_worker)
    monkeypatch.setattr("ml.reranker_suite.download_model", forbidden)
    monkeypatch.setattr("ml.model.fit", forbidden)
    monkeypatch.setattr("ml.metrics.choose_threshold", forbidden)
    assert run_suite(suite_args) == 0
    assert read_json(suite_args.out / "status.json")["state"] == "completed"
    comparison = read_json(suite_args.out / "comparison.json")
    assert set(comparison["runs"]) == set(SIZES)
    assert comparison["all_requested_models_completed"] is True
    for size in SIZES:
        for mode in MODES:
            assert len(comparison["runs"][size]["modes"][mode]["unknown_predictions"]) == 1
            assert comparison["runs"][size]["modes"][mode]["labeled_scored"] == 1
    with pytest.raises(ValueError, match="already exists"):
        run_suite(suite_args)


def test_suite_keeps_successful_results_and_exits_nonzero_after_failure(suite_args, monkeypatch):
    def worker(command, **kwargs):
        if "Qwen/Qwen3-Reranker-4B" in command:
            return SimpleNamespace(returncode=1)
        return fake_worker(command, **kwargs)

    monkeypatch.setattr("ml.reranker_suite.subprocess.run", worker)
    assert run_suite(suite_args) == 1
    status = read_json(suite_args.out / "status.json")
    assert status["state"] == "failed" and status["models"]["4B"]["state"] == "failed"
    assert status["models"]["8B"]["state"] == "completed"
    comparison = read_json(suite_args.out / "comparison.json")
    assert set(comparison["runs"]) == {"0.6B", "8B"}
    assert comparison["all_requested_models_completed"] is False


@pytest.mark.parametrize("change", ["threshold", "prompt", "revision", "hardware"])
def test_comparison_rejects_mismatched_protocols_or_inputs(suite_args, monkeypatch, change):
    monkeypatch.setattr("ml.reranker_suite.subprocess.run", fake_worker)
    assert run_suite(suite_args) == 0
    path = suite_args.out / "8B" / "report.json"
    report = read_json(path)
    if change == "threshold":
        report["protocol"]["threshold"] = 0.7
    elif change == "revision":
        report["protocol"]["model"]["revision"] = "0" * 40
    elif change == "hardware":
        report["protocol"]["model"]["hardware"] = {"gpu_name": "different GPU"}
    elif change == "prompt":
        path = suite_args.out / "8B" / "with_history" / "predictions.json"
        report = read_json(path)
        report[0]["prompt_sha256"] = "changed"
    path.write_text(json.dumps(report))
    with pytest.raises(ValueError, match="different inputs|Unexpected checkpoint"):
        summarize_runs(suite_args.out, SIZES)

"""Run pinned Qwen sizes in separate processes with a fixed evaluation protocol."""

import argparse
import os
import subprocess
import sys
from pathlib import Path

from .reranker import MODEL_REVISIONS
from .splits import partition_pairs
from .train import digest
from .validation import read_json, require, validate_bundle, write_json

SIZES = ("0.6B", "4B", "8B")
DOWNLOAD_FILES = ["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json",
                  "special_tokens_map.json", "merges.txt", "vocab.json", "*.safetensors",
                  "model.safetensors.index.json"]
MODES = ("with_history", "with_posts", "onboarding_only")


def write_status(out, status):
    temporary = out / ".status.next.json"
    write_json(temporary, status)
    temporary.replace(out / "status.json")


def model_id(size):
    require(size in SIZES, "Unsupported model size")
    return f"Qwen/Qwen3-Reranker-{size}"


def download_model(size):
    from huggingface_hub import snapshot_download

    name = model_id(size)
    return snapshot_download(repo_id=name, revision=MODEL_REVISIONS[name], token=False,
                             allow_patterns=DOWNLOAD_FILES, max_workers=2)


def summarize_runs(out, sizes):
    """Reject comparisons with changed data, prompts, thresholds, or hardware."""
    summary, reference = {}, None
    for size in sizes:
        directory = out / size
        report = read_json(directory / "report.json")
        protocol = report["protocol"]
        model = protocol["model"]
        require(model["id"] == model_id(size) and model["revision"] == MODEL_REVISIONS[model_id(size)],
                "Unexpected checkpoint in comparison")
        contract = {key: protocol[key] for key in ("dataset_sha256", "splits_sha256", "cases_sha256",
                    "baseline_sha256", "prompt_template_sha256", "threshold", "modes_in_order",
                    "source_sha256", "packages")}
        contract["inference"] = {key: model[key] for key in ("device", "dtype", "attention", "max_tokens",
                                                          "batch_size", "hardware")}
        rows, inputs = {}, {}
        for mode in MODES:
            predictions = read_json(directory / mode / "predictions.json")
            inputs[mode] = [(r["example_id"], r["prompt_sha256"], r["abstain_reason"]) for r in predictions]
            metrics = report["modes"][mode]
            rows[mode] = {"total": metrics["total"], "labeled_scored": metrics["labeled_scored"],
                          "unknown_labels": metrics["unknown_labels"], "abstained": metrics["abstained"],
                          "metrics": metrics["metrics"], "latency": metrics["latency"]}
        contract["inputs"] = inputs
        require(reference is None or contract == reference, "Runs have different inputs or evaluation settings")
        reference = contract
        summary[size] = {"model": model, "modes": rows,
                         "runtime_statistics": report.get("runtime_statistics", {})}
    return {"runs": summary,
            "warning": "Existing synthetic development cases, not fresh human validation. No winner auto-selected. "
                       "Unknown cases are excluded from F1; inspect their scores separately. "
                       "Latency excludes model loading and cache hits; memory is PyTorch allocator usage only."}


def run_suite(args):
    require(args.sizes and len(set(args.sizes)) == len(args.sizes), "Choose unique model sizes")
    require(all(size in SIZES for size in args.sizes), "Unsupported model size")
    require(not args.out.exists(), "Output directory already exists; use a fresh suite name")
    bundle = validate_bundle(read_json(args.dataset))
    partitions = partition_pairs(bundle, read_json(args.splits))
    require(partitions["test"], "No evaluation pairs")
    # Fail on missing inputs before downloading weights or allocating output files.
    inputs = {name: digest(path) for name, path in vars(args).items()
              if name in ("dataset", "splits", "cases", "baselines", "diagnostic") and path is not None}
    if args.baselines:
        baseline = read_json(args.baselines)
        require(baseline["dataset_sha256"] == inputs["dataset"] and baseline["splits_sha256"] == inputs["splits"],
                "Baselines used different data or splits")
    args.out.mkdir(parents=True)
    status = {"state": "running", "input_sha256": inputs, "models": {},
              "device": args.device, "dtype": args.dtype, "downloads_requested": args.download,
              "warning": "Frozen models on the existing synthetic development benchmark; no training."}
    environment = {**os.environ, "HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
                   "TOKENIZERS_PARALLELISM": "false", "PYTHONUNBUFFERED": "1"}
    for size in args.sizes:
        name = model_id(size)
        record = {"model_id": name, "revision": MODEL_REVISIONS[name], "state": "starting"}
        status["models"][size] = record
        write_status(args.out, status)
        try:
            if args.download:
                print(f"Downloading/checking pinned {name} ...", flush=True)
                record["state"] = "downloading"
                write_status(args.out, status)
                download_model(size)
            record["state"] = "scoring"
            write_status(args.out, status)
            command = [sys.executable, "-m", "ml.benchmark_reranker", "--dataset", str(args.dataset),
                       "--splits", str(args.splits), "--out", str(args.out / size), "--model-id", name,
                       "--revision", MODEL_REVISIONS[name], "--device", args.device, "--dtype", args.dtype,
                       "--max-tokens", str(args.max_tokens)]
            for flag in ("cases", "baselines", "diagnostic"):
                if getattr(args, flag) is not None:
                    command.extend(["--" + flag, str(getattr(args, flag))])
            print(f"Evaluating {size} in a separate process ...", flush=True)
            completed = subprocess.run(command, env=environment, check=False)
            require(completed.returncode == 0, f"Benchmark exited with code {completed.returncode}; see job logs")
            require((args.out / size / "report.json").is_file(), "Benchmark did not produce its final report")
            record["state"] = "completed"
        except Exception as error:
            record.update(state="failed", error=f"{type(error).__name__}: {error}")
            print(f"{size} failed: {error}", file=sys.stderr, flush=True)
        write_status(args.out, status)
    completed_sizes = [size for size in args.sizes if status["models"][size]["state"] == "completed"]
    status["state"] = "completed" if len(completed_sizes) == len(args.sizes) else "failed"
    try:
        comparison = summarize_runs(args.out, completed_sizes)
        unknown_ids = {p["example_id"] for p in partitions["test"] if p["label"]["relevant_connection"] is None}
        for size in completed_sizes:
            for mode in MODES:
                records = read_json(args.out / size / mode / "predictions.json")
                comparison["runs"][size]["modes"][mode]["unknown_predictions"] = [
                    r for r in records if r["example_id"] in unknown_ids]
        comparison["all_requested_models_completed"] = status["state"] == "completed"
        write_json(args.out / "comparison.json", comparison)
    except Exception as error:
        status.update(state="failed", comparison_error=f"{type(error).__name__}: {error}")
        print(f"Comparison rejected: {error}", file=sys.stderr, flush=True)
    write_status(args.out, status)
    print(f"Suite {status['state']}: {args.out / 'status.json'}", flush=True)
    return 0 if status["state"] == "completed" else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("dataset", "splits", "out"):
        parser.add_argument("--" + name, type=Path, required=True)
    for name in ("cases", "baselines", "diagnostic"):
        parser.add_argument("--" + name, type=Path)
    parser.add_argument("--sizes", nargs="+", choices=SIZES, default=list(SIZES))
    parser.add_argument("--device", choices=("cpu", "mps", "cuda"), default="cuda")
    parser.add_argument("--dtype", choices=("float32", "float16"), default="float16")
    parser.add_argument("--max-tokens", type=int, default=4096)
    parser.add_argument("--download", action="store_true", help="Explicitly download pinned public weights before offline scoring")
    raise SystemExit(run_suite(parser.parse_args()))


if __name__ == "__main__":
    main()

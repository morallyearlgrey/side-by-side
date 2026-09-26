"""Frozen-prompt, fixed-threshold Qwen experiment. No fitting or test tuning."""

import argparse
import hashlib
import importlib.metadata
import json
import platform
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch

from .features import ABLATIONS
from .metrics import evaluate
from .reranker import (INSTRUCTION, MODEL_ID, MODEL_REVISIONS, PREFIX, SUFFIX, PROMPT_VERSION,
                       QwenReranker, score_pair_texts)
from .splits import partition_pairs
from .train import digest
from .validation import read_json, require, validate_bundle, write_json

THRESHOLD = 0.5


def summarize(pairs, records, profiles, cases, threshold=THRESHOLD):
    require([p["example_id"] for p in pairs] == [r["example_id"] for r in records], "Prediction order mismatch")
    groups = defaultdict(list)
    for i, (pair, row) in enumerate(zip(pairs, records)):
        if pair["label"]["relevant_connection"] is None or row["uncalibrated_relevance_score"] is None:
            continue
        groups["all"].append(i)
        candidate = profiles[pair["candidate_profile_version_id"]]
        groups["candidate_preferences_" + ("present" if candidate["conversation_preferences"] else "missing")].append(i)
        groups["history_" + ("present" if pair["prior_feedback_ids"] else "missing")].append(i)
        if cases:
            groups[cases[pair["example_id"]]["case"]].append(i)
    metrics = {}
    for name, ids in groups.items():
        labels = np.asarray([pairs[i]["label"]["relevant_connection"] for i in ids])
        scores = np.asarray([records[i]["uncalibrated_relevance_score"] for i in ids])
        metrics[name] = evaluate([pairs[i] for i in ids], labels, scores, threshold)
    queries = defaultdict(list)
    for i in groups.get("history_counterfactual", []):
        queries[pairs[i]["viewer_profile_version_id"]].append(i)
    margins = []
    for ids in queries.values():
        positive = [records[i]["uncalibrated_relevance_score"] for i in ids if pairs[i]["label"]["relevant_connection"] == 1]
        negative = [records[i]["uncalibrated_relevance_score"] for i in ids if pairs[i]["label"]["relevant_connection"] == 0]
        if positive and negative:
            margins.append(float(min(positive) - max(negative)))
    metrics["history_ordering"] = {"queries": len(margins), "correct": sum(m > 1e-8 for m in margins),
                                    "positive_minus_negative_margins": margins}
    return {"total": len(pairs), "unknown_labels": sum(p["label"]["relevant_connection"] is None for p in pairs),
            "abstained": sum(r["uncalibrated_relevance_score"] is None for r in records),
            "labeled_scored": len(groups.get("all", [])), "metrics": metrics}


def paired_baselines(pairs, records, profiles, cases, comparison, mode):
    result = {}
    for run, modes in comparison["runs"].items():
        if mode not in modes:
            continue
        old = modes[mode]
        by_id = {r["example_id"]: r for r in old["predictions"]}
        indices = [i for i, pair in enumerate(pairs) if pair["example_id"] in by_id
                   and records[i]["uncalibrated_relevance_score"] is not None]
        common = [pairs[i] for i in indices]
        result[run] = {"common_cases": len(common), "reranker": summarize(
            common, [records[i] for i in indices], profiles, cases), "baselines": {}}
        for name in ("neural", "logistic", "cosine"):
            predictions = [{"example_id": p["example_id"],
                            "uncalibrated_relevance_score": by_id[p["example_id"]][name + "_score"]} for p in common]
            result[run]["baselines"][name] = summarize(common, predictions, profiles, cases, old["thresholds"][name])
    return result


def latency_summary(records):
    measured = [r for r in records if not r["cache_hit"] and r["uncalibrated_relevance_score"] is not None]
    seconds = [r["elapsed_seconds"] for r in measured]
    tokens = [r["input_tokens"] for r in measured]
    return {"uncached_scored_pairs": len(measured), "cache_hits": sum(r["cache_hit"] for r in records),
            "first_uncached_seconds": seconds[0] if seconds else None,
            "median_uncached_seconds": float(np.median(seconds)) if seconds else None,
            "p95_uncached_seconds": float(np.percentile(seconds, 95)) if seconds else None,
            "total_uncached_seconds": sum(seconds),
            "input_tokens_min": min(tokens, default=None), "input_tokens_max": max(tokens, default=None),
            "note": "Batch size 1; tokenization, device transfer, and synchronized inference. Excludes model download/loading. Cache hits excluded from latency percentiles; first call may include compilation."}


def run_benchmark(dataset, splits, out, model, *, cases_path=None, baseline_path=None,
                  modes=("with_history", "with_posts", "onboarding_only"), diagnostic_path=None):
    require(not out.exists(), "Output directory already exists; choose a fresh experiment name")
    require(modes and all(m in ABLATIONS for m in modes) and len(set(modes)) == len(modes), "Invalid modes")
    bundle = validate_bundle(read_json(dataset))
    pairs = partition_pairs(bundle, read_json(splits))["test"]
    require(pairs, "No test cases")
    profiles = {p["profile_version_id"]: p for p in bundle["profiles"]}
    cases = read_json(cases_path) if cases_path else {}
    if cases_path:
        require(set(cases) == {p["example_id"] for p in bundle["training_pairs"]}, "Case metadata mismatch")
    comparison = read_json(baseline_path) if baseline_path else None
    if comparison:
        require(comparison["dataset_sha256"] == digest(dataset) and comparison["splits_sha256"] == digest(splits),
                "Baselines used different data or split assignments")
    protocol = {"model": model.metadata(), "dataset_sha256": digest(dataset), "splits_sha256": digest(splits),
        "cases_sha256": digest(cases_path) if cases_path else None,
        "baseline_sha256": digest(baseline_path) if baseline_path else None,
        "prompt_version": PROMPT_VERSION, "instruction": INSTRUCTION, "prefix": PREFIX, "suffix": SUFFIX,
        "prompt_template_sha256": hashlib.sha256((PREFIX + INSTRUCTION + SUFFIX).encode()).hexdigest(),
        "threshold": THRESHOLD, "threshold_policy": "Fixed at 0.5 before scoring. No threshold or weight fitting.",
        "modes_in_order": list(modes), "python": platform.python_version(),
        "packages": {p: importlib.metadata.version(p) for p in ("torch", "transformers", "numpy", "huggingface-hub")},
        "source_sha256": {p.name: digest(p) for p in Path(__file__).parent.glob("*.py")},
        "warning": "Synthetic drafts remain unreviewed. This existing challenge is a DEVELOPMENT benchmark, not a fresh independently held-out human test. Prompt design used knowledge of prior failure categories."}
    out.mkdir(parents=True)
    write_json(out / "protocol.json", protocol)
    report = {"protocol": protocol, "modes": {}}
    for mode in modes:
        started = time.perf_counter()
        print(f"Scoring {mode}: {len(pairs)} development pairs ...", flush=True)

        def progress(done, total):
            if done == 1 or done % 5 == 0 or done == total:
                print(f"  {done}/{total} pairs processed ({time.perf_counter() - started:.1f}s)", flush=True)

        records, prompts = score_pair_texts(bundle, pairs, model, mode=mode, progress=progress)
        result = summarize(pairs, records, profiles, cases)
        result["latency"] = latency_summary(records)
        if comparison:
            result["paired_comparisons"] = paired_baselines(pairs, records, profiles, cases, comparison, mode)
        directory = out / mode
        directory.mkdir()
        write_json(directory / "predictions.json", records)
        with (directory / "prompts.jsonl").open("x") as stream:
            for row in prompts:
                stream.write(json.dumps(row) + "\n")
        write_json(directory / "metrics.json", result)
        report["modes"][mode] = result
        all_metrics = result["metrics"].get("all")
        print(f"{mode}: F1 {all_metrics['f1']:.3f}" if all_metrics else f"{mode}: no scorable labeled cases", flush=True)
    if diagnostic_path:
        diagnostic = validate_bundle(read_json(diagnostic_path))
        records, prompts = score_pair_texts(diagnostic, diagnostic["training_pairs"], model, mode="with_history")
        write_json(out / "development-diagnostic.json", {"dataset_sha256": digest(diagnostic_path),
            "not_part_of_benchmark": True, "predictions": records, "prompts": prompts})
    if hasattr(model, "runtime_statistics"):
        report["runtime_statistics"] = model.runtime_statistics()
    write_json(out / "report.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--splits", type=Path, required=True)
    parser.add_argument("--cases", type=Path)
    parser.add_argument("--baselines", type=Path)
    parser.add_argument("--diagnostic", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--device", choices=("cpu", "mps", "cuda"), default="cpu")
    parser.add_argument("--dtype", choices=("float32", "float16"), default="float32")
    parser.add_argument("--model-id", choices=MODEL_REVISIONS, default=MODEL_ID)
    parser.add_argument("--revision", help="Defaults to the pinned revision for the selected model")
    parser.add_argument("--max-tokens", type=int, default=4096)
    parser.add_argument("--modes", choices=ABLATIONS, nargs="+", default=["with_history", "with_posts", "onboarding_only"])
    args = parser.parse_args()
    require(not args.out.exists(), "Output directory already exists; choose a fresh experiment name")
    torch.set_num_threads(2)
    print(f"Loading frozen {args.model_id} on {args.device} ({args.dtype}), offline ...", flush=True)
    model = QwenReranker(device=args.device, dtype=args.dtype, model_id=args.model_id,
                         revision=args.revision, max_tokens=args.max_tokens)
    run_benchmark(args.dataset, args.splits, args.out, model, cases_path=args.cases,
                  baseline_path=args.baselines, modes=args.modes, diagnostic_path=args.diagnostic)


if __name__ == "__main__":
    main()

"""Evaluate saved runs on the same test cases, without fitting or tuning anything."""

import argparse
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch

from .features import FeatureBuilder, TextEncoder, feature_names
from .metrics import evaluate
from .predict import score_pairs
from .splits import partition_pairs
from .train import digest
from .validation import read_json, require, validate_bundle, write_json


def compare_runs(dataset, splits, runs, out, *, cases_path=None, encoder=None):
    require(not out.exists(), "Comparison output already exists; use a new path")
    require(len(set(map(str, runs))) == len(runs) and runs, "Supply distinct saved runs")
    bundle = validate_bundle(read_json(dataset))
    test_pairs = partition_pairs(bundle, read_json(splits))["test"]
    require(test_pairs, "No test cases")
    subset = {**bundle, "training_pairs": test_pairs}
    profiles = {p["profile_version_id"]: p for p in bundle["profiles"]}
    cases = read_json(cases_path) if cases_path else {}
    if cases_path:
        require(set(cases) == {p["example_id"] for p in bundle["training_pairs"]}, "Case metadata does not match dataset")
    report = {"dataset_sha256": digest(dataset), "splits_sha256": digest(splits),
              "warning": "Unreviewed synthetic challenge. Same author as training; not validated human compatibility. No test-set fitting or threshold selection.",
              "test_cases": len(test_pairs), "unknown_labels": sum(p["label"]["relevant_connection"] is None for p in test_pairs),
              "runs": {}}
    for run in runs:
        saved_metrics = read_json(run / "metrics.json")
        results = {}
        for mode in saved_metrics["ablation_results"]:
            directory = run / mode
            config = read_json(directory / "config.json")
            if encoder is None:
                encoder = TextEncoder(revision=config["encoder"]["revision"])
            require(encoder.metadata() == config["encoder"], "Run encoders differ; comparison requires the same representation")
            scored = score_pairs(subset, directory, encoder=encoder)
            require([row["example_id"] for row in scored] == [p["example_id"] for p in test_pairs], "Prediction order mismatch")
            usable = [i for i, row in enumerate(scored) if row["abstain_reason"] is None]
            selected = [test_pairs[i] for i in usable]
            if not selected:
                results[mode] = {"gated": len(scored), "models": {}}
                continue
            raw = FeatureBuilder(subset, encoder, mode=mode, top_k=config["top_k"]).matrix(selected)
            state = torch.load(directory / "matcher.pt", map_location="cpu", weights_only=True)
            x = (raw - state["mean"].numpy()) / state["scale"].numpy()
            logistic = read_json(directory / "logistic.json")
            logits = x @ np.asarray(logistic["coef"])[0] + logistic["intercept"][0]
            scores = {"neural": np.asarray([scored[i]["uncalibrated_relevance_score"] for i in usable]),
                      "logistic": np.exp(-np.logaddexp(0, -logits)),
                      "cosine": np.clip((raw[:, feature_names().index("goal_candidate_max")] + 1) / 2, 0, 1)}
            thresholds = {"neural": config["threshold"], "logistic": logistic["threshold"],
                          "cosine": saved_metrics["ablation_results"][mode]["cosine"]["validation"]["threshold"]}
            groups = defaultdict(list)
            for i, pair in enumerate(selected):
                if pair["label"]["relevant_connection"] is None:
                    continue
                groups["all"].append(i)
                candidate = profiles[pair["candidate_profile_version_id"]]
                groups["candidate_preferences_" + ("present" if candidate["conversation_preferences"] else "missing")].append(i)
                groups["history_" + ("present" if pair["prior_feedback_ids"] else "missing")].append(i)
                if cases:
                    groups[cases[pair["example_id"]]["case"]].append(i)
            require(groups.get("all"), "No labeled test cases remain after eligibility checks")
            models = {}
            for name, values in scores.items():
                model_report = {}
                for group, ids in groups.items():
                    labels = np.asarray([selected[i]["label"]["relevant_connection"] for i in ids])
                    model_report[group] = evaluate([selected[i] for i in ids], labels, values[ids], thresholds[name])
                queries = defaultdict(list)
                for i in groups.get("history_counterfactual", []):
                    queries[selected[i]["viewer_profile_version_id"]].append(i)
                margins = []
                for ids in queries.values():
                    positive = [values[i] for i in ids if selected[i]["label"]["relevant_connection"] == 1]
                    negative = [values[i] for i in ids if selected[i]["label"]["relevant_connection"] == 0]
                    if positive and negative:
                        margins.append(float(min(positive) - max(negative)))
                model_report["history_ordering"] = {"queries": len(margins),
                    "correct": sum(m > 1e-8 for m in margins), "positive_minus_negative_margins": margins}
                models[name] = model_report
            records = [{"example_id": pair["example_id"], "label": pair["label"]["relevant_connection"],
                        **{name + "_score": float(values[i]) for name, values in scores.items()}}
                       for i, pair in enumerate(selected)]
            results[mode] = {"gated": len(scored) - len(usable), "models": models,
                             "thresholds": thresholds, "predictions": records}
            print(f"{run.name}/{mode}: challenge neural F1 {models['neural']['all']['f1']:.3f}; "
                  f"logistic {models['logistic']['all']['f1']:.3f}", flush=True)
        report["runs"][str(run)] = results
    write_json(out, report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--splits", type=Path, required=True)
    parser.add_argument("--cases", type=Path)
    parser.add_argument("--runs", type=Path, nargs="+", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    compare_runs(args.dataset, args.splits, args.runs, args.out, cases_path=args.cases)


if __name__ == "__main__":
    main()

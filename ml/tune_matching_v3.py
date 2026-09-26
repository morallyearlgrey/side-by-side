"""Fit a scalar calibration on synthetic train, choose policy on validation, test once."""

import argparse
import importlib.metadata
import itertools
import json
import math
import platform
from collections import defaultdict
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression

from .features import TextEncoder
from .metrics import evaluate
from .matching_v3 import (FORMAT_AFFINITY_FLOOR, FORMAT_ENCODER_REVISION, MIN_HISTORY_SUPPORT,
                         MAX_HISTORY, ONBOARDING_WEIGHT, POLICY_VERSION, SOCIAL_MIN_RELEVANCE,
                         SOCIAL_WEIGHT, SourceAwareBuilder, blended_score, instruction_hashes,
                         score_components)
from .reranker import QwenReranker, score_pair_texts
from .splits import partition_pairs
from .train import digest
from .validation import read_json, require, validate_bundle, write_json

THRESHOLDS = tuple(i / 20 for i in range(1, 21))
GATE_THRESHOLDS = (0.3, 0.5, 0.7)
DEFAULT_POLICY = {"decision_threshold": 0.5, "evidence_threshold": 0.5, "style_threshold": 0.5}
IDENTITY = {"kind": "identity", "slope": 1.0, "intercept": 0.0}


def logit(score):
    require(math.isfinite(score) and 0 <= score <= 1, "Score must be finite and in [0, 1]")
    p = min(1 - 1e-6, max(1e-6, score))
    return math.log(p / (1 - p))


def raw_score(record, baseline=False):
    if baseline:
        return record["uncalibrated_relevance_score"]
    score, _ = blended_score(record)
    if score is None:
        return None
    for name in ("sufficiency", "style"):
        component = record["components"].get(name)
        if component and component["uncalibrated_relevance_score"] is None:
            return None
    style = record["components"].get("style")
    # Compatibility can attenuate relevance, never create a topic match or bonus.
    return score * (style["uncalibrated_relevance_score"] if style else 1.0)


def fit_calibration(train_pairs, records, *, baseline=False):
    require([p["example_id"] for p in train_pairs] == [r["example_id"] for r in records], "Calibration alignment error")
    rows = [(raw_score(r, baseline), p["label"]["relevant_connection"]) for p, r in zip(train_pairs, records)]
    rows = [(s, y) for s, y in rows if s is not None and y is not None]
    require({y for _, y in rows} == {0, 1}, "Calibration needs both known classes in training")
    model = LogisticRegression(C=1.0, random_state=42, max_iter=1000)
    model.fit(np.asarray([[logit(s)] for s, _ in rows]), np.asarray([y for _, y in rows]))
    slope, intercept = float(model.coef_[0, 0]), float(model.intercept_[0])
    result = {"kind": "synthetic_platt", "slope": slope, "intercept": intercept,
              "fit_examples": len(rows), "fit_split": "train", "human_calibrated": False,
              "warning": "Fits generated label frequencies, not human connection probabilities."}
    if slope <= 0:
        result.update(IDENTITY, fallback_reason="nonpositive_slope_would_reverse_ranking")
    return result


def calibrated(score, calibration):
    if calibration["kind"] == "identity":
        return score
    z = calibration["slope"] * logit(score) + calibration["intercept"]
    return 1 / (1 + math.exp(-max(-60.0, min(60.0, z))))


def decide(record, calibration, policy, *, baseline=False):
    result = {"example_id": record["example_id"], "decision": "insufficient_evidence",
              "score": None, "reason": record["abstain_reason"], "research_only": True,
              "requires_mutual_consent": True, "production_eligibility_checked": False}
    raw = raw_score(record, baseline)
    if raw is None:
        result["reason"] = result["reason"] or "component_unavailable"
        return result
    result["score"] = calibrated(raw, calibration)
    if not baseline:
        _, result["source_weights"] = blended_score(record)
        if record["components"]["sufficiency"]["uncalibrated_relevance_score"] < policy["evidence_threshold"]:
            result["reason"] = "insufficient_support_for_requested_conversation"
            return result
        style = record["components"].get("style")
        if style and style["uncalibrated_relevance_score"] < policy["style_threshold"]:
            result.update(decision="not_recommended", reason="supported_format_conflict")
            return result
    recommended = result["score"] >= policy["decision_threshold"]
    result.update(decision="recommend" if recommended else "not_recommended",
                  reason="above_threshold" if recommended else "below_threshold")
    return result


def decision_metrics(pairs, decisions):
    require([p["example_id"] for p in pairs] == [d["example_id"] for d in decisions], "Decision alignment error")
    tn = fp = fn = tp = known_abstentions = unknown_accepted = unknown_abstentions = 0
    known_negative_abstentions = positive_abstentions = unknown_count = 0
    for p, d in zip(pairs, decisions):
        y = p["label"]["relevant_connection"]
        yes, abstain = d["decision"] == "recommend", d["decision"] == "insufficient_evidence"
        if y is None:
            unknown_count += 1
            unknown_accepted += int(yes)
            unknown_abstentions += int(abstain)
            continue
        known_abstentions += int(abstain)
        if y:
            tp += int(yes)
            fn += int(not yes)
            positive_abstentions += int(abstain)
        else:
            fp += int(yes)
            tn += int(not yes)
            known_negative_abstentions += int(abstain)
    known = tn + fp + fn + tp
    precision, recall = tp / max(1, tp + fp), tp / max(1, tp + fn)
    return {"total": len(pairs), "known": known, "unknown": unknown_count,
            "confusion_matrix_tn_fp_fn_tp": [tn, fp, fn, tp],
            "precision": precision, "recall": recall, "f1": 2 * tp / max(1, 2 * tp + fp + fn),
            "known_coverage": (known - known_abstentions) / max(1, known),
            "known_abstentions": known_abstentions, "positive_abstentions": positive_abstentions,
            "unknown_recommended": unknown_accepted, "unknown_abstentions": unknown_abstentions,
            "selection_cost": 2 * fp + fn + 2 * unknown_accepted + 0.5 * positive_abstentions + 0.25 * known_negative_abstentions,
            "note": "Abstentions count as not recommending in the known-label confusion matrix; coverage is separate. Unknown is not a negative class. Selection cost is a declared prototype utility, not measured harm."}


def choose_policy(validation_pairs, records, calibration, *, baseline=False):
    evidence = (0.5,) if baseline else GATE_THRESHOLDS
    styles = (0.5,) if baseline else GATE_THRESHOLDS
    trials = []
    for threshold, gate, style in itertools.product(THRESHOLDS, evidence, styles):
        policy = {"decision_threshold": threshold, "evidence_threshold": gate, "style_threshold": style}
        metrics = decision_metrics(validation_pairs, [decide(r, calibration, policy, baseline=baseline) for r in records])
        trials.append({"policy": policy, "metrics": metrics})
    best = min(trials, key=lambda t: (t["metrics"]["selection_cost"],
               t["metrics"]["confusion_matrix_tn_fp_fn_tp"][1], t["metrics"]["unknown_recommended"],
               sum(abs(t["policy"][k] - DEFAULT_POLICY[k]) for k in DEFAULT_POLICY)))
    return best["policy"], trials


def summarize_decisions(pairs, decisions, cases):
    result = {"all": decision_metrics(pairs, decisions), "cases": {}}
    for category in sorted({cases[p["example_id"]]["case"] for p in pairs}):
        indexes = [i for i, p in enumerate(pairs) if cases[p["example_id"]]["case"] == category]
        result["cases"][category] = decision_metrics([pairs[i] for i in indexes], [decisions[i] for i in indexes])
    result["mistakes"] = [{"example_id": p["example_id"], "draft_label": p["label"]["relevant_connection"], **d}
                          for p, d in zip(pairs, decisions) if p["label"]["relevant_connection"] is not None
                          and int(d["decision"] == "recommend") != p["label"]["relevant_connection"]]
    scored = [i for i, (p, d) in enumerate(zip(pairs, decisions))
              if p["label"]["relevant_connection"] is not None and d["score"] is not None
              and d["decision"] != "insufficient_evidence"]
    if scored:
        metrics = evaluate([pairs[i] for i in scored],
                           np.asarray([pairs[i]["label"]["relevant_connection"] for i in scored]),
                           np.asarray([decisions[i]["score"] for i in scored]), 0.5)
        result["ranking_answered_only"] = metrics["ranking"]
    history = defaultdict(list)
    for p, d in zip(pairs, decisions):
        if cases[p["example_id"]]["case"] == "history_counterfactual":
            history[p["viewer_profile_version_id"]].append((p, d))
    margins = []
    for group in history.values():
        if any(d["score"] is None or d["decision"] == "insufficient_evidence" for _, d in group):
            continue
        positive = [d["score"] for p, d in group if p["label"]["relevant_connection"] == 1]
        negative = [d["score"] for p, d in group if p["label"]["relevant_connection"] == 0]
        if positive and negative:
            margins.append(min(positive) - max(negative))
    result["history_ordering"] = {"total_queries": len(history), "scored_queries": len(margins),
                                  "correct": sum(m > 1e-8 for m in margins), "margins": margins}
    return result


def run_experiment(dataset, splits, cases_path, out, model, *, format_encoder=None):
    require(not out.exists(), "Output directory already exists; use a new experiment directory")
    bundle = validate_bundle(read_json(dataset))
    partitions = partition_pairs(bundle, read_json(splits))
    require(all(partitions[s] for s in ("train", "validation", "test")), "All three splits are required")
    cases = read_json(cases_path)
    require(set(cases) == {p["example_id"] for p in bundle["training_pairs"]}, "Case metadata mismatch")
    builder = SourceAwareBuilder(bundle)
    out.mkdir(parents=True)
    protocol = {"model": model.metadata(), "policy_version": POLICY_VERSION,
                "python": platform.python_version(),
                "packages": {p: importlib.metadata.version(p) for p in ("torch", "transformers", "numpy", "scikit-learn", "jsonschema")},
                "instruction_sha256": instruction_hashes(), "dataset_sha256": digest(dataset),
                "splits_sha256": digest(splits), "cases_sha256": digest(cases_path),
                "source_sha256": {p.name: digest(p) for p in Path(__file__).parent.glob("*.py")},
                "source_weights": [ONBOARDING_WEIGHT, SOCIAL_WEIGHT],
                "social_min_relevance": SOCIAL_MIN_RELEVANCE, "max_history": MAX_HISTORY,
                "format_encoder": format_encoder.metadata() if format_encoder is not None else None,
                "format_affinity_floor": FORMAT_AFFINITY_FLOOR, "minimum_history_support": MIN_HISTORY_SUPPORT,
                "grid": {"decision_thresholds": THRESHOLDS, "gate_thresholds": GATE_THRESHOLDS},
                "split_policy": "Calibration: train only. Policy selection: validation only. Test scored after freezing policy.",
                "warning": "Synthetic generated labels and shared templates, no independent human validation. No Qwen weight fine-tuning. Scores are not human compatibility probabilities."}
    write_json(out / "protocol.json", protocol)
    write_json(out / "status.json", {"state": "running"})

    def status(value):
        tmp = out / ".status.next.json"
        write_json(tmp, value)
        tmp.replace(out / "status.json")

    def score_split(split):
        directory = out / split
        directory.mkdir()
        pairs = partitions[split]
        status({"state": "running", "split": split})

        def progress(done, total):
            if done == 1 or done % 20 == 0 or done == total:
                print(f"{split}: {done}/{total} pairs", flush=True)

        baseline, base_prompts = score_pair_texts(bundle, pairs, model, progress=progress)
        records, prompts = score_components(builder, pairs, model, progress=progress, format_encoder=format_encoder)
        write_json(directory / "baseline.json", baseline)
        write_json(directory / "components.json", records)
        for name, rows in (("baseline-prompts", base_prompts), ("source-aware-prompts", prompts)):
            with (directory / (name + ".jsonl")).open("x") as stream:
                for row in rows:
                    stream.write(json.dumps(row, ensure_ascii=True) + "\n")
        return baseline, records

    try:
        train_baseline, train = score_split("train")
        validation_baseline, validation = score_split("validation")
        calibrator = fit_calibration(partitions["train"], train)
        baseline_calibrator = fit_calibration(partitions["train"], train_baseline, baseline=True)
        policy, trials = choose_policy(partitions["validation"], validation, calibrator)
        baseline_policy, base_trials = choose_policy(partitions["validation"], validation_baseline, baseline_calibrator, baseline=True)
        options = {
            "baseline_fixed_0.5": (validation_baseline, IDENTITY, DEFAULT_POLICY, True),
            "baseline_calibrated": (validation_baseline, baseline_calibrator, baseline_policy, True),
            "source_aware_default": (validation, IDENTITY, DEFAULT_POLICY, False),
            "source_aware_tuned": (validation, calibrator, policy, False),
        }
        validation_comparison = {name: decision_metrics(partitions["validation"],
            [decide(r, cal, settings, baseline=is_baseline) for r in rows])
            for name, (rows, cal, settings, is_baseline) in options.items()}
        # Dict order breaks exact ties in favor of the simpler existing path.
        recommended = min(validation_comparison, key=lambda name: (
            validation_comparison[name]["selection_cost"],
            validation_comparison[name]["confusion_matrix_tn_fp_fn_tp"][1],
            validation_comparison[name]["unknown_recommended"]))
        selected = {"policy": policy, "calibration": calibrator, "baseline_policy": baseline_policy,
                    "baseline_calibration": baseline_calibrator, "weights_frozen": True,
                    "fit_split": "train", "selection_split": "validation", "test_used_for_selection": False,
                    "recommended_variant": recommended, "validation_comparison": validation_comparison,
                    "ready_for_live_profiles": False}
        write_json(out / "selected_policy.json", selected)
        write_json(out / "validation-trials.json", {"source_aware": trials, "baseline": base_trials})
        print("Policy frozen; now scoring the test split.", flush=True)
        test_baseline, test = score_split("test")
        report = {"protocol": protocol, "selected": selected, "splits": {}}
        for split, base, rows in (("validation", validation_baseline, validation), ("test", test_baseline, test)):
            pairs = partitions[split]
            variants = {
                "baseline_fixed_0.5": [decide(r, IDENTITY, DEFAULT_POLICY, baseline=True) for r in base],
                "baseline_calibrated": [decide(r, baseline_calibrator, baseline_policy, baseline=True) for r in base],
                "source_aware_default": [decide(r, IDENTITY, DEFAULT_POLICY) for r in rows],
                "source_aware_tuned": [decide(r, calibrator, policy) for r in rows],
            }
            report["splits"][split] = {name: summarize_decisions(pairs, decisions, cases) for name, decisions in variants.items()}
            write_json(out / split / "decisions.json", variants)
        report["runtime_statistics"] = model.runtime_statistics() if hasattr(model, "runtime_statistics") else {}
        report["test_timing"] = {
            "baseline_total_seconds": sum(r["elapsed_seconds"] for r in test_baseline),
            "source_aware_total_seconds": sum(v["elapsed_seconds"] for r in test for v in r["components"].values()),
            "source_aware_model_calls": sum(sum(k != "style" for k in r["components"]) for r in test),
            "source_aware_cache_hits": sum(v["cache_hit"] for r in test for v in r["components"].values()),
            "note": "Measured calls include shared-cache effects; this is not cold-start or end-to-end app latency."}
        write_json(out / "report.json", report)
        status({"state": "completed", "test_used_for_selection": False})
        print(json.dumps({name: result["all"] for name, result in report["splits"]["test"].items()}, indent=2), flush=True)
        return report
    except Exception as error:
        status({"state": "failed", "error": f"{type(error).__name__}: {error}"})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--splits", type=Path, required=True)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--device", choices=("cpu", "mps", "cuda"), default="cuda")
    parser.add_argument("--dtype", choices=("float16", "float32"), default="float16")
    parser.add_argument("--model-size", choices=("0.6B", "4B"), default="4B")
    args = parser.parse_args()
    encoder = TextEncoder(device="cpu", revision=FORMAT_ENCODER_REVISION)
    model = QwenReranker(model_id=f"Qwen/Qwen3-Reranker-{args.model_size}", device=args.device, dtype=args.dtype)
    run_experiment(args.dataset, args.splits, args.cases, args.out, model, format_encoder=encoder)


if __name__ == "__main__":
    main()

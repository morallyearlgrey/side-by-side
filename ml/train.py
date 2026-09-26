"""Train and compare a small matcher on validated, explicitly split synthetic data."""

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import subprocess
import sys
from pathlib import Path

os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import numpy as np
import torch
from sklearn.linear_model import LogisticRegression

from .features import (ABLATIONS, FEATURE_VERSION, FeatureBuilder, TextEncoder,
                       eligibility_reason, feature_names)
from .metrics import choose_threshold, evaluate
from .model import fit, predict_scores
from .splits import SPLITS, partition_pairs
from .validation import SCHEMA, read_json, require, validate_bundle, write_json


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def select_rows(bundle, partitions):
    profiles = {p["profile_version_id"]: p for p in bundle["profiles"]}
    rows, counts = {}, {}
    for split in SPLITS:
        rows[split] = []
        counts[split] = {"total": len(partitions[split]), "unknown_label": 0, "gated": 0, "used": 0}
        for pair in partitions[split]:
            if pair["label"]["relevant_connection"] is None:
                counts[split]["unknown_label"] += 1
                continue
            viewer = profiles[pair["viewer_profile_version_id"]]
            candidate = profiles[pair["candidate_profile_version_id"]]
            if eligibility_reason(viewer, candidate, "with_history"):
                counts[split]["gated"] += 1
                continue
            rows[split].append(pair)
        counts[split]["used"] = len(rows[split])
        require({p["label"]["relevant_connection"] for p in rows[split]} == {0, 1},
                f"{split} must contain both labeled classes after gates; do not train on the Italy example")
    return rows, counts


def train_run(dataset, splits, out, *, device="cpu", seed=42, epochs=100, patience=12,
              batch_size=32, modes=ABLATIONS, encoder=None, revision="main", allow_unreviewed=False):
    bundle = validate_bundle(read_json(dataset))
    manifest = read_json(splits)
    partitions = partition_pairs(bundle, manifest)
    rows, counts = select_rows(bundle, partitions)
    unreviewed = sum(not p["label"]["human_reviewed"] for group in rows.values() for p in group)
    require(allow_unreviewed or unreviewed == 0,
            "Unreviewed labels present. Review them, or explicitly use --allow-unreviewed-synthetic for a smoke test.")
    require(not out.exists(), "Output directory already exists; choose a fresh run name")
    require(all(mode in ABLATIONS for mode in modes) and modes and len(set(modes)) == len(modes), "Invalid ablations")
    if device == "cuda":
        require(torch.cuda.is_available(), "CUDA unavailable; request a GPU compute node")
    torch.set_num_threads(max(1, int(os.environ.get("SLURM_CPUS_PER_TASK", "2"))))
    encoder = encoder or TextEncoder(device=device, revision=revision, batch_size=batch_size)
    out.mkdir(parents=True)
    labels = {key: np.asarray([p["label"]["relevant_connection"] for p in rows[key]], dtype=np.float32) for key in SPLITS}
    provenance = {"dataset_sha256": digest(dataset), "splits_sha256": digest(splits),
                  "schema_sha256": digest(SCHEMA),
                  "dataset_id": bundle["dataset_id"], "seed": seed, "feature_version": FEATURE_VERSION,
                  "feature_names": feature_names(), "encoder": encoder.metadata(),
                  "top_k": 6, "epochs_limit": epochs, "patience": patience, "batch_size": batch_size,
                  "device": device, "python": platform.python_version(), "unreviewed_labeled_pairs": unreviewed,
                  "packages": {name: importlib.metadata.version(name) for name in
                               ("torch", "numpy", "sentence-transformers", "transformers", "scikit-learn", "jsonschema")},
                  "warning": "Synthetic-label experiment, not validated human compatibility or calibrated friendship probability."}
    git = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=False)
    provenance["git_commit"] = git.stdout.strip() if git.returncode == 0 else None
    status = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True, check=False)
    provenance["git_dirty"] = bool(status.stdout.strip()) if status.returncode == 0 else None
    provenance["source_sha256"] = {p.name: digest(p) for p in Path(__file__).parent.glob("*.py")}
    frozen = subprocess.run([sys.executable, "-m", "pip", "freeze"], capture_output=True, text=True, check=True)
    with (out / "environment.freeze.txt").open("x") as stream:
        stream.write(frozen.stdout)
    write_json(out / "provenance.json", provenance)
    write_json(out / "split_manifest.json", manifest)
    report = {"warning": provenance["warning"], "counts": counts, "ablation_results": {},
              "split_limitation": manifest.get("limitation"), "test_policy": "No test-set early stopping or threshold selection."}
    for mode in modes:
        print(f"Encoding {mode} ...", flush=True)
        builder = FeatureBuilder(bundle, encoder, mode=mode)
        # Identical rows across ablations; absence is represented by masks, not dropped test cases.
        raw = {key: builder.matrix(rows[key]) for key in SPLITS}
        mean = raw["train"].mean(axis=0)
        scale = raw["train"].std(axis=0)
        scale[scale < 1e-6] = 1.0
        x = {key: (value - mean) / scale for key, value in raw.items()}
        coverage = []
        for i, name in enumerate(feature_names()):
            low, high = float(raw["train"][:, i].min()), float(raw["train"][:, i].max())
            coverage.append({"feature": name, "train_min": low, "train_max": high,
                "constant_in_training": high - low < 1e-6,
                **{key + "_outside_training_range": int(np.sum(
                    (raw[key][:, i] < low - 1e-6) | (raw[key][:, i] > high + 1e-6)))
                   for key in ("validation", "test")}})
        model, history = fit(x["train"], labels["train"], x["validation"], labels["validation"],
                             device=device, seed=seed, epochs=epochs, patience=patience, batch_size=batch_size)
        scores = {key: predict_scores(model, x[key], device) for key in SPLITS}
        threshold = choose_threshold(labels["validation"], scores["validation"])
        logistic = LogisticRegression(C=1.0, max_iter=2000, random_state=seed).fit(x["train"], labels["train"])
        baseline_scores = {
            "cosine": {key: np.clip((raw[key][:, feature_names().index("goal_candidate_max")] + 1) / 2, 0, 1) for key in SPLITS},
            "logistic": {key: logistic.predict_proba(x[key])[:, 1] for key in SPLITS}}
        evaluations = {"neural": {key: evaluate(rows[key], labels[key], scores[key], threshold) for key in ("validation", "test")}}
        for name, values in baseline_scores.items():
            cutoff = choose_threshold(labels["validation"], values["validation"])
            evaluations[name] = {key: evaluate(rows[key], labels[key], values[key], cutoff) for key in ("validation", "test")}
        directory = out / mode
        directory.mkdir()
        write_json(directory / "feature_coverage.json", coverage)
        torch.save({"state_dict": {key: value.cpu() for key, value in model.state_dict().items()},
                    "mean": torch.from_numpy(mean), "scale": torch.from_numpy(scale)}, directory / "matcher.pt")
        write_json(directory / "config.json", {**provenance, "mode": mode, "threshold": threshold,
                                               "input_dim": len(feature_names()), "best_epoch": history["best_epoch"]})
        write_json(directory / "training_history.json", history)
        # Numerical baseline parameters only: no pickle of arbitrary Python objects.
        write_json(directory / "logistic.json", {"coef": logistic.coef_.tolist(), "intercept": logistic.intercept_.tolist(),
                                                  "threshold": evaluations["logistic"]["validation"]["threshold"]})
        records = []
        for i, pair in enumerate(rows["test"]):
            records.append({"example_id": pair["example_id"], "label": int(labels["test"][i]),
                            "neural_score": float(scores["test"][i]),
                            **{name + "_score": float(value["test"][i]) for name, value in baseline_scores.items()}})
        write_json(directory / "test_predictions.json", records)
        report["ablation_results"][mode] = evaluations
        print(f"{mode}: best epoch {history['best_epoch']}; synthetic test F1 {evaluations['neural']['test']['f1']:.3f}", flush=True)
    write_json(out / "metrics.json", report)
    print(f"Saved artifacts to {out}. Synthetic metrics are NOT real-world validation.", flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--splits", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--patience", type=int, default=12)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--revision", default="main")
    parser.add_argument("--mode", choices=(*ABLATIONS, "all"), default="all")
    parser.add_argument("--allow-unreviewed-synthetic", action="store_true")
    args = parser.parse_args()
    train_run(args.dataset, args.splits, args.out, device=args.device, seed=args.seed,
              epochs=args.epochs, patience=args.patience, batch_size=args.batch_size,
              modes=ABLATIONS if args.mode == "all" else (args.mode,), revision=args.revision,
              allow_unreviewed=args.allow_unreviewed_synthetic)


if __name__ == "__main__":
    main()

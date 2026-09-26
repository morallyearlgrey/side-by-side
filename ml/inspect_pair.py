"""Inspect embeddings, pairwise similarities, and an optional research match score."""

import argparse
import json
from pathlib import Path

from .features import (ROLES, FeatureBuilder, TextEncoder, eligibility_reason,
                       fact_text, feature_names)
from .predict import score_pairs
from .validation import ROOT, read_json, require, validate_bundle


def inspect_pair(bundle, example_id, encoder, *, model_dir=None, mode=None, device="cpu"):
    validate_bundle(bundle)
    pairs = [pair for pair in bundle["training_pairs"] if pair["example_id"] == example_id]
    require(len(pairs) == 1, f"Unknown example_id: {example_id}")
    pair = pairs[0]
    config = read_json(Path(model_dir) / "config.json") if model_dir else None
    if config:
        require(mode is None or mode == config["mode"], "Inspection mode must match the checkpoint")
        mode = config["mode"]
    mode = mode or "with_history"
    builder = FeatureBuilder(bundle, encoder, mode=mode, top_k=config["top_k"] if config else 6)
    viewer = builder.profiles[pair["viewer_profile_version_id"]]
    candidate = builder.profiles[pair["candidate_profile_version_id"]]
    query_text = builder.intent(viewer, pair["context"]["goal"])
    query = builder.vector(query_text)
    vf, ve = builder.select(viewer, query)
    cf, ce = builder.select(candidate, query)
    features = builder.build(pair)

    def facts_with_vectors(facts, vectors, prefix):
        return [{"display_id": f"{prefix}{i + 1}", "fact_id": fact["fact_id"],
                 "role": fact["relationship"], "text": fact_text(fact),
                 "vector_preview_first_6": vector[:6].tolist(),
                 "goal_cosine": float(vector @ query)}
                for i, (fact, vector) in enumerate(zip(facts, vectors))]

    prediction = None
    if model_dir:
        selected_bundle = {**bundle, "training_pairs": [pair]}
        prediction = score_pairs(selected_bundle, model_dir, device=device, encoder=encoder)[0]
    return {"example_id": example_id, "viewer_profile": viewer["profile_version_id"],
            "candidate_profile": candidate["profile_version_id"], "mode": mode,
            "encoder": encoder.metadata(), "query": query_text,
            "viewer_facts": facts_with_vectors(vf, ve, "V"),
            "candidate_facts": facts_with_vectors(cf, ce, "C"),
            "cosine_matrix": (ve @ ce.T).tolist(), "comparison_count": len(vf) * len(cf),
            "features": {name: float(value) for name, value in zip(feature_names(), features)},
            "abstain_reason": eligibility_reason(viewer, candidate, mode),
            "prediction": prediction, "validation_threshold": config["threshold"] if config else None,
            "label_for_comparison_only": pair["label"],
            "warning": "Synthetic-only local diagnostic. Cosines are not compatibility percentages; the score is uncalibrated."}


def render_markdown(report):
    def cell(value):
        return str(value).replace("|", "\\|").replace("\n", " ").replace("\r", " ")

    lines = [f"# Pair Inspection: {cell(report['example_id'])}", "", report["warning"], "",
             f"Direction: `{cell(report['viewer_profile'])}` -> `{cell(report['candidate_profile'])}`",
             f"Feature mode: `{report['mode']}`", "", "## Viewer Goal", "", cell(report["query"]), "",
             "## Selected Facts", "",
             f"Each fact has a {report['encoder']['dimension']}-number normalized embedding. "
             "Only the first six components are shown below.", ""]
    for title, key in (("Viewer", "viewer_facts"), ("Candidate", "candidate_facts")):
        lines.extend([f"### {title}", ""])
        for fact in report[key]:
            preview = ", ".join(f"{x:.4f}" for x in fact["vector_preview_first_6"])
            lines.extend([f"- **{fact['display_id']} [{fact['role']}]** {cell(fact['text'])}",
                          f"  Vector preview: `[{preview}, ...]`; viewer-goal cosine: `{fact['goal_cosine']:.4f}`"])
        if not report[key]:
            lines.append("No approved facts selected.")
        lines.append("")
    lines.extend(["## Fact-to-Fact Cosines", "",
                  f"{len(report['viewer_facts'])} viewer facts x {len(report['candidate_facts'])} candidate facts "
                  f"= {report['comparison_count']} comparisons. Values are not match probabilities.", ""])
    if report["viewer_facts"] and report["candidate_facts"]:
        columns = [fact["display_id"] for fact in report["candidate_facts"]]
        lines.extend(["| Viewer / Candidate | " + " | ".join(columns) + " |",
                      "| --- | " + " | ".join("---:" for _ in columns) + " |"])
        for fact, row in zip(report["viewer_facts"], report["cosine_matrix"]):
            lines.append(f"| {fact['display_id']} | " + " | ".join(f"{value:.4f}" for value in row) + " |")
    lines.extend(["", "## Role-Pair Summaries", "",
                  "Each entry is the strongest selected fact comparison for that role pair. "
                  "A dash means a role is absent; the model receives zero plus role-presence flags.", "",
                  "| Viewer / Candidate | " + " | ".join(ROLES) + " |",
                  "| --- | " + " | ".join("---:" for _ in ROLES) + " |"])
    features = report["features"]
    for a in ROLES:
        values = []
        for b in ROLES:
            present = features[f"viewer_has:{a}"] and features[f"candidate_has:{b}"]
            values.append(f"{features[f'role_cosine:{a}:{b}']:.4f}" if present else "- (absent)")
        lines.append(f"| {a} | " + " | ".join(values) + " |")
    lines.extend(["", "## Final Research Score", ""])
    prediction = report["prediction"]
    if report["abstain_reason"]:
        lines.append(f"Abstain: `{report['abstain_reason']}`. No match score should be used.")
    elif prediction is None:
        lines.append("No checkpoint supplied; this report inspects the encoder and features only.")
    else:
        score = prediction["uncalibrated_relevance_score"]
        lines.append(f"Uncalibrated neural score: **{score:.4f}**. Validation-selected threshold: **{report['validation_threshold']:.4f}**.")
        lines.append("This is not a percentage chance of friendship. Blocks, availability, and mutual consent are not checked here.")
    label = report["label_for_comparison_only"]
    lines.extend(["", f"Comparison annotation (not a feature): `{label['relevant_connection']}`; "
                  f"source `{label['source']}`; human reviewed: `{label['human_reviewed']}`.", "",
                  "## All 71 Inputs", "", "These are the raw features before checkpoint normalization, not an attribution of model decisions.", "",
                  "| Feature | Value |", "| --- | ---: |"])
    lines.extend(f"| `{name}` | {value:.6f} |" for name, value in features.items())
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=ROOT / "data/samples/v2/italy-example.json")
    parser.add_argument("--example-id", default="jane_to_john_v2")
    parser.add_argument("--model-dir", type=Path)
    parser.add_argument("--mode", choices=("onboarding_only", "with_posts", "with_history"))
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--revision", default="main")
    parser.add_argument("--format", choices=("markdown", "json"), default="markdown")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    if args.out:
        require(not args.out.exists(), "Output already exists; choose a fresh filename")
    bundle = validate_bundle(read_json(args.dataset))
    require(any(p["example_id"] == args.example_id for p in bundle["training_pairs"]), "Unknown example_id")
    config = read_json(args.model_dir / "config.json") if args.model_dir else None
    encoder = TextEncoder(device=args.device, revision=config["encoder"]["revision"] if config else args.revision)
    report = inspect_pair(bundle, args.example_id, encoder, model_dir=args.model_dir, mode=args.mode, device=args.device)
    output = json.dumps(report, indent=2, allow_nan=False) + "\n" if args.format == "json" else render_markdown(report)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open("x") as stream:
            stream.write(output)
        print(f"Saved diagnostic to {args.out}")
    else:
        print(output, end="")


if __name__ == "__main__":
    main()

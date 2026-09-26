"""Compare frozen 4B v3 versus v4, without fitting or selecting any parameters."""

import argparse
from collections import Counter
import hashlib
from pathlib import Path
import time

from .evidence import EvidenceVerifier
from .features import TextEncoder
from .matching_v3 import FORMAT_ENCODER_REVISION, SourceAwareBuilder, score_components
from .matching_v4 import (CONTRADICTION_THRESHOLD, FIRSTHAND_THRESHOLD, POLICY_VERSION,
                          score_bundle)
from .reranker import MODEL_REVISIONS, QwenReranker
from .tune_matching_v3 import decide, decision_metrics
from .validation import read_json, require, write_json

MODEL_ID = "Qwen/Qwen3-Reranker-4B"


def summarize(pairs, decisions, cases):
    def selected(indexes):
        return decision_metrics([pairs[i] for i in indexes], [decisions[i] for i in indexes])
    result = {"all": selected(range(len(pairs))),
              "decision_counts": dict(Counter(d["decision"] for d in decisions)),
              "reason_counts": dict(Counter(d["reason"] for d in decisions))}
    for field in ("cohort", "case"):
        result[field] = {value: selected([i for i, p in enumerate(pairs) if cases[p["example_id"]][field] == value])
                         for value in sorted({c[field] for c in cases.values()})}
    result["unknown_recommendations"] = [d for p, d in zip(pairs, decisions)
                                        if p["label"]["relevant_connection"] is None and d["decision"] == "recommend"]
    result["missed_positives"] = [d for p, d in zip(pairs, decisions)
                                 if p["label"]["relevant_connection"] == 1 and d["decision"] != "recommend"]
    return result


def run_evaluation(bundle, cases, selected, model, evidence_model, encoder):
    builder = SourceAwareBuilder(bundle)
    pairs = bundle["training_pairs"]
    require(set(cases) == set(builder.pairs), "Case sidecar must match the evaluation bundle")
    require(all("evidence_requirement" in p["context"] for p in pairs), "Explicit request contracts required")
    require(model.metadata()["id"] == MODEL_ID and model.metadata()["revision"] == MODEL_REVISIONS[MODEL_ID],
            "Evaluation requires the pinned 4B checkpoint; no smaller-model fallback")
    def progress(done, total):
        if done == 1 or done % 10 == 0 or done == total:
            print(f"  {done}/{total} pairs", flush=True)

    print(f"Scoring {len(pairs)} cases with 4B + evidence checker", flush=True)
    start = time.perf_counter()
    v4 = score_bundle(bundle, model, selected, evidence_model=evidence_model, format_encoder=encoder, progress=progress)
    v4_seconds = time.perf_counter() - start
    print("Evidence-gated pass complete; scoring the unchanged v3 comparison", flush=True)
    start = time.perf_counter()
    records, prompts = score_components(builder, pairs, model, format_encoder=encoder, progress=progress)
    v3 = {"records": records, "prompts": prompts,
          "decisions": [decide(r, selected["calibration"], selected["policy"]) for r in records]}
    report = {"v3": summarize(pairs, v3["decisions"], cases),
              "v4": summarize(pairs, v4["decisions"], cases),
              "timing": {"v4_seconds": v4_seconds, "v3_incremental_seconds": time.perf_counter() - start,
                         "note": "Shared prompt caches; model loading excluded. Not a fair latency comparison or API benchmark."},
              "changes": [{"example_id": a["example_id"], "v3": a, "v4": b}
                          for a, b in zip(v3["decisions"], v4["decisions"])
                          if (a["decision"], a["reason"]) != (b["decision"], b["reason"])],
              "parameters_fitted": False, "ready_for_live_profiles": False,
              "limitation": "Synthetic draft judgments, shared templates, no human evaluation. Known regressions are reported separately. "
                            "Entailment is textual support, not verification of real-world claims or mutual consent."}
    return {"v3": v3, "v4": v4, "report": report}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--policy-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    require(not args.out.exists(), "Output exists; do not overwrite earlier results")
    bundle, cases = read_json(args.dataset), read_json(args.cases)
    builder = SourceAwareBuilder(bundle)
    require(set(cases) == set(builder.pairs), "Case sidecar must match the evaluation bundle")
    require(all("evidence_requirement" in p["context"] for p in builder.pairs.values()), "Explicit request contracts required")
    selected = read_json(args.policy_dir / "selected_policy.json")
    base = read_json(args.policy_dir / "protocol.json")
    require(read_json(args.policy_dir / "status.json")["state"] == "completed", "Base policy run must be completed")
    require(selected["recommended_variant"] == "source_aware_tuned", "Expected the selected source-aware policy")
    require(base["model"]["id"] == MODEL_ID and base["model"]["revision"] == MODEL_REVISIONS[MODEL_ID], "Base checkpoint mismatch")
    require(base["format_encoder"]["revision"] == FORMAT_ENCODER_REVISION, "Base encoder mismatch")
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    protocol = {"model_id": MODEL_ID, "model_revision": MODEL_REVISIONS[MODEL_ID],
                "evidence_policy": POLICY_VERSION, "base_policy": selected,
                "firsthand_threshold": FIRSTHAND_THRESHOLD, "contradiction_threshold": CONTRADICTION_THRESHOLD,
                "parameters_fitted": False, "ready_for_live_profiles": False,
                "dataset_sha256": digest(args.dataset), "cases_sha256": digest(args.cases),
                "base_policy_files_sha256": {p.name: digest(p) for p in args.policy_dir.glob("*.json")},
                "source_sha256": {p.name: digest(p) for p in Path(__file__).parent.glob("*.py")},
                "schema_sha256": digest(Path(__file__).resolve().parents[1] / "data/schemas/matching-dataset-v2.schema.json")}
    args.out.mkdir(parents=True)
    write_json(args.out / "protocol.json", protocol)
    write_json(args.out / "status.json", {"state": "running", "stage": "loading_models"})

    def update(name, value):
        temporary = args.out / ("." + name + ".next.json")
        write_json(temporary, value)
        temporary.replace(args.out / (name + ".json"))

    try:
        print(f"Loading pinned {MODEL_ID} on CUDA with float16; no fallback", flush=True)
        model = QwenReranker(model_id=MODEL_ID, device="cuda", dtype="float16")
        encoder = TextEncoder(device="cpu", revision=FORMAT_ENCODER_REVISION)
        evidence = EvidenceVerifier(device="cpu")
        protocol.update(model=model.metadata(), format_encoder=encoder.metadata(), evidence_model=evidence.metadata())
        update("protocol", protocol)
        update("status", {"state": "running", "stage": "scoring"})
        result = run_evaluation(bundle, cases, selected, model, evidence, encoder)
        for variant in ("v3", "v4"):
            (args.out / variant).mkdir()
            for name, value in result[variant].items():
                write_json(args.out / variant / (name + ".json"), value)
        result["report"]["runtime_statistics"] = model.runtime_statistics() if hasattr(model, "runtime_statistics") else {}
        write_json(args.out / "report.json", result["report"])
        update("status", {"state": "completed", "pairs": len(bundle["training_pairs"]), "parameters_fitted": False})
        for variant in ("v3", "v4"):
            m = result["report"][variant]["all"]
            print(f"{variant}: unknown recommended={m['unknown_recommended']}/{m['unknown']}, "
                  f"positive abstentions={m['positive_abstentions']}, known coverage={m['known_coverage']:.3f}", flush=True)
        print(f"Results: {args.out}", flush=True)
    except Exception as exc:
        update("status", {"state": "failed", "error": type(exc).__name__, "message": str(exc)})
        raise


if __name__ == "__main__":
    main()

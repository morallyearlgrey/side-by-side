"""Evidence-gated scoring over approved synthetic profiles, not a live-user API."""

import argparse
import hashlib
import json
import math
from pathlib import Path

from .evidence import EvidenceVerifier
from .features import TextEncoder, fact_text, normalized
from .matching_v3 import FORMAT_ENCODER_REVISION, SourceAwareBuilder, score_components, source_facts
from .reranker import MODEL_REVISIONS, QwenReranker
from .tune_matching_v3 import decide
from .validation import read_json, require, write_json

POLICY_VERSION = "source-aware-evidence-v4"
FIRSTHAND_THRESHOLD = 0.8
CONTRADICTION_THRESHOLD = 0.8
FIRSTHAND_METHOD = "nli_firsthand_support"


def experience_claims(profile, *, include_social, posts):
    """Use full owned source text so an excerpt cannot omit a negation or attribution."""
    answers = {a["answer_id"]: a["answer_text"] for a in profile["onboarding_answers"]}
    groups = source_facts(profile)
    allowed = {}
    for source, facts in groups.items():
        if source == "social" and not include_social:
            continue
        for fact in facts:
            if fact["role"] == "experienced":
                key = normalized(fact_text(fact))
                allowed[(source, key)] = {**fact, "source_quotes": []}
    for fact in profile["facts"]:
        if (fact["relationship"] != "experienced" or fact["confirmation"] != "confirmed"
                or not fact["matching_allowed"]):
            continue
        for evidence in fact["evidence"]:
            source = "onboarding" if evidence["source_type"] == "onboarding_answer" else "social"
            claim = allowed.get((source, normalized(fact_text(fact))))
            if claim is not None:
                source_text = (answers[evidence["reference_id"]] if source == "onboarding"
                               else posts[evidence["reference_id"]]["caption"])
                if source_text not in claim["source_quotes"]:
                    claim["source_quotes"].append(source_text)
    return [claim for claim in allowed.values() if claim["source_quotes"]]


def evidence_plan(builder, pair):
    # Existing ownership, timestamps, boundaries, and source permissions run first.
    prepared = builder.build(pair)
    if prepared["abstain_reason"]:
        return prepared["abstain_reason"], []
    context = pair["context"]
    requirement = context.get("evidence_requirement")
    if requirement is None:
        return "evidence_requirement_missing", []
    if requirement["confirmation"] != "confirmed" or requirement["kind"] == "unresolved":
        return "evidence_requirement_unresolved", []
    if requirement["kind"] == "none":
        return None, []
    if not context["goal"] or not context["goal"].strip():
        return "experience_request_missing", []
    if not requirement["claim"].strip():
        return "experience_claim_missing", []
    subject = requirement["subject"]
    expected = {"learn": "candidate", "share": "viewer"}.get(context["mode"])
    if expected and subject not in (expected, "both"):
        return "experience_direction_conflict", []
    subjects = ("viewer", "candidate") if subject == "both" else (subject,)
    tasks = []
    for endpoint in subjects:
        profile = builder.profiles[pair[endpoint + "_profile_version_id"]]
        claims = experience_claims(profile, include_social=builder.include_social, posts=builder.posts)
        if not claims:
            return "required_firsthand_experience_missing", []
        # Normalized fact details cannot prove themselves. Only the original
        # evidence quotes enter entailment, against an independently confirmed request.
        tasks.append({"name": "firsthand_" + endpoint, "claim": requirement["claim"],
                      "claims": [{"approved_details": claim["details"], "sources": claim["source_quotes"]}
                                 for claim in claims]})
    return None, tasks


def evidence_failure(result):
    score, contradiction = result["support_score"], result["contradiction_score"]
    if (result.get("abstain_reason") is not None
            or any(not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= 1
                   for v in (score, contradiction))):
        return "firsthand_evidence_unavailable"
    if contradiction >= CONTRADICTION_THRESHOLD:
        return "firsthand_evidence_conflicting"
    if score < FIRSTHAND_THRESHOLD:
        return "required_firsthand_experience_unsupported"
    return None


def score_evidence_aware(builder, pairs, model, *, evidence_model=None, format_encoder=None, progress=None):
    """Gate before relevance; a high score cannot bypass missing required evidence."""
    pairs = list(pairs)
    requests = {}
    for pair in pairs:
        require(builder.pairs.get(pair.get("example_id")) == pair, "Pair must belong to the validated bundle")
        context = pair["context"]
        key = (pair["viewer_profile_version_id"], pair["as_of"], context["mode"], context["goal"])
        requirement = context.get("evidence_requirement")
        require(key not in requests or requests[key] == requirement,
                "Evidence requirement must not change with the candidate for the same request")
        requests[key] = requirement
    records, prompts = [], []
    for pair in pairs:
        reason, tasks = evidence_plan(builder, pair)
        checks = {}
        for task in tasks:
            if evidence_model is None:
                reason = "firsthand_verifier_unavailable"
                break
            checks[task["name"]] = []
            prompts.append({"example_id": pair["example_id"], **task, "method": FIRSTHAND_METHOD})
            # At least one relevant experience claim must be supported. An
            # unrelated accomplishment neither establishes nor vetoes that claim.
            for claim in task["claims"]:
                checked = {}
                # The request must be within the approved fact's scope AND
                # supported by its source. Other facts in a long answer are not
                # automatically approved merely because we read it for context.
                for stage, texts in (("approved_scope", [claim["approved_details"]]), ("source_support", claim["sources"])):
                    result = evidence_model.check(task["claim"], texts)
                    reason = evidence_failure(result)
                    if reason == "firsthand_evidence_unavailable":
                        result = {"support_score": None, "contradiction_score": None, "abstain_reason": reason}
                    checked[stage] = result
                    if reason:
                        break
                checks[task["name"]].append(checked)
                if reason is None:
                    break
            if reason:
                break
        if reason:
            record = {"example_id": pair["example_id"], "components": {}, "abstain_reason": reason,
                      "history_used": 0, "history_omitted": 0, "research_only": True,
                      "requires_mutual_consent": True, "production_eligibility_checked": False}
        else:
            scored, audit = score_components(builder, [pair], model, format_encoder=format_encoder)
            record = scored[0]
            prompts.extend(audit)
        record.update(evidence_policy=POLICY_VERSION, firsthand_checks=checks)
        records.append(record)
        if progress:
            progress(len(records), len(pairs))
    return records, prompts


def score_bundle(bundle, model, selected, *, evidence_model=None, format_encoder=None, progress=None):
    """Shared strict entry point for offline scoring and the future service adapter."""
    require(selected.get("recommended_variant") == "source_aware_tuned", "Expected the selected source-aware policy")
    records, prompts = score_evidence_aware(SourceAwareBuilder(bundle), bundle["training_pairs"],
                                          model, evidence_model=evidence_model, format_encoder=format_encoder,
                                          progress=progress)
    decisions = [decide(r, selected["calibration"], selected["policy"]) for r in records]
    for decision in decisions:
        decision["evidence_policy"] = POLICY_VERSION
    return {"decisions": decisions, "records": records, "prompts": prompts}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--policy-dir", type=Path, required=True,
                        help="Completed 4B v3 run containing selected_policy.json and protocol.json")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--device", choices=("cpu", "mps", "cuda"), default="cuda")
    parser.add_argument("--dtype", choices=("float32", "float16"), default="float16")
    args = parser.parse_args()
    require(not args.out.exists(), "Output already exists; preserve previous experiments")
    bundle = read_json(args.dataset)
    builder = SourceAwareBuilder(bundle)
    # Check the contract before loading the multi-GB model; never silently migrate goals.
    require(all(p["context"].get("evidence_requirement") is not None for p in builder.pairs.values()),
            "Provide explicit evidence_requirement for every request; no legacy inference or label-based migration")
    selected = read_json(args.policy_dir / "selected_policy.json")
    protocol = read_json(args.policy_dir / "protocol.json")
    status = read_json(args.policy_dir / "status.json")
    model_id = "Qwen/Qwen3-Reranker-4B"
    require(status["state"] == "completed", "Policy run must be completed")
    require(selected["recommended_variant"] == "source_aware_tuned", "Expected source-aware selected policy")
    require(protocol["model"]["id"] == model_id and
            protocol["model"]["revision"] == MODEL_REVISIONS[model_id], "Policy model checkpoint mismatch")
    require(protocol["format_encoder"]["revision"] == FORMAT_ENCODER_REVISION, "Policy encoder mismatch")
    encoder = TextEncoder(device="cpu", revision=FORMAT_ENCODER_REVISION)
    evidence_model = EvidenceVerifier(device="cpu")
    model = QwenReranker(model_id=model_id, device=args.device, dtype=args.dtype)
    result = score_bundle(bundle, model, selected, evidence_model=evidence_model, format_encoder=encoder)
    digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    result["protocol"] = {"evidence_policy": POLICY_VERSION, "model": model.metadata(),
                          "format_encoder": encoder.metadata(), "firsthand_threshold": FIRSTHAND_THRESHOLD,
                          "evidence_model": evidence_model.metadata(), "contradiction_threshold": CONTRADICTION_THRESHOLD,
                          "dataset_sha256": digest(args.dataset), "base_policy_sha256": digest(args.policy_dir / "selected_policy.json"),
                          "source_sha256": {p.name: digest(p) for p in Path(__file__).parent.glob("*.py")},
                          "schema_sha256": digest(Path(__file__).resolve().parents[1] / "data/schemas/matching-dataset-v2.schema.json"),
                          "ready_for_live_profiles": False,
                          "base_policy": selected,
                          "warning": "Fixed new evidence gate; prior calibration reused, not a fresh held-out evaluation or human probability."}
    args.out.mkdir(parents=True)
    for name, value in result.items():
        write_json(args.out / (name + ".json"), value)
    print(json.dumps({"output": str(args.out), "decisions": len(result["decisions"]), "research_only": True}))


if __name__ == "__main__":
    main()

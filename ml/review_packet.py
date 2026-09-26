"""Blind review packets: draft judgments are kept in a separate answer-key file."""

import hashlib
import json
import random
from collections import Counter, defaultdict

from .features import approved_facts
from .splits import partition_pairs
from .validation import write_json


def coverage(bundle, manifest):
    profiles = {p["profile_version_id"]: p for p in bundle["profiles"]}
    result = {}
    for split, pairs in partition_pairs(bundle, manifest).items():
        slices = defaultdict(Counter)
        sizes = []
        for pair in pairs:
            label = str(pair["label"]["relevant_connection"])
            viewer, candidate = [profiles[pair[key]] for key in
                                 ("viewer_profile_version_id", "candidate_profile_version_id")]
            slices["all"][label] += 1
            for side, profile in (("viewer", viewer), ("candidate", candidate)):
                suffix = "present" if profile["conversation_preferences"] else "missing"
                slices[f"{side}_preferences_{suffix}"][label] += 1
                count = len(approved_facts(profile, "with_history"))
                sizes.append(count)
                slices[f"{side}_facts_{'many' if count > 3 else 'few'}"][label] += 1
                has_post = any(e["source_type"] == "owned_post" for f in profile["facts"] for e in f["evidence"])
                slices[f"{side}_posts_{'present' if has_post else 'missing'}"][label] += 1
            slices["history_" + ("present" if pair["prior_feedback_ids"] else "missing")][label] += 1
            slices["mode_" + pair["context"]["mode"]][label] += 1
        result[split] = {"slices": dict(slices), "fact_count_min": min(sizes, default=0),
                         "fact_count_max": max(sizes, default=0)}
    return result


def write_packets(bundle, manifest, cases, out):
    profiles = {p["profile_version_id"]: p for p in bundle["profiles"]}
    feedback = {h["feedback_id"]: h for h in bundle["feedback"]}
    partitions = partition_pairs(bundle, manifest)
    rng = random.Random(814)
    buckets = defaultdict(list)
    for pair in partitions["train"]:
        candidate = profiles[pair["candidate_profile_version_id"]]
        key = (cases[pair["example_id"]]["case"], pair["label"]["relevant_connection"],
               bool(candidate["conversation_preferences"]))
        buckets[key].append(pair)
    for group in buckets.values():
        rng.shuffle(group)
    selected = []
    while len(selected) < min(40, len(partitions["train"])):
        for group in buckets.values():
            if group and len(selected) < 40:
                selected.append(group.pop())
    packet_sets = {"training": selected, "challenge": partitions["test"]}
    dataset_hash = hashlib.sha256((out / "dataset.json").read_bytes()).hexdigest()
    write_json(out / "coverage.json", coverage(bundle, manifest))
    keys = {}
    for name, pairs in packet_sets.items():
        rng.shuffle(pairs)
        lines = [f"# {name.title()} Review Packet", "",
                 "All people and posts are fictional. Review independently BEFORE opening the draft key or model results.",
                 "A supported match is 1; a supported mismatch is 0; insufficient evidence is unknown.",
                 "Missing preferences, missing posts, and missing feedback do not mean dislike.",
                 "For each case, record positive / negative / unknown, reviewer, rubric, and a reason in the companion JSONL.",
                 "Nothing is marked human-reviewed by exporting or opening this packet.", ""]
        with (out / f"review-{name}.jsonl").open("x") as stream:
            for i, pair in enumerate(pairs, 1):
                viewer = profiles[pair["viewer_profile_version_id"]]
                candidate = profiles[pair["candidate_profile_version_id"]]
                history = [{"feedback": feedback[ref],
                            "earlier_partner": profiles[feedback[ref]["candidate_profile_version_id"]]}
                           for ref in pair["prior_feedback_ids"]]
                row = {"review_number": i, "example_id": pair["example_id"], "dataset_sha256": dataset_hash,
                       "context": pair["context"], "viewer": viewer, "candidate": candidate,
                       "history": history, "decision": None, "reviewer": None, "reviewed_at": None,
                       "rubric": dict.fromkeys(pair["label"]["rubric"]), "reason": None}
                stream.write(json.dumps(row) + "\n")
                keys[pair["example_id"]] = pair["label"]
                lines += [f"## Case {i}", "", f"ID: `{pair['example_id']}`",
                          f"Mode: {pair['context']['mode']}. Goal: {pair['context']['goal']}", ""]
                for title, profile in (("Viewer", viewer), ("Candidate", candidate)):
                    lines += [f"### {title}", f"Current goal: {profile['current_goal']}",
                              "Open to: " + "; ".join(profile["open_to_discussing"]),
                              "Conversation preferences: " + ("; ".join(profile["conversation_preferences"]) or "Not provided")]
                    for item in profile["facts"]:
                        sources = ", ".join(e["source_type"] for e in item["evidence"])
                        lines.append(f"- {item['relationship']} / {item['topic']} ({sources}): {item['details']}")
                    lines.append("")
                lines += ["### Earlier Feedback"]
                if not history:
                    lines.append("None. This is not a negative rating.")
                for item in history:
                    old = item["earlier_partner"]
                    h = item["feedback"]
                    lines += [f"- Context: {h['context']}",
                              "  Partner's facts: " + "; ".join(f["details"] for f in old["facts"]),
                              "  Partner's style: " + "; ".join(old["conversation_preferences"]),
                              f"  Explicit outcomes: {json.dumps(h['outcomes'])}"]
                lines += ["", "Decision: ______  Reason: ______", ""]
        with (out / f"review-{name}.md").open("x") as stream:
            stream.write("\n".join(lines))
    write_json(out / "draft-answer-key.json", keys)
    write_json(out / "review-manifest.json", {"dataset_sha256": dataset_hash,
        "packet_sizes": {key: len(value) for key, value in packet_sets.items()},
        "reviewed_by_humans": False,
        "policy": "Challenge fixed before training; no test-based threshold or epoch selection. Same assistant authored training and challenge assumptions. Human review is still required."})

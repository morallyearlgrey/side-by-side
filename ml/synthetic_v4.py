"""Fresh draft scenarios plus a separately identified replay of three known failures."""

import argparse
import copy
from collections import Counter
from pathlib import Path

from .dataset_builder import DatasetBuilder, add_history_family, fact
from .synthetic_v3 import generate as generate_v3
from .validation import require, validate_bundle, write_json

DOMAINS = (
    ("zipper", "backpack zipper repair", "replacing a backpack zipper",
     "I have replaced a backpack zipper.",
     "I removed the broken zipper from my backpack and sewed a replacement zipper into it.",
     "I plan to replace my backpack zipper next month; I have never replaced one."),
    ("negatives", "film scanning", "scanning 35mm film negatives",
     "I have scanned 35mm film negatives.",
     "I scanned two rolls of my 35mm film negatives and adjusted the resulting digital images.",
     "I want to scan my 35mm film negatives, but I have never scanned film."),
    ("planter", "balcony gardening", "building a balcony planter",
     "I have built a balcony planter.",
     "I built a wooden planter for my balcony and filled it with soil for herbs.",
     "I hope to build a balcony planter, but I have not built one yet."),
)


def contract(claim=None, subject="candidate"):
    return {"version": 1, "kind": "firsthand" if claim else "none",
            "subject": subject if claim else None, "claim": claim, "confirmation": "confirmed"}


def generate():
    b = DatasetBuilder("sidebyside-evidence-v4-eval-01", 20260926)
    b.manifest.update(purpose="Frozen-policy evaluation only; no training or threshold selection",
                      limitation="Assistant-authored synthetic draft judgments with shared templates. "
                      "Fresh domains were authored after v4 development; they are not independent human validation. "
                      "Known v3 failures are a separate development-regression cohort.")
    for slug, topic, activity, claim, experience, future in DOMAINS:
        group = "v4_" + slug
        request = f"I want firsthand advice from someone with personal experience {activity}."
        together = f"Find another beginner to try {activity} together; no prior experience is necessary."
        offer = f"Share my experience {activity} with a beginner who welcomes advice."
        willing = fact(topic, "can_share", f"I welcome questions about {activity}.")

        def person(key, facts, goal=offer, openness=None):
            return b.profile(group, "test", key, facts, goal, [topic] if openness is None else openness)

        viewer = person("viewer", [fact(topic, "wants_to_try", future)], request)
        novice = person("novice", [fact(topic, "wants_to_try", future)], together)
        expert = person("expert", [fact(topic, "experienced", experience), willing])
        social = person("social", [fact(topic, "interested", f"I enjoy {topic}."), willing,
                                   fact(topic, "experienced", experience, "post")])
        noise = person("noise", [fact(topic, "experienced", experience), willing,
                                 fact("music", "experienced", "I attended a jazz concert last weekend.", "post")])
        broad = person("broad", [fact(topic, "experienced", f"I visited an exhibition about {topic}."), willing])
        unrelated_detail = "I baked sourdough bread last week."
        unrelated = person("unrelated", [fact("bread baking", "experienced", unrelated_detail)],
                           "I want to discuss bread baking only.", ["Bread baking"])
        declined = person("declined", [fact(topic, "experienced", experience)],
                          f"I do not want to give advice about {activity} today. I only want to discuss cafes.",
                          ["Local cafes, not project advice"])
        missing = person("missing", [], request)

        # Deliberately flawed extraction fixtures: approval of a normalized fact
        # must not turn a future plan or third-party quote into personal evidence.
        def extraction_case(key, normalized_detail, full_source):
            p = person(key, [fact(topic, "experienced", normalized_detail), willing])
            p["onboarding_answers"][0]["answer_text"] = full_source
            p["facts"][0]["evidence"][0]["support"] = full_source
            return p

        planned = extraction_case("planned", claim, future)
        attributed = extraction_case("attributed", claim,
                                     f'My friend told me, "{experience}" That was my friend, not me; {future}')
        contradicted = extraction_case("contradicted", claim,
                                       f"My earlier claim was wrong. {future}")
        extra = extraction_case("unapproved_extra", unrelated_detail,
                                f"{unrelated_detail} {experience}")
        extra["facts"][0]["topic"] = "bread baking"

        def pair(a, c, mode, goal, label, category, requirement):
            reasons = {1: "Draft: specific request, approved evidence, and stated willingness align.",
                       0: "Draft: explicit topic or current intent conflicts with this request.",
                       None: "Draft: the requested personal experience is not established by eligible evidence."}
            ref = b.pair(a, c, mode, goal, label, reasons[label], category)
            b.bundle["training_pairs"][-1]["context"]["evidence_requirement"] = copy.deepcopy(requirement)
            b.cases[ref]["cohort"] = "fresh_synthetic"

        for candidate, label, category in (
            (expert, 1, "supported_onboarding"), (novice, None, "missing_firsthand"),
            (broad, None, "broad_topic_only"), (planned, None, "future_not_experience"),
            (attributed, None, "third_party_not_self"), (contradicted, None, "unsupported_normalization"),
            (extra, None, "unapproved_extra_in_source"), (social, 1, "supported_owned_post"),
            (noise, 1, "irrelevant_post_invariance"), (unrelated, 0, "unrelated_topic"),
            (declined, 0, "current_intent_conflict"), (missing, None, "missing_onboarding"),
        ):
            pair(viewer, candidate, "learn", request, label, category, contract(claim))
        pair(viewer, novice, "find_activity_partner", together, 1, "beginner_companionship", contract())
        pair(expert, novice, "share", offer, 1, "reverse_sharing", contract(claim, "viewer"))

        start = len(b.bundle["training_pairs"])
        add_history_family(b, group, "test", topic, experience,
                           [f"Short practical rounds trying {activity} together",
                            f"A structured theory lecture about {topic} before any practice"])
        for p in b.bundle["training_pairs"][start:]:
            p["context"]["evidence_requirement"] = contract()
            b.cases[p["example_id"]]["cohort"] = "fresh_synthetic"

    old, manifest, cases = generate_v3()
    # Explicit, request-authored regression contracts; never inferred from labels
    # during scoring. These three cases are not called fresh or held out.
    regression_claims = {
        "v3_quilting_pair_0182": "I have joined fabric blocks with aligned corners.",
        "v3_astro_pair_0202": "I have taken sharp telescope pictures of the moon.",
        "v3_stopwatch_pair_0222": "I have recognized a last-layer cube pattern without pausing.",
    }
    endpoints = set()
    for p in old["training_pairs"]:
        if p["example_id"] in regression_claims:
            p["context"]["evidence_requirement"] = contract(regression_claims[p["example_id"]])
            b.bundle["training_pairs"].append(p)
            endpoints.update((p["viewer_profile_version_id"], p["candidate_profile_version_id"]))
            b.cases[p["example_id"]] = {**cases[p["example_id"]], "cohort": "known_v3_regression"}
    for p in old["profiles"]:
        if p["profile_version_id"] in endpoints:
            b.bundle["profiles"].append(p)
            group = manifest["user_groups"][p["user_id"]]
            b.manifest["user_groups"][p["user_id"]] = group
            b.manifest["group_splits"][group] = "test"
    validate_bundle(b.bundle)
    return b.bundle, b.manifest, b.cases


def export(out):
    require(not out.exists(), "Dataset path already exists; preserve frozen evaluation inputs")
    bundle, manifest, cases = generate()
    coverage = {"pairs": len(bundle["training_pairs"]), "human_reviewed": False,
                "labels": dict(Counter(str(p["label"]["relevant_connection"]) for p in bundle["training_pairs"])),
                "categories": dict(Counter(c["case"] for c in cases.values())),
                "cohorts": dict(Counter(c["cohort"] for c in cases.values())),
                "limitation": manifest["limitation"]}
    out.mkdir(parents=True)
    for name, value in (("dataset", bundle), ("manifest", manifest), ("cases", cases), ("coverage", coverage)):
        write_json(out / (name + ".json"), value)
    print(f"Generated {coverage['pairs']} synthetic evaluation pairs at {out}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    export(parser.parse_args().out)

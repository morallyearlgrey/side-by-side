"""Generate an explicitly synthetic engineering pilot, not human outcome data."""

import argparse
import json
import random
from pathlib import Path

from .splits import partition_pairs
from .validation import validate_bundle, write_json

# Each whole scenario family stays in one split, including historical partners.
# Sentence templates are shared across families: this is NOT a template-disjoint benchmark.
SCENARIOS = (
    ("italy", "budget Italy travel", "plan an Italy trip using hostels and regional trains",
     "planned Rome and Bologna hostel stays, bought regional train tickets, and tracked daily spending",
     "everyday local life and regional food", "luxury resort loyalty programs"),
    ("pedals", "DIY guitar effects", "build a low-cost fuzz pedal and debug solder joints",
     "assembled a silicon fuzz circuit and fixed a noisy ground connection with a multimeter",
     "understanding how circuits shape guitar tone", "collecting expensive vintage guitars without electronics work"),
    ("bread", "small-kitchen sourdough", "bake a reliable sourdough loaf with a tiny oven",
     "adjusted starter feeding and fermentation timing to bake in a small apartment oven",
     "sharing homemade food with friends", "restaurant pastry business strategy"),
    ("bikes", "city bicycle maintenance", "patch a bicycle tube and adjust mechanical brakes",
     "patched punctures and aligned brake pads on a daily commuter bicycle",
     "repairing things independently and making commuting affordable", "professional cycling race statistics"),
    ("film", "home film photography", "develop black-and-white film on a student budget",
     "processed black-and-white rolls in a bathroom tank and corrected uneven development",
     "capturing ordinary neighborhood moments", "collecting rare cameras as financial investments"),
    ("garden", "balcony vegetable gardening", "grow herbs in containers on a shady balcony",
     "grew basil and parsley in containers and adjusted watering for a shaded balcony",
     "cooking with ingredients grown at home", "large commercial greenhouse logistics"),
    ("climb", "beginner indoor bouldering", "learn foot placement on easy indoor bouldering routes",
     "practiced quiet foot placements and repeated beginner indoor routes with climbing partners",
     "enjoying movement and solving physical puzzles", "watching elite outdoor climbing documentaries only"),
    ("language", "conversational Japanese practice", "practice ordering food in Japanese without memorized scripts",
     "used Japanese in cafes and practiced unscripted ordering conversations with language partners",
     "connecting through everyday conversation", "historical Japanese writing systems without speaking practice"),
    ("stars", "beginner backyard astronomy", "find bright constellations using borrowed binoculars",
     "identified Orion and the Pleiades with binoculars and planned around local light pollution",
     "sharing a quiet outdoor activity with friends", "space telescope funding policy debates"),
    ("sewing", "repairing thrifted clothes", "hem secondhand trousers using basic hand stitches",
     "shortened thrifted trousers and reinforced seams with hand stitches",
     "keeping useful clothes out of waste", "luxury runway brand marketing"),
    ("coffee", "affordable home filter coffee", "dial in a hand grinder for balanced pour-over coffee",
     "adjusted grind size, water temperature, and pouring speed for an inexpensive dripper",
     "enjoying an everyday ritual without costly equipment", "commercial cafe franchise expansion"),
    ("games", "cooperative tabletop game design", "prototype a cooperative card game with paper cards",
     "playtested paper card rules and rebalanced how players share limited actions",
     "making welcoming games friends can play together", "collectible card resale pricing"),
    ("kayak", "beginner lake kayaking", "plan an easy supervised lake kayaking outing",
     "joined guided beginner lake outings and compared rental options and group planning",
     "spending gentle outdoor time with friends", "competitive whitewater race commentary"),
    ("audio", "bedroom music recording", "record clear acoustic guitar with one inexpensive microphone",
     "tested microphone placement and reduced room reflections using household furnishings",
     "sharing original music without a studio budget", "music streaming business revenue analysis"),
    ("pottery", "community studio pottery", "make a simple hand-built mug at a community studio",
     "built coil mugs, attached handles, and asked studio staff about shared kiln schedules",
     "making everyday objects by hand alongside other beginners", "auction prices of antique porcelain"),
)


def generate(seed=42):
    rng = random.Random(seed)
    families = [row[0] for row in SCENARIOS]
    rng.shuffle(families)
    assignments = {family: "train" if i < 9 else "validation" if i < 12 else "test"
                   for i, family in enumerate(families)}
    bundle = {"schema_version": 2, "dataset_id": f"synthetic_engineering_pilot_{seed}",
              "training_basis": "synthetic_only", "profiles": [], "posts": [], "feedback": [], "training_pairs": []}
    manifest = {"version": 1, "dataset_id": bundle["dataset_id"], "seed": seed,
                "user_groups": {}, "group_splits": assignments,
                "limitation": "People and scenario families are disjoint; sentence templates are shared."}

    for family, topic, goal, experience, motivation, contrast in SCENARIOS:
        def profile(kind, role, details, intent, style, post=False):
            user = f"{family}_{kind}"
            statement = details + ". My motivation is " + motivation + "."
            answer = {"answer_id": user + "_answer", "question_key": "interests",
                      "question_text": "What specifically interests you, and why?",
                      "answer_text": statement, "answered_at": "2026-09-20T08:00:00Z"}
            fact = {"fact_id": user + "_fact", "topic": topic, "relationship": role,
                    "details": details, "motivation": motivation,
                    "evidence": [{"source_type": "onboarding_answer", "reference_id": answer["answer_id"],
                                  "channel": "self_report", "support": statement}],
                    "confirmation": "confirmed", "matching_allowed": True,
                    "sharing_scope": "after_mutual_consent"}
            answers = [answer]
            if post:
                # Experience is only in the caption, so the onboarding ablation really removes it.
                answer["answer_text"] = f"I am interested in {topic}. My motivation is {motivation}."
                post_id = user + "_post"
                bundle["posts"].append({"post_id": post_id, "owner_user_id": user, "data_origin": "synthetic",
                                        "posted_at": "2026-09-19T08:00:00Z", "available_at": "2026-09-20T07:00:00Z",
                                        "caption": statement, "image_ref": None})
                fact["evidence"] = [{"source_type": "owned_post", "reference_id": post_id,
                                     "channel": "caption", "support": statement}]
            openness = f"I am open to conversations about {topic}. {intent}"
            answers.extend([
                {"answer_id": user + "_goal", "question_key": "goals", "question_text": "What conversation do you want?",
                 "answer_text": intent, "answered_at": "2026-09-20T08:01:00Z"},
                {"answer_id": user + "_open", "question_key": "open_topics", "question_text": "What are you open to discussing?",
                 "answer_text": openness, "answered_at": "2026-09-20T08:02:00Z"},
                {"answer_id": user + "_style", "question_key": "conversation_style", "question_text": "What style do you enjoy?",
                 "answer_text": style, "answered_at": "2026-09-20T08:03:00Z"}])
            facts = [fact]
            if role == "experienced":
                facts.append({**fact, "fact_id": user + "_willing", "relationship": "can_share",
                              "details": "I welcome beginner questions and enjoy sharing what I learned.",
                              "motivation": None,
                              "evidence": [{"source_type": "onboarding_answer", "reference_id": user + "_open",
                                            "channel": "self_report", "support": openness}]})
                answers[-2]["answer_text"] += " I welcome beginner questions and enjoy sharing what I learned."
                facts[-1]["evidence"][0]["support"] = "I welcome beginner questions and enjoy sharing what I learned."
            result = {"profile_version_id": user + "_v1", "user_id": user, "data_origin": "synthetic",
                      "valid_from": "2026-09-20T09:00:00Z", "onboarding_answers": answers,
                      "current_goal": intent, "conversation_intent": intent, "facts": facts,
                      "open_to_discussing": [topic, intent], "conversation_preferences": [style], "avoid_topics": []}
            bundle["profiles"].append(result)
            manifest["user_groups"][user] = family
            return result

        learner = profile("learner", "wants_to_try", f"I want to {goal}",
                          f"I want firsthand practical advice to {goal}; I also enjoy learning alongside beginners.",
                          "Concrete examples, patient explanations, and hands-on activities")
        mentor = profile("mentor", "experienced", f"I have {experience}",
                         f"Share lessons from {topic} and answer beginner questions.", "Practical examples and patient discussion", post=True)
        mentor2 = profile("mentor2", "experienced", f"I have {experience}",
                          f"Share lessons from {topic} and answer beginner questions.", "Practical examples and patient discussion")
        peer = profile("peer", "learning", f"I am beginning to {goal} and have not done it yet",
                       f"Find another beginner to learn how to {goal} together.", "Friendly collaborative practice")
        partner = profile("partner", "interested", f"I would enjoy trying to {goal} with someone",
                          f"Find company for beginner activities related to {topic}.", "Low-pressure shared activities")
        mismatch = profile("other_focus", "interested", f"I only want to discuss {contrast} today",
                           f"I only want a conversation about {contrast}, not practical beginner advice or activities.",
                           "Detailed analysis of my chosen subject")
        # Correct the topic and motivation instead of inventing a preference from the broad domain.
        mismatch["facts"][0]["topic"] = contrast
        mismatch["facts"][0]["motivation"] = None
        mismatch["onboarding_answers"][0]["answer_text"] = mismatch["facts"][0]["details"]
        mismatch["facts"][0]["evidence"][0]["support"] = mismatch["facts"][0]["details"]
        mismatch["open_to_discussing"] = [contrast]
        mismatch["onboarding_answers"][2]["answer_text"] = "I am open to discussing " + contrast
        practical = profile("past_practical", "experienced", f"I have {experience}",
                            f"Teach practical beginner skills for {topic}.", "Concrete examples and patient hands-on explanations")
        theory = profile("past_theory", "interested", f"I enjoy the theory surrounding {topic}",
                         f"Discuss abstract theory about {topic}.", "Long theoretical lectures without practical examples")
        history_ids = []
        for old, useful in ((practical, True), (theory, False)):
            ref = old["user_id"] + "_feedback"
            history_ids.append(ref)
            bundle["feedback"].append({"feedback_id": ref, "data_origin": "synthetic",
                "viewer_profile_version_id": learner["profile_version_id"], "candidate_profile_version_id": old["profile_version_id"],
                "observed_at": "2026-09-23T12:00:00Z", "context": f"Find practical advice to {goal}",
                "outcomes": {"connection_accepted": True, "conversation_useful": useful, "would_talk_again": None},
                "explicit_comment": "The examples helped." if useful else "I wanted practical examples instead of an abstract lecture."})

        def pair(viewer, candidate, mode, context, label, reason):
            rubric = {"topic_fit": "yes", "intent_fit": "yes", "specific_bridge": "yes", "evidence_sufficient": "yes"}
            if label == 0:
                rubric.update(intent_fit="no", specific_bridge="no")
            if label is None:
                rubric.update(intent_fit="unknown", specific_bridge="unknown", evidence_sufficient="unknown")
            bundle["training_pairs"].append({"example_id": f"{family}_pair_{len(bundle['training_pairs']):04d}",
                "data_origin": "synthetic", "as_of": "2026-09-25T12:00:00Z",
                "viewer_profile_version_id": viewer["profile_version_id"], "candidate_profile_version_id": candidate["profile_version_id"],
                "prior_feedback_ids": history_ids if viewer is learner else [],
                "context": {"mode": mode, "goal": context},
                "label": {"relevant_connection": label, "source": "synthetic_draft", "human_reviewed": False,
                          "rubric": rubric, "reason": reason}})

        advice = f"Find firsthand practical advice to {goal}"
        together = f"Find another beginner to practice how to {goal} together"
        for expert in (mentor, mentor2):
            pair(learner, expert, "learn", advice, 1, "Specific stated experience and willingness address the learner's current goal.")
            pair(expert, learner, "share", expert["current_goal"], 1, "The viewer wants to share; the candidate explicitly welcomes beginner advice.")
            pair(expert, mismatch, "share", expert["current_goal"], 0, "The candidate explicitly wants a different conversation today.")
        for novice in (peer, partner):
            pair(learner, novice, "learn", advice, None, "Interest or aspiration does not establish the firsthand experience requested.")
            pair(learner, novice, "find_activity_partner", together, 1, "Both explicitly welcome learning or trying a specific activity with company.")
            pair(novice, learner, "find_activity_partner", together, 1, "The learner also explicitly welcomes learning alongside beginners.")
            pair(novice, mismatch, "find_activity_partner", together, 0, "The candidate explicitly seeks a different conversation, not beginner activities.")
        pair(learner, mismatch, "learn", advice, 0, "The candidate's explicit present intent excludes the requested practical discussion.")
        pair(mismatch, learner, "exchange_stories", mismatch["current_goal"], 0, "The learner's declared current goal differs from the viewer's narrowly specified conversation.")
        pair(peer, partner, "collaborate", together, 1, "Two beginners want company to try the same specific activity.")
        pair(partner, peer, "collaborate", together, 1, "Shared beginner activity is appropriate without claiming either is an expert.")

    validate_bundle(bundle)
    partition_pairs(bundle, manifest)
    return bundle, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    bundle, manifest = generate(args.seed)
    args.out.mkdir(parents=True, exist_ok=False)
    write_json(args.out / "dataset.json", bundle)
    write_json(args.out / "splits.json", manifest)
    profiles = {p["profile_version_id"]: p for p in bundle["profiles"]}
    # Review all examples in a sidecar; reviewing does not silently change dataset labels.
    with (args.out / "review.jsonl").open("x") as stream:
        for pair in bundle["training_pairs"]:
            row = {"example_id": pair["example_id"], "context": pair["context"],
                   "viewer": profiles[pair["viewer_profile_version_id"]],
                   "candidate": profiles[pair["candidate_profile_version_id"]],
                   "draft_label": pair["label"], "reviewer": None, "reviewed_label": None, "review_notes": None}
            stream.write(json.dumps(row) + "\n")
    print(f"Created {len(bundle['profiles'])} fictional profiles and {len(bundle['training_pairs'])} draft pairs.")
    print("Engineering pilot only. Review the labels; do not claim real-world accuracy from this data.")


if __name__ == "__main__":
    main()

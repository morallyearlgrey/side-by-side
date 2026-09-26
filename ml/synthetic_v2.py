"""Broader synthetic coverage plus a frozen, separately worded review challenge.

This is still assistant-authored draft data, not human-reviewed ground truth.
The original v1 generator and its artifacts are deliberately left intact.
"""

import argparse
import random
from pathlib import Path

from .challenge_v2 import add_challenge
from .dataset_builder import DatasetBuilder, add_history_family, fact
from .review_packet import write_packets
from .splits import partition_pairs
from .synthetic import SCENARIOS
from .validation import validate_bundle, write_json


VALIDATION_SCENARIOS = (
    ("maps", "volunteer neighborhood mapping", "map missing curb ramps with an open mapping app",
     "surveyed street corners and uploaded curb-ramp locations for a volunteer map",
     "making neighborhood information useful to other people", "historical map collecting"),
    ("print", "home linocut printing", "carve a two-color linocut and align the paper layers",
     "cut two lino blocks and used registration marks to line up two ink colors",
     "making handmade cards to exchange", "industrial packaging supply chains"),
    ("dance", "beginner social swing dance", "learn a basic swing-dance step with another beginner",
     "practiced beginner swing steps at a community social and helped partners count the beat",
     "having a friendly shared activity", "professional dance competition scoring"),
)

BACKGROUND = (
    ("urban sketching", "draw quick street scenes in a pocket notebook"),
    ("puzzle games", "solve cooperative logic puzzles with friends"),
    ("homemade noodles", "roll fresh pasta dough with a bottle instead of a machine"),
    ("running", "build up to a comfortable weekend five-kilometer run"),
    ("campus radio", "put together short playlists for a student radio show"),
    ("woodworking", "sand and finish a small wooden bookend"),
)

STYLE_PAIRS = (
    ("Concrete worked examples, followed by time to try the steps myself",
     "Big-picture theory and long exploratory discussion before any practical steps"),
    ("A patient back-and-forth with short questions and demonstrations",
     "A detailed uninterrupted explanation, with questions saved until the end"),
    ("Improvising together, experimenting, and comparing what happened",
     "Following an organized checklist and carefully planning before starting"),
)


def generate(seed=20260925, replicas=4):
    if replicas < 1:
        raise ValueError("replicas must be positive")
    rng = random.Random(seed)
    builder = DatasetBuilder(f"synthetic_coverage_v2_{seed}_r{replicas}", seed)

    for scenario in (*SCENARIOS, *VALIDATION_SCENARIOS):
        family, topic, activity, experience, motivation, contrast = scenario
        split = "train" if scenario in SCENARIOS else "validation"
        group = "coverage_" + family
        for replica in range(replicas):
            styles = STYLE_PAIRS[replica % len(STYLE_PAIRS)]

            def profile(key, specs, goal, openness):
                # Assign optional fields before pairs/labels, not as a consequence of a label.
                specs = list(specs)
                count = rng.choice((0, 1, 2, 4, 6))
                for i, (other_topic, other_activity) in enumerate(rng.sample(BACKGROUND, count)):
                    role = rng.choice(("interested", "experienced", "wants_to_try", "learning", "can_share"))
                    text = {"interested": f"Outside this topic, I enjoy conversations about how to {other_activity}.",
                            "experienced": f"I have learned how to {other_activity} through my own projects.",
                            "wants_to_try": f"Someday I would like to {other_activity}.",
                            "learning": f"I am currently learning to {other_activity}.",
                            "can_share": f"I welcome questions and can share how I {other_activity}."}[role]
                    specs.append(fact(other_topic, role, text))
                prefs = [] if rng.random() < 0.5 else [rng.choice(styles)]
                return builder.profile(group, split, f"r{replica}_{key}", specs, goal, openness, prefs)

            wish = (
                f"I want to {activity}. {motivation.capitalize()} matters to me.",
                f"My next small project: {activity}. I'd like to hear what actually worked for someone.",
                f"Could someone walk me through how they {activity}? I'm starting from the basics.",
                f"Trying to figure out how to {activity}; I care about {motivation}.",
            )[replica % 4]
            learner_role = rng.choice(("wants_to_try", "learning"))
            seeking = f"Get firsthand tips to {activity}, or find someone to practice alongside."
            seeker = profile("seeker", [fact(topic, learner_role, wish),
                fact(topic, "interested", f"I am interested in {topic}, especially {motivation}.")],
                seeking, [topic, f"Practical advice and company to {activity}"])

            mentor_specs = [fact(topic, "experienced", f"I {experience}.",
                                 "post" if replica % 2 else "answer"),
                            fact(topic, "can_share", f"Ask me about how I {experience}; I enjoy sharing the details."),
                            fact(topic, "interested", f"I enjoy {topic}, including {motivation}.")]
            mentor = profile("mentor", mentor_specs,
                f"Share practical lessons and stories about {topic}; beginners' questions are welcome.",
                [topic, "Beginner questions and firsthand stories"])
            collaborator = profile("collaborator", [fact(topic, "experienced", f"Last year I {experience}."),
                fact(topic, "can_share", f"I'd gladly work with a newcomer who wants to {activity}.")],
                f"Work with someone on a small {topic} project and trade practical ideas.", [topic, "Working together"])
            peer = profile("peer", [fact(topic, "learning", f"I am just beginning to {activity}; I have no firsthand results yet."),
                fact(topic, "interested", f"I like {topic} and {motivation}.")],
                f"Find another beginner to {activity} with; learning together sounds good.",
                [topic, "Beginner advice and practicing together"])
            # Real topic overlap and experience, but a different explicitly chosen conversation.
            specialist = profile("specialist", [fact(topic, "experienced", f"I {experience}.",
                                                   "post" if replica % 2 == 0 else "answer"),
                fact(contrast, "interested", f"My current focus is {contrast}."),
                fact(contrast, "can_share", f"I welcome questions about {contrast}.")],
                f"Today I'd like to discuss {contrast}. I am taking a break from hands-on help and beginner activities.",
                [contrast])
            unrelated = profile("unrelated", [fact(contrast, "interested", f"I follow {contrast} closely."),
                fact(contrast, "experienced", f"I have put together a discussion group focused on {contrast}.")],
                f"Join a detailed conversation about {contrast} today.", [contrast])
            storyteller = profile("storyteller", [fact(topic, "experienced", f"I {experience}; it was memorable."),
                fact(topic, "interested", f"I am curious about other people's experiences with {topic}.")],
                f"Swap firsthand stories about {topic}, including surprises and mistakes.", [topic, "Firsthand stories"])
            fan = profile("fan", [fact(topic, "interested", f"I like hearing about {topic} and {motivation}.")],
                f"Have a relaxed conversation about {topic}; I am happy to hear beginner questions or stories.", [topic])

            advice = f"Hear firsthand practical advice on how to {activity}"
            together = f"Find company to learn how to {activity} together"
            history = []
            if replica % 2:
                # Null outcomes and unrelated feedback must not turn into negative labels.
                history.append(builder.feedback(seeker, storyteller, f"Swap stories about {topic}", True, None))
                history.append(builder.feedback(seeker, unrelated, f"Discuss {contrast}", None, None, accepted=False))

            def pair(a, b, mode, goal, label, case, reason):
                return builder.pair(a, b, mode, goal, label, reason, case, history if a is seeker else [])

            pair(seeker, mentor, "learn", advice, 1, "experience_aspiration",
                 "Specific firsthand experience and explicit willingness address the requested advice.")
            pair(seeker, collaborator, "learn", advice, 1, "experience_aspiration",
                 "The candidate has relevant experience and explicitly welcomes working with newcomers.")
            pair(seeker, specialist, "learn", advice, 0, "same_topic_different_intent",
                 "Experience overlaps, but today's stated discussion excludes hands-on beginner help.")
            pair(seeker, unrelated, "learn", advice, 0, "different_current_goal",
                 "The candidate explicitly seeks a different conversation today.")
            pair(seeker, peer, "learn", advice, None, "unknown_experience",
                 "Two beginners can learn together, but interest is not evidence of the requested firsthand results.")
            pair(mentor, seeker, "share", mentor["current_goal"], 1, "reverse_willingness",
                 "The viewer wants to share practical experience and the candidate welcomes this advice.")
            pair(mentor, specialist, "share", mentor["current_goal"], 0, "same_topic_different_intent",
                 "The candidate's current chosen discussion differs from the offered practical lessons.")
            pair(mentor, unrelated, "share", mentor["current_goal"], 0, "different_current_goal",
                 "The candidate explicitly seeks a different conversation, not this practical topic.")
            pair(seeker, peer, "find_activity_partner", together, 1, "beginner_companionship",
                 "Both explicitly welcome practicing this activity with another beginner.")
            pair(peer, seeker, "find_activity_partner", together, 1, "beginner_companionship",
                 "The candidate explicitly welcomes company for the same beginner activity.")
            pair(peer, specialist, "find_activity_partner", together, 0, "same_topic_different_intent",
                 "The candidate is explicitly taking a break from beginner activities.")
            pair(peer, collaborator, "collaborate", together, 1, "complementary_roles",
                 "The experienced candidate wants to work with a newcomer on this activity.")
            pair(collaborator, specialist, "collaborate", together, 0, "same_topic_different_intent",
                 "A shared broad topic does not override the candidate's different current intention.")
            pair(storyteller, mentor, "exchange_stories", storyteller["current_goal"], 1, "shared_experience",
                 "Both have relevant firsthand experiences and explicitly welcome stories.")
            pair(mentor, storyteller, "exchange_stories", storyteller["current_goal"], 1, "shared_experience",
                 "Both want to exchange experiences on the same specific subject.")
            pair(storyteller, specialist, "exchange_stories", storyteller["current_goal"], 0, "same_topic_different_intent",
                 "The candidate explicitly chooses a different specialist discussion today rather than these practical stories.")
            pair(fan, storyteller, "casual_chat", fan["current_goal"], 1, "interest_to_experience",
                 "An interested listener and a willing storyteller have an explicit conversation bridge.")
            pair(fan, specialist, "casual_chat", fan["current_goal"], 0, "same_topic_different_intent",
                 "The candidate currently chooses a narrower different discussion.")
            pair(fan, peer, "learn", advice, None, "unknown_experience",
                 "A learner has not established the requested firsthand experience.")

        add_history_family(builder, group, split, topic, f"I {experience}.", STYLE_PAIRS[rng.randrange(3)])

    add_challenge(builder)
    validate_bundle(builder.bundle)
    partition_pairs(builder.bundle, builder.manifest)
    return builder.bundle, builder.manifest, builder.cases


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=20260925)
    parser.add_argument("--replicas", type=int, default=4)
    args = parser.parse_args()
    bundle, manifest, cases = generate(args.seed, args.replicas)
    args.out.mkdir(parents=True, exist_ok=False)
    write_json(args.out / "dataset.json", bundle)
    write_json(args.out / "splits.json", manifest)
    write_json(args.out / "cases.json", cases)
    write_packets(bundle, manifest, cases, args.out)
    print(f"Created {len(bundle['profiles'])} synthetic profiles and {len(bundle['training_pairs'])} draft pairs.")
    print("Review packets hide draft labels. No records have been marked human-reviewed.")


if __name__ == "__main__":
    main()

"""New fictional domains for automated development; never human-reviewed labels."""

import argparse
from collections import Counter
from pathlib import Path

from .dataset_builder import DatasetBuilder, add_history_family, fact
from .splits import partition_pairs
from .validation import require, validate_bundle, write_json

# Families, including historical partners, stay wholly within one split.
# Wording and author assumptions remain shared: this is not independent validation.
DOMAINS = [
    ("train", "espresso", "espresso dialing", "balancing sour espresso shots",
     "I compared grind settings and shot times until the sharp sourness became balanced.",
     "My espresso tastes sour and I have not yet found settings that fix it.",
     "collecting ceramic cups", "I collect handmade cups but have never adjusted an espresso machine."),
    ("train", "cyanotype", "cyanotype printing", "getting distinct leaf silhouettes",
     "I exposed leaves on coated paper at several durations and found a timing that preserved the edges.",
     "I bought coated paper but my first leaf outlines are blurred.",
     "the history of blue pigments", "I read about blue pigments, not photographic printing methods."),
    ("train", "sketching", "urban sketching", "drawing convincing street perspective",
     "I practiced drawing one street from three corners and corrected converging window lines.",
     "I sketch shop fronts but their windows seem tilted in incompatible directions.",
     "collecting city postcards", "I collect postcards of buildings without drawing them."),
    ("train", "miniatures", "miniature painting", "painting tiny faces without obscuring detail",
     "I painted twelve miniature faces using thin layers and kept the sculpted eyes visible.",
     "I have primed my first miniature but have not painted a face.",
     "competitive game strategy", "I discuss tabletop tactics, not painting or making miniatures."),
    ("train", "synth", "modular synthesizers", "recording a repeatable bass patch",
     "I documented a bass patch's cable routes and knob positions and rebuilt its sound the next day.",
     "I can make interesting noises but cannot recreate yesterday's bass sound.",
     "concert ticket collecting", "I keep concert tickets but have no experience programming synth sounds."),
    ("train", "plants", "plant propagation", "rooting pothos cuttings in water",
     "I rooted three pothos cuttings in water and recorded when new roots appeared.",
     "I want to try a pothos cutting but have not rooted one yet.",
     "botanical illustration", "I draw leaves for greeting cards but do not grow plants."),
    ("validation", "bookbinding", "bookbinding", "sewing a notebook that opens flat",
     "I sewed a notebook with exposed spine stitching and checked that the pages opened flat.",
     "My folded pages are ready but I have never sewn a notebook.",
     "collecting rare novels", "I collect novels for their stories, not binding construction."),
    ("validation", "ceramics", "ceramics", "recording glaze combinations on test tiles",
     "I labeled and fired a set of glaze test tiles and compared the layered colors.",
     "I have blank tiles and glaze jars but no finished comparison samples.",
     "museum pottery history", "I read about ancient pottery but have not glazed or fired anything."),
    ("validation", "bass", "bass guitar practice", "keeping a steady syncopated bass rhythm",
     "I recorded slow metronome practice and gradually made the offbeat bass notes land consistently.",
     "I can play the notes but lose the pulse on offbeats.",
     "vintage instrument collecting", "I collect instrument catalogs, not practice techniques."),
    ("test", "quilting", "quilting", "joining fabric blocks with aligned corners",
     "I finished a small quilt and adjusted seam allowances until its block corners met.",
     "I have cut squares but my first joined corners do not meet.",
     "textile trade history", "I research textile trade routes but have never stitched a quilt."),
    ("test", "astro", "lunar photography", "taking sharp telescope pictures of the moon",
     "I photographed the moon through a telescope and compared focus positions to resolve crater edges.",
     "I own a phone adapter but all my moon photos are blurry.",
     "space opera writing", "I write fictional moon colonies, not telescope or camera techniques."),
    ("test", "stopwatch", "speedcubing", "recognizing a last-layer pattern without pausing",
     "I filmed slow cube solves and practiced recognizing the last-layer patterns before turning.",
     "I can finish a cube slowly but pause to identify every last-layer pattern.",
     "puzzle box collecting", "I collect decorative puzzle boxes but do not practice cube solving."),
]


def generate():
    b = DatasetBuilder("sidebyside-source-aware-v3", 20260926)
    b.manifest["limitation"] = (
        "Assistant-authored synthetic draft labels. Disjoint people and topic families, but shared "
        "construction templates and author assumptions across train/validation/test. No human "
        "review, observed conversation outcomes, or independent external validation."
    )
    for split, slug, topic, project, experience, novice_text, other, other_text in DOMAINS:
        group = "v3_" + slug
        request = f"I need firsthand advice on {project}, not just general encouragement."
        activity = f"Find another beginner to experiment together with {project}; neither of us needs to be an expert."
        offer = f"Share what I learned about {project} with someone who welcomes beginner advice."
        openness = [f"Discussing {project}", f"Trying {topic} together"]

        def person(key, facts, goal, prefs=(), open_topics=None):
            return b.profile(group, split, key, facts, goal,
                             openness if open_topics is None else open_topics, prefs)

        viewer = person("learner", [fact(topic, "learning", novice_text)], request)
        novice = person("peer", [fact(topic, "wants_to_try", f"I am starting {project} and have not finished a successful attempt.")], activity)
        expert_facts = [fact(topic, "experienced", experience),
                        fact(topic, "can_share", f"I welcome questions about {project} and can explain my attempts.")]
        expert = person("maker", expert_facts, offer)
        unrelated = person("other", [fact(other, "experienced", other_text)], f"Talk only about {other}, not {project}.", open_topics=[other])
        missing = person("missing", [], request)
        social = person("social", [fact(topic, "interested", f"I enjoy {topic}."), expert_facts[1],
                                  fact(topic, "experienced", experience, "post")], offer)
        noise = person("noise", expert_facts + [fact("live music", "experienced", "I attended a small jazz concert last week.", "post")], offer)
        declined = person("declined", [fact(topic, "experienced", experience)],
                          f"I do not want to give advice or practice {project} today; I only want to chat about local cafes.",
                          open_topics=["Local cafes, not coaching or project advice"])

        def pair(a, c, mode, goal, label, case, history=()):
            reasons = {1: "Draft: stated activity, evidence, and openness support this specific direction.",
                       0: "Draft: stated topic, immediate intent, or requested format conflicts with this opportunity.",
                       None: "Draft: requested evidence is missing; do not assume experience or assign a negative label."}
            return b.pair(a, c, mode, goal, label, reasons[label], case, history)

        pair(viewer, expert, "learn", request, 1, "firsthand_help")
        pair(viewer, unrelated, "learn", request, 0, "specific_topic_mismatch")
        pair(viewer, novice, "learn", request, None, "firsthand_evidence_missing")
        pair(viewer, missing, "learn", request, None, "onboarding_missing")
        pair(novice, viewer, "find_activity_partner", activity, 1, "beginner_companionship")
        pair(viewer, novice, "find_activity_partner", activity, 1, "immediate_goal_overrides_broad_goal")
        pair(expert, novice, "share", offer, 1, "reverse_willingness")
        pair(viewer, social, "learn", request, 1, "social_experience_bridge")
        pair(social, novice, "share", offer, 1, "viewer_social_experience")
        pair(viewer, noise, "learn", request, 1, "irrelevant_post_invariance")
        pair(viewer, declined, "learn", request, 0, "current_intent_over_experience")
        pair(novice, unrelated, "find_activity_partner", activity, 0, "activity_topic_mismatch")

        styles = [f"Try {project} together in short rounds, comparing results as we go",
                  f"Discuss the theory of {topic} in a structured lecture before trying anything"]
        people = add_history_family(b, group, split, topic, experience, styles)
        hviewer, partner = people["viewer_a"], people["nowb"]
        neutral_goal = f"Chat about {topic}; I do not have a preferred format today."
        null_ref = b.feedback(hviewer, people["pastb"], neutral_goal, None, None, accepted=False)
        pair(hviewer, partner, "casual_chat", neutral_goal, 1, "null_feedback_not_dislike", [null_ref])
        unrelated_ref = b.feedback(hviewer, people["pastb"], "A lecture about commuter parking prices", False, False)
        pair(hviewer, partner, "casual_chat", f"Exchange experiences about {topic} without choosing a format.",
             1, "unrelated_history_not_dislike", [unrelated_ref])
        current = person("current_preferences", [fact(topic, "interested", f"I enjoy {topic}.")],
                         f"Today I specifically want a structured explanation of {topic} before any practical activity.", [styles[1]])
        old_ref = b.feedback(current, people["pasta"], f"Practice {project} together", True, True)
        pair(current, people["nowb"], "learn", current["current_goal"], 1, "current_preference_over_history", [old_ref])
        pair(current, people["nowa"], "learn", current["current_goal"], 0, "explicit_format_conflict", [old_ref])
    validate_bundle(b.bundle)
    partition_pairs(b.bundle, b.manifest)
    return b.bundle, b.manifest, b.cases


def export(out):
    require(not out.exists(), "Output directory already exists; choose a new dataset path")
    bundle, manifest, cases = generate()
    out.mkdir(parents=True)
    for name, value in (("dataset", bundle), ("splits", manifest), ("cases", cases)):
        write_json(out / (name + ".json"), value)
    coverage = {split: {"pairs": len(pairs),
                       "labels": dict(Counter(str(p["label"]["relevant_connection"]) for p in pairs)),
                       "cases": dict(Counter(cases[p["example_id"]]["case"] for p in pairs))}
                for split, pairs in partition_pairs(bundle, manifest).items()}
    write_json(out / "coverage.json", {"human_reviewed": False, "splits": coverage,
                                      "limitation": manifest["limitation"]})
    print(f"Generated {len(bundle['training_pairs'])} synthetic draft pairs at {out}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    export(parser.parse_args().out)


if __name__ == "__main__":
    main()

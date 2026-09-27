"""Bounded topic exclusions, not a general safety or intent classifier.

Only exact supported labels are interpreted. More nuanced boundaries abstain.
Whole optional claims are omitted; source answers and evidence are never rewritten.
"""

import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

CATALOG_BYTES = (Path(__file__).resolve().parents[3] / "shared/topic-boundaries.json").read_bytes()
CATALOG = json.loads(CATALOG_BYTES)


def normalized(value):
    return " ".join(re.findall(r"\w+", unicodedata.normalize("NFKC", value).casefold()))


@dataclass(frozen=True)
class TopicBoundaries:
    categories: tuple[str, ...]
    unresolved: bool = False

    def excludes(self, text):
        value = normalized(text)
        return any(re.search(r"\b" + re.escape(term.rstrip("*")) + (r"\w*\b" if term.endswith("*") else r"\b"), value)
                   for category in self.categories for term in CATALOG["categories"][category]["terms"])


def topic_boundaries(*profiles):
    aliases = {normalized(label): category for category, data in CATALOG["categories"].items()
               for label in data["labels"]}
    categories = set()
    for profile in profiles:
        for label in profile.get("avoid_topics", []):
            category = aliases.get(normalized(label))
            if category is None:
                return TopicBoundaries((), unresolved=True)
            categories.add(category)
    return TopicBoundaries(tuple(sorted(categories)))


def fact_text(fact):
    return " ".join(fact.get(key) or "" for key in ("topic", "details", "motivation"))


def scoped_profiles(viewer, candidate):
    """Return per-pair copies; never edit immutable versions or user settings."""
    boundaries = topic_boundaries(viewer, candidate)
    if boundaries.unresolved:
        return None, "boundary_review_required"
    result = []
    for profile in (viewer, candidate):
        answers = {str(a["answer_id"]): a["answer_text"] for a in profile.get("onboarding_answers", [])}
        request = profile.get("conversation_request") or {}
        requirement = request.get("evidence_requirement") or {}
        required = [profile.get("current_goal"), profile.get("conversation_intent"),
                    request.get("goal"), requirement.get("claim")]
        if any(boundaries.excludes(value) for value in required if value):
            return None, "topic_boundary_conflict"
        result.append({**profile,
            "facts": [fact for fact in profile["facts"] if not boundaries.excludes(fact_text(fact))
                      and not any(boundaries.excludes(answers.get(str(e["reference_id"]), ""))
                                  for e in fact.get("evidence", []))],
            "open_to_discussing": [t for t in profile["open_to_discussing"] if not boundaries.excludes(t)],
            "conversation_preferences": [t for t in profile["conversation_preferences"] if not boundaries.excludes(t)],
        })
    return result, None


class BoundaryAwareReranker:
    """Apply semantic exclusions as well as the conservative lexical projection."""

    def __init__(self, model, boundaries):
        self.model, self.boundaries = model, boundaries

    def score(self, query, document, *, instruction):
        if self.boundaries.categories:
            instruction += (
                " Both people exclude these conversation topics: "
                + json.dumps(self.boundaries.categories)
                + ". Return no if the proposed conversation depends on an excluded topic, including "
                  "synonyms or indirect references. A shared unrelated interest is not excluded merely "
                  "because a topic boundary exists. Do not infer personal beliefs from these exclusions."
            )
        return self.model.score(query, document, instruction=instruction)

"""Source-backed activity candidates; no provider-authored venue or schedule facts."""

import re
from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .jobs import now


class Activity(BaseModel):
    # PostgREST may also return server-maintained timestamps. Only these reviewed
    # fields may leave the service or participate in candidate selection.
    model_config = ConfigDict(extra="ignore")

    id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=100)
    kind: Literal["evergreen", "recurring", "event"]
    title: str = Field(min_length=1, max_length=180)
    summary: str = Field(min_length=1, max_length=1000)
    venue: str = Field(min_length=1, max_length=180)
    area: str = Field(min_length=1, max_length=120)
    tags: list[str] = Field(max_length=20)
    cost: Literal["free", "paid", "unknown"]
    cost_note: str = Field(max_length=500)
    eligibility: Literal["public", "gt_community", "students", "unknown"]
    eligibility_note: str = Field(max_length=500)
    duration_minutes: int = Field(ge=5, le=720)
    indoor: bool
    source_url: str = Field(max_length=2000)
    source_name: str = Field(min_length=1, max_length=180)
    source_checked_at: datetime
    review_after: datetime
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    status: Literal["active", "cancelled", "archived"]

    @field_validator("source_url")
    @classmethod
    def public_source(cls, value):
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("A public HTTPS source is required")
        return value

    @field_validator("source_checked_at", "review_after", "starts_at", "ends_at")
    @classmethod
    def aware_timestamp(cls, value):
        if value is not None and value.tzinfo is None:
            raise ValueError("Activity timestamps require a timezone")
        return value

    @field_validator("tags")
    @classmethod
    def short_tags(cls, values):
        if any(not 1 <= len(tag) <= 80 for tag in values):
            raise ValueError("Activity tags must be short nonempty strings")
        return values


def eligible(activity, at):
    """Unknown age, student status, schedule and transport are never inferred."""
    if (activity.status != "active" or activity.eligibility != "public"
            or not activity.source_checked_at <= at < activity.review_after
            or activity.review_after <= activity.source_checked_at):
        return False
    # A curator must not mark a restricted entry public. Also fail closed for
    # common age restrictions in imported notes until structured age consent exists.
    if re.search(r"\b(?:18|21)\s*(?:\+|and (?:over|older)|or (?:over|older))|\badults?[- ]only\b",
                 activity.eligibility_note, re.IGNORECASE):
        return False
    if activity.kind in ("event", "recurring"):
        # A recurring program alone is not evidence of its next occurrence.
        return bool(activity.starts_at and activity.ends_at
                    and at < activity.starts_at < activity.ends_at)
    return activity.starts_at is None and activity.ends_at is None


# Small explicit normalization keeps ranking explainable. This is tag relevance,
# not evidence of a shared experience or semantic matching-model causality.
STOPWORDS = {"a", "an", "and", "as", "at", "be", "both", "by", "for", "from", "i", "in",
             "into", "is", "it", "like", "love", "me", "my", "of", "on", "or", "the", "to",
             "with", "you", "your"}
TAG_ALIASES = {
    "arts": "art", "walks": "walk", "walking": "walk",
    "runs": "run", "running": "run", "hikes": "hike", "hiking": "hike",
    "biking": "cycling", "bicycling": "cycling", "bikes": "cycling",
    "photographs": "photography", "photos": "photography", "photo": "photography",
    "gardens": "garden", "gardening": "garden", "museums": "museum",
    "games": "game", "gaming": "game", "ceramics": "pottery",
}


def tokens(value):
    return {TAG_ALIASES.get(token, token) for token in re.findall(r"[a-z0-9]+", value.casefold())
            if token not in STOPWORDS}


def related_topics(activity, topics):
    tags = [tokens(tag) for tag in activity.tags]
    return [topic for topic in topics if any(tokens(topic) & tag for tag in tags)]


def activity_reason(activity, own_topics, peer_topics):
    own, peer = related_topics(activity, own_topics), related_topics(activity, peer_topics)
    if own and peer:
        return "both_interests", "Inspired by interests you have both shared."
    if own or peer:
        return "one_interest", "Inspired by an interest one of you shared."
    return "general_activity", "A public activity you could explore together."


async def candidates(repo, own_topics, peer_topics, *, limit=6):
    at = now()
    # Missing schema/database errors deliberately propagate. An empty reviewed
    # catalog is different from a broken database, and never activates fake data.
    rows = await repo.select("activity_catalog", {
        "status": "eq.active", "eligibility": "eq.public", "review_after": f"gt.{at.isoformat()}",
    }, order="id.asc", limit=500)
    ranked = []
    for row in rows:
        try:
            activity = Activity.model_validate(row)
        except (ValidationError, TypeError, ValueError):
            continue
        if not eligible(activity, at):
            continue
        own = len(related_topics(activity, own_topics))
        peer = len(related_topics(activity, peer_topics))
        # Both people benefiting dominates many matches for one person. Free
        # entries break ties; no budget, distance or schedule compatibility claim.
        score = (bool(own and peer), bool(own or peer), min(own, peer),
                 activity.cost == "free", min(own + peer, 8))
        ranked.append((score, activity))
    ranked.sort(key=lambda item: item[1].id)
    ranked.sort(key=lambda item: item[0], reverse=True)
    selected, places = [], set()
    for _, activity in ranked:
        # Avoid three slight variations on the same venue in a small suggestion set.
        place = (activity.venue.casefold(), activity.area.casefold())
        if place in places:
            continue
        selected.append(activity)
        places.add(place)
        if len(selected) == limit:
            break
    return selected


def invitation_options(activity):
    return [f'Would you like to try "{activity.title}" together?',
            f'Interested in checking out "{activity.title}" together?']


def activity_output(activity, own_topics, peer_topics, invitation=None):
    basis, reason = activity_reason(activity, own_topics, peer_topics)
    return {**activity.model_dump(mode="json"), "basis": basis, "reason": reason,
            "invitation": invitation or invitation_options(activity)[0]}

from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ShortText = Annotated[str, Field(min_length=1, max_length=500)]
QuestionKey = Literal["interests", "motivation", "goals", "experiences", "open_topics", "conversation_style", "boundaries"]
ConversationMode = Literal["learn", "share", "exchange_stories", "collaborate", "find_activity_partner", "casual_chat"]
Gender = Literal["woman", "man", "nonbinary", "another_gender", "undisclosed"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Evidence(StrictModel):
    source_type: Literal["onboarding_answer"] = "onboarding_answer"
    reference_id: UUID
    channel: Literal["self_report"] = "self_report"
    support: Annotated[str, Field(min_length=1, max_length=5000)]


class Fact(StrictModel):
    fact_id: Annotated[str, Field(min_length=1, max_length=100)]
    topic: ShortText
    relationship: Literal["interested", "experienced", "wants_to_try", "learning", "can_share"]
    details: Annotated[str, Field(min_length=1, max_length=2000)]
    motivation: Annotated[str, Field(max_length=1000)] | None = None
    evidence: Annotated[list[Evidence], Field(min_length=1, max_length=10)]
    confirmation: Literal["confirmed", "pending", "rejected"] = "pending"
    matching_allowed: bool = False
    sharing_scope: Literal["matching_only", "after_mutual_consent"] = "matching_only"


class EvidenceRequirement(StrictModel):
    version: Literal[1] = 1
    kind: Literal["none", "firsthand", "unresolved"]
    subject: Literal["viewer", "candidate", "both"] | None = None
    claim: Annotated[str, Field(max_length=2000)] | None = None
    confirmation: Literal["confirmed", "pending"] = "pending"

    @model_validator(mode="after")
    def coherent_requirement(self):
        if self.kind == "firsthand":
            if self.confirmation == "confirmed" and (self.subject is None or self.claim is None or not self.claim.strip()):
                raise ValueError("Firsthand requests require a subject and a specific claim")
        elif self.subject is not None or self.claim is not None:
            raise ValueError("Only firsthand requests have a subject or claim")
        if self.kind == "unresolved" and self.confirmation == "confirmed":
            raise ValueError("An unresolved request cannot be confirmed")
        return self


class ConversationRequest(StrictModel):
    mode: ConversationMode
    goal: Annotated[str, Field(max_length=2000)]
    evidence_requirement: EvidenceRequirement

    @model_validator(mode="after")
    def confirmed_request(self):
        requirement = self.evidence_requirement
        if requirement.confirmation == "confirmed":
            if not self.goal.strip():
                raise ValueError("A confirmed conversation request needs a goal")
            expected = {"learn": "candidate", "share": "viewer"}.get(self.mode)
            if requirement.kind == "firsthand" and expected and requirement.subject not in (expected, "both"):
                raise ValueError("Firsthand experience must match the conversation direction")
        return self


class ProfileDraft(StrictModel):
    conversation_request: ConversationRequest | None = None
    current_goal: Annotated[str, Field(max_length=2000)] = ""
    conversation_intent: Annotated[str, Field(min_length=1, max_length=1000)] | None = None
    facts: Annotated[list[Fact], Field(max_length=50)] = []
    open_to_discussing: Annotated[list[ShortText], Field(max_length=30)] = []
    conversation_preferences: Annotated[list[ShortText], Field(max_length=30)] = []
    avoid_topics: Annotated[list[ShortText], Field(max_length=30)] = []

    @model_validator(mode="after")
    def unique_facts(self):
        ids = [fact.fact_id for fact in self.facts]
        if len(ids) != len(set(ids)):
            raise ValueError("Fact IDs must be unique")
        return self


class Preview(StrictModel):
    enabled: bool = False
    display_name: Annotated[str, Field(max_length=80)] = ""
    interests: Annotated[list[ShortText], Field(max_length=8)] = []


class HardFilters(StrictModel):
    conversation_intents: Annotated[list[ConversationMode], Field(max_length=6)] = []


class UserSettings(StrictModel):
    muse_descriptions_enabled: bool = False
    discovery_radius_m: float = Field(default=3218.688, ge=160.9344, le=3218.688)
    display_name: Annotated[str, Field(max_length=80)] = ""
    occupation: Annotated[str, Field(max_length=160)] = ""
    skills: Annotated[list[ShortText], Field(max_length=30)] = []
    interests: Annotated[list[ShortText], Field(max_length=30)] = []
    personality_traits: Annotated[list[ShortText], Field(max_length=20)] = []
    profile_location: Annotated[str, Field(max_length=200)] = ""
    gender_identity: Gender = "undisclosed"
    gender_preferences: Annotated[list[Gender], Field(max_length=5)] = []
    matching_context: ConversationMode = "casual_chat"
    hard_filters: HardFilters = Field(default_factory=HardFilters)
    discoverable: bool = False
    bluetooth_enabled: bool = False


class ReviewRequest(StrictModel):
    update_preview: bool = True
    profile: ProfileDraft
    preview: Preview = Field(default_factory=Preview)
    settings: UserSettings = Field(default_factory=UserSettings)
    matching_consent: bool | None = None


class MessageRequest(StrictModel):
    message_id: UUID
    content: Annotated[str, Field(max_length=5000)]
    skip: bool = False

    @model_validator(mode="after")
    def nonempty(self):
        if not self.skip and not self.content.strip():
            raise ValueError("An answer or skip is required")
        return self


class PresenceRequest(StrictModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float = Field(ge=0, le=1000)
    observed_at: datetime

    @field_validator("observed_at")
    @classmethod
    def aware_time(cls, value):
        if value.tzinfo is None:
            raise ValueError("Timestamp must include a timezone")
        return value.astimezone(UTC)


class EncounterRequest(StrictModel):
    observed_at: datetime | None = None
    token: Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{43}$")]
    rssi: int | None = Field(default=None, ge=-127, le=20)


class ConversationIdeaRequest(StrictModel):
    candidate_id: UUID
    context_key: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class ConnectionRequest(StrictModel):
    candidate_id: UUID
    mode: Literal["nearby", "ble"] = "nearby"


class DecisionRequest(StrictModel):
    decision: Literal["accepted", "declined", "revoked"]


class FeedbackRequest(StrictModel):
    connection_id: UUID
    conversation_useful: bool | None = None
    would_talk_again: bool | None = None


class ConsentRequest(StrictModel):
    purpose: Literal["personal_matching", "social_import", "model_training"]
    granted: bool


class ProfileAnswerRequest(StrictModel):
    question_key: QuestionKey
    question_text: Annotated[str, Field(min_length=1, max_length=1000)]
    answer_text: Annotated[str, Field(min_length=1, max_length=5000)]


class MuseReply(StrictModel):
    question: Annotated[str, Field(min_length=1, max_length=1000)]
    question_key: QuestionKey
    ready_for_review: bool
    draft: ProfileDraft

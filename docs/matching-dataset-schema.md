# Matching Dataset and Feature Contract

V2 data contract, for Bryan and Kai to review. The initial offline training
pipeline now lives in [`ml/`](../ml/README.md). It accepts synthetic data only;
the onboarding/social extractor and production matching service are not yet
implemented. The feature groups below describe the broader design; the ML
README documents the exact 71-value comparison vector implemented in v1.

Machine-readable contract: [JSON Schema](../data/schemas/matching-dataset-v2.schema.json).
Complete fictional example: [Italy example](../data/samples/v2/italy-example.json).
The earlier JSONL examples remain v1 and are not silently migrated.

## 1. What We Are Learning

The first model estimates **directional conversational relevance**:

> Given A's current goals, approved interests, and earlier feedback, is there
> a specific, supported reason A might enjoy talking to B about an available topic?

This is not a personality score, a prediction of friendship, a consent decision,
or a guarantee that B wants to meet. Evaluate B -> A separately. Require mutual
approval at runtime regardless of scores. Initially, synthetic labels represent
a reviewer's hypothesis, not observed human outcomes.

The product should support more than advice-seeking. Valid connections include
shared enthusiasm, exchanging stories, complementary experience, learning
together, collaboration, and finding an activity partner.

## 2. What the Dataset Contains

| Collection | Purpose | Important fields |
| --- | --- | --- |
| Profiles | Immutable view of what the person has told us and approved | Raw onboarding answers, normalized facts, current goal, open topics, conversation preferences, avoided topics |
| Posts | Evidence for additional profile facts | Owner, caption, optional image reference, posting time; no likes, DMs, or other people's account histories |
| Feedback | Explicit earlier interaction outcomes | Who gave feedback, conversation context, acceptance, usefulness, would-talk-again, optional comment, observation time |
| Pairs | Supervised training/evaluation examples | Two profile versions, prediction time, earlier feedback IDs, contextual goal, relevance label, label source, rationale |

The schema packages these as four arrays for a small portable example. At scale,
they can be exported as four JSONL files or stored as related Supabase tables.
Profile versions must remain immutable so future edits do not rewrite old inputs.

Real data requires explicit authorization for training, separate from permission
to use content for personal matching. `training_basis` records that distinction;
it is an auditable declaration, not proof of consent or an access-control system.
Keep consent receipts outside this sample, and propagate revocation/deletion to
source data, derived facts, embeddings, and future training exports.

## 3. Onboarding Is a Primary Input

Suggested questions, not all mandatory:

1. What do you enjoy, and which specific parts interest you?
2. Why do those interests matter to you?
3. What would you like to try, learn, build, or experience?
4. What experiences or projects would you enjoy talking about?
5. What kind of conversation are you open to right now?
6. Do you have preferred conversation styles or topics to avoid?

Preserve the original answer, question, and timestamp. Normalize answers into
the same fact structure as approved post extractions. An answer such as "I love
travel because I enjoy regional food and discovering everyday local life" must
retain those details rather than collapse to `travel`.

Profiles work with no social account and no feedback history. Social posts add
optional evidence; having more posts must not itself increase a person's score.
Deduplicate overlapping facts so an onboarding answer plus ten similar posts
does not count as eleven independent interests.

Bryan's revised product preference is an onboarding-first ranking policy:
70% onboarding relevance and 30% optional Instagram relevance when both channels
have enough approved evidence to score. With no usable Instagram evidence,
use onboarding alone (100%/0%); absence is not a negative label. Insufficient
onboarding should trigger a follow-up or abstention, not social-only ranking.
These are proposed explicit score-combination weights, not dataset proportions
or a claim of an empirically optimal/calibrated model. A stored weight does not
enforce neural-network feature importance. Separate channel scoring and
validation still need implementation; the current ML experiments are unchanged.
See the [onboarding-first database handoff](database-schema-onboarding-first.md)
for the source split, missing-data rules, and proposed Supabase layout.

An explicit correction overrides an inferred fact. Current explicit boundaries
and conversation goals govern candidate/topic eligibility. Older history cannot
override a newly stated preference. Missing motivation remains null; do not
invent it from an image, nationality, appearance, or demographic stereotype.

## 4. Unified Fact Shape

Both onboarding and posts become facts with:

| Field | Meaning |
| --- | --- |
| `fact_id` | Reference key, not a predictive feature |
| `topic` / `details` | Specific subject and the relevant activity or experience |
| `relationship` | Interested, experienced, wants to try, learning, or explicitly willing to share |
| `motivation` | The user's stated reason, or null if unknown |
| `evidence[]` | Original answer or owned post reference, evidence channel, supporting text |
| `confirmation` | Confirmed, pending, or rejected by the user |
| `matching_allowed` | Whether the fact may be used for personal matching |
| `sharing_scope` | Matching only, or eligible for display after mutual consent |

Only confirmed, matching-allowed facts enter the v1 feature builder proposed
below. Keep pending/rejected extractions for audit and extraction evaluation,
not as concealed ranking signals. An image of a landmark is not proof of a
trip; captions, explicit answers, and confirmation resolve its meaning.

`can_share` must come from the person's stated willingness, not the extractor's
guess. `experienced` does not imply `can_share`. A source timestamp is not
necessarily the time the depicted event happened. Do not assume an old travel
experience is irrelevant just because the source post is old.

## 5. What the Network Actually Receives

An embedding is a numeric representation of text, not a human-authored score.
Use a pretrained text encoder to compute these vectors. A separate pretrained
multimodal extractor can interpret approved images and captions before matching.
The small matching network does not learn image understanding from these records.

| Feature group | Available-at-prediction input | Proposed representation |
| --- | --- | --- |
| Viewer intent | Current goal, purpose, and stated motivations | Text embedding plus conversation-mode category |
| Specific interests | Confirmed facts from initial answers AND posts | Individual fact embeddings including details and motivation |
| Experience/aspiration relationship | Fact roles for each proposed conversation | Categorical role-pair encoding; not just topic-word overlap |
| Candidate relevance | Candidate's approved facts and open topics | Text embeddings and goal-to-fact semantic similarities |
| Depth and context | Shared activities, subtopics, constraints such as budget | Fact-to-fact comparison features, with missing-value masks |
| Conversation preferences | Explicit preferences from each profile | Text embeddings; unknown is not an incompatibility |
| Preference memory | Viewer-owned feedback strictly before prediction time | Separate positive/negative history summaries, candidate-to-history similarities, history-present mask |
| Evidence availability | Confirmed usable facts and supported relation types | Presence/coverage masks, not raw social popularity or posting frequency |

Start with a frozen encoder and small matching head. Select a bounded number of
facts relevant to the current goal using the same retrieval procedure during
training and inference. Preserve the original fact/history records even if an
initial implementation pools their vectors. Do not average experience and
aspiration into one undifferentiated topic vector. Keep positive and negative
feedback separate; zero history means missing, not negative.

This is a revised input proposal, not the earlier fixed 1,168-value sketch.
Choose the encoder and feature blocks before calculating the input dimension.
Record encoder ID/revision, pooling/retrieval settings, and feature-schema version
with every derived feature export. Do not create arbitrary numeric embeddings
or hand-enter "compatibility scores" as if they were measured model inputs.

Names, user IDs, handles, profile IDs, follower counts, precise location,
appearance, protected/sensitive attributes, and review labels are not ranking
features. IDs are lookup keys only. Availability, blocks, topic boundaries,
matching permission, and mutual consent remain hard gates outside the model.

## 6. What Makes Information Relevant?

There are two separate questions:

1. **Is this usable evidence?** It belongs to the user, supports the stated
   interpretation, is approved for matching, and does not contradict a correction.
2. **Does it support this conversation?** It helps satisfy a current goal or
   creates a specific shared/complementary interest both parties are open to.

For Jane's goal of hearing budget Italy travel experiences:

| Available information | Treatment |
| --- | --- |
| John says he used Italian trains and hostels, and welcomes questions | Specific supported connection; proposed positive |
| John is interested only in debating Italian football today | Explicit current-goal mismatch for this opportunity; proposed negative |
| A caption says "Italy someday" | Evidence of aspiration, not a completed visit; do not invent firsthand experience |
| John's profile contains no travel information at all | Unknown travel relevance, not proof he has never traveled |
| Jane wants a future travel buddy; Emi also wants to visit Italy | Could be positive under this different goal; the topic alone does not determine the label |
| John enjoyed giving advice last month but now says "not open to travel questions" | Exclude that topic now; history cannot override his boundary |

Relevant does not mean recent, popular, flattering, or similar in every way.
One specific conversational connection may be sufficient. No user needs to be
an expert; two beginners sharing a goal can be a good match.

## 7. Labeling Rubric

Annotators see the same frozen profiles, current context, and earlier feedback
the feature builder can access. For each direction, record:

- `topic_fit`: yes / no / unknown.
- `intent_fit`: yes / no / unknown.
- `specific_bridge`: yes / no / unknown.
- `evidence_sufficient`: yes / no / unknown.
- A concise explanation grounded in the provided records.

Use `relevant_connection: 1` for a supported, specific connection that fits the
goal and stated openness. Use `0` for a supported mismatch, not merely missing
information. Use `null` when the evidence cannot establish either. Exclude null
labels from binary training loss; retain them for uncertainty and extraction tests.

The rubric fields and reason are **labels/audit metadata**, never input features.
Do not let a labeling model place its answer into an input summary. Synthetic
labels remain `synthetic_draft` unless humans actually review them. A classifier
trained on generated labels learns the generator's assumptions; a sigmoid value
is not automatically a calibrated chance of friendship.

Real request acceptance, conversation usefulness, and desire to talk again are
separate outcomes in `feedback`, not interchangeable substitutes for the first
relevance target. No response, no rating, or a timeout stays null. Never treat
missing feedback as an explicit dislike.

## 8. Required Validation Beyond JSON Schema

JSON Schema validates structure and local constraints. Enable RFC 3339
`date-time` format assertions in the chosen validator; some libraries treat
`format` as annotation unless the relevant checker/dependency is installed.
An ingestion validator must additionally check:

1. IDs are unique; all profile/post/answer/feedback references exist and ownership
   matches. Evidence from a post must refer to the profile owner's own post.
2. Profile snapshots and sources existed at `as_of`; feedback was observed
   strictly earlier. Backfilled comments and later profile edits cannot leak in.
3. Initial-answer/caption quotes actually appear in the referenced text. Visual
   support needs real image review; a synthetic description is not image evidence.
4. Every history record belongs to the viewer, not the candidate's private history.
5. Real training exports have verified permission and exclude revoked information.
6. Facts derived from the same evidence are deduplicated, and source content is
   treated as untrusted data, never as agent instructions.
7. For new-user tests, neither endpoint nor related persona templates leak across
   train/validation/test groups. Split people first, then generate pairs. Evaluate
   known-user future personalization with a separate time-based split.

Do not train on the example file. First review labels together, create a varied
pilot, and compare a small learned model with cosine and simple-rule baselines.
Evaluate onboarding only, onboarding plus posts, and those inputs plus history
on the same held-out cases. That tells us which information actually helps.

## References

- [Sentence Transformers: semantic similarity](https://sbert.net/docs/sentence_transformer/usage/semantic_textual_similarity.html)
  describes embedding-based similarity, not a guarantee of interpersonal fit.
- [JSON Schema: conditional validation](https://json-schema.org/understanding-json-schema/reference/conditionals)
  supports the local consistency checks used by the machine-readable schema.
- [scikit-learn: grouped evaluation](https://scikit-learn.org/stable/modules/cross_validation.html#cross-validation-iterators-for-grouped-data)
  explains keeping grouped subjects out of both training and test folds.

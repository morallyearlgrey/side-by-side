# SidebySide: Matching Data Sample

Small review sample for Bryan and Kai. All people, posts, feedback, and labels
are fictional, assistant-authored fixtures. Nothing was scraped from Instagram.
Labels are unreviewed proposals, not measured human compatibility. These seven
legacy examples are not a training or benchmark dataset. Subsequent experiments
use the v2 schema; see [the ML pipeline](../../ml/README.md) for their status.

For the expanded onboarding-plus-posts proposal, see the
[v2 dataset and feature contract](../../docs/matching-dataset-schema.md),
[machine-readable schema](../schemas/matching-dataset-v2.schema.json), and
[complete fictional v2 example](v2/italy-example.json). The original JSONL files
below remain v1; v2 is an explicit, reviewable evolution rather than an implicit
change to their format.

## What Kai Should Review

| Pair | Proposed label | Why it is included |
| --- | --- | --- |
| Jane -> John | Relevant (1) | She wants a budget Italy trip; he has relevant firsthand experience and welcomes travel questions. |
| John -> Jane | Relevant (1) | He enjoys sharing practical travel advice; she has questions in that area. This direction is evaluated separately. |
| Jane -> Luca | Not relevant (0) | Both mention Italy, but his current interest is Italian football tactics, not travel planning. |
| Jane -> Emi | Unknown (null) | Emi's Italy post expresses a wish, not a completed trip. There is insufficient evidence for Jane's firsthand-advice goal. |
| Noor -> Ari | Relevant (1) | Noor wants to build a fuzz pedal; Ari repairs analog music equipment and welcomes beginner build questions. Noor's prior feedback favors concrete explanations. |
| Ari -> Noor | Relevant (1) | Ari wants to discuss beginner repair/build projects; Noor has a specific project question. |
| Noor -> John | Not relevant (0) | Noor enjoyed John's practical communication previously, but his available profile does not support her present electronics question. History must not override topic relevance. |

These are directional suggestions, not consent decisions or friendship
probabilities. Unknown is not zero. In the unknown Italy example, another
conversation goal could justify a different label.

## Files

- `profiles.jsonl`: six immutable profile snapshots, including explicit goals,
  topic relationships, approved experiences, and willingness to discuss topics.
- `posts.jsonl`: three fictional owned-post examples and candidate extractions.
- `feedback.jsonl`: two fictional, earlier interactions illustrating preference
  memory. They are not the target labels for the later training pairs.
- `training_pairs.jsonl`: seven directional pair records referencing exact
  profile versions and only feedback available before each pair's `as_of` time.

Each physical line is one valid JSON object. Every file uses `schema_version: 1`.
This is a review proposal, not a frozen production schema.

## How to Read the Data

Facts have a `topic`, a `relationship` such as `experienced` or `wants_to_try`,
and specific `details`. A source reference distinguishes a post-supported fact
from a profile answer. The separate `open_to_discussing` field is explicit:
experience alone never implies willingness to advise a stranger.

Post extractions preserve supporting caption text and uncertainty. The profile
uses only confirmed interpretations. `user_confirmed: true` is fictional in
this sample, not a claim that a real participant approved anything.

Images are not included. `image_ref` is null, and
`illustrative_image_description` explains a hypothetical image for reviewers.
It is not visual evidence or a real model output. This sample can illustrate
matching inputs but cannot evaluate an image-understanding model. No external
image URLs or real social-account identifiers are used.

## Labels and Model Inputs

The proposed first target is **directional conversational relevance**:

- `1`: a specific, plausible conversation opportunity fits the viewer's current
  goal and the candidate's stated openness.
- `0`: the available profiles support a poor fit for that goal. This does not
  label the person undesirable or predict that any conversation would fail.
- `null`: insufficient evidence; exclude from supervised binary loss pending
  review. Keep it for testing uncertainty handling.

All labels have `source: synthetic_draft` and `human_reviewed: false`. Change
those only after an actual review. Explanations are audit material and must
never become input features. Do not interpret synthetic labels as real user
acceptance or post-conversation satisfaction; log those outcomes separately.

A future feature builder would resolve the referenced profile snapshots and
earlier feedback, then encode their approved content. Profile IDs are lookup
keys, not predictive features. Do not feed IDs, names, labels, label reasons,
or future feedback into the network. Record encoder and feature-schema versions
when generating embeddings; do not fabricate vectors by hand.

The Noor examples show why retaining actual feedback is useful: she values
patient, concrete explanations, but the system should not recommend a previously
liked person for every unrelated goal. Two fictional observations do not prove
a stable preference. Evaluate the benefit of history instead of assuming it.

## Consent and Evaluation

Runtime availability, blocks, and mutual approval remain hard gates outside the
learned relevance score. A high score must never reveal posts or personal auras
without the appropriate consent.

Do not report accuracy on this tiny sample. Before generating a larger dataset,
review the target definition and cases together. Include varied domains,
counterexamples, uncertain extractions, and missing histories. For new-user
evaluation, split people and near-duplicate persona families before generating
pairs, preventing either endpoint from leaking across splits. Keep all feedback
inputs earlier than the prediction time. Use a separate time-based evaluation
for future interactions among known users.

## Questions for Review

1. Do the positive examples provide a specific reason both people might talk?
2. Is the Italy/football example a fair negative for the stated goal?
3. Should the Italy wish-post example stay unknown until the user clarifies?
4. Do the historical examples help without overriding current intent?
5. Which labels would you change, and what evidence would justify the change?

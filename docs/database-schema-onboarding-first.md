# SidebySide Database Handoff: Onboarding First

Proposal revision 2 for Bryan and Kai. This is a database design contract, not
executable SQL, an applied Supabase migration, or a change to the running model
comparison. It replaces the earlier Instagram-heavy presentation of the app
schema. The existing machine-readable ML dataset remains version 2.

## Product Rule

Onboarding is the primary profile. A user can complete it, receive matches,
give feedback, and use the product without connecting Instagram. Instagram is
an optional source of additional, user-approved conversational evidence.

The conversational onboarding should capture:

| Existing question key | What to preserve |
| --- | --- |
| `interests` | Specific activities, subtopics, examples, and depth of interest |
| `motivation` | Why the interest matters, in the user's own words |
| `goals` | What they want to learn, try, make, or discuss now |
| `experiences` | Experiences and skills they choose to talk about |
| `open_topics` | What they are explicitly willing to discuss/share |
| `conversation_style` | Stated preferences for the interaction |
| `boundaries` | Topics they want excluded; these are hard gates, not weighted preferences |

Not every question is mandatory. Ask relevant follow-ups and let people skip.
Do not infer motivation, expertise, or willingness to advise from a broad topic.
The user must confirm extracted facts before they become matching inputs.
Merely finishing the onboarding UI does not prove enough evidence exists for
every candidate/topic; insufficient evidence must still produce abstention.

## Storage Contract

Supabase Auth handles authentication; PostgreSQL stores the following records.
Use UUID primary/foreign keys and UTC `timestamptz` values. `?` means nullable.
All user references point to `profiles.user_id`; all profile-version references
point to `profile_versions.profile_version_id`. Arrays inside JSONB below are
JSON arrays, not PostgreSQL `jsonb[]` columns.

### Core Onboarding Tables

```text
profiles
  user_id uuid PK/FK -> auth.users.id
  display_name text
  discoverable boolean DEFAULT false
  current_profile_version_id uuid FK?
  created_at, updated_at

onboarding_sessions
  session_id uuid PK
  user_id uuid FK
  status text: in_progress | awaiting_confirmation | completed
  started_at, completed_at?

onboarding_answers
  answer_id uuid PK
  session_id uuid FK -> onboarding_sessions.session_id
  question_key text: one of the seven keys above
  question_text text, answer_text text
  answered_at

profile_versions
  profile_version_id uuid PK
  user_id uuid FK, onboarding_session_id uuid FK
  valid_from
  data_origin text: synthetic | real_opt_in
  onboarding_answers jsonb: immutable snapshot of selected answer records
  current_goal text?, conversation_intent text?
  facts jsonb: approved/pending/rejected facts with source provenance
  open_to_discussing text[]
  conversation_preferences text[]
  avoid_topics text[]
```

Answers are append-only revisions; a correction creates a new answer and profile
version. The snapshot freezes the exact inputs, instead of rereading mutable
answers when interpreting an older match. Validate that the current-version
pointer, onboarding session, answer references, and profile share an owner, and
that each source existed by `valid_from`. Enforce these with ownership-aware
foreign keys/constraints and server-side validation, not naming conventions.
Immutability does not prevent privacy deletion: erase/revoke underlying records
and invalidate affected derivatives when required.

Facts and answer snapshots use the exact shapes in
[`matching-dataset-v2.schema.json`](../data/schemas/matching-dataset-v2.schema.json).
In particular, a fact is:

```text
fact_id, topic, relationship, details, motivation?, evidence[],
confirmation, matching_allowed, sharing_scope

relationship: interested | experienced | wants_to_try | learning | can_share
confirmation: confirmed | pending | rejected
sharing_scope: matching_only | after_mutual_consent

evidence[]: {source_type, reference_id, channel, support}
source_type: onboarding_answer | owned_post
channel: self_report for answers; caption or image for posts
```

Do not replace this with a flat keyword list. For example, preserve "I want to
hear how people plan low-budget train trips through Italy" rather than "travel".
Explicit `can_share` is separate from simply having an experience.

### Ranking and Personalization

```text
matching_policies (server-controlled, immutable versions)
  policy_id uuid PK, policy_version text UNIQUE
  onboarding_weight numeric DEFAULT 0.70
  instagram_weight numeric DEFAULT 0.30
  missing_instagram_policy text: onboarding_only
  insufficient_onboarding_policy text: abstain
  created_at
  CHECK weights are in [0,1] and sum to 1

match_scores (server-only)
  score_id uuid PK
  viewer_profile_version_id uuid FK, candidate_profile_version_id uuid FK
  policy_id uuid FK -> matching_policies.policy_id
  context jsonb, history_cutoff_at, prior_feedback_ids uuid[]
  onboarding_score double precision?, instagram_score double precision?
  onboarding_abstain_reason text?, instagram_abstain_reason text?
  applied_onboarding_weight numeric?, applied_instagram_weight numeric?
  final_score double precision?, abstain_reason text?
  supporting_fact_ids jsonb
  model_id text, model_revision text, pipeline_version text
  scored_at, expires_at
  CHECK non-null scores are finite and within [0,1]
  Applied weights are both null when abstaining; otherwise in [0,1] and sum to 1.

feedback (private to its author)
  feedback_id uuid PK
  viewer_profile_version_id uuid FK, candidate_profile_version_id uuid FK
  data_origin text, observed_at, context text, explicit_comment text?
  outcomes jsonb:
    connection_accepted: boolean|null
    conversation_useful: boolean|null
    would_talk_again: boolean|null
```

For each directional prediction A -> B:

1. Apply availability, matching permission, blocks, and explicit topic boundaries
   before scoring. These gates cannot be traded off against a higher score.
2. Use A's explicit onboarding/current intent as the query. Compare it with B's
   confirmed onboarding facts to obtain `onboarding_score`.
3. Optionally compare the same query with B's confirmed, matching-allowed facts
   supported only by owned Instagram posts, retaining B's explicit openness and
   boundaries as constraints. This produces `instagram_score`; it does not
   infer A's goals or B's willingness from pictures.
4. When both scores are supported, apply the proposed policy:
   `final_score = 0.70 * onboarding_score + 0.30 * instagram_score`.
5. When there is no sufficiently supported Instagram score (not connected,
   revoked, no approved relevant evidence, extraction failure, or duplicates
   only), store `instagram_score = null`, record the reason, and apply 1.0/0.0.
   Set `final_score = onboarding_score`; do not impose a 0.70 score ceiling.
6. Missing evidence is not a mismatch. A supported negative Instagram judgment
   can be 0 and retains the 0.30 weight; unsupported judgments remain null.
7. If onboarding evidence is insufficient, store an abstention with no final
   score and request a useful follow-up. Do not silently substitute Instagram.
8. Evaluate B -> A separately. A's Instagram connection is not required to score
   B's optional Instagram evidence for A. Neither direction grants consent.

These weights describe the arithmetic combination of separate channel scores,
not 70% of training rows or a guarantee that 70% of a neural model's internal
features are onboarding. Both channel scores need comparable scales and
validation against reviewed examples. The weighted result is a ranking
heuristic, not a calibrated probability of friendship. Fallback and enriched
rankings need separate evaluation for users with and without Instagram.

Deduplicate facts across sources before scoring. A fact independently supported
by onboarding belongs to the onboarding channel, retaining all evidence for
audit; do not count it again in the Instagram channel. User confirmation of an
Instagram extraction alone does not change its source into onboarding. New,
distinct details may be separate facts when independently supported.

Explicit prior feedback can inform fact retrieval and relevance in both
channels, but is not an extra unbounded boost outside the 70/30 policy. Use only
viewer-owned feedback observed before the prediction cutoff; preserve positive
and negative feedback separately. A new explicit preference overrides older
feedback. Missing feedback is null, never an automatic dislike.

### Optional Instagram Evidence

```text
social_connections
  connection_id uuid PK, user_id uuid FK
  platform text: instagram for this version
  platform_account_id text, granted_scopes text[]
  connected_at, revoked_at?
  Credentials are kept separately in server-only secret storage.

posts
  post_id uuid PK, owner_user_id uuid FK
  connection_id uuid FK -> social_connections.connection_id
  data_origin text, posted_at, available_at
  caption text, image_ref text? (private storage reference)
```

Neither table is required for signup or onboarding-only matching. Instagram
import remains subject to authorized platform access; this design does not
claim an importer is implemented. Never ingest other people's histories, DMs,
likes, or followers for ranking. Do not reward post count, account popularity,
or choosing to connect Instagram. A later Spotify connector needs an explicit
versioned evidence adapter, not disguised `owned_post` references.

### Consent, Safety, and Discovery

```text
connection_requests
  request_id uuid PK
  requester_user_id uuid FK, recipient_user_id uuid FK
  requester_profile_version_id uuid FK, recipient_profile_version_id uuid FK
  requester_decision text, recipient_decision text
  Decisions: pending | accept | decline | revoke; default pending
  created_at, expires_at, updated_at

user_blocks
  blocker_user_id uuid FK, blocked_user_id uuid FK, created_at
  Composite PK: (blocker_user_id, blocked_user_id); no self-blocks

consent_receipts
  consent_id uuid PK, user_id uuid FK
  purpose text: social_import | personal_matching | model_training
  source_ref text?, policy_version text, granted_at, revoked_at?

badge_sessions (server-only)
  session_token text PK, user_id uuid FK
  issued_at, expires_at, revoked_at?
```

Use RLS and server-side authorization: raw answers, sources, snapshots, and
feedback are private to their owner; policies, raw scores, and badge mappings
are server-controlled. Participants can see permitted request state and can
change only their own decision through a validated operation. Checking row
membership alone does not prevent one participant changing the other's columns.
Profiles are revealed through a filtered backend response, not a grant to read
the full underlying row, only after both accept and the backend rechecks
expiry, version scope, availability, blocks, and revocations. Even then, expose
only facts explicitly approved for sharing, never raw posts or private history.

Badge-to-user registration is not yet implemented. It must authenticate the
wearer/device; an observed public BLE token is not authorization or identity.
The current Core2 only broadcasts temporary tokens.

Training permission is separate from matching permission. Training pairs remain
an offline dataset initially. An export adapter must emit only the existing ML
v2 fields: database-only session/policy/score fields cannot be sent directly to
the strict JSON validator. Real exports require verified training consent;
deletions/revocations must reach sources, snapshots, embeddings, cached scores,
and future exports. None of this proposal changes existing synthetic labels,
the v2 JSON schema, or the current Newton model comparison.

Reference: [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

# SidebySide HTTP API v1

Base URL is the developer laptop/server reachable by the phone (not the phone's `localhost`). Interactive schemas: `/docs`; machine-readable: `/openapi.json`.

Every `/v1` endpoint requires `Authorization: Bearer <Supabase access token>` except Spotify's single-use-state OAuth callback and the separately authenticated Core2 state endpoint below. The API asks the configured Supabase Auth server to validate account tokens; client-supplied user IDs cannot impersonate actors. Privileged DB credentials stay on the server. Errors use `{ "error": { "code": "…", "message": "…" } }`; request schema errors use FastAPI's standard 422 `detail` array. No mock scoring or fallback authentication exists.

## Authentication and onboarding

Authentication itself (signup/login/session refresh/password recovery) uses the public Supabase client SDK. The API provides:

| Method/path | Request | Response |
| --- | --- | --- |
| `GET /health` | None | Configuration/readiness flags; no credentials |
| `GET /v1/me` | None | `{profile,current_version,preview,matching_consent,onboarding,readiness}` |
| `GET /v1/onboarding` | None | Resume/create `{session_id,status,ready_for_review,turns,draft,provider,error}` |
| `POST /v1/onboarding/messages` | `{message_id: UUID,content:string,skip?:boolean}` | Same session shape; provider failure preserves answer and reports `error` |
| `POST /v1/onboarding/review` | `ReviewRequest` below | `{profile,current_version,matching_consent}` |
| `PATCH /v1/profile` | `ReviewRequest` | New immutable profile version; original version/answers retained |
| `POST /v1/profile/answers` | `{question_key,question_text,answer_text}` | Owned answer including `answer_id` for citation in reviewed edits |
| `PATCH /v1/settings` | Partial `UserSettings` | Updated own `profiles` row |
| `POST /v1/consents` | `{purpose,granted}` | Updated choice; purposes `personal_matching`, `social_import`, `model_training` stay independent |
| `DELETE /v1/me` | None | Deletes authenticated account and cascading runtime data |

`profile` is the actor's record: `user_id`, `display_name`, `current_profile_version_id`, `settings`, `available`, `discoverable`, `bluetooth_enabled`, timestamps. A new account has no current version and discovery is disabled. `current_version` is the actor's full immutable snapshot including source answers; it must never be reused as another person's preview.

Opening assistant turn is exactly **What makes you YOU?** Turn shape: `{id,role:'assistant'|'user',content,question_key,created_at}`. The seven keys are `interests`, `motivation`, `goals`, `experiences`, `open_topics`, `conversation_style`, `boundaries`. Retry the same content with the same `message_id`. If a provider reply is pending, finish/retry that turn before sending another. The answer is saved before a provider request; failed/malformed provider responses do not erase it.

```typescript
type Fact = {
  fact_id: string;
  topic: string;
  relationship: 'interested'|'experienced'|'wants_to_try'|'learning'|'can_share';
  details: string;
  motivation: string | null;
  evidence: {
    source_type: 'onboarding_answer';
    reference_id: string; // UUID of owned original answer
    channel: 'self_report';
    support: string; // exact nonempty excerpt
  }[];
  confirmation: 'confirmed'|'pending'|'rejected';
  matching_allowed: boolean;
  sharing_scope: 'matching_only'|'after_mutual_consent';
};
type EvidenceRequirement = {
  version: 1;
  kind: 'none'|'firsthand'|'unresolved';
  subject: 'viewer'|'candidate'|'both'|null;
  claim: string|null;
  confirmation: 'confirmed'|'pending';
};
type ConversationRequest = {
  mode: UserSettings['matching_context'];
  goal: string;
  evidence_requirement: EvidenceRequirement;
};
type ProfileDraft = {
  conversation_request?: ConversationRequest|null; // missing legacy state requires review
  current_goal: string;
  conversation_intent: string | null; // stated intent, not a context-mode enum
  facts: Fact[];
  open_to_discussing: string[];
  conversation_preferences: string[];
  avoid_topics: string[];
};
type Preview = { enabled: boolean; display_name: string; interests: string[] };
type UserSettings = {
  display_name: string;
  occupation: string;
  skills: string[];
  interests: string[];
  personality_traits: string[];
  profile_location: string;
  matching_context: 'learn'|'share'|'exchange_stories'|'collaborate'|'find_activity_partner'|'casual_chat';
  hard_filters: {conversation_intents: UserSettings['matching_context'][]}; // filter by the other person's mode
  discoverable: boolean;
  bluetooth_enabled: boolean;
};
type ReviewRequest = {
  profile: ProfileDraft;
  preview: Preview;
  settings: UserSettings;
  matching_consent: boolean;
};
```

When the agent finishes gathering details, the session becomes `awaiting_confirmation` and returns `ready_for_review: true`, including on resume. This is a single handoff to the editable profile review screen. Further chat messages return the same draft without storing another answer or calling Muse; a chat “yes” never confirms a profile or grants consent. Reusing an existing message ID with different content still returns `409 message_id_reused`. The user must use the explicit ProfileForm review/save action (`POST /v1/onboarding/review`) to publish a version.

A confirmed conversation request needs a nonempty goal equal to `current_goal`
and a mode equal to `settings.matching_context`. `firsthand` needs a nonempty
claim and a subject: `learn` checks `candidate` (or `both`), while `share` checks
`viewer` (or `both`). `none` has null subject/claim and explicitly allows a
request without firsthand evidence. `unresolved` has null subject/claim and
cannot be confirmed. The claim must preserve the requested activity, constraints,
and outcome; it must not broaden the goal or turn an attempt into success.
Changing mode, goal, kind, subject, or claim requires fresh user confirmation.
Store the whole request in the immutable profile version; a job's context must
match that version. Missing/pending metadata is not inferred from old profiles,
labels, or keywords: the user reviews it in Settings before V4 can recommend.

Muse output is only a draft. The user explicitly selects confirmation, matching permission, and sharing scope at review. A public preview has separate approval; neither fact scope authorizes preacceptance disclosure. Settings display fields are not model features. Add a self-reported answer through `/profile/answers` before making evidence-linked new matching facts. Instagram/image/Spotify evidence is rejected by this release's runtime DTOs.

## Nearby and queued inference

| Method/path | Request | Response |
| --- | --- | --- |
| `PUT /v1/presence` | `{latitude,longitude,accuracy_m,observed_at:ISO8601}` | `{expires_at,refresh_after_seconds}` |
| `DELETE /v1/presence` | None | Disable location discovery and remove presence |
| `GET /v1/nearby?limit=20&cursor=…` | Optional opaque cursor, max limit 50 | `{items,snapshot_id,next_cursor,pending_count,not_recommended_count,insufficient_evidence_count,unavailable_count,model,refresh_after_seconds}` |
| `POST /v1/feedback` | `{connection_id,conversation_useful:boolean|null,would_talk_again:boolean|null}` | `{feedback_id}` |
| `POST /v1/blocks/{user_id}` | None | `{blocked:true}` |
| `DELETE /v1/blocks/{user_id}` | None | `{blocked:false}` |

Nearby item: `{user_id,preview,score,status:'recommend',distance_m,reason}`.
Only recommendations appear, sorted by descending directional relevance and
UUID tie-break. The score uses frozen synthetic calibration and is not a measured
probability of friendship or a useful conversation. Public preview alone is
returned; raw evidence, matching-only facts, goals, and transcripts do not leak
as reasons. The displayed `reason` describes inputs generally.

| Inference status | Numeric score | Nearby / BLE behavior |
| --- | --- | --- |
| `recommend` | Finite value in [0,1] | Ranked in Nearby; may offer a BLE invitation subject to eligibility |
| `not_recommended` | Finite value in [0,1] | Counted separately, not ranked or offered |
| `insufficient_evidence` | `null` | Counted separately; missing/unclear/unsupported evidence is not a zero score |
| `unavailable` | `null` | Counted separately; model/configuration/inference is unavailable |

`pending_count` tracks eligible pairs awaiting a current result, not an inference
decision. The four counts stay distinct. All invitation and disclosure rules
still apply even to a recommendation.

PostGIS enforces two miles (3,218.688 m), fresh presence, blocks in either direction, availability, matching consent, and both users' hard filters. Foreground presence defaults: 60-second client refresh, 300-second TTL measured from the observed instant, maximum accepted accuracy 250 m; no promise of continuous background tracking. Manual profile location is unrelated to live GPS.

Pagination captures a stable snapshot. `409 snapshot_expired` means reset pages and refetch; do not append stale pages. Snapshot ownership, eligibility, model version and expiry are checked on continuation. Poll at the returned 15-second bound while active. SQL invalidation clears affected snapshots; no globally readable Realtime stream is exposed.

The worker keeps deduplicated jobs in Postgres. Identity includes ordered participants, profile versions, context, invalidation revisions, explicit history-policy version, model revision, pipeline, policy, frozen policy SHA-256 and cache refresh epoch. Model changes cannot process old jobs under stale provenance. SQL leases, capped attempts, retry delay, current eligibility/version checks and publish-time validation prevent stale results. Local inference uses one API process with a warmed model and embedded worker. Remote mode disables API inference and uses a standalone worker against the same persistent queue; a private, expiring heartbeat with the exact policy fingerprint and pinned model provenance controls readiness. More inference replicas each load a model; distributed leases prevent duplicate claims.

Policy `onboarding-evidence-v4` and pipeline
`online-approved-onboarding-evidence-v4` exclude imported media and feedback
history. Jobs, scores, snapshots, and worker heartbeats bind the frozen
`selected_policy.json` SHA-256; scores and readiness also identify Qwen,
DeBERTa evidence-checker, MiniLM format-encoder, prompt, and feature revisions.
The server checks approved, owned, timestamped onboarding evidence and the
version-bound conversation request before inference. A separate `real_opt_in`
adapter shares low-level V4 scoring; research synthetic-only validation remains
unchanged. See [online V4 provenance and setup](../docs/online-evidence-v4.md).

Explicit feedback is privately stored with null missing outcomes; it is not a
negative label, an inference input, or training authorization. New social/history
serving requires separately versioned validation and evaluation. Migration
`202609260003` changes decision/provenance constraints and invalidates V1 cached
results; old worker heartbeats cannot advertise readiness for the new pipeline.

## Bluetooth and invitations

| Method/path | Request | Response |
| --- | --- | --- |
| `POST /v1/ble/sessions` | None | `{session_id,token,expires_at}` |
| `DELETE /v1/ble/sessions` | None | `{live:false}`; revoke tokens and disable BLE mode |
| `POST /v1/ble/encounters` | `{token,rssi?:number,observed_at?:ISO8601}` | `{status,score,reason,candidate_id?,preview?}` |
| `GET /v1/connections` | None | `{items:Connection[]}` |
| `POST /v1/connections` | `{candidate_id,mode:'nearby'|'ble'}` | `Connection` |
| `PUT /v1/connections/{request_id}/decision` | `{decision:'accepted'|'declined'|'revoked'}` | `Connection` |

A phone token is 32 random bytes encoded as 43 base64url characters, expires after at most 120 seconds, and is stored only as SHA-256. Rotate at ~90 seconds. Session issuance requires a confirmed profile and current matching consent; it explicitly opts into BLE. Encounter requests require both Live sessions and current eligibility. Invalid/expired/blocked encounters use generic `404 encounter_not_available`. RSSI is not GPS distance or identity proof. A known UUID or token is not permission to disclose details. A BLE invitation additionally requires the authenticated caller's fresh recorded encounter and a current `recommend` result. `not_recommended`, `insufficient_evidence`, `unavailable`, and pending results never trigger an invitation/banner or profile disclosure.

`Connection` includes `request_id`, `requester_id`, `recipient_id`, each party's decision, `status`, `preview`, `shared_profile`, creation/expiry. Status is `pending`, `accepted`, `declined`, `revoked`, `profile_changed` or `unavailable`. `shared_profile` is null before mutual acceptance and after expiry, revocation, a block, availability/filter/consent change, or profile version change. When authorized it contains only confirmed facts explicitly marked `after_mutual_consent`, stripped of evidence and internal IDs. Each actor can update only their own decision. Creating a request counts as that requester's acceptance of the bound version, not the recipient's.

## Core2 badge status

The badge reports its own button state over Wi-Fi to FastAPI, which updates
Supabase. This status is separate from phone discovery, matching availability,
profile disclosure, and matching consent. An AprilTag or broadcast BLE ID is
not an authentication credential. This release adds no public AR/profile lookup.

| Method/path | Authentication | Request | Response |
| --- | --- | --- | --- |
| `GET /v1/badges` | Account session | None | `{badges:Badge[]}`, owner only |
| `POST /v1/badges` | Account session | `{label?:string}` (trimmed, 1–64 characters) | HTTP 201 `{badge:Badge,device_token:string}` |
| `DELETE /v1/badges/{device_id}` | Account session | None | `{badge:Badge}`; owner-only irreversible revocation |
| `PUT /v1/badges/state` | Device token | `{state:'paused'|'available',sequence:integer}` | `Badge` plus `heartbeat_seconds:15,lease_seconds:45` |

`Badge` contains `device_id`, `label`, `reported_state`, `last_sequence`,
`last_seen_at`, `lease_expires_at`, `created_at`, `revoked_at`, and
`effective_state:'paused'|'available'|'offline'|'revoked'`. The API omits owner
IDs and credential hashes. `offline` means no unexpired server lease, even if
the last report said available. Revocation takes precedence. UI polling can lag
the server by up to its 15-second refresh interval.

Provisioning derives the owner from Supabase Auth and returns a fresh 32-byte
secret once: `sbs_badge_<device UUID>.<43 base64url characters>`. Only SHA-256 of
that complete token is stored. It authorizes only state reports for its device;
it is not a Supabase session or service-role key. Use HTTPS with certificate
validation. The firmware permits plain HTTP only with an explicit local testing
flag. Never place credentials in URLs, logs, source control or screenshots.

The server uses its own clock for a fixed 45-second lease. New state changes and
heartbeats have strictly increasing sequences from 1 through 9,007,199,254,740,991.
An exact retry is idempotent and does **not** extend the lease; older sequences or
a different state under the same sequence return `409 stale_badge_report`.
Invalid/revoked credentials return `401 invalid_badge_credential`. Validation
uses 422 and transient server/database failures use 503. The device persists
reserved counter blocks across reboot; an erased counter requires revoking and
registering a new device. See [firmware setup](../hardware/README.md).

Local pause stops BLE immediately. If Wi-Fi is unavailable the database learns
the current state after reconnection; until then the prior lease can remain
valid for at most 45 seconds after its last accepted report. Power-off attempts
a pause report within a bounded grace period and otherwise relies on expiry.
The database row retains the last report; consumers must derive current status
from lease expiry and revocation, not `reported_state` alone.

## Spotify

- `GET /v1/integrations/spotify`: `{available,reason,connected,display,matching_supported:false,scope}`.
- `POST /v1/integrations/spotify/connect`: `{authorization_url,expires_in_seconds}`; open in a system auth browser.
- `GET /v1/integrations/spotify/callback?state=…&code=…`: server callback; single-use expiring state replaces bearer auth here.
- `DELETE /v1/integrations/spotify`: delete encrypted tokens/display data and cancel outstanding states.

Authorization Code with PKCE, fixed configured redirect URI, SHA-256 stored state, encrypted verifier and encrypted provider tokens are implemented. Current scope: `user-read-private`; account display name/link returned only to its owner. No Spotify history, derived personality profile, ML ingestion, or training is implemented. These uses are restricted by [Spotify's current Developer Policy](https://developer.spotify.com/policy). Users can independently self-report music interests through ordinary onboarding. A Spotify account connection is not a matching or training consent.

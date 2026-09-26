# SidebySide HTTP API v1

Base URL is the developer laptop/server reachable by the phone (not the phone's `localhost`). Interactive schemas: `/docs`; machine-readable: `/openapi.json`.

Every `/v1` endpoint requires `Authorization: Bearer <Supabase access token>` except Spotify's single-use-state OAuth callback. The API asks the configured Supabase Auth server to validate each token; client-supplied user IDs cannot impersonate actors. Privileged DB credentials stay on the server. Errors use `{ "error": { "code": "…", "message": "…" } }`; request schema errors use FastAPI's standard 422 `detail` array. No mock scoring or fallback authentication exists.

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
type ProfileDraft = {
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

Muse output is only a draft. The user explicitly selects confirmation, matching permission, and sharing scope at review. A public preview has separate approval; neither fact scope authorizes preacceptance disclosure. Settings display fields are not model features. Add a self-reported answer through `/profile/answers` before making evidence-linked new matching facts. Instagram/image/Spotify evidence is rejected by this release's runtime DTOs.

## Nearby and queued inference

| Method/path | Request | Response |
| --- | --- | --- |
| `PUT /v1/presence` | `{latitude,longitude,accuracy_m,observed_at:ISO8601}` | `{expires_at,refresh_after_seconds}` |
| `DELETE /v1/presence` | None | Disable location discovery and remove presence |
| `GET /v1/nearby?limit=20&cursor=…` | Optional opaque cursor, max limit 50 | `{items,snapshot_id,next_cursor,pending_count,abstained_count,unavailable_count,model,refresh_after_seconds}` |
| `POST /v1/feedback` | `{connection_id,conversation_useful:boolean|null,would_talk_again:boolean|null}` | `{feedback_id}` |
| `POST /v1/blocks/{user_id}` | None | `{blocked:true}` |
| `DELETE /v1/blocks/{user_id}` | None | `{blocked:false}` |

Nearby item: `{user_id,preview,score,status:'scored',distance_m,reason}`. Only scored candidates appear, sorted by descending uncalibrated directional relevance and UUID tie-break. Unavailable and abstained counts are separate, never fake zero scores. Public preview alone is returned; raw evidence, matching-only facts, goals and transcripts do not leak as reasons. The displayed `reason` describes the inputs generally, not a fabricated personalized explanation.

PostGIS enforces two miles (3,218.688 m), fresh presence, blocks in either direction, availability, matching consent, and both users' hard filters. Foreground presence defaults: 60-second client refresh, 300-second TTL measured from the observed instant, maximum accepted accuracy 250 m; no promise of continuous background tracking. Manual profile location is unrelated to live GPS.

Pagination captures a stable snapshot. `409 snapshot_expired` means reset pages and refetch; do not append stale pages. Snapshot ownership, eligibility, model version and expiry are checked on continuation. Poll at the returned 15-second bound while active. SQL invalidation clears affected snapshots; no globally readable Realtime stream is exposed.

The worker keeps deduplicated jobs in Postgres. Identity includes ordered participants, profile versions, context, invalidation revisions, explicit history-policy version, model revision, pipeline, policy and cache refresh epoch. Model changes cannot process old jobs under stale provenance. SQL leases, capped attempts, retry delay, current eligibility/version checks and publish-time validation prevent stale results. Local inference uses one API process with a warmed model and embedded worker. Remote mode disables API inference and uses a standalone worker against the same persistent queue; a private, expiring, exact-model heartbeat controls readiness. More inference replicas each load a model; distributed leases prevent duplicate claims.

Policy `onboarding-only-v1` excludes imported media and feedback from inference in this release. Explicit feedback is privately stored with null missing outcomes; it is not a negative label or training authorization. The model input preserves current preferences, roles, goals and openness; research `with_history` semantics remain untouched. New history-aware serving requires a separately versioned validation/evaluation change.

## Bluetooth and invitations

| Method/path | Request | Response |
| --- | --- | --- |
| `POST /v1/ble/sessions` | None | `{session_id,token,expires_at}` |
| `DELETE /v1/ble/sessions` | None | `{live:false}`; revoke tokens and disable BLE mode |
| `POST /v1/ble/encounters` | `{token,rssi?:number,observed_at?:ISO8601}` | `{status,score,reason,candidate_id?,preview?}` |
| `GET /v1/connections` | None | `{items:Connection[]}` |
| `POST /v1/connections` | `{candidate_id,mode:'nearby'|'ble'}` | `Connection` |
| `PUT /v1/connections/{request_id}/decision` | `{decision:'accepted'|'declined'|'revoked'}` | `Connection` |

A phone token is 32 random bytes encoded as 43 base64url characters, expires after at most 120 seconds, and is stored only as SHA-256. Rotate at ~90 seconds. Session issuance requires a confirmed profile and current matching consent; it explicitly opts into BLE. Encounter requests require both Live sessions and current eligibility. Invalid/expired/blocked encounters use generic `404 encounter_not_available`. RSSI is not GPS distance or identity proof. A known UUID or token is not permission to disclose details. A BLE invitation additionally requires the authenticated caller's fresh recorded encounter and a current scored result.

`Connection` includes `request_id`, `requester_id`, `recipient_id`, each party's decision, `status`, `preview`, `shared_profile`, creation/expiry. Status is `pending`, `accepted`, `declined`, `revoked`, `profile_changed` or `unavailable`. `shared_profile` is null before mutual acceptance and after expiry, revocation, a block, availability/filter/consent change, or profile version change. When authorized it contains only confirmed facts explicitly marked `after_mutual_consent`, stripped of evidence and internal IDs. Each actor can update only their own decision. Creating a request counts as that requester's acceptance of the bound version, not the recipient's.

## Spotify

- `GET /v1/integrations/spotify`: `{available,reason,connected,display,matching_supported:false,scope}`.
- `POST /v1/integrations/spotify/connect`: `{authorization_url,expires_in_seconds}`; open in a system auth browser.
- `GET /v1/integrations/spotify/callback?state=…&code=…`: server callback; single-use expiring state replaces bearer auth here.
- `DELETE /v1/integrations/spotify`: delete encrypted tokens/display data and cancel outstanding states.

Authorization Code with PKCE, fixed configured redirect URI, SHA-256 stored state, encrypted verifier and encrypted provider tokens are implemented. Current scope: `user-read-private`; account display name/link returned only to its owner. No Spotify history, derived personality profile, ML ingestion, or training is implemented. These uses are restricted by [Spotify's current Developer Policy](https://developer.spotify.com/policy). Users can independently self-report music interests through ordinary onboarding. A Spotify account connection is not a matching or training consent.

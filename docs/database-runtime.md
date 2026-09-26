# Application database runtime

The migrations in `supabase/migrations/` implement the onboarding-first mobile/API
runtime. Migration `202609260003` adds the application's onboarding evidence V4
contract on top of the original schema and worker registry. The existing
`data/schemas/matching-dataset-v2.schema.json` and `ml/` synthetic-only guards
remain unchanged. No Instagram ingestion, Spotify-to-model evidence adapter,
or shared-model training export is implemented here. Migration `202609260004`
adds a separate private Core2 registry for owner-managed credentials and badge
status; it does not change account availability or matching eligibility.

## Apply and verify

Initial deployment was verified on **2026-09-26** in the authorized Supabase
project: PostgreSQL 17.6, PostGIS 3.3.7, 19 application tables with RLS enabled on
all 19, and two private buckets. Migration `202609260001` is registered in
`supabase_migrations.schema_migrations`. No seed accounts or profiles were
persisted. The migration SHA-256 is
`f7a91259c3adb62a71afad8ecf98e7371e6ed8aff05a1db8a3fafdc912fbc867`.
Further schema changes must be new migrations rather than edits to the applied
file. Full SQL assertions passed against the actual PostgreSQL/PostGIS server
inside a transaction that was rolled back before deployment.

Migration `202609260002` subsequently added the server-only worker heartbeat
registry. Its SHA-256 is
`07cd9edcea0e89166d49c083bb6f7d11d50894cb619967aa2d71eba3dc6f633e`.
Verification after this migration found **20 application tables, all with RLS**,
two registered migrations, and no persisted Auth users, profiles, or synthetic
heartbeat rows from testing.

Migration `202609260003_onboarding_evidence_v4.sql` was applied and registered on
**2026-09-26**, with SHA-256
`7c50b5df78b4c3002513c4abefd85b4b59f5af213eb6ca6190257c09e6112618`.
Its forward migration and updated runtime assertions first passed against live
Supabase in a rolled-back transaction. The subsequent live smoke verified real
JWT authentication, request publication and stale-request rejection, queue and
radius behavior, invitation gates, BLE tokens, and RLS. All three temporary
Auth accounts were deleted afterward. No neural models were loaded or scores
published; the restarted API is healthy and the remote worker remains absent.

Existing profile versions are preserved; no request approval is backfilled.
Historical jobs/results retain their original identity, and the V4 runtime
excludes them from its cache/readiness and cancels incompatible claimed jobs.

Use a fresh local Supabase project for development:

```sh
supabase start
supabase db reset
# Set DATABASE_URL to the local database URL, including sslmode=disable.
python3 supabase/tests/run.py
```

`supabase db reset` erases a **local** development database and rebuilds it from
migrations and the fictional seed. Do not use reset against a production database.
Apply reviewed forward migrations through the normal Supabase migration workflow
for an authorized remote project. Inspect existing tables and migration history
first; do not replay the initial migration on an existing application schema.
Apply migration 003 before starting the V4 API or worker.
Apply migrations 004 and 005 before starting badge registration/state reporting.

After pulling the Connect/Matches navigation update on **2026-09-26**, migrations
`202609261430_navigation_preferences` and `202609261431_connection_constellation`
were applied on top of the already registered 001–011 migrations. The two new
migrations and navigation SQL assertions first passed in a rolled-back
transaction with isolated temporary fixtures. Only the migrations and ledger
records were then committed; no seed/reset ran and existing Auth/profile/version
counts were preserved. Verified the preference table's RLS/owner-read policy,
four service-only RPCs, and PostgREST schema reload. Page and constellation API
probes returned 200 with empty results for a nonexistent test actor. SHA-256:

- 1430: `662e1facb953be03fc5d25ba5d95df2166211a25daafcf0b3bf1f86bece6b598`
- 1431: `07da26507602733f4aafc966322232899bbb37ccfca93dbd9d5ff05a51dcbf01`

### Core2 registry

`badge_devices` binds an immutable owner and a hashed, per-device credential.
The authenticated API creates and lists only the caller's registrations.
Neither anonymous nor authenticated Supabase clients can directly read/write
the registry or invoke its RPCs. The service role invokes `report_badge_state`
under a row lock to verify the hash/revocation and advance a bounded monotonic
sequence. Exact retries preserve the original timestamp and lease; stale or
conflicting reports are rejected. `revoke_badge` verifies ownership and clears
the lease permanently. Account deletion cascades through registrations.

`reported_state` retains the last button report. For current status, prioritize
`revoked_at`, then require `lease_expires_at > clock_timestamp()`; otherwise the
badge is offline. A live lease lasts 45 seconds and firmware refreshes every
15 seconds. No expiry sweep or matching worker is needed to derive this status.
Badge reports never alter `profiles.available`, consent, profile versions, phone
BLE tokens or matching invalidations. `supabase/tests/badges.sql` exercises this
contract together with the existing runtime assertions in a rolled-back transaction.

Migrations 004 and 005 were applied and registered on **2026-09-26**, after
rollback-only checks against the authorized project. The existing two profiles
and one profile version were preserved. SHA-256 values:

- 004: `585fe4ba9de5720d2160b7708475ebeb80100f58efb8d6799f3428d853190ba2`
- 005: `e7d147e515c15b04036162054b93f01dd3eadd42791451b4465d86e3b9a91967`

005 preserves the original migration and changes the stale badge error to
PostgREST's explicit `PT409`. Live testing found that `40001` made the HTTP
request repeatedly retry until timeout. This is a
[documented Supabase/PostgREST behavior](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b),
so intentional badge conflicts must not use the serialization-failure code.

The test runner needs `psql`; it accepts `DATABASE_URL` or
`--env-file services/api/.env`. It runs in one transaction and ends in `ROLLBACK`.
On failure, closing the connection also rolls back. `--migrate` tests the entire
migration, including PostGIS installation, against an empty application schema
without applying it permanently. Without that flag, it tests an already
migrated database. It uses only four fixed fictional fixture identities and
rejects collisions with non-fixture accounts. Credentials are passed through
libpq environment variables and are not logged or embedded in shell arguments.

The SQL assertions cover real PostGIS radius/expiry behavior, evidence ownership,
source excerpts, immutable versions, RLS, privileged RPC access, actor-specific
connection decisions, profile publication, version-scoped consent, matching job
leases and invalidation, all four V4 decisions, nullable scores, frozen model/
policy provenance, BLE/GPS independence, consent revocation, and optimistic
onboarding revisions. Request assertions include immutable approval, mode/goal
coherence, legacy missing metadata, a pending empty goal, and rejection of a
confirmed empty goal or mismatched firsthand direction. These tests do not establish
model quality or physical Bluetooth reliability.

### CI without project credentials

`supabase/tests/bootstrap.sql` is a **CI-only** scaffold for a disposable database
named exactly `sidebyside_ci`. It refuses other database names and databases with
existing Auth, Storage, migration, or application schemas. It must never be
applied to Supabase. It supplies minimal `auth.users`, `auth.uid()`, Storage
tables/folder handling, and the anonymous/authenticated/service roles needed to
exercise the actual migration's RLS and RPCs on PostgreSQL/PostGIS.

The verified Docker image is `postgis/postgis:17-3.5`; its [Docker Hub tag
metadata](https://hub.docker.com/v2/repositories/postgis/postgis/tags/17-3.5)
identifies digest
`sha256:01a6a70e41e6c4467c8f55f6063555ed72db2d6662cd0d571040d42eadaeb6f6`.
Use an `amd64` Linux CI runner for that image. Configure `POSTGRES_DB=sidebyside_ci`
and a disposable test password in the service, then run:

```sh
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/bootstrap.sql
python3 supabase/tests/run.py --migrate
```

The CI database URL uses `sslmode=disable` against its local service. The image
normally initializes PostGIS in `public`; the guarded bootstrap recreates it in
`extensions` to match Supabase. No production migration contains that recreation.
This CI test proves the migration's PostgreSQL constraints/RLS, not all Supabase
Auth or Storage service behavior. The actual Supabase server was also tested
separately with rollback-only fixtures as recorded above.
The pinned CI image, bootstrap, migrations 001/002 and their complete SQL
assertions were also run successfully in a disposable local container on 2026-09-26. That
container was removed after validation.

The local seed contains fictional users around New York, including a nearby
candidate, an outside-radius candidate, and an expired observation. Seeded users
have no passwords or usable sign-in credentials. They are marked `synthetic`.
Presence expires normally; rerun the local seed through a reset to refresh it.
The seed is not a production data import and does not contain fabricated scores.

## Authorization boundary

The API must authenticate each bearer token with Supabase Auth and derive the
caller UUID from that authenticated identity. It then uses its backend-only
service-role client. Never accept a caller UUID from a mobile request body as
authorization. RPC arguments named `p_user_id`, `p_viewer_id`, and
`p_requester_id` are trusted **only because clients cannot invoke these RPCs**.

All application tables have RLS. Authenticated clients may select their own
profile, original answers, sessions, versions, presence, preview, consent, and
feedback. They may read their own blocks and connection requests they participate
in. They cannot mutate these tables directly. Raw scores, jobs, pagination
snapshots, BLE token registries, provider credentials, and OAuth states are
server-only. No policy grants public access to another person's underlying
profile or precise location.

`profile-imports` and `profile-photos` are private Storage buckets with size and
MIME limits. The object path must start with the authenticated owner's UUID.
Read/upload/delete policies are scoped to that prefix. Returning a signed photo
URL to someone else remains an API visibility decision; bucket access alone
does not grant matching or sharing consent.

Deleting an Auth account cascades through runtime tables. An account-erasure
operation must also remove its Storage objects and any external derived caches
before declaring erasure complete. Deleting an individual answer triggers
erasure of every profile snapshot containing it, which cascades through its
scores, jobs, feedback and requests and clears its active version pointer.
Training exports are unavailable in this release.

## Core tables and RPCs

All timestamps are `timestamptz`. Source/subject/owner identities are UUIDs.

| Contract | Fields and behavior |
| --- | --- |
| `profiles` | `user_id`, `display_name`, `discoverable`, `bluetooth_enabled`, `available`, `current_profile_version_id`, `settings`. Both discovery controls start false. The current-version foreign key includes its owner. |
| `onboarding_sessions` | `session_id`, `user_id`, `status`, `turns`, `draft`, `revision`, `started_at`, `completed_at`. One unfinished session per user. |
| `onboarding_answers` | `answer_id`, `session_id`, `user_id`, one of the seven `question_key` values, `question_text`, `answer_text`, `answered_at`. Updates are rejected; corrections append new answers. |
| `profile_versions` | Immutable snapshots with owned onboarding-answer evidence and exact supporting excerpts. Each fact source must appear in the frozen answer snapshot. Optional `conversation_request` binds reviewed mode, goal, and firsthand requirement to this version; missing legacy requests remain unapproved. |
| `profile_previews` | `user_id`, `enabled`, `preview`, `updated_at`. Separately approved fields: `display_name`, `headline`, `interests`, `occupation`. This does not reinterpret `matching_only` or `after_mutual_consent` facts as public. |
| `consent_receipts` | `consent_id`, `user_id`, `purpose`, `source_ref`, `policy_version`, `granted_at`, `revoked_at`. Purposes are `personal_matching`, `social_import`, `model_training`; these are independent. |
| `feedback` | Owner `user_id`, viewer/candidate version IDs, `data_origin`, `observed_at`, `context`, `outcomes`, optional private `explicit_comment`. Exact outcomes: `connection_accepted`, `conversation_useful`, `would_talk_again`, each boolean or null. Updates are rejected. |

Service-only RPC signatures:

```text
start_onboarding(p_user_id) -> onboarding_sessions row
append_onboarding_exchange(p_user_id, p_session_id, p_expected_revision,
  p_turns, p_draft=null, p_status='in_progress') -> onboarding_sessions row
publish_profile(p_user_id, p_session_id, p_profile,
  p_preview={}, p_settings={}) -> profile_versions row
```

`start_onboarding` resumes an unfinished session or creates one whose initial
assistant content is exactly `What makes you YOU?`. Append uses optimistic
revision checking; a conflicting or foreign session produces SQLSTATE `40001`.
The API maps this to a retryable conflict and uses message IDs for idempotency.
Store original answers before calling an external provider so failed calls do
not lose user input.

`publish_profile` locks the owned profile/session, builds source snapshots from
actual database answers, inserts the new immutable version, updates the current
pointer/settings, writes any explicitly supplied preview, and completes the
session in one transaction. Completed sessions may be used for later reviewed
edits. Optional `p_profile.answer_ids` selects a subset of that session's owned
answers; absent means all. Client-supplied snapshots or origins are not trusted:
this RPC always records `real_opt_in` and derives the source records itself.

`p_profile` contains `current_goal`, `conversation_intent`, `facts`,
`open_to_discussing`, `conversation_preferences`, `avoid_topics`, and optional
`conversation_request`.
`conversation_intent` is nullable free text, preserving what the person wants
from a conversation. It is distinct from the six-option `settings.matching_context`.
`p_settings` merges display/settings fields and may explicitly set
`discoverable`, `bluetooth_enabled`, and `available`. Enabling discovery requires
an active personal-matching receipt. `p_preview` is `{enabled, ...approvedFields}`;
an empty object leaves the previous preview intact. Supply `{enabled:false}` to
clear its visibility. Neither publication nor an OS permission grants matching
consent automatically.

`conversation_request` is `{mode, goal, evidence_requirement}`. The requirement is
`{version:1, kind, subject, claim, confirmation}`. `kind` is `none`, `firsthand`,
or `unresolved`; `subject` is `viewer`, `candidate`, `both`, or null; confirmation
is `confirmed` or `pending`. A firsthand confirmation needs a nonempty claim and
a compatible subject (`candidate`/`both` for `learn`, `viewer`/`both` for `share`).
`none` and `unresolved` require null subject/claim; unresolved cannot be confirmed.
Confirmed requests require a nonempty goal. Pending requests may retain an empty
goal, normalized against a null `current_goal` in storage.

SQL validates the request's shape, goal equality, and mode against the settings
published with the version. Muse proposals remain pending, and the app resets
confirmation after edits to the mode, goal, kind, subject, or claim. The API
requires a reviewed profile publication to change conversation mode; a direct
settings patch cannot silently reactivate an older request. The worker compares
its job context with the saved version. Missing, pending, or stale requests
produce `insufficient_evidence`; legacy profiles need review in Settings. Request
confirmation remains separate from fact approval, consent, and profile sharing.

## Presence, discovery, and connections

`presence` stores private `latitude`, `longitude`, `accuracy_m`, `observed_at`,
`expires_at`, and a generated PostGIS geography point. Expiry may be at most 30
minutes after the observation; the API normally uses a shorter configurable
window. Eligibility rejects expired and future-dated observations. The maximum
Nearby radius is **3,218.688 metres**, measured on geography rather than a degree
approximation. Accuracy is stored; the current server uses coordinates as the
observed estimate and does not promise precise distance from inaccurate GPS.

```text
eligible_pair(p_viewer_id, p_candidate_id, p_mode='nearby') -> boolean
nearby_candidates(p_viewer_id, p_radius_m=3218.688)
  -> rows {user_id, profile_version_id, distance_m, preview}
request_connection(p_requester_id, p_recipient_id,
  p_lifetime_seconds=86400, p_mode='nearby') -> connection_requests row
decide_connection(p_user_id, p_request_id, p_decision)
  -> connection_requests row
```

Every eligible pair needs two current profiles, availability, active matching
consent, and no block in either direction. The supported hard filter is
`settings.hard_filters.conversation_intents`, an optional allowed-context array;
despite the retained wire key's name, it compares the other person's selected
`settings.matching_context` (default `casual_chat`), not free-text profile intent.
Both people's filters apply. Other settings are not silently interpreted as
hard filters or model features. Contexts are `learn`, `share`,
`exchange_stories`, `collaborate`, `find_activity_partner`, and `casual_chat`.

Nearby also requires both GPS discovery controls and fresh observations inside
the radius. Candidate previews must be explicitly enabled to appear in the
Nearby query or receive an invitation through that mode. Geographic filtering
does not compute a model score. The API ranks only current V4 `recommend`
results and requires a recommendation before offering an invitation in either
Nearby or BLE mode. The service-only connection RPC continues to enforce
ownership, eligibility, and version-bound mutual acceptance.

BLE eligibility is independent of GPS/discoverable. It requires both
`bluetooth_enabled` switches and unrevoked active phone sessions.
`phone_ble_sessions` stores `session_id`, `user_id`, SHA-256 `token_hash`,
`issued_at`, `expires_at`, `revoked_at`; the raw bearer token is never persisted.
Tokens expire within ten minutes, with shorter rotations configured by the API.
`encounters` has `observer_user_id`, `observed_user_id`, `observed_session_id`,
`observed_at`, and optional `rssi`. The session-owner FK prevents claiming a
different observed owner. One observer/session pair is deduplicated. BLE
invitation requests additionally require a recorded encounter within five
minutes. An observed token is a proximity hint, not proof of identity or consent.

Requests contain both participant IDs and their version IDs, individual
`requester_decision`/`recipient_decision`, creation/expiry/update times, and
`request_id`. Decisions are `pending`, `accept`, `decline`, or `revoke`.
Creating a request accepts only on behalf of the requester. Opposite-direction
requests are serialized/deduplicated. The decision RPC changes only the caller's
side; an acceptance cannot reverse another participant's decline/revocation.
Acceptance rejects expired requests, stale profile versions, blocks, unavailable
profiles, or missing matching consent.

The internal `connection` eligibility mode rechecks consent/availability/blocks
and filters without requiring continued physical proximity. It does not itself
authorize disclosure. Every Matches/detail response must also verify both
decisions, expiry and exact current profile versions, then project only facts
whose sharing scope is `after_mutual_consent`. Never return raw version rows,
support excerpts, or private transcripts as match details.

## Persistent matching jobs and cache

Current policy `onboarding-evidence-v4` and pipeline
`online-approved-onboarding-evidence-v4` use only approved onboarding evidence,
with actual weights **1.0 / 0.0**. The pipeline combines pinned Qwen 4B relevance,
DeBERTa firsthand-evidence checks, MiniLM conversation-format comparison, and the
frozen selected calibration. MiniLM is a component, not a separately selectable
serving provider. Social evidence and feedback history remain excluded.

The selected policy SHA-256 is
`b1e4b4ef1c58f17007400f5064ef97b12d19489d1a78698ca177e2792080bf57`.
SQL's `matching_v4_identity` checks the exact Qwen model/revision, pipeline,
policy, and fingerprint. `matching_v4_provenance` additionally checks the evidence
and format model IDs/revisions, prompt, and feature versions. These helpers are
service-only. See [the pinned asset table and deployment guide](online-evidence-v4.md).
The synthetic calibration does not make scores real-world connection probabilities.

`matching_jobs` has:

```text
job_id, identity_hash (unique), viewer_id, candidate_id,
viewer_version_id, candidate_version_id, context, mode,
history_version, history_cutoff_at, model_id, model_revision,
pipeline_version, policy, policy_sha256, status, attempts, next_attempt_at,
lease_expires_at, lease_token, result, error, created_at, updated_at
```

Statuses are `pending`, `running`, `succeeded`, `failed`, `cancelled`. The API
constructs the identity hash from participants, immutable profile versions,
context, invalidation revisions, model/pipeline/policy/hash, excluded-history
version, discovery mode, and a cache refresh window; the database prevents duplicate identities. A worker uses:

```text
claim_matching_jobs(p_limit=10, p_lease_seconds=120) -> job rows
publish_matching_result(p_job_id, p_lease_token, p_result,
  p_ttl_seconds=300) -> boolean
fail_matching_job(p_job_id, p_lease_token, p_error,
  p_retry_seconds=30) -> boolean
```

Claims use `FOR UPDATE SKIP LOCKED`, unique lease tokens, bounded leases, and a
five-attempt limit. A publication must have the current unexpired lease, current
profile versions, current eligibility, and the pinned V4 job identity. Result
provenance must match the complete frozen policy and asset identity. `false`
means the job is no longer publishable and its result must not be displayed;
an old-policy job is cancelled, never promoted to V4. Failure scheduling is bounded; expired worker
leases can be claimed again.

`p_result` includes `status`, nullable `score`/`final_score`, `reason`, actual
channel weights, and full pinned provenance. If both score keys are supplied,
they must agree. The contract is:

| Status | Score and stored weights | API behavior |
| --- | --- | --- |
| `recommend` | Finite [0,1], onboarding 1.0 / social 0.0 | Ranked in Nearby; eligible for BLE invitation/banner |
| `not_recommended` | Finite [0,1], onboarding 1.0 / social 0.0 | Separate count, no ranking or invitation |
| `insufficient_evidence` | Null score and weights | Separate count; missing support is not a zero score |
| `unavailable` | Null score and weights | Separate count; inference is unavailable |

`match_scores` records directional identities, immutable profile versions,
model/pipeline/policy/hash, channel weights, history cutoff, expiry, and the
server-only result. A numeric zero is valid for a scored decision. SQL enforces
onboarding-only weights and no social score. Historical V1 score rows keep their
original `scored`/`abstained` states and identity; V4 lookups never serve them.
The API rechecks current eligibility before serving any cached recommendation.

`match_snapshots` stores `snapshot_id`, `viewer_id`, items, counts, timestamps,
and explicit model/revision/pipeline/policy/hash. It supports stable pagination
for at most ten minutes. V4 items contain only recommendations, sorted by
descending score and a candidate-ID tie-breaker. Counts separately retain
`pending_count`, `not_recommended_count`, `insufficient_evidence_count`, and
`unavailable_count`. Pending denotes waiting for a current result, not a model
decision. The API rejects expired, invalidated, or incompatible snapshot cursors
instead of combining ranking generations. Legacy snapshots need not be deleted
to be excluded by the new exact-identity lookup.

`matching_invalidations(user_id,revision,updated_at)` is the persistent change
signal for a worker. Profile/settings, preview, presence, consent, blocks, and
feedback changes delete affected scores/snapshots and cancel outstanding jobs.
The worker recomputes eligible directional pairs affected by new revisions.
Turning Live off or revoking matching consent also revokes active phone tokens;
matching revocation disables discovery and revokes connection requests. New
model/policy configuration must use distinct cache identities and trigger
fresh pair scheduling. Time expiry is always checked at read/publish time;
routine cleanup can later delete expired history to reduce storage.

### Remote worker readiness

`model_worker_heartbeats` is server-only and stores `worker_id`, model ID/revision,
pipeline, policy, `policy_sha256`, full `provenance`, `status`
(`ready`/`unavailable`), a safe reason, update time, and expiry. For V4, SQL requires
both the exact identity and full pinned asset provenance even for an unavailable
heartbeat. API readiness queries the configured model/revision plus V4 pipeline,
policy, and fingerprint. An old worker heartbeat cannot declare V4 ready.

The database limits heartbeat expiry to five minutes and rejects observations
more than five seconds in the future. The current worker refreshes every
20 seconds and uses a 90-second expiry. Keep machine clocks synchronized.
Readiness does not authorize disclosure, bypass a lease, establish model quality,
or guarantee a later inference succeeds. All three model assets must be cached
and loaded in a compatible worker environment; migration 003 starts no worker
and downloads no weights.

## Spotify state and credentials

`provider_oauth_states` contains a hashed state, owner, provider, encrypted PKCE
verifier, redirect URI, expiry and consumption time.
`consume_oauth_state(p_state_hash)` atomically returns and consumes an unexpired
state. An equivalent conditional update may be used by the API. State expires
within 15 minutes and may be consumed only once.

`provider_connections` contains owner/provider IDs, granted scopes,
`encrypted_token`, token expiry, `display_data`, connection/revocation times.
It is server-only even when the display data will be shown to its owner.
Encryption and key rotation belong to the API; never store encryption keys in
this schema. Disconnect clears the ciphertext and marks revocation. Current
Spotify integration is authorized account/display functionality. Spotify data
must not be fed into the matcher or model training through an invented
onboarding/post source type.

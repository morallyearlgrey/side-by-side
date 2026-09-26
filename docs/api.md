# Backend setup and integration notes

The FastAPI service in `services/api/sidebyside_api/` implements the application boundary. Bryan's `ml/` and `hardware/` research packages remain in place and retain their own commands and validation. HTTP request/response shapes are in [the v1 contract](../contracts/api.md); database RPC and ownership details are in [the runtime schema guide](database-runtime.md).

## Run locally

For Muse question-generation speed, request deadlines, and privacy-safe timing
logs, see [Muse latency](muse-latency.md).

From the repository root, with [uv](https://docs.astral.sh/uv/getting-started/installation/) installed:

```sh
uv sync
cp services/api/.env.example services/api/.env
# Fill the server-only environment file; never put these privileged keys in Expo.
uv run uvicorn sidebyside_api.main:app --app-dir services/api --host 0.0.0.0 --port 8000 --no-access-log
```

The phone's API URL is `http://<your-Mac-LAN-IP>:8000`. Set
`EXPO_PUBLIC_NATIVE_API_URL` in `apps/mobile/.env` to that address while keeping
`EXPO_PUBLIC_API_URL=http://127.0.0.1:8000` for the browser on your Mac. The native
override is optional; without it both platforms use `EXPO_PUBLIC_API_URL`.
Restart Metro after changing either value, and start it with `npx expo start
--dev-client --lan` from `apps/mobile` for physical phones. The phone and Mac must
be on a network that permits them to communicate. Check the LAN address again
after switching Wi-Fi networks. Use `http://localhost:8081` on the Mac for browser
location testing; an HTTP LAN page is not a secure browser geolocation context.
Production requires HTTPS. Restrict laptop network exposure to your development
network. Disable URL access logging because OAuth callback URLs contain short-lived
authorization codes. The application does not log bearer tokens, raw onboarding
answers, provider tokens, or private model inputs.

For `npm run web`, the example backend environment explicitly allows
`http://localhost:8081` and `http://127.0.0.1:8081`. If Expo opens another host or
port, add that exact browser origin to the `CORS_ORIGINS` JSON array and restart
the API. An empty array rejects cross-origin browser API requests. Native iPhone
requests do not use browser CORS. Production should list only its approved HTTPS
web origins.

In Supabase Auth's redirect URL allowlist, retain
`sidebyside://auth/callback` for native builds and add
`http://localhost:8081/auth/callback` for the default web development origin.
Add `http://127.0.0.1:8081/auth/callback` only if that is also used, and match any
changed Expo port exactly. Browser sign-up and password recovery use PKCE: open
the email link in the same browser/profile that initiated the request, using
the same origin. A new tab in that browser can access the persisted verifier;
another browser, private browsing profile, or a switch between `localhost` and
`127.0.0.1` cannot. Native email links must return to the app on the device that
started the request.

If a callback says it cannot find the verification key, the signup email may
already have been confirmed before the redirect. Use **Back to sign in** and
enter the email/password created during signup. This route opens the sign-in
form directly. For a password reset, request a fresh link from the browser/app
where it will be opened. Reopening a consumed link does not restore its key.
The callback deduplicates repeated effects for the same mounted link and only
offers a password-change form after a successful recovery exchange. It never
treats a missing key or an unrelated existing session as successful verification.
See [Supabase's PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

Python is pinned by the lockfile to a compatible `>=3.12,<3.14` range; `uv sync --python 3.12` chooses 3.12. Runtime dependencies and development tools are in root `pyproject.toml` / `uv.lock`. Run the API from the root so the separate `ml` package remains importable.

The settings loader reads `.env` then `services/api/.env`; real environment variables override both. Both environment files are ignored. Server configuration:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Project HTTPS URL |
| `SUPABASE_ANON_KEY` | Public key used only to contact the trusted project's Auth verifier |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged server-only PostgREST and account deletion credential |
| `DATABASE_URL` | Direct/pooler PostgreSQL connection string used by migration and SQL verification tools; not needed for normal HTTP API requests |
| `MUSE_API_KEY` | Meta Model API key; never exposed in the app |
| `MUSE_MODEL` | Default `muse-spark-1.3` |
| `MATCHING_EXECUTION` | `local` default or `remote`; remote readiness requires a fresh exact-model worker heartbeat |
| `MATCHING_PROVIDER` | `qwen` only for the online evidence V4 pilot; legacy `minilm` serving is unsupported |
| `MATCHING_MODEL_ID` | Default `Qwen/Qwen3-Reranker-4B` |
| `MATCHING_MODEL_REVISION` | Default 4B pinned revision `22e683669bc0f0bd69640a1354a6d0aebcfeede5` |
| `MATCHING_DEVICE` / `MATCHING_DTYPE` | Explicit supported local device (`cpu`, `mps`, `cuda`) / `float32` or `float16`; no silent fallback |
| `MATCHING_WARM_ON_STARTUP` | Default `false`; enable local warming after installing inference packages and all three pinned cached models |
| `WORKER_ENABLED` | Default `true`; embedded persistent-queue worker |
| `SPOTIFY_CLIENT_ID` | Registered developer application ID |
| `SPOTIFY_REDIRECT_URI` | Exact allowlisted server callback URL ending `/v1/integrations/spotify/callback` |
| `SPOTIFY_TOKEN_ENCRYPTION_KEY` | Fernet key for provider tokens and PKCE verifiers |
| `MOBILE_RETURN_URI` | Fixed app deep link after OAuth; default `sidebyside://settings` |
| `CORS_ORIGINS` | JSON array of explicit allowed browser origins; native requests do not require CORS |

Set `SPOTIFY_TOKEN_ENCRYPTION_KEY` using a generated Fernet key and keep it in secret storage; rotating it requires disconnecting/reconnecting previously encrypted accounts or a deliberate key migration. Development Spotify users must satisfy the account/app access rules shown in the developer dashboard. Without the registered app, redirects and encryption configuration, the API/UI report Spotify unavailable.

## Muse onboarding

Verified official provider contract: [Meta Chat Completions](https://dev.meta.ai/docs/protocols/chat-completions), `POST https://api.meta.ai/v1/chat/completions`, bearer authentication and model `muse-spark-1.3`. No alternative model is silently substituted. Muse runs on the backend, proposes questions and evidence-linked draft facts, and has no database tool access. API-supplied schema is validated locally; exact source excerpts and current ownership must pass before draft/profile publication. Provider credentials/access and output format may still fail at runtime; the original answer remains resumable and retryable.

Configuration readiness does not prove every future provider call will succeed. A synthetic live onboarding request was verified during implementation; this does not test arbitrary user dialogue quality. Grounded and editable facts, distinct role semantics, pending confirmation and optional permission prompts are essential parts of the flow.

## Bluetooth conversation ideas

Current Connect match cards and accepted Matches also request automatic Muse
activity suggestions through `/v1/matches/description`, using the reviewed
Supabase catalog. No separate Muse permission toggle is required. See
[activity suggestions and catalog import](activity-suggestions.md) for the
source, disclosure, expiry, fallback, and deployment contract. The existing BLE
conversation endpoint below remains available to older callers.

Recommended BLE encounters now include a talking point derived from enabled
profile previews. An exact shared interest produces "You both list pottery as
an interest." If only the other person lists it, the wording says so. With no
shared preview topics, the reason stays limited to being nearby and available.
This is a grounded talking point, not an explanation of the model's private
evidence or a claim about someone's experience.

The app requests `/v1/ble/conversation-ideas` separately so Muse never delays
Bluetooth discovery. Muse receives only the topic and a neutral version of the
reason; no names, IDs, coordinates, raw answers or matching-only facts. The API
uses the existing `MUSE_API_KEY` and `MUSE_MODEL`. It checks eligibility, recent
encounters, preview approval, current profile versions and recommendation before
and after generation. A changed or revoked context cannot return an old idea.

Generation has a 15-second deadline, at most four concurrent provider calls,
32 pending unique contexts and 256 cached results per API process. Successful
ideas are cached for five minutes; failures fall back to a clearly labeled
simple question and are cached for 15 seconds. Duplicate requests coalesce.
No database migration or additional model worker is needed for this feature;
the existing matching worker is still required to produce new recommendations.

## Foreground location checks

In Nearby, select **Explore my neighborhood** and grant location permission.
Keep the app/tab open until **Nearby is on** appears. The app requests a fresh,
high-accuracy fix, rejects fixes older than a minute or less precise than 250 m,
and publishes a foreground heartbeat every minute plus movement updates. A
failed permission, acquisition or API request shows guidance and **Retry
location**. It does not report success merely because the opt-in was saved.

Browser geolocation uses `maximumAge: 0`, high accuracy and a 25-second timeout;
it works without relying on a browser's optional Permissions API. Native uses
Expo's foreground permission and system-services checks. On iPhone, enable
Location Services and allow SidebySide **While Using the App**, with **Precise
Location** on. For a local server, also allow SidebySide's Local Network access.
The app does not request continuous background tracking. Pending work is retired
on backgrounding, account changes and unmount, and new location is not sent by
an old account's request.

Verify on both phones with the native build, a reachable backend and both apps
open. Browser permission behavior is separate from iPhone permission behavior.
An empty match list can still be correct: current profile requirements and a
running matching worker are necessary for new ranked recommendations, even
after location succeeds.

## Inference assets and deployment

The application now uses pipeline `online-approved-onboarding-evidence-v4` and
policy `onboarding-evidence-v4`. This replaces application V1 serving. It reuses
Bryan's frozen Qwen relevance/sufficiency prompts, V4 firsthand-evidence gate,
MiniLM format comparison, and selected calibration through a dedicated
`real_opt_in` adapter. The research `score_bundle` entry point still rejects live
profiles; no synthetic records or labels are fabricated to bypass that check.

The app intentionally supports approved onboarding evidence only: source weights
are 1.0 onboarding and 0.0 social, with no feedback history. This is a separately
identified online pilot, not deployment of every research V4 feature. The
[completed V3](ml-newton-results-852098.md) and
[V4](ml-newton-results-852419.md) Newton experiments remain reproducible research;
their synthetic results are not live-user accuracy or connection probabilities.

See [online evidence V4](online-evidence-v4.md) for the three exact model revisions,
the frozen policy fingerprint, request-confirmation rules, and reproducible
worker setup. Installing the optional packages does not download model weights:

```sh
uv sync --python 3.12 --extra inference
```

Inference needs **Qwen3-Reranker-4B, the pinned DeBERTa evidence classifier, and the
pinned MiniLM format encoder** in the intended host's local Hugging Face cache.
SentencePiece is included in the inference extra. DeBERTa and MiniLM load on CPU;
Qwen uses the explicitly configured device/dtype. All loaders use cached assets,
safetensors, and no remote code. A missing asset or unsupported provider/model
configuration makes the pipeline unavailable; no smaller model or learned-head
fallback is selected. Model loading is done once and scoring is serialized.
No downloads, training, checkpoint creation, or policy tuning happen on startup
or a profile edit.

A user-confirmed `conversation_request` is stored with each immutable profile
version. It binds the conversation mode, goal, and whether firsthand experience
is needed from the viewer, candidate, both, or neither. Changing any part requires
fresh review. Muse can propose a pending interpretation but cannot confirm it.
Older profiles remain readable; missing/pending/stale request metadata yields
`insufficient_evidence` until the user reviews it in Settings. A confirmed
request does not confirm facts, grant matching consent, or authorize disclosure.

Results distinguish `recommend`, `not_recommended`, `insufficient_evidence`, and
`unavailable`. Only the first two have numeric scores. Nearby ranks only
recommendations; BLE invitations and banners require a current recommendation.
Evidence failure is not a negative judgment about a person. Full source answers
are checked against approved fact scope and the requested claim; unsupported
claims, ambiguous requirements, boundaries, and token limits fail closed.
Public API responses never expose private per-fact evidence checks or prompts.

### Jobs and scaling

In local inference mode, run one API process for the first deployment; it contains one model runtime and an embedded worker. Remote mode uses the standalone worker described below. Persistent SQL jobs use row locks, leases, retries and at most five attempts. Changed profiles, location, filters, availability, blocks and consent invalidate affected scores/snapshots; background reconciliation schedules both directions for currently eligible nearby pairs. A periodic sweep catches expiry and model deployment changes. Snapshot pages expire/reset instead of mixing different rankings. Foreground clients use bounded polling; background mobile discovery reliability remains a separate device test.

Current reconciliation scans at most 1,000 recent invalidation actors per pass and 100 recent BLE encounters per actor. This is a small-project implementation, not an unbounded city-scale event processor. Larger deployments should use cursor-based durable event claiming and separated worker scheduling before exceeding these bounds. The app sends no profile data to an unconfigured external matching endpoint.

## Core2 Wi-Fi status

Apply `202609260004_badge_state.sql` and
`202609260005_badge_conflict_http_status.sql` before using the badge Settings section.
Sign in to the app, open **Settings → Your Core2 badge**, register a badge, and
copy its one-time token into the ignored Arduino `badge_config.h` file. The
phone uses its existing Supabase session to provision/revoke; the Core2 uses
only its restricted device token to `PUT /v1/badges/state`. The API keeps all
Supabase privileged credentials on the server.

Follow [the hardware guide](../hardware/README.md) for Wi-Fi, API address,
TLS CA configuration, compilation and physical tests. The API URL must be
reachable from the badge; the laptop's `localhost` is not reachable from Core2.
A deployed API needs HTTPS. Explicit HTTP opt-in is available for local network
testing. No public hosting or device flashing is performed by adding this code.

Badge state is recorded independently of phone discovery and matching consent.
Every accepted new report uses a 45-second server lease; 15-second heartbeats
keep it current. Settings shows offline when the lease expires. Pausing the
badge immediately stops its own local BLE advertisement; offline state changes
reach the database on reconnect. This integration does not render AprilTags or
add an AR identity lookup. See [the API contract](../contracts/api.md#core2-badge-status)
for the exact response, sequence, retry and revocation rules.

With the local API running and the authorized Supabase environment configured,
an explicit synthetic integration check is available:

```sh
RUN_LIVE_BADGE_SMOKE=1 PYTHONPATH=services/api uv run python services/api/tests/live_badge_smoke.py
```

It creates two temporary, confirmed test accounts, sends real HTTP requests,
checks authorization/state/revocation, and deletes the accounts in `finally`.
It sends no email, loads no model, and does not operate physical hardware.

## Spotify scope

The implemented flow uses the official [Authorization Code with PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow), a fixed redirect URI, expiring single-use state, encrypted verifiers/tokens, and `GET https://api.spotify.com/v1/me` for an owner-only account display/link. Disconnect removes token/display state. There is no ML import of Spotify content: the current [Developer Policy](https://developer.spotify.com/policy) restricts both analysis into user profiles and ingestion into AI/ML models. Independently self-reported music interests can still be discussed in onboarding. Do not use a user's confirmation to relabel imported provider data as self-reported evidence.

## Checks

```sh
uv run ruff check services/api
uv run pytest services/api/tests
uv run --extra inference pytest services/api/tests ml/tests
```

All model/identity test doubles live under tests and are injected explicitly; production settings contain no fake auth or random-score flag. Tests cover trusted Auth verification, private evidence/immutable profiles, resumable provider failures, source validation, directional text/feature parity, recommendation, supported-negative, insufficient-evidence and unavailable states, sorted snapshot pagination, consent/availability disclosure gates, token registry boundaries, worker provenance and PKCE state handling. Database migration/RLS tests are separate SQL checks; Bluetooth physical testing is separate from API tests.

To run the SQL checks, also fill `DATABASE_URL` in the ignored
`services/api/.env` with the authorized PostgreSQL connection string, install
`psql`, and run `python3 supabase/tests/run.py --env-file services/api/.env`.
The public Supabase HTTPS URL and service-role key cannot substitute for this
database connection. For a local Supabase database, include `sslmode=disable`;
the runner otherwise requires SSL. See the [database guide](database-runtime.md)
for the rollback-only test scope and separate CI bootstrap.

## Run the evidence V4 worker on an allocated Newton GPU

The local API and a remote inference worker share the private Supabase queue.
The worker needs outbound Supabase access, exposes no HTTP port, and does not
need Muse, Spotify, or the Supabase public key. Use the same application commit
and applied migrations on both sides. Follow the complete
[worker setup](online-evidence-v4.md#run-on-an-allocated-gpu) for environment,
assets, pinned configuration, and the launch command.

Bryan's Qwen cache was reported under
`/home/br123310/.cache/sidebyside-qwen` on `newton.ist.ucf.edu`. Verify all three
model revisions exist there before launch; a completed research job is not a
running worker. Bryan's reported research environment uses Python 3.11, while
the application requires Python 3.12 or 3.13. Create a separate compatible app
environment and verify CUDA there; do not replace the working research
installation. No Newton worker or allocation has been started by this integration.

The standalone worker warms all assets once, writes a private heartbeat every
20 seconds, reconciles pairs, claims persistent jobs, and publishes
version-checked results. Heartbeats expire after 90 seconds. API readiness
requires current model, pipeline, policy fingerprint, and pinned asset provenance.
A stopped allocation becomes unavailable; a process with missing assets exits
before claiming jobs. Remote mode never loads/claims inference in the API itself.

Migration `202609260001` creates the queue and runtime schema; `202609260002`
adds heartbeats. Forward migration `202609260003` adds conversation requests,
V4 decisions and provenance, and invalidates obsolete work/results. Apply it
before running the new API/worker. Migrations do not configure SSH, install
weights, or start a GPU allocation.

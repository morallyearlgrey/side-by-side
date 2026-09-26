# Backend setup and integration notes

The FastAPI service in `services/api/sidebyside_api/` implements the application boundary. Bryan's `ml/` and `hardware/` research packages remain in place and retain their own commands and validation. HTTP request/response shapes are in [the v1 contract](../contracts/api.md); database RPC and ownership details are in [the runtime schema guide](database-runtime.md).

## Run locally

From the repository root, with [uv](https://docs.astral.sh/uv/getting-started/installation/) installed:

```sh
uv sync
cp services/api/.env.example services/api/.env
# Fill the server-only environment file; never put these privileged keys in Expo.
uv run uvicorn sidebyside_api.main:app --app-dir services/api --host 0.0.0.0 --port 8000 --no-access-log
```

The phone's API URL is `http://<your-Mac-LAN-IP>:8000`. Production requires HTTPS. Restrict laptop network exposure to your development network. Disable URL access logging because OAuth callback URLs contain short-lived authorization codes. The application does not log bearer tokens, raw onboarding answers, provider tokens, or private model inputs.

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
| `MATCHING_PROVIDER` | `qwen` default, or explicitly configured `minilm` |
| `MATCHING_MODEL_ID` | Default `Qwen/Qwen3-Reranker-4B` |
| `MATCHING_MODEL_REVISION` | Default 4B pinned revision `22e683669bc0f0bd69640a1354a6d0aebcfeede5` |
| `MATCHING_DEVICE` / `MATCHING_DTYPE` | Explicit supported local device (`cpu`, `mps`, `cuda`) / `float32` or `float16`; no silent fallback |
| `MATCHING_WARM_ON_STARTUP` | Default `false`; enable after installing inference packages and cached assets |
| `MATCHING_MODEL_DIR` | MiniLM learned checkpoint/config directory, when selecting that provider |
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

## Inference assets and deployment

Installing optional Python packages does **not** fetch model weights:

```sh
uv sync --extra inference
```

For Qwen, separately obtain/cache the exact approved pinned model/tokenizer with permission for the chosen machine. See Bryan's [reranker deployment experiment notes](ml-newton-rerankers.md). Do not run his cluster jobs as part of API startup. After assets and compatible RAM/device are ready, set `MATCHING_WARM_ON_STARTUP=true`. The reused `QwenReranker` loads cached safe tensor weights with `local_files_only=True`; absent assets yield a readiness reason and `unavailable` scores. A completed Newton batch job is not an inference service.

Qwen 4B is a provisional research choice. The completed comparison used a tiny synthetic development set; no friendship probability or production accuracy is asserted. Inputs over its configured token cap abstain instead of truncating. Model loading happens once; inference is serialized through a lock and persistent worker claims. No training, checkpoint creation, or model download occurs on startup or a profile edit.

For an explicitly chosen MiniLM deployment:

1. Supply an `onboarding_only` learned `config.json` and `matcher.pt` from the preserved research feature contract. Other ablations are rejected by online v1.
2. Cache `sentence-transformers/all-MiniLM-L6-v2` at `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`.
3. Set `MATCHING_PROVIDER=minilm`, `MATCHING_MODEL_ID=sentence-transformers/all-MiniLM-L6-v2`, `MATCHING_MODEL_DIR` and `MATCHING_MODEL_REVISION` to the **SHA-256 of matcher.pt**.
4. Enable startup warming. The runtime verifies feature order, 71 dimensions, encoder metadata, normalization shapes/finite values, learned state and checkpoint hash. It rejects unsupported/incompatible assets.

The real-user Pydantic adapter accepts only reviewed `real_opt_in` profiles with owned, timestamped onboarding evidence. It calls shared feature or low-level text scoring only after online validation. It never feeds live users into a fake synthetic labeled bundle or disables `validate_bundle`. Parity tests compare generated Qwen text and all 71 MiniLM feature values to Bryan's original synthetic fixture behavior. Cosine/logistic baselines and research CLI behavior remain unchanged.

Model outputs have `scored`, `abstained` or `unavailable` states. Boundary strings require explicit future boundary-policy review; the current shared gate abstains. Missing approved evidence/openness also abstains. A high score cannot grant matching consent, invitation acceptance or disclosure permission. Model metadata accompanies persisted scores, not private per-fact reasoning in public API responses.

### Bryan’s source-aware V3 research and the application policy

Commit `c129aa9` adds [the automated matching V3 experiment](ml-matching-v3.md), including `ml/matching_v3.py`, synthetic dataset generation and `ml/tune_matching_v3.py`. It compares a source-aware candidate pipeline against the preserved reranker: separate onboarding/social relevance tasks, a Qwen evidence-sufficiency task, pinned MiniLM conversation-format affinity, contextual explicit feedback, scalar logistic calibration on synthetic training labels, and threshold selection on validation. The recorded status is locally tested with the full Newton 4B experiment still pending. Its 240 generated cases remain synthetic and unreviewed; calibration is not a human connection probability, and the experiment does not fine-tune Qwen’s weights.

The implemented API and standalone application worker continue to use `onboarding-only-v1` with pipeline `online-approved-onboarding-v1`: approved onboarding evidence, the original Qwen prompt or the compatible MiniLM learned head, no imported social evidence, and no feedback/calibration transformation in inference. V3’s new optional `instruction` parameter preserves Qwen’s original default, so the current online adapter remains compatible. The application does not discover or automatically activate a research `selected_policy.json` artifact.

V3’s source weights are a research heuristic: 70% onboarding plus 30% usable social comparisons, with social scores below the fixed 0.5 cutoff omitted and 1.0/0.0 fallback when none remain. That omission rule differs from treating an available supported social mismatch as zero. Do not describe V3 as a validated implementation of the original product’s source-weighting proposal or apply these weights to Spotify data. The runtime database currently enforces onboarding-only score provenance and weights.

Promoting a V3 variant would require a deliberate application change: a new policy and pipeline identity for jobs, scores, snapshots and worker readiness; online validation for the supported source channels and eligible viewer history; pinned format-encoder assets; persisted calibration/threshold/instruction provenance; and appropriate schema changes. Research states `recommend`, `not_recommended`, and `insufficient_evidence` also need an explicit API decision contract. A supported negative is not an unavailable model, an insufficient-evidence result must remain distinguishable, and no recommendation grants consent or profile disclosure. Keep the existing synthetic-only research validator intact.

The new `ml/slurm/matching_v3.sbatch` performs a bounded **research calibration/evaluation batch** and can deliberately stage the small pinned MiniLM encoder. It does not start `sidebyside_api.worker`, consume the live Supabase matching queue, or publish application readiness heartbeats. Running the standalone worker below is a separate deployment action and does not launch that experiment, train a calibration, or download model assets.

### Jobs and scaling

In local inference mode, run one API process for the first deployment; it contains one model runtime and an embedded worker. Remote mode uses the standalone worker described below. Persistent SQL jobs use row locks, leases, retries and at most five attempts. Changed profiles, location, filters, availability, blocks and consent invalidate affected scores/snapshots; background reconciliation schedules both directions for currently eligible nearby pairs. A periodic sweep catches expiry and model deployment changes. Snapshot pages expire/reset instead of mixing different rankings. Foreground clients use bounded polling; background mobile discovery reliability remains a separate device test.

Current reconciliation scans at most 1,000 recent invalidation actors per pass and 100 recent BLE encounters per actor. This is a small-project implementation, not an unbounded city-scale event processor. Larger deployments should use cursor-based durable event claiming and separated worker scheduling before exceeding these bounds. The app sends no profile data to an unconfigured external matching endpoint.

## Spotify scope

The implemented flow uses the official [Authorization Code with PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow), a fixed redirect URI, expiring single-use state, encrypted verifiers/tokens, and `GET https://api.spotify.com/v1/me` for an owner-only account display/link. Disconnect removes token/display state. There is no ML import of Spotify content: the current [Developer Policy](https://developer.spotify.com/policy) restricts both analysis into user profiles and ingestion into AI/ML models. Independently self-reported music interests can still be discussed in onboarding. Do not use a user's confirmation to relabel imported provider data as self-reported evidence.

## Checks

```sh
uv run ruff check services/api
uv run pytest services/api/tests
uv run --extra inference pytest services/api/tests ml/tests
```

All model/identity test doubles live under tests and are injected explicitly; production settings contain no fake auth or random-score flag. Tests cover trusted Auth verification, private evidence/immutable profiles, resumable provider failures, source validation, directional text/feature parity, unavailable vs abstained states, sorted snapshot pagination, consent/availability disclosure gates, token registry boundaries, worker provenance and PKCE state handling. Database migration/RLS tests are separate SQL checks; Bluetooth physical testing is separate from API tests.

To run the SQL checks, also fill `DATABASE_URL` in the ignored
`services/api/.env` with the authorized PostgreSQL connection string, install
`psql`, and run `python3 supabase/tests/run.py --env-file services/api/.env`.
The public Supabase HTTPS URL and service-role key cannot substitute for this
database connection. For a local Supabase database, include `sslmode=disable`;
the runner otherwise requires SSL. See the [database guide](database-runtime.md)
for the rollback-only test scope and separate CI bootstrap.

## Run Qwen on Bryan's allocated Newton GPU

The local API and a remote inference worker can share the same private Supabase queue. The worker needs outbound Supabase access; it exposes **no HTTP port** and does not need Muse, Spotify, or the Supabase public key.

Known assets reported by the project owner:

- Bryan's MiniLM cache is on his other Mac at `/Users/bryantaylan/Documents/Playground/side-by-side/.venv-ml/hf-cache`; it is not available on Kai's Mac, and a learned `matcher.pt` / `config.json` directory has not been supplied.
- The pinned Qwen 4B cache is under `/home/br123310/.cache/sidebyside-qwen` on `newton.ist.ucf.edu`. Bryan must supply his own authenticated cluster session and a running GPU allocation. An old batch result is not an active worker.

Local API configuration for that topology:

```dotenv
MATCHING_EXECUTION=remote
WORKER_ENABLED=false
MATCHING_WARM_ON_STARTUP=false
MATCHING_PROVIDER=qwen
MATCHING_MODEL_ID=Qwen/Qwen3-Reranker-4B
MATCHING_MODEL_REVISION=22e683669bc0f0bd69640a1354a6d0aebcfeede5
```

Inside **Bryan's already approved GPU allocation**, from the repository root with the same commit and inference dependencies installed, provide `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` through protected environment/secrets storage, then run:

```sh
# HF_HOME must point at the existing cache root (the snapshots normally live in its hub/ child).
export HF_HOME=/home/br123310/.cache/sidebyside-qwen
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export MATCHING_PROVIDER=qwen
export MATCHING_MODEL_ID=Qwen/Qwen3-Reranker-4B
export MATCHING_MODEL_REVISION=22e683669bc0f0bd69640a1354a6d0aebcfeede5
export MATCHING_DEVICE=cuda
export MATCHING_DTYPE=float16
PYTHONPATH=services/api uv run --extra inference python -m sidebyside_api.worker
```

This is a proposed startup command, not a report that a Newton session was started. Confirm the actual cache layout before starting; the worker never downloads missing weights and exits with an explicit asset/device error. Do not put credentials into a committed Slurm script or terminal output. The worker reads only consent-gated runtime profiles required for claimed pairs, so running it on an institutional machine also requires that environment to be approved for those users' data.

The standalone worker warms its model once, writes an expiring private `model_worker_heartbeats` record every 20 seconds, reconciles affected pairs, claims persistent jobs, and publishes version-checked scores. Its heartbeat expires after 90 seconds; a stopped allocation becomes unavailable automatically. The API queries a heartbeat for the exact model revision and pipeline before reporting remote readiness. The local API never loads/claims inference work when `MATCHING_EXECUTION=remote`, even if a worker flag was accidentally left enabled. A remote process with missing model assets does not consume queued jobs or fabricate unavailable scores in competition with a working GPU.

Migration `202609260002` adds the private heartbeat table. The initial queue/schema is `202609260001`. Neither migration configures SSH access or starts a GPU allocation.

# Implementation verification — 2026-09-26

The initial app implementation was integrated on top of Bryan's `c129aa9`
research commit. The evidence V4 upgrade below builds on his `caacaa0` commit.
Existing `ml/`, `hardware/`, and `data/` files were preserved.

## Evidence V4 integration

| Area | Evidence |
| --- | --- |
| API and research | 283 tests passed and 12 skipped across `services/api/tests` and `ml/tests`; Ruff and `git diff --check` passed. Contract and model-double tests verify decision handling, pinned provenance, reviewed requests, legacy profile compatibility, and onboarding prompt parity. They do not establish neural quality. |
| Mobile | TypeScript, Expo lint, and all 24 tests passed. New coverage checks confirmation invalidation after edits and excludes negative, deferred, unavailable, or incomplete results from ranked matches and BLE banners. The current Settings page renders the new request controls; no real user's confirmation was changed during verification. |
| Forward database upgrade | Migration `202609260003` and all runtime assertions passed against the authorized Supabase project inside a rollback transaction. The migration was then applied and registered with SHA-256 `7c50b5df78b4c3002513c4abefd85b4b59f5af213eb6ca6190257c09e6112618`. A disposable PostGIS database also passed fresh-schema and legacy-score preservation checks. |
| Live integration | Three temporary synthetic accounts used real Auth JWTs to verify request confirmation, owned evidence snapshots, stale-request rejection, immutable edits, radius selection, V4 queue identity, unavailable readiness, gated invitations, BLE token lifecycle, blocks, consent revocation, and direct RLS. All three were deleted afterward; the original two profiles and one profile version remained. This run loaded no model, claimed no shared jobs, and published no scores. |
| Running API | The local API was restarted after migration and reports the V4 pipeline. No ready remote worker is connected, so matching remains unavailable. |

The serving adapter is `online-approved-onboarding-evidence-v4`, policy
`onboarding-evidence-v4`. It uses approved onboarding data only, with explicit
request confirmation and separate `recommend`, `not_recommended`,
`insufficient_evidence`, and `unavailable` states. See the
[integration and worker guide](online-evidence-v4.md) for all three pinned
checkpoints and the frozen policy. Bryan's synthetic evaluation metrics do not
establish real-user accuracy for this adapter. Real model warming, uncached
serving latency, and end-to-end neural predictions remain unverified here.

## Initial implementation verification (historical)

| Area | Evidence |
| --- | --- |
| API and research | 159 tests passed across `services/api/tests` and `ml/tests`, including Bryan's new v3 tests; Ruff passed. |
| Existing scanner | Five hardware scanner tests passed. |
| Mobile code | TypeScript, Expo lint, and the web production export passed. Automated checks cover account ownership, cancellation, BLE session lifecycle, and resuming persisted onboarding replies. |
| Live Supabase | Both migrations applied, 20 tables with RLS, PostGIS, and two private buckets verified. SQL assertions passed in rollback transactions. The pinned CI PostGIS container also passed bootstrap, migrations, and assertions. |
| Live API integration | Temporary synthetic accounts used real Auth JWTs and actual PostgREST tables to check profiles, radius selection, queues, BLE token resolution/revocation, mutual acceptance, blocks, and consent. The integration scorer was explicitly a test fixture, not Qwen inference. |
| Live Muse | A synthetic onboarding answer produced a provider response and evidence-linked draft through the configured Muse API. |
| Browser walkthrough | At a 390×844 viewport: sign-in, Nearby, Bluetooth's native-build state, Matches empty state, Settings, profile save with a blank optional intent, persistence after reload, and sign-out. Rendering errors found during the walkthrough were fixed. |
| Cleanup | All temporary Auth accounts and associated app data were deleted. The UI test credentials file was removed. No synthetic match scores were inserted into the running production API. |
| Native setup | Expo SDK 54 prebuild, local module autolinking, CocoaPods 1.16.2 installation, Foundation-only BLE protocol checks, and Core Bluetooth controller typechecking passed. See the device guide for the latest native compile result. |
| Repository hygiene | Local environment files are ignored. A scan of Git candidate files against configured secret values found no matches. Generated native projects, installed dependencies, model weights, and build outputs are excluded. |

## External setup still required

- Configure personal signing in Xcode and connect/trust the physical iPhones.
  Neither installation on a phone nor
  radio exchange between two phones has been verified. Follow
  [the device acceptance procedure](device-testing.md).
- Bryan must start the matching worker inside an authorized Newton GPU
  allocation with all three pinned checkpoints and a separate compatible app
  environment. No Newton login, allocation, worker,
  or public endpoint was created during implementation. The app reports
  matching unavailable while no ready worker is present.
- A GPU allocation ending stops new scoring. Continuous availability needs
  continuous inference hosting. Bryan's research batches remain separate
  experiments; this app serves the versioned onboarding-only evidence V4
  policy described in [API setup](api.md).
- Confirm Supabase's Auth redirect allowlist and email delivery configuration.
  The live smoke used preconfirmed synthetic accounts; email confirmation and
  password recovery links were not sent as part of testing.
- Spotify requires developer application configuration. Instagram import and
  continuous background phone discovery are outside this implementation.

## Dependency audit

The compatible Expo 54 dependency tree currently reports **one high and three
moderate npm advisories**. `image-size` is used by Metro's local asset bundler;
the reported issues concern denial of service on crafted image input.
`decode-uri-component`, through `query-string` and Expo Router, reports malformed
URL decoding denial of service. These are unresolved dependency findings, not
a claim of a clean audit.

Forcing `image-size` 2.x into this Metro version was tested and rejected because
Metro calls its removed filename-based API, breaking both development and
production bundling. The lockfile retains the compatible implementation.
Use the committed repository assets for builds and upgrade the Expo/toolchain
together before general distribution. PostCSS and Xcode's UUID dependency were
updated using compatible overrides. Do not run `npm audit fix --force` without
checking SDK and native build compatibility.

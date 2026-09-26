# Implementation verification — 2026-09-26

The app implementation was integrated on top of Bryan's `c129aa9` research
commit. Existing `ml/`, `hardware/`, and `data/` files were preserved.

## Passed

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

- Finish Xcode's iOS platform installation, configure personal signing, and
  connect/trust the physical iPhones. Neither installation on a phone nor
  radio exchange between two phones has been verified. Follow
  [the device acceptance procedure](device-testing.md).
- Bryan must start the matching worker inside an authorized Newton GPU
  allocation with the cached checkpoint. No Newton login, allocation, worker,
  or public endpoint was created during implementation. The app reports
  matching unavailable while no ready worker is present.
- A GPU allocation ending stops new Qwen scoring. Continuous availability
  needs continuous inference hosting. Bryan's v3 calibration batch remains a
  separate research experiment; this app serves the versioned onboarding-only
  v1 policy described in [API setup](api.md).
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

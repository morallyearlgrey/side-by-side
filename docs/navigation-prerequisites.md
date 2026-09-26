# Reviewed Navigation Prerequisites

The user explicitly approved including necessary unpublished prerequisites on the dedicated navigation branch. They are separated from navigation/consent cleanup in the first commit. No shared schema is applied by either commit.

Source of the reviewed baseline: `/Users/bryantaylan/Documents/Playground/side-by-side-kai-review`, as preserved in the original navigation snapshot index. Paths below are relative to that repository. These are required code only, not a wholesale copy of its dirty checkout.

## Device Registration and Revocation

- `apps/mobile/src/features/devices/OptionalDevices.tsx`: existing Settings pairing, owner lease, unlink and signout behavior.
- `apps/mobile/src/features/devices/DisplayPermission.tsx`: explicit accepted-connection display consent, distinct from matching consent.
- `apps/mobile/src/features/devices/deviceStatus.ts`: computes offline/revoked/worn/AR-ready state without inferring device capability.
- `apps/mobile/src/features/devices/deviceStatus.test.ts`: covers those lease/status boundaries.
- `services/api/sidebyside_api/devices.py`: authenticated pairing/claim/lease/revocation and separately authorized display projection used by those controls.
- `services/api/sidebyside_api/badges.py` and `services/api/tests/test_badges.py`: narrow atomic marker-session report additions required by the existing optional charm/display protocol; no firmware copied.
- `services/api/sidebyside_api/repository.py`: preserve the database's 429 response for pairing throttles.
- `services/api/tests/test_devices.py`: owner/auth/isolation, expiry, revocation and display tests.
- `supabase/migrations/202609260009_optional_device_linking.sql`: private pairing, credential and owner-lease storage/RPCs.
- `supabase/migrations/202609260010_device_display_consent.sql`: explicit revisioned display consent and authorized projections.
- `supabase/migrations/202609260011_display_signout_barrier.sql`: signout epoch barrier preventing stale device responses from reviving display.
- `supabase/tests/devices.sql`: database-side privilege, pairing and consent regression tests.

## Authorized Meetup and Location

- `apps/mobile/src/features/meetup/ConnectionMeetup.tsx`: existing separate both-party sharing controls.
- `apps/mobile/src/features/meetup/useMeetup.ts`: existing focused/foreground polling, share lease and stale-response guard.
- `apps/mobile/src/features/meetup/types.ts` and `types.test.ts`: mutual opt-in and lease checks.
- `apps/mobile/src/features/meetup/MeetupMap.tsx` and `MeetupMap.web.tsx`: retain the existing explicitly labeled external-link/Leaflet fallback.
- `apps/mobile/src/features/nearby/presenceLocation.ts`, `presenceLocation.web.ts`, `presenceLocation.types.ts`: fresh position acquisition used by the copied meetup hook, including the WebKit timestamp correction.
- `apps/mobile/src/features/nearby/presenceObservation.ts`: rejects stale/invalid observations before sharing.
- `apps/mobile/src/features/nearby/presenceLocation.test.ts`, `presenceLocation.web.test.ts`, `presenceObservation.test.ts`: corresponding native/web/freshness regressions.
- `services/api/sidebyside_api/meetup.py` and `services/api/tests/test_meetup.py`: authenticated projection wrapper and tests.
- `supabase/migrations/202609260008_connection_meetup.sql`: locked both-party opt-in, current connection/profile/block checks and short-lived coordinate projection.
- `supabase/tests/meetup.sql`: database authorization/revocation tests.
- `apps/mobile/package.json`, `package-lock.json`: only Leaflet and its TypeScript types for the existing fallback.
- `apps/mobile/app.config.ts`: accurate permission text distinguishing discovery from separately authorized precise meetup sharing.

## Readiness Wiring

- `services/api/sidebyside_api/config.py`: the existing disabled-by-default fictional-demo scope flag.
- `services/api/sidebyside_api/jobs.py`: actor-scoped readiness and candidate/eligibility guards used by discovery; no scoring architecture change.
- `services/api/sidebyside_api/service.py`: passes the authenticated actor to readiness, while retaining upstream conversation methods.
- `services/api/sidebyside_api/main.py`: additive device/meetup route wiring, retaining upstream conversation endpoint/provider wiring.
- `supabase/migrations/202609260006_demo_worker_scope.sql`: service-only fictional-account scope/readiness guards required when that flag is enabled; not a worker deployment.
- `supabase/migrations/202609260007_demo_candidate_scope.sql`: candidates cannot escape the fictional-account scope.
- `supabase/tests/demo_worker.sql` and the single `raw_app_meta_data` fixture column in `supabase/tests/bootstrap.sql`: local/disposable SQL coverage for that scope.
- `services/api/tests/test_navigation_prerequisites.py`: new small regression coverage for actor-scoped readiness and unchanged ordinary candidate bounds, with no model calls.

## Deliberately Excluded

No source `.env`, credentials, hardware firmware, Quest builds, Newton deployment/preflight scripts, demo account creation scripts, model caches, training data, CUDA changes or Python worker implementations are included. `inference_backend.py`, `demo_worker.py`, `worker_preflight.py`, `demo_accounts.py`, and source changes to `matching.py`/`worker.py` are not navigation runtime dependencies and are excluded.

Upstream `foregroundLocation.ts`/tests and its `usePresence.ts` lifecycle remain the publishing implementation. The alternative snapshot `PresenceSession` controller is not imported into the publishing tree. Upstream conversation modules, types, API/service/provider wiring, native API URL selection, request deadline handling and Bluetooth query-pruning behavior remain intact.

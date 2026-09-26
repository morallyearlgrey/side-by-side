# SidebySide

An opt-in social discovery app: a conversation about what makes you **you**, a
two-mile Nearby circle, and direct phone-to-phone Bluetooth discovery.

## Run the app

Requirements: Node 22.13+, Python 3.12, npm, and [uv](https://docs.astral.sh/uv/getting-started/installation/).
The iPhone app uses **Expo SDK 54 / React Native 0.81**. Choose Xcode for both
your Mac and your test phone using [Apple's compatibility table](https://developer.apple.com/xcode/system-requirements).
The development Mac now runs macOS 27; its previous Xcode 16.2 could not prepare
the iPhone 17 Pro. Xcode 27 is installed and can prepare that phone. Review its license and
finish first-launch components before native builds. See
[device preparation and testing](docs/device-testing.md).

```sh
npm ci
uv sync
cp apps/mobile/.env.example apps/mobile/.env
cp services/api/.env.example services/api/.env
# Fill in local configuration. Never commit environment files.
uv run uvicorn sidebyside_api.main:app --app-dir services/api --host 0.0.0.0 --port 8000 --no-access-log
```

In another terminal:

```sh
npm run web                         # Review screens and account flows
# For iPhone builds, complete the Ruby/CocoaPods setup in docs/device-testing.md.
cd apps/mobile
bundle exec npx expo prebuild --platform ios # Generate disposable Xcode project
bundle exec npx expo run:ios --device        # Build/install on a connected phone
```

For a phone, set `EXPO_PUBLIC_NATIVE_API_URL` to the laptop's current LAN address,
such as `http://192.168.1.20:8000`. This overrides `EXPO_PUBLIC_API_URL` on native
devices while web can keep using localhost. Restart Metro after changing it.
For local native development, `EXPO_PUBLIC_NATIVE_API_FOLLOW_METRO=true` can
follow the selected Metro server's LAN hostname automatically while preserving
the API port/path. It only rewrites local HTTP API URLs in development; hosted
APIs, release builds, web, and Expo tunnel hosts keep their configured URLs.
`localhost` on a phone means the phone itself.
Use HTTPS for a deployed API. The phone and laptop must be on a network that
allows them to communicate. Expo Go/web cannot run the custom Bluetooth module.

Each teammate can sign a local build with their own free Apple Account in Xcode.
TestFlight and paid Expo build services are not required for this local workflow.
Free provisioning expires; see the [two-device guide](docs/device-testing.md).

## Configuration and database

- Mobile gets only the Supabase URL/publishable key and API URL.
- Backend gets the Supabase service-role key, Muse API key, and optional model/
  Spotify configuration. See [API setup](docs/api.md).
- Apply the migrations in `supabase/migrations/` to an authorized Supabase
  project. [Database setup and access rules](docs/database-runtime.md) explain
  migration history, RLS, synthetic seeds, and rollback-only tests.
- Allow `sidebyside://auth/callback` in Supabase Auth's redirect URL settings
  for native email confirmation and recovery. For Expo web testing, also allow
  `http://localhost:8081/auth/callback` and, if used,
  `http://127.0.0.1:8081/auth/callback`. Adjust the port to match Expo. Complete
  web email links in the same browser/profile and exact origin that started
  the flow; `localhost` and `127.0.0.1` have separate browser storage. Email
  delivery/provider configuration belongs to that Supabase project.
- Muse uses its real API. It produces editable, evidence-linked draft facts;
  the app requires the person to approve facts before matching.
- Recommended Bluetooth encounters show a specific shared-preview talking point
  and a Muse conversation question. Connect's notification lasts five seconds;
  its popup lasts up to sixty seconds and can be dismissed. Cards remain while
  the latest server response still recommends them with an unexpired lease.
  Repeated polling refreshes eligible cards without replaying automatic alerts.
  Private matching evidence is never shown as a reason.
- Nearby requests fresh foreground location with visible retry guidance.
  Location opt-in requires a saved profile and matching consent; incomplete
  model setup does not prevent checking location. Browser testing uses localhost
  or HTTPS, and physical phones need a reachable API address. See [API and
  phone network setup](docs/api.md).
- Mobile discovery switches accept taps across the entire row. A saved profile
  and matching consent are required to activate location or Bluetooth; missing
  match-suggestion details show review guidance without blocking device setup.
  Retry actions explain permission/service failures; phone-settings guidance is
  reserved for permission or radio/service settings problems. Location shows the
  last successful update and current radius, with an “Update my location” action.
  Confirmed on/off changes update local profile state without waiting for a poll,
  and new GPS observations or accepted BLE encounters refresh discoveries.
- Titled cards and sections can expand/collapse while preserving form state.
  The native 3D orbit includes a compatibility fix for React Native's partial
  Performance API. Actual iPhone orbit rendering, pause/manual rotation, and
  Profile/Settings card folding were checked. Native location permission and
  fresh acquisition, Bluetooth permission and foreground scan/broadcast state,
  and both full-row off controls were also verified on one iPhone. See
  [device verification](docs/device-testing.md) for the remaining touch/two-phone checks.
- Matching uses the **onboarding evidence V4 pilot**: pinned Qwen 4B relevance,
  DeBERTa firsthand-evidence checks, and MiniLM conversation-format comparison,
  with the frozen policy from Bryan's completed Newton experiment. The app uses
  approved onboarding evidence and a user-confirmed conversation request;
  imported social data and feedback history are excluded.
- Muse onboarding and match wording use minimal reasoning with bounded request
  deadlines. See [latency settings and measured results](docs/muse-latency.md).
  Muse availability is separate from the GPU matching worker's readiness.
- **All three cached models and a running inference worker are separate setup
  requirements.** Missing assets produce unavailable results, not fake scores.
  Nearby ranks only `recommend` decisions; unsupported requests remain
  `insufficient_evidence`. Existing users must review their conversation request
  in Settings. See [online evidence V4 setup](docs/online-evidence-v4.md).
- The completed [V4 research evaluation](docs/ml-newton-results-852419.md) used
  synthetic cases. Its results do not establish live-user accuracy or imply a
  running Newton worker. The app adapter has a separate versioned identity and
  retains the research package's synthetic-only input restrictions.
- Spotify requires an approved developer app/client ID and callback URI. It is
  an account/display integration; Spotify data does not feed personality
  inference, matching, or model training. Instagram import is deferred.

## Checks

```sh
npm run typecheck
npm run lint
npm test
uv sync --extra inference
uv run ruff check services/api
uv run pytest services/api/tests ml/tests
python3 supabase/tests/run.py --env-file services/api/.env
```

The database suite uses a transaction and rolls it back. It tests authorization,
real PostGIS radius queries, profile provenance, invalidation, and consent rules.
Tests using deterministic/mock encoders do not establish model quality. Radio
behavior needs two physical iPhones; record results in the device guide.

GitHub Actions runs app, API/research, database, and pure Swift protocol checks.
Neither CI nor ordinary app startup downloads model weights or trains a model.
See [verification results and remaining setup](docs/verification.md) for what
was exercised against live services and what still needs physical devices.

## Project directories

- [apps/mobile/](apps/mobile/): Expo Router screens, auth, profile review, Nearby,
  Matches, Settings, and authored Swift under `modules/nearby-ble/`.
- [services/api/](services/api/): authenticated FastAPI API, Muse onboarding,
  inference adapters, queued matching, BLE encounters, and Spotify OAuth.
- [supabase/](supabase/): migrations, private Storage policies, synthetic seed,
  and database tests.
- [contracts/](contracts/): API and phone BLE contracts.
- [ml/](ml/README.md): matching models, experiments, and tests.
- [hardware/](hardware/README.md): Core2 badge, discovery prototype and optional Wi-Fi status sync through the API.
- [data/](data/samples/README.md): sample data and matching schemas.
- [docs/](docs/): onboarding, matching, and experiment documentation.

The Core2 prototype remains independent of phone discovery. Its Pause/Available
button can now sync badge status to Supabase through the API; register its
restricted device key in Settings and follow the hardware setup guide. Bryan's research
schema, synthetic-only validation, pinned revisions, and benchmark fixtures are
preserved. Authored Swift lives outside generated `apps/mobile/ios/` so native
regeneration does not remove it.

## Collaborating

Agree on the API, evidence, and BLE contracts before editing shared interfaces.
Pull the latest `main` before starting; commit small verified changes and fetch
again before pushing. This implementation uses direct pushes to `main` as
requested. Preserve each other's work, resolve concurrent changes, and never
force-push. Commit migrations and lockfiles; keep keys, real user exports,
generated native projects, model weights, and datasets out of Git.

Keep meaningful implementation changes, verified setup, and remaining test
requirements reflected in the [shared project context](https://docs.google.com/document/d/16LQUGsSiZvThrdG2jEdftCsQugu3RHQhiiDbfilxiCs/edit)
as well as the repository documentation, then push the verified changes directly
to `main` using the workflow above.

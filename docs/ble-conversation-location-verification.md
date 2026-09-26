# Bluetooth conversation ideas and foreground location

Verified September 26, 2026.

## Changes

- Recommended phone BLE encounters display a deterministic talking point from
  enabled profile previews. Muse generates a short question from that topic.
  No private matching evidence, location, raw answers or identifiers are sent
  to the conversation generator.
- The popup lasts up to 120 seconds, with dismissal and earlier removal when
  Live stops, the encounter expires or its recommendation is withdrawn. The
  current Bluetooth card retains the talking point and question.
- Location setup is independent of AI readiness. Browser and native acquisition
  request a fresh high-accuracy position, show progress and allow retry. The
  acquisition timeout is 25 seconds; presence/settings API calls have 10-second
  deadlines, including authentication lookup and response-body parsing.
- Foreground presence updates every minute and on movement. Account changes,
  backgrounding and unmount retire pending work. A disabled matching query no
  longer renders an indefinite loading spinner.
- The optional `EXPO_PUBLIC_NATIVE_API_URL` allows the phone to reach the Mac's
  LAN API while the browser continues using localhost. Configuration values and
  credentials remain in ignored environment files.

## Verification

- Mobile typecheck and Expo lint passed; all **68 mobile tests** passed.
- The full API suite passed (172 tests before the final provider-budget test);
  the updated provider/encounter suites passed all **42 tests** afterward.
  Ruff and `git diff --check` passed.
- A live Muse call using synthetic shared pottery interests returned
  `source: "muse"` and "What do you enjoy most about pottery?" in 7.23 seconds.
  Its completion budget includes reasoning; a 500-token budget exhausted before
  content, so the provider now allows 2,000 tokens within a 15-second deadline.
- The existing authenticated browser preview first reported a location timeout.
  A subsequent foreground attempt progressed through **Saving your location**
  and successfully showed **Nearby is on · precise location stays private**.
  Coordinates were not printed or placed in test fixtures.
- The API responded successfully through both loopback and the Mac's current
  LAN address, and the running API exposes the conversation-ideas endpoint.

## Remaining device/model checks

- No physical two-iPhone Bluetooth exchange or iPhone GPS acquisition was
  performed in this verification. JavaScript tests do not prove radio behavior
  or phone network reachability.
- The live matching service reports `remote_worker_not_connected`. Location can
  be enabled, but new ranked AI matches and their BLE invitations still require
  the configured worker and eligible, reviewed profiles.
- Shared-preview talking points are not causal explanations of the private
  matching model. Muse output is constrained and validated structurally; this
  does not prove every generated question's semantic quality.

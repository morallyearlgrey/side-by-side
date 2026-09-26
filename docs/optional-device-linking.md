# Optional Quest and Core2 Linking

Implementation spans this API/mobile checkout and the existing Unity prototype
at `/Users/bryantaylan/Documents/Playground/side-by-side/apps/quest`.
Ordinary phone matching, invitations, meetup sharing and Newton scope are unchanged.

## Current Deployment

The confirmed existing Auth accounts were resolved uniquely by exact email in a
private operator script. A new Quest record belongs to Bryan; a new Core2 record
belongs to Kai. Bryan's two pre-existing badge registrations were preserved.
Migrations `202609260009`, `202609260010` and `202609260011` are applied. No AR
permission was granted, no connection decision was changed, and no synthetic
heartbeat was submitted for either physical device.

The scoped credentials are in ignored, mode-0600 files:

- `artifacts/device-linking/quest.json`
- `artifacts/device-linking/core2.json`

They intentionally have no API endpoint yet. The current phone API URL is
loopback-only. Neither credential has been installed. A database owner record
does not mean the hardware is connected or worn.

## Pairing And Presence

`POST /v1/devices/pairings` requires the owner's verified account session and
explicit choice of `quest` or `core2`. It issues a 256-bit private USB setup
approval, valid for three minutes and usable exactly once. Its random ID becomes
the device ID. The database serializes approval consumption and signout, derives
ownership from the approved account, stores only credential hashes, and never
reassigns an existing device. Issuance is limited to five per minute per account;
claim attempts are additionally limited per directly connected IP in the API
process. The approval is not a six-digit guessable public code and must never be
put on a public marker, BLE packet, URL query or log.

`POST /v1/devices/pairings/claim` exchanges that approval for either a
`sbs_headset_...` or `sbs_badge_...` credential. A lost claim response requires a
new approval and explicit revocation of the orphaned device; replay does not
return the secret. The operator provisioning helper uses the same exchange only
after explicit user-confirmed ownership and refuses existing active links of the
same kind. It never creates Auth accounts.

Headsets report to `PUT /v1/devices/headsets/state` every five seconds and on
changes. A monotonically increasing, durably reserved sequence rejects old
observations. Equal retries never renew a lease. Device presence lasts 15 seconds.
An independent 30-second owner lease is renewed by the authenticated, explicitly
enabled Devices view; headset credentials cannot renew that lease. The phone
ages both leases locally even if requests stop working. Connected/unknown,
connected/not-worn, AR-unavailable and AR-ready are distinct states. Worn reports
use the installed Meta XR Core 207.0.0 `OVRManager.instance.isUserPresent` plus
`HMDMounted`/`HMDUnmounted`; USB, a process and BLE never imply worn status.

Core2 keeps the existing 45-second status lease, boot-paused state, two-minute
random token/tag/address rotation and power-off control. V2 Wi-Fi reports add
`session_token`, `tag_id`, `marker_size_tenths_mm`, and `remaining_seconds` to the
scoped badge status request. They atomically replace the current association;
rotation cannot extend an earlier session. Pause, revocation and new legacy-v1
reports erase the association. Public BLE and tag formats are unchanged from the
working v2 prototype. The original hardware checkout is preserved; the merged
Wi-Fi + AprilTag firmware lives in this checkout's `hardware/core2-badge`.

Separately, every account receives one stable `tag36h11` marker in the Connect
dashboard. It is a public spatial anchor and does not encode an email, account
ID, or credential. This account marker is separate from the Core2 transport's
short-lived BLE/session token. The existing authenticated headset session,
mutual accepted connection, and both display permissions are still required
before any profile preview can be revealed.

## Consent-Controlled Display

In Settings > Optional devices, each participant explicitly enables AR display
for an already accepted connection. Permission expires after 15 minutes and
requires a fresh authenticated Devices view within 30 seconds. Neither a device
link nor a pending invitation grants AR permission. Both participants' choices
are required. Revision checks and signout tombstones reject delayed old opt-ins.
The permission affects only the add-on, not phone availability or matching consent.

`POST /v1/devices/headsets/reveal` accepts only a headset credential and an
observed token/tag/size. SQL checks current device/owner leases, worn, foreground,
camera/tracker readiness, badge state/session expiry, collisions, both decisions,
both separate display permissions, current profile versions, existing
`eligible_pair(..., 'connection')`, availability, matching consent and blocks in
both directions. The API then uses the unchanged app `connection_projection`
and rechecks authorization before responding. Only the app-approved preview
name and up to three interests are returned; no raw answers, evidence, full
profile, camera frames or worker inference inputs are sent.

The Quest's automatic mode is anonymous until authorized. X manual mode and Y
screen-test mode remain deliberate, visibly fictional demos. Revocation never
silently switches modes. Local tracking loss, pause, headset removal, background,
ambiguous discovery and marker changes invalidate pending replies and clear
private text. The local gate checks generation, request order and the exact
token/tag/size tuple. A copied public token/tag is not proof of physical wearer
identity; the shared display explicitly says it is not identity-verified.

## Timing Bounds

- Local marker loss uses the existing 350 ms maximum observation age; explicit
  pause/removal/background clears immediately on the local event/frame.
- Reveal requests repeat every two seconds with a three-second request timeout.
  Every private display lease is at most five seconds **from request start**,
  further reduced by all remaining server leases. A delayed reply cannot extend
  that cutoff. A failed request clears the local gate.
- A delivered remote revoke/block/decline/profile/consent change stops new
  authorization. A previously authorized display may remain until its current
  lease expires, at most five seconds; this is not instant remote revocation.
- An undelivered Core2 pause/power-off expires after its last 45-second heartbeat
  lease, and local marker/BLE loss normally hides sooner. Repeated old sequences
  cannot keep it alive. A lost headset heartbeat expires after 15 seconds.
- Offline phone signout/closed Devices view expires its owner/display activity
  within 30 seconds of the last accepted renewal. Online signout revokes headset
  credentials, cancels pending approvals, and invalidates separate AR permission.

## Finish Physical Setup

1. Parent coordinates reloading the existing API at port 8000; its current
   process has not loaded the new routes. Do not restart Expo or API independently.
2. Establish an approved HTTPS endpoint reachable from Quest and Core2, with
   trusted TLS and no redirects. Obtain its issuer root CA and the Core2's Wi-Fi
   configuration privately. No Supabase key or account password goes on hardware.
3. Install the compiled Quest development APK only after coordination. Keep the
   Quest connected by USB, approve USB debugging inside the headset, and use its
   exact serial with `hardware/prepare_device.py --credential
   artifacts/device-linking/quest.json --api-url HTTPS_URL --install-quest
   --serial SERIAL`. The helper needs `adb` on PATH. It streams only the scoped
   key into app-private internal storage, refuses an existing config, and does
   not install/relaunch the APK itself. Relaunch after configuration.
4. For Core2, prepare a mode-0600 JSON file containing only `ssid` and `password`.
   Run `hardware/prepare_device.py --credential artifacts/device-linking/core2.json
   --api-url HTTPS_URL --wifi-config PRIVATE_JSON --root-ca ROOT_PEM`. It stages
   firmware under ignored `artifacts/device-linking/core2-badge`, preserving any
   existing configuration. Build with `bash hardware/build_core2.sh
   artifacts/device-linking/core2-badge artifacts/device-linking/core2-build`;
   its private umask protects binaries that embed the scoped key.
   Flash only after parent coordination, using the confirmed Core2 USB port and
   the previously reliable 115200 upload speed. Opening serial may restart it.
5. Verify actual reports: Core2 boots paused, A starts a new tag/session, B and
   the two-minute timer rotate it, pause/off clear it. Bryan explicitly enables
   the headset session in Devices. Confirm worn/removed, focus, camera readiness,
   loss/reacquisition and network expiry using real heartbeats, not injected ones.
6. Complete the ordinary app invitation and both acceptance decisions. Only then
   may both users choose the separate AR permission. Keep both Devices views open
   during the prototype session. Check reveal, revoke, block, end, pause, rotation
   and network loss. Linking approval does not authorize performing these choices
   on behalf of either user.

All migrations were exercised in a disposable Docker PostgreSQL/PostGIS database
with rollback and the existing runtime, meetup, badges and fictional-worker SQL
regressions. `supabase/tests/run_devices.py` is intentionally Docker-only. The
live migration helper applies only the explicit additive files and never seeds,
resets, or deletes existing account data.

## Build Evidence

The Quest Android development APK built successfully at
`/Users/bryantaylan/Documents/Playground/side-by-side/apps/quest/Builds/SidebySideQuest.apk`
(76 MB). The authorization state machine, tracking/coordinate tests, nearby
discovery states, packaged Java bridge and required permissions checks passed.
Java BLE tests separately passed parsing, metadata, expiry, ambiguity and conflict
checks. These results are not physical headset verification.

The merged Wi-Fi + AprilTag Core2 firmware compiled and linked successfully on
ESP32 package 3.3.11, M5Unified 0.2.23 and M5GFX 0.2.30 with
`esp32:esp32:m5stack_core2:PSRAM=disabled`. The installed M5GFX miniz declarations
must be preincluded to avoid an SDK include-guard collision. Both choices are
captured in `hardware/build_core2.sh`. Default PSRAM-enabled linking exceeded
IRAM by 2,764 bytes; the supported disabled setting resolved it without moving
interrupt code or patching the SDK. The successful test image uses 1,911,983 bytes
of program storage and placeholder credentials only. It is not a provisioned
image to flash. Host protocol checks cover all 587 tags, packet bounds and
sequence reservation; all seven scanner tests passed.

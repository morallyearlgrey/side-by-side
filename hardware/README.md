# Companion Charm on M5Stack Core2

The Core2 displays its owner's stable `tag36h11` AprilTag and advertises an
expiring Bluetooth session. Wi-Fi reports the session, tag, and device state to
SidebySide. The account owns the device through a scoped pairing credential;
an email address or account access token is never broadcast.

## Controls

The three capacitive buttons below the screen work on both screens:

- **Left — Home:** show Companion Charm, the owner's name, special ID, and status.
  Returning Home hides the marker but leaves an enabled sharing session running.
- **Middle — Tag / sharing:** toggle sharing. On shows only the complete AprilTag
  on a white screen. Off hides the marker, stops BLE advertising immediately,
  and sends a pause to the server to clear the device's session association.
- **Right — Power:** stop sharing, attempt to sync the pause, then power off.
  USB power may require deep sleep; test complete power-off on battery.

Boot always starts with sharing off. Enabling requires a recent authenticated
server response permitting sharing. Enable **Nearby sharing** in the phone app
first. Device buttons cannot override the account's privacy settings. Phone
sharing being switched off is observed on the next heartbeat (normally within
15 seconds); if the charm loses its connection, it stops sharing after the
30-second freshness window. Local off is immediate even without Wi-Fi.

The visible AprilTag **never cycles**. Its ID is allocated once for each profile
in the database and shown on Connect as the user's Comet Charm. Random Bluetooth
session tokens and radio addresses still rotate every two minutes; these do not
change the visible special ID. The marker is an AprilTag, not a QR code.

The Core2 has no GPS. The phone supplies any app location permission/location
updates. The charm controls its own Bluetooth, marker, and accessory presence;
it does not change the phone's OS permission or independently measure location.
A tag plus BLE session is not permission to reveal a profile: the headset's
separate wearer, current account, connection, and display-consent checks remain.

## Pair and provision

1. Sign in to the intended owner account in SidebySide. Settings → **Approve
   charm pairing** creates a single-use approval that expires in three minutes.
   Claim it using `POST /v1/devices/pairings/claim` with the approval as bearer.
   Store the resulting device token privately. Never commit it or log it.
2. Read the owner's `april_tag.tag_id` from authenticated `GET /v1/me` (or the
   owner's Connect card). Generate the private identity header from that same ID:

   ```bash
   node hardware/generate-charm-identity.cjs 3 Kai
   ```

   This generates `core2-badge/badge_identity.h`; it does **not** create a new ID
   or authenticate ownership. The API verifies the owner's allocated tag.
3. Copy `core2-badge/badge_config.example.h` to `badge_config.h`. Supply Wi-Fi,
   API HTTPS URL, device token, and the API's trusted root CA. Both private
   headers are gitignored. The configured Kai device uses **Kai's iPhone**
   hotspot. Keep Personal Hotspot enabled; enable Maximize Compatibility for
   the Core2's 2.4 GHz Wi-Fi when needed.
4. Build and upload as below. Provisioned binaries contain the private values;
   keep them private too. A new owner needs a new credential and their own tag.

The marker uses the same `apriltag` family data as the Connect renderer. Its
200-pixel square contains a 160-pixel black border, approximately 20.3 mm wide on
[the Core2's 2-inch 320×240 display](https://docs.m5stack.com/en/core/core2).
`marker_size_tenths_mm=203` describes that black border, excluding the white
quiet zone. Confirm the physical size if changing the display/layout.

## Build and upload

Validated setup: ESP32 board package **3.3.5**, M5Unified **0.2.23**, M5GFX
**0.2.30**, NimBLE-Arduino **2.5.1**, FQBN `esp32:esp32:m5stack_core2:PSRAM=disabled`.

`hardware/build-core2.sh` performs the complete cloud + BLE build. It accepts
`ARDUINO_CLI`, `ARDUINO_CONFIG_FILE`, `M5UNIFIED_LIBRARY`, `M5GFX_LIBRARY`, and `NIMBLE_LIBRARY`
environment variables if these are not installed in the default locations.
Use fully downloaded libraries outside folders with cloud placeholders.

```bash
hardware/build-core2.sh artifacts/core2-build
```

The advertiser uses NimBLE with unused scanner, central, and peripheral roles
disabled. The larger Bluedroid host exhausted the internal heap needed for TLS
on this device; NimBLE leaves room for Bluetooth and verified HTTPS together.

The script uses C++ link-time optimization and `-fno-strict-aliasing`. C source
must not use LTO because this ESP32 version's panic handler fails to link with
it. `cfg.internal_rtc=false` removes the unused RTC/timezone path; NTP supplies
UTC for TLS. The final build has little instruction RAM headroom, so a successful
full link is required after changes. Do not enlarge the linker memory limits.

On Apple Silicon, Arduino's `ctags` must be an executable native Arduino fork
that supplies `returntype` fields; generic Universal Ctags is incompatible with
Arduino sketch preprocessing. Incorrect generated prototypes are a toolchain
problem, not a reason to remove valid return types from the sketch.

Upload the compiled image to the observed USB serial port:

```bash
arduino-cli upload \
  --fqbn esp32:esp32:m5stack_core2:PSRAM=disabled \
  --port /dev/cu.usbserial-YOUR_DEVICE \
  --input-dir artifacts/core2-build/firmware \
  --upload-property upload.speed=115200 \
  hardware/core2-badge
```

Add `--config-file` if using a non-default Arduino CLI config. Close Serial
Monitor before uploading. Do not erase NVS while reusing a device credential.
If device storage is erased, revoke and pair it again.

## Server contract and troubleshooting

`PUT /v1/badges/state` receives `state`, monotonically increasing `sequence`, and
for available sessions `session_token`, `tag_id`, `marker_size_tenths_mm`, and
`remaining_seconds`. Paused reports have no session metadata. Apply migrations
through `202609261801_stable_badge_session_binding.sql` and deploy the matching
API. A successful response must include boolean `sharing_allowed`.

A background task handles Wi-Fi, NTP and HTTPS so the buttons keep responding.
Certificate, hostname, and date validation remain enabled; redirects are
blocked. No device secret is printed. The sequence counter reserves blocks in
NVS before use. Retries keep their sequence; duplicate retries do not extend
leases. The API gives accepted state a 45-second lease and clears marker/session
association on pause. Only the current local revision can become synced.

Home reports cloud disconnected, clock waiting, revoked credentials, or a
configuration/sequence error separately from local sharing. A revoked credential
requires pairing again. A missing API permission field is a configuration error;
do not deploy firmware against an older API and assume permission was granted.

USB serial at 115200 baud: `s` status, `a` sharing on, `p` sharing off, `h` Home,
`b` middle-button toggle, `x` power off. These are local cable diagnostics.

## Verification

Host checks:

```bash
clang++ -std=c++11 -Wall -Wextra -pedantic hardware/tests/protocol_test.cpp -o /tmp/charm-protocol-test
/tmp/charm-protocol-test
clang++ -std=c++11 -Wall -Wextra -pedantic hardware/tests/sync_policy_test.cpp -o /tmp/charm-sync-test
/tmp/charm-sync-test
python3 -m unittest discover -s hardware/scanner -p 'test_*.py' -v
```

On actual hardware, check boot off, middle button on, stable tag, Home navigation,
then middle button off. Confirm BLE packets stop and the database session clears.
Test phone sharing off, Wi-Fi loss, reboot, and battery power-off. The app's
per-user tag allocation and the accessory binding also have API/database tests.

The scanner uses `hardware/scanner/requirements.txt` and
`hardware/scanner/scan_badge.py --seconds 0`. Grant macOS Bluetooth access when
prompted. Scanner RSSI is signal strength, not precise distance or identity.
The Core2 protocol is a 30-byte legacy advertisement containing custom service
UUID `defb0de6-0009-47e1-acd7-b6de56c6978f`, version 1, and eight random session
bytes. Scannable, non-connectable advertising uses a random private address;
the scan response identifies the service and generic name SidebySide.

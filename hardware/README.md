# Core2 Discovery Prototype

One Core2 advertises a temporary identifier; a Mac scanner reports discovery and
expiry. With optional Wi-Fi configuration, the badge also reports its own
paused/available state to the API and database. Without that configuration it
remains a local BLE prototype. This sketch does **not** render AprilTags, alter
profile availability, authorize matching or consent, reveal profiles, or
integrate with Quest. If an AprilTag sketch is running on the device, uploading
this sketch would replace it; port the small cloud interface described below
into that sketch to preserve its display.

## Badge Controls

- Boot: paused. No BLE advertising until the wearer explicitly enables it.
- Bottom-left touch button A, or tap the central state rectangle: Available/Paused.
- Bottom-middle button B: new session immediately, but only while available.
- Bottom-right touch button C: power off, preserving the previous sketch's control.
- Every two minutes while available: stop, change the session token and Bluetooth
  address, then resume. Resuming from pause also creates a fresh session.
- The cloud status line reports `SYNCING`, `SYNCED`, `OFFLINE`, a configuration
  error, or `NOT CONFIGURED` independently of the local BLE state.

The screen says Bryan by default; change `DISPLAY_NAME` in the sketch for Kai.
That text appears only on the physical display, not in Bluetooth packets.
The complete session token appears on the display and USB serial console so it
can be compared with the scanner during the test.

USB power may affect true power-off behavior. The firmware first stops Bluetooth,
calls M5Unified's power-off routine, and uses deep sleep if that routine returns.
Unplug USB for a battery-only power-off test. It never powers off automatically
at boot. The old placeholder remains at:
`/Users/bryantaylan/Documents/Playground/core2-placeholder/core2-placeholder.ino`.

## Optional API and Database Reporting

1. Apply the API's badge migration and run/deploy the API. Sign in to the mobile
   app, create a Core2 badge in the badge management screen, and copy the one-time
   `device_token`. Alternatively, use authenticated `POST /v1/badges` with a
   `label`. That account owns this device record; firmware never supplies an
   owner ID. Revoke the record in the app if its secret is lost or exposed.
2. Copy `core2-badge/badge_config.example.h` to `core2-badge/badge_config.h`.
   The latter is gitignored. Enter Wi-Fi credentials, the API base URL, the
   per-device token, and the PEM root CA that validates the API hostname.
   Do not put an account access token or Supabase service-role key on the badge.
3. Build and upload using the instructions below when ready. This change has
   not been uploaded automatically. The normal build has cloud reporting
   disabled when `badge_config.h` is absent.

HTTPS verifies the certificate chain, hostname, and certificate dates. The
badge obtains time from NTP (`pool.ntp.org`, `time.nist.gov`); `WAIT FOR CLOCK`
means time has not synchronized. A wrong CA/hostname, unreachable API, or Wi-Fi
failure leaves cloud reporting offline while local buttons continue to work.
For an explicitly chosen trusted LAN development server only, setting
`BADGE_ALLOW_INSECURE_HTTP` to `1` permits `http://`; this sends the device secret
unencrypted. The default rejects HTTP, and HTTPS never disables verification.
Use the Mac's LAN address when developing locally: `localhost` on the badge is
the badge itself. The server must listen on the LAN interface.

The firmware sends `PUT /v1/badges/state` with its device bearer token and a
JSON body such as `{"state":"paused","sequence":1025}`. It reports paused at
boot, a fresh state after a button action or BLE failure, and a heartbeat every
15 seconds while powered on. Rotation sends the current state too. The API
timestamps the report and gives it a 45-second lease; a missed lease makes the
device's effective state offline. This report does not map a BLE session token
to a user and does not modify the account's matching/consent settings.

Wi-Fi, DNS, TLS, and HTTP run in a separate FreeRTOS task. A one-entry mailbox
keeps the latest requested state, so a pause supersedes queued availability.
Local advertising stops before a pause is queued. A request already in flight
may finish first; the newer sequence wins once the pause reaches the server.
The display shows `SYNCED` only for the current local state. Retries keep the
same sequence until the next heartbeat; duplicate retries do not extend the
server lease. No network request blocks the M5 button loop (the existing BLE
controller acknowledgements still have their own two-second timeouts).

The badge reserves sequence numbers in blocks of 1024 in NVS before use. On
reboot it skips unused numbers so an old request cannot override the boot
pause. The NVS namespace derives from the credential. Never erase NVS and reuse
the same device record: revoke it, create a new badge, and configure its new
secret. HTTP 409 displays `REPROVISION BADGE`; 401/403 displays `CHECK DEVICE
KEY`. These errors stop retries until reboot/configuration is repaired. NVS
write failure displays `CONFIG ERROR`. Secrets are never printed by the sketch,
but remain in its configuration and firmware image; keep both private.

Power-off stops BLE immediately, queues paused, and gives the cloud request up
to four seconds to finish before shutting down. If it cannot deliver the pause,
the last server lease expires after 45 seconds. Sudden power loss has the same
lease behavior. A locally paused/offline badge does not prove the database has
already received the pause; check the cloud status or badge management screen.

To integrate with a separate AprilTag sketch, copy `badge_cloud.h`,
`badge_cloud.cpp`, `badge_sync_policy.h`, and your private `badge_config.h` into
its sketch folder. Call `badgecloud::begin()` once after initialization,
`badgecloud::publish(!paused)` after changing local state, and
`badgecloud::poll()` each loop. Render `badgecloud::statusLabel()` near that
sketch's own status indicator. Preserve its tag rendering and local pause
semantics, and queue `publish(false)` before power-off. The transport itself
does not render or erase the display.

## Build and Upload

Toolchain used for the original hardware test:

- Arduino IDE's bundled Arduino CLI.
- Espressif ESP32 board package 3.3.11.
- Board: `M5Core2`, FQBN `esp32:esp32:m5stack_core2`.
- M5Unified 0.2.23 and its installed M5GFX dependency.
- Built-in ESP32 BLE library; no separate NimBLE library needed.

The current cloud integration was compile-checked with the installed ESP32 package
3.3.5, M5Unified 0.2.23, and M5GFX 0.2.30. All source files compiled, but the
complete firmware **did not link**: with FQBN
`esp32:esp32:m5stack_core2:PSRAM=disabled`, instruction RAM overflowed by **784
bytes**. There is no verified flashable binary for this integration yet.

The sketch uses explicit ESP-IDF BLE initialization and its HTTP client to avoid
unused GATT/scanner wrappers and HTTP cookie parsing. Arduino's required
`btInUse` memory marker was verified as a strong symbol in the compiled sketch
object. UTC-only SNTP supplies time for certificate validation; certificate and
hostname checks and disabled redirects remain in force. A host regression test
checks that HTTP 401 still produces the credential error when the IDF client
returns a failed perform result with authorization retries disabled.

The earlier physical test used 3.3.11; the new cloud integration still needs a
successful full build on that version (or a verified memory fix) before upload.
No additional SDK was downloaded during this change because disk space was low.
Install M5Unified and M5GFX in Arduino IDE's Library Manager if needed.

Open `hardware/core2-badge/core2-badge.ino` in Arduino IDE. Keep all sibling
`.h` and `.cpp` files in the same folder. Select M5Core2 and the USB serial
port, set Tools -> Upload Speed to 115200, close other Serial Monitors, then
upload. The first 1500000-baud transfer disconnected on this setup. Upload replaces the device's
current running sketch, not the saved placeholder files.

The developer CLI build command is:

```bash
"/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli" compile --config-file "$HOME/.arduinoIDE/arduino-cli.yaml" --fqbn esp32:esp32:m5stack_core2 --jobs 2 --build-path artifacts/core2-badge-build hardware/core2-badge
```

Use Serial Monitor at 115200 baud. USB-only diagnostics are single characters:
`s` reports status, `a` enables advertising, `p` pauses, and `n` rotates an active
session. These are development controls over the local cable, not wireless
commands or authorization APIs.

## Mac Scanner

Run from the repository root in a Mac Terminal. Do not run this on Newton.

```bash
python3 -m venv .venv-badge
```

```bash
.venv-badge/bin/python -m pip install -r hardware/scanner/requirements.txt
```

```bash
.venv-badge/bin/python hardware/scanner/scan_badge.py --seconds 0
```

Enable Bluetooth and grant Bluetooth access to the app running Python when
macOS asks. Do not pair the badge in system Bluetooth settings. This is
advertisement discovery, not a connection. Ctrl+C stops the scanner only.

Acceptance test:

1. Reboot the Core2: PAUSED; no new FOUND event.
2. Tap Available: scanner prints `FOUND session=...`; compare the full 16-digit
   token with the screen/serial console.
3. Tap Pause: scanner prints `EXPIRED` about five seconds after the last packet.
4. Resume: a new token appears, not the previous token.
5. Tap New ID: the new token appears; the old one expires independently. The
   scanner does not assume they are the same person.
6. Leave it available for two minutes: verify token rotation.
7. Tap Off: screen sleeps and advertisements cease. Boot remains paused.

Turning away is a useful radio test, but BLE reception is not guaranteed through
all obstacles. RSSI is signal strength, not a reliable distance, identity, or 3D
position measurement. Expiry means no recent packets, not proof of a deliberate
decline or that the person physically left. Operating-system duplicate filtering
and radio loss must be tested on the actual receiver; a five-second TTL is only
a prototype choice.

## Draft Wire Contract

- Custom service UUID: `defb0de6-0009-47e1-acd7-b6de56c6978f`.
- Legacy, scannable, non-connectable advertising; no GATT service or pairing.
- Advertising interval requested: 250-300 ms, plus controller scheduling/jitter.
- Main packet: flags (3 bytes), then 128-bit service-data AD field (27 bytes).
- Service UUID is in BLE little-endian wire order. Service data visible to Bleak
  is exactly 9 bytes: version `0x01` followed by eight random session-token bytes.
- Scan response: complete 128-bit service UUID and generic name `SidebySide`.
- Main packet is 30 bytes; scan response 29 bytes, below each 31-byte limit.
- Every session uses ESP-IDF's non-resolvable private address generator. A new
  address and token are applied only after advertising has stopped.
- The main task waits for GAP completion events before displaying AVAILABLE.
  Errors/timeouts disable the stack and show BLE ERROR; no automatic retry or
  silent continued advertising is intended. Physical failure testing remains
  necessary; compilation alone cannot establish radio behavior.

This UUID is a new proposed Core2 protocol, not an agreed change to Kai's mobile
app. Share it before implementing a common receiver. Phone-to-phone iOS
advertising has different constraints and is not validated by this badge test.

These are opaque broadcast identifiers, NOT anonymous, authenticated, encrypted,
or replay-proof credentials. Nearby observers can see/copy packets and may
correlate sessions. Do not use a token or RSSI alone to authorize profile access,
prove identity, grant mutual consent, or place an aura. Production needs an
authenticated expiring session registry, block/availability checks, and separate
mutual consent. No raw profile or stable user ID is broadcast.

## Verification

Verified on Bryan's connected Core2 and Mac:

- Firmware compiled and uploaded successfully at 115200 baud.
- USB commands enabled advertising, changed the session ID, and returned to paused.
- The Mac received both expected session IDs over Bluetooth, matching USB output.
- After pause, neither tested session had been received in the preceding five
  seconds. The device was left paused.
- All five scanner unit tests and the host packet layout/bounds test passed.

Those observations apply to the earlier BLE-only firmware. Cloud integration
has passed the host packet/sequence tests and five scanner tests. An independent
code review checked state revisions, stale acknowledgements, TLS configuration,
and power-off. The complete Arduino link remains blocked as described above;
there is no new flashable binary or physical-device verification. Once it builds,
test with provisioned Wi-Fi, CA, and device credentials:

1. Boot paused; confirm the API records paused before enabling availability.
2. Enable, pause, and rapidly toggle while the API responds slowly. Check the
   latest sequence/state and ensure an older response cannot undo the pause.
3. Disconnect Wi-Fi/API; verify buttons still work and the API marks the device
   offline 45 seconds after its last accepted report. Reconnect while paused.
4. Reboot; check its sequence exceeds all previous reports and boot is paused.
5. Test an invalid CA, blocked NTP, a revoked token, and a 409 sequence conflict;
   verify the corresponding error is visible without crashing or going live.
6. Test power-off both online and offline; verify local BLE stops and the server
   receives pause or the lease expires. Test Wi-Fi/BLE coexistence and touch
   responsiveness on the actual hardware.

Still to test manually: screen layout and touch controls, the automatic
two-minute rotation, battery-only power-off, and discovery on the intended
phone/Quest receiver. The serial boot log included a PSRAM initialization
warning with the board's default PSRAM setting; badge initialization and the
USB/Bluetooth checks still succeeded. PSRAM operation is not verified.

Pure scanner tests (do not require Bluetooth permissions):

```bash
python3 -m unittest discover -s hardware/scanner -p 'test_*.py' -v
```

Host-side packet layout/bounds test:

```bash
clang++ -std=c++11 -Wall -Wextra -pedantic hardware/tests/protocol_test.cpp -o /tmp/sidebyside-badge-protocol-test
```

```bash
/tmp/sidebyside-badge-protocol-test
```

Sequence allocation, clock rollover, and HTTP error handling checks:

```bash
clang++ -std=c++11 -Wall -Wextra -pedantic hardware/tests/sync_policy_test.cpp -o /tmp/sidebyside-badge-sync-test
/tmp/sidebyside-badge-sync-test
```

References: [M5Unified Core2 buttons](https://docs.m5stack.com/en/arduino/m5core2/button),
[ESP-IDF GAP APIs](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/bluetooth/esp_gap_ble.html),
[ESP32 Preferences/NVS](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/preferences.html),
[ESP-IDF HTTP/TLS client](https://docs.espressif.com/projects/esp-idf/en/v5.5/esp32/api-reference/protocols/esp_http_client.html),
[ESP-IDF beacon initialization](https://github.com/espressif/esp-idf/blob/v5.5/examples/bluetooth/bluedroid/ble/ble_ibeacon/main/ibeacon_demo.c),
[ESP32 Wi-Fi/BLE coexistence](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/coexist.html),
[Bleak scanner API](https://bleak.readthedocs.io/en/latest/api/scanner.html).

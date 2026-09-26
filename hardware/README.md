# Core2 Discovery Prototype

This first hardware milestone is independent of the model comparison. One Core2
advertises a temporary identifier; a Mac scanner reports discovery and expiry.
No Wi-Fi, cloud request, Supabase mapping, matching, consent request, Quest
integration, or profile reveal is implemented here.

## Badge Controls

- Boot: paused. No BLE advertising until the wearer explicitly enables it.
- Bottom-left touch button A, or tap the central state rectangle: Available/Paused.
- Bottom-middle button B: new session immediately, but only while available.
- Bottom-right touch button C: power off, preserving the previous sketch's control.
- Every two minutes while available: stop, change the session token and Bluetooth
  address, then resume. Resuming from pause also creates a fresh session.

The screen says Bryan by default; change `DISPLAY_NAME` in the sketch for Kai.
That text appears only on the physical display, not in Bluetooth packets.
The complete session token appears on the display and USB serial console so it
can be compared with the scanner during the test.

USB power may affect true power-off behavior. The firmware first stops Bluetooth,
calls M5Unified's power-off routine, and uses deep sleep if that routine returns.
Unplug USB for a battery-only power-off test. It never powers off automatically
at boot. The old placeholder remains at:
`/Users/bryantaylan/Documents/Playground/core2-placeholder/core2-placeholder.ino`.

## Build and Upload

Verified local toolchain at implementation time:

- Arduino IDE's bundled Arduino CLI.
- Espressif ESP32 board package 3.3.11.
- Board: `M5Core2`, FQBN `esp32:esp32:m5stack_core2`.
- M5Unified 0.2.23 and its installed M5GFX dependency.
- Built-in ESP32 BLE library; no separate NimBLE library needed.

Open `hardware/core2-badge/core2-badge.ino` in Arduino IDE. Keep its sibling
`badge_protocol.h` file in the same folder. Select M5Core2 and the USB serial
port, set Tools -> Upload Speed to 115200, close other Serial Monitors, then
upload. The first 1500000-baud transfer disconnected on this setup. Upload replaces the device's
current running sketch, not the saved placeholder files.

The developer CLI build command is:

```bash
"/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli" compile --config-file /Users/bryantaylan/.arduinoIDE/arduino-cli.yaml --fqbn esp32:esp32:m5stack_core2 --jobs 2 --build-path artifacts/core2-badge-build hardware/core2-badge
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

References: [M5Unified Core2 buttons](https://docs.m5stack.com/en/arduino/m5core2/button),
[ESP-IDF GAP APIs](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/bluetooth/esp_gap_ble.html),
[Bleak scanner API](https://bleak.readthedocs.io/en/latest/api/scanner.html).

# SidebySide phone discovery protocol v1

Status: implemented as an authored local Expo module; **physical iPhone interoperability has not yet been verified**. This is a foreground protocol. Core2 firmware and its advertisement format remain an independent research prototype.

## Radio and GATT

| Field | Value |
| --- | --- |
| Primary service UUID | `77E397EF-735A-46F8-93A8-10278179E870` |
| Read-only token characteristic UUID | `77E397EF-735A-46F8-93A8-10278179E871` |
| Advertisement | Service UUID only; no user ID, name, token, or service-data payload |
| Characteristic bytes | One unsigned version byte `0x01`, then the opaque token's UTF-8 bytes |
| Token encoding | 32–128 ASCII characters from `[A-Za-z0-9_-]` |
| Token source | Authenticated API, cryptographically random; a 32-byte base64url token is suitable |
| Native lifetime | At most 120 seconds after `start(token)` |
| Recommended refresh | Register a fresh server token and call `start(newToken)` around 90 seconds |
| Peer connection | Maximum four concurrent connections, each with a ten-second deadline |
| Duplicate suppression | Same peripheral: 30 seconds; same token: 45 seconds; bounded 256-entry caches |

The advertiser runs as a peripheral and the scanner as a central concurrently. Both phones perform both roles. On discovery, the central connects, discovers the service and characteristic, reads the value, validates version/length/encoding, emits an encounter, and disconnects. There are no characteristic writes or notifications. A new start value updates the dynamic characteristic without republishing the service.

The read implementation respects ATT offsets and holds a short per-central snapshot so token rotation does not mix two values during a long read. An invalid version or malformed token is discarded. Unknown RSSI is null. RSSI is diagnostic information; it does not establish metres of separation or the two-mile location boundary.

Apple supports local name and service UUIDs in `CBPeripheralManager.startAdvertising`; the separate Core2 service-data payload cannot simply be copied into this API. The phone protocol uses GATT for its token. See [Apple's advertising API](https://developer.apple.com/documentation/corebluetooth/cbperipheralmanager/startadvertising(_:)).

## Native/JavaScript contract

Import the module from `apps/mobile/modules/nearby-ble`.

```ts
start(token: string): Promise<BleState>
stop(): Promise<BleState>
getState(): Promise<BleState>
addStateListener(listener: (state: BleState) => void): { remove(): void }
addEncounterListener(listener: (encounter: BleEncounter) => void): { remove(): void }
```

`BleState` has `available`, `live`, `status`, `scanning`, `advertising`, and optional `message`. `live` is true only when both scan and advertise are active. `start()` may initially return `starting`; listen for state updates. Permission denial, radio off, unsupported hardware, expiration, backgrounding, and native failures are distinct recoverable states. `getState()` does not ask for permission. Expo Go/web/Android return `unavailable` without pretending to scan.

An encounter contains `token`, nullable `rssi`, `identifier`, and `observedAt`. The Core Bluetooth identifier is local diagnostic metadata, not a database user ID. The JS subscriber must send the token to the authenticated backend for resolution. Do not persist raw tokens in analytics or print them to application logs.

The native module starts its managers only after an explicit Live action. Backgrounding stops advertising/scanning, cancels connections, and clears the local token. It does not automatically restart when the app becomes active. The application also stops and revokes its server session on sign-out, Live off, backgrounding, and loss of matching consent. Remove event subscriptions during provider cleanup. When a renewal fails, stop rather than keeping an apparently live expired session. No background modes are declared for this milestone.

## Server ownership and disclosure

The backend owns expiry/revocation and token-to-user mappings. A detected token is public and replayable; it is a discovery hint, not a credential or proof of identity/proximity. A valid token does not authorize profile access.

Resolve tokens only for authenticated active phone sessions. Check token ownership/expiry, current profiles, availability, matching consent, blocks in either direction, and the relevant score state. Reject self encounters and rate-limit requests. Never return coordinates or private evidence. Preview consent and mutual acceptance still govern disclosure. Stop/revoke old sessions before issuing replacements so callers cannot keep many parallel active identities.

GPS discovery and BLE Live are separate controls. BLE discovery is not gated on having a Core2 badge or scanning a QR code; it also cannot prove the location geofence. The backend's two-mile location query remains separate.

A recommended encounter shows an in-app popup for up to **two minutes**. It
contains the approved-preview talking point and an asynchronously generated Muse
conversation question. Both remain on the Bluetooth card while the encounter is
current. Dismissal, stopping Live, account changes or encounter expiration can
hide the popup earlier; its timer never extends encounter validity. Suggestions
are keyed by account, candidate and server context, and discarded when that
context is no longer recommended. See [the API contract](api.md) for generation
and consent checks.

## Authored sources and checks

Swift sources and the podspec live under `apps/mobile/modules/nearby-ble/ios/`; Expo autolinks local modules under `apps/mobile/modules/`. Generated `apps/mobile/ios/` is disposable. See [Expo autolinking](https://docs.expo.dev/modules/autolinking/) and [module API](https://docs.expo.dev/modules/module-api/).

The Foundation-only checks in `tests/main.swift` cover invalid payloads, versioning, maximum size, ATT offset handling, deduplication, and bounded cache behavior. They do not simulate Core Bluetooth or prove radio reliability. Full instructions and required device evidence are in [device testing](../docs/device-testing.md).

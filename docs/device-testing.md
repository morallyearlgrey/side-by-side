# Local iPhone builds and two-phone BLE testing

## What is currently verified

The repository contains authored Swift central/peripheral code, the TypeScript interface, and deterministic packet/cooldown and session-lifecycle checks. During setup, Xcode 16.2 (16C5032a) finished installing on this macOS 14.6 Mac. The account owner accepted its agreement, and the first-launch check passes. Expo prebuild, local-module autolinking, and CocoaPods installation succeeded. A full simulator build was attempted but stopped because the iOS 18.2 platform/runtime was still unavailable; no physical devices were connected. A direct module-target build reached ExpoModulesCore dependency compilation, but its archive step stalled while reading a generated object marked `compressed,dataless` under Documents. That attempt was stopped. **The complete iOS app/module build, signing, and physical two-phone BLE testing remain unverified.** Record actual device results in the table below; an automated check is not a substitute.

## Free local installation

Use a Mac, Xcode, a personal Apple Account, and a physical iPhone. A paid Expo build plan and TestFlight are not prerequisites for this local workflow. Apple's free Personal Team provisioning expires after seven days and is for testing on personal devices; rebuild/reinstall when it expires. It does not provide general app distribution. See [Apple account capabilities and limits](https://developer.apple.com/help/account/basics/about-your-developer-account).

Each teammate can build with their own Personal Team and personal phone. Choose a distinct bundle identifier per teammate if Xcode requires it; the shared BLE UUIDs stay the same across builds. Do not share signing credentials. Teammates need the repository and local toolchain for this workflow; there is no unsigned QR-code installation path for the custom native app.

1. Install the full supported Xcode and its iOS platform. The app uses **Expo SDK 54** for compatibility with the development Mac's macOS 14.6. SDK 54 supports iOS 15.1+ and requires Xcode 16.1+; the project uses Node 22.13+ for a consistent toolchain. See the [Expo SDK compatibility table](https://docs.expo.dev/versions/v54.0.0/). **Xcode 16.2** supports macOS Sonoma 14.5+, including this Mac. Newer Xcode releases require newer macOS; check [Apple's system requirements](https://developer.apple.com/xcode/system-requirements) before installing. A pending `.appdownload` and Command Line Tools alone cannot build the iPhone app.
2. Open Xcode once and complete its setup. Select the full Xcode in Xcode Settings → Locations → Command Line Tools. Confirm `xcodebuild -version` succeeds.
3. Follow the root README to install dependencies, configure the API and Supabase, and start the API. A physical phone must reach a laptop server by its LAN address or a configured HTTPS URL; `localhost` on the phone means the phone. Use the same trusted network and allow the API port through the laptop firewall as needed.
4. Complete the Ruby/CocoaPods setup below once. From `apps/mobile`, generate/install native dependencies using the pinned tools:

   ```sh
   npm ci
   bundle exec npx expo prebuild --platform ios
   ```

5. Open the generated `.xcworkspace` inside `apps/mobile/ios/`. Under Xcode Settings → Apple Accounts, sign in. In the app target's Signing & Capabilities, select your Personal Team and automatic signing. Connect/unlock the iPhone and trust the Mac when prompted. Select that device as the run destination. Apple's [device build instructions](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices) cover pairing and provisioning.
6. Enable Developer Mode when requested, including the restart/confirmation. See [Apple Developer Mode instructions](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device/).
7. Run the app from Xcode. For subsequent local debug builds, `bundle exec npx expo run:ios --device` can select the connected phone. Use `npx expo start --dev-client` when the development build needs Metro. Inspect errors in Xcode if signing or build fails; do not describe a failed build as installed.
8. Repeat with a second physical iPhone. Supabase/API credentials must be configured, the API must be reachable, and each person must have a separate confirmed account.

Do not edit generated Swift inside `apps/mobile/ios/`; authored module code lives under `apps/mobile/modules/nearby-ble/ios/`. Expo Go can preview supported app flows but cannot load this custom module. Native module changes require rebuilding the development app, not just refreshing JavaScript. See [Expo custom native code](https://docs.expo.dev/workflow/customizing/).

## Ruby and CocoaPods

`apps/mobile/Gemfile` and `Gemfile.lock` pin CocoaPods 1.16.2 and its dependencies. Use Ruby 3.3 (the Gemfile accepts 3.1–3.x) and Bundler 2.5.22. macOS's built-in Ruby 2.6 is too old for this toolchain. Keep your existing Ruby version manager if you have one.

On Kai's current Mac, a compatible Ruby already exists at `/opt/homebrew/Library/Homebrew/vendor/portable-ruby/3.3.7/bin`. To use it for this terminal session:

```sh
export PATH="/opt/homebrew/Library/Homebrew/vendor/portable-ruby/3.3.7/bin:$PATH"
```

Then, from `apps/mobile`:

```sh
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
ruby --version
bundle --version
bundle config set --local path .bundle/gems
bundle install
bundle exec pod --version
```

The installed gems and local Bundler settings stay under the ignored `.bundle/` directory. If your chosen Ruby lacks Bundler 2.5.22, install that Bundler version through that Ruby's `gem` command first. Use `bundle exec npx expo prebuild --platform ios` and `bundle exec npx expo run:ios --device` so Expo's subprocesses can find the pinned CocoaPods installation. Do not use the task's temporary `work/` paths for future builds.

On this macOS version, the current Homebrew CocoaPods formula attempted a large LLVM/Rust/Ruby source-build chain. The Bundler setup above uses the existing compatible Ruby and avoids making that chain a project prerequisite.

For the next native build attempt, finish installing Xcode's iOS platform and use a local DerivedData directory outside Documents, such as `/tmp/sidebyside-derived-data`, to avoid the observed generated-file hydration stall. Xcode's default DerivedData location under `~/Library/Developer/Xcode/DerivedData` is another suitable choice. A successful build still needs a separate test on physical phones.

## Build troubleshooting

### Developer disk image is missing the requested device variant

`kAMDMobileImageMounterPersonalizedBundleMissingVariantError` means the installed
developer image cannot supply the variant requested by the connected device.
First confirm that the phone is paired and Developer Mode is enabled. With
Xcode 16.2 or later, use Apple's hardware-support updater for the selected
Xcode after completing its first-launch setup and license review:

```sh
xcodebuild -runFirstLaunch -checkForNewerComponents
```

Complete any administrator prompt yourself. Reopen Xcode, reconnect the unlocked
phone, and wait for device preparation. Apple documents this in its
[additional-components guide](https://developer.apple.com/documentation/xcode/downloading-and-installing-additional-xcode-components)
and [Xcode 16.2 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-16_2-release-notes/).

On the development Mac, this updater completed successfully on 2026-09-26:
the installed developer-image build changed from `16C5032a` to `16C7015`, and
CoreDevice changed from `397.28` to `397.30`. Installation alone does not verify
that a particular phone can mount the new image; reconnect the phone and check
device preparation before claiming an on-device result.

The included iOS SDK version and physical-device support are separate. If a
hardware-support update is unavailable or preparation still fails, choose a
newer Xcode and compatible macOS using
[Apple's requirements table](https://developer.apple.com/xcode/system-requirements).
An Expo-compatible Xcode version alone does not verify a particular phone's
preparation, installation, or debugging support.

### Xcode reports a sandbox denial for `SidebySide.app/ip.txt`

React Native's physical-device Debug script writes the Metro server address to
`ip.txt` inside the app bundle. The SidebySide target needs **Build Settings →
User Script Sandboxing → No** for Debug and Release, as required by the
[React Native 0.81 integration guide](https://reactnative.dev/docs/0.81/integration-with-existing-apps).
The local `withReactNativeScriptSandboxing` config plugin sets this app-target
override during Expo prebuild. Keep it when Xcode offers recommended project
settings; a project-level `Yes` must not replace the app-target `No`.

For an already-generated project, set the app target's setting to `No` and run
again, or rerun the regular iOS prebuild command above to apply the plugin.

## Foreground acceptance procedure

Start with two consenting test accounts, approved profiles, matching consent enabled, and an available configured matcher if testing ranked invitations. Keep both phones unlocked with SidebySide in the foreground. Location discovery may be disabled for the BLE-only radio test.

1. Enable Live on A; accept Bluetooth permission. Confirm A progresses from `starting` to `live` with scanning and advertising both true.
2. Enable Live on B. Confirm each phone reads the other's token, submits an authenticated encounter, and gets an appropriate backend result. Radio exchange can be successful even when the matcher honestly returns unavailable/abstained; record those outcomes separately.
3. Keep phones together for several seconds. Repeated advertisements must not create a flood of repeated requests or invitations. Verify peer/token cooldowns and server rate limits.
4. Wait through a token renewal. Confirm fresh tokens resolve, prior revoked tokens no longer resolve, and discovery remains live only while the server session is valid. Simulate a renewal/network failure; the switch/state must leave Live when the session cannot be maintained.
5. Turn Live off on A. Confirm A stops scanning/advertising, B gets no new valid discovery result for A, and the backend rejects the old token. Allow for packets already in flight; revocation governs whether they can resolve.
6. Sign A out while Live. Verify radio/session cleanup and no private results after sign-out. Sign back in and require a fresh discovery session.
7. Deny Bluetooth permission, switch the Bluetooth radio off, and later restore permission/radio. Verify informative states and recovery using a new explicit Live action. The app must remain usable throughout.
8. Test blocks in either direction, unavailable users, revoked matching consent, and self tokens. The backend must not show an invitation or disclose a profile for ineligible encounters.
9. Test mutual acceptance: before both people accept, return only their separately approved previews; afterward show only the agreed fields. Declining/revoking must remove the corresponding access.
10. Move devices apart and return. Record discovery latency and missed detections without interpreting RSSI as an exact radius.

## Background observations

Lock either phone, switch to another app, and suspend/terminate SidebySide. This milestone deliberately stops Live on background entry. Verify that radio activity stops and the server session is revoked when the app can contact the backend; server expiry bounds stale sessions if it cannot. Reopen and explicitly enable Live with a new token.

Do not claim continuous locked-screen detection or background pop-ups. Any future background mode requires a separate implementation and device evaluation. The Core2-to-Mac test in Bryan's hardware notes does not establish any iPhone result.

## Record results

| Test | Device A / iOS | Device B / iOS | Commit | Result / measured behavior |
| --- | --- | --- | --- | --- |
| Expo prebuild / module autolinking / CocoaPods | Local Mac | — | — | Passed with Expo 54 / CocoaPods 1.16.2 |
| Full simulator build | Local Mac | — | — | Attempt blocked by pending iOS 18.2 platform/runtime |
| Direct native module target build | Local Mac | — | — | Incomplete: dependency archive stalled on a dataless generated object; attempt stopped |
| Native personal signing | Not run | Not run | — | Requires connected devices and Personal Team configuration |
| Foreground two-way token exchange | Not run | Not run | — | Two physical iPhones required |
| Rotation and revocation | Not run | Not run | — | Test radio and API together |
| Permission/radio failure recovery | Not run | Not run | — | Record actual system prompt behavior |
| Background stop and resume | Not run | Not run | — | Confirm the foreground-only contract |
| Mutual acceptance/privacy | Not run | Not run | — | Requires configured API/Supabase |

Record timestamps/latency and relevant status messages without recording raw tokens, coordinates, or personal profile content.

## Foundation-only protocol check

On a machine with the Swift toolchain, from the repository root:

```sh
mkdir -p /tmp/sidebyside-ble-check
swiftc apps/mobile/modules/nearby-ble/ios/BleProtocol.swift \
  apps/mobile/modules/nearby-ble/tests/main.swift \
  -o /tmp/sidebyside-ble-check/protocol-check
/tmp/sidebyside-ble-check/protocol-check
```

This exercises malformed input rejection, bounded token sizes, offsets and deduplication without requiring Expo or a radio. Keep the physical acceptance tests above as a distinct gate.

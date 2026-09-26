# Local iPhone builds and two-phone BLE testing

## What is currently verified

The repository contains authored Swift central/peripheral code, the TypeScript interface, and deterministic packet/cooldown and session-lifecycle checks. On 2026-09-26, dependencies, Expo prebuild, local-module autolinking, and CocoaPods installation were refreshed successfully. The generated workspace includes NearbyBle, ExpoBlur, ExpoGL and react-native-maps. The Mac now runs macOS 27 with Xcode 27 (27A266a). First-launch setup passes; the connected iPhone 17 Pro on iOS 26.6.1 is paired, has Developer Mode enabled, and reports developer disk-image services available. **The full physical-device Debug build, development signing, installation, and native process launch passed**, including compilation of the Swift Bluetooth module. Launch initially returned a developer-trust error; after the owner trusted their developer account on the phone, devicectl launched the app and confirmed its process was running. The local signature verifies and the provisioning profile includes this phone, matches the bundle identifier, and expires on 2026-10-03. The initial blank screen involved two stages: the phone could not reach Metro on campus Wi-Fi, then native startup revealed missing/mismatched font dependencies and a Node-only Three.js entry point. The phone reached Metro over its hotspot; SDK-compatible font/file-system dependencies were linked into a rebuilt and reinstalled native app, and Metro now selects Three’s ESM entry on native platforms. The latest physical-device launch downloaded/executed the iOS bundle without the earlier font, route-import, or `process.emitWarning` errors. **Visual UI confirmation, Live radio state, and physical two-phone BLE exchange still need verification.**

Earlier Xcode 16.2 attempts on macOS 14.6 stopped at missing simulator components and a dependency archive stalled on a generated object marked `compressed,dataless` under Documents. Those attempts did not establish a successful build.

## Free local installation

Use a Mac, Xcode, a personal Apple Account, and a physical iPhone. A paid Expo build plan and TestFlight are not prerequisites for this local workflow. Apple's free Personal Team provisioning expires after seven days and is for testing on personal devices; rebuild/reinstall when it expires. It does not provide general app distribution. See [Apple account capabilities and limits](https://developer.apple.com/help/account/basics/about-your-developer-account).

Each teammate can build with their own Personal Team and personal phone. Choose a distinct bundle identifier per teammate if Xcode requires it; the shared BLE UUIDs stay the same across builds. Do not share signing credentials. Teammates need the repository and local toolchain for this workflow; there is no unsigned QR-code installation path for the custom native app.

1. Install the full supported Xcode and its iOS platform. **Expo SDK 54** supports iOS 15.1+ and lists Xcode 16.1+ as its minimum; that minimum does not guarantee support for a newer physical phone. The project uses Node 22.13+. See the [Expo SDK compatibility table](https://docs.expo.dev/versions/v54.0.0/). For this macOS 27 Mac and iPhone 17 Pro, use Xcode 27, which Apple lists for macOS 26.6 or later. Check [Apple's system requirements](https://developer.apple.com/xcode/system-requirements) for other combinations. A pending download and Command Line Tools alone cannot build the iPhone app.
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

### Blank development build before the app loads

First test `http://<Mac-LAN-IP>:8081/status` in Safari on the phone. Metro must
be running and return `packager-status:running`. On 2026-09-26, the phone did
not reach Metro over campus Wi-Fi; switching the Mac to the iPhone's hotspot
allowed the native app to download and execute its JavaScript bundle. A shared
Wi-Fi name alone does not establish device-to-device reachability. See
[Expo's connection troubleshooting](https://docs.expo.dev/get-started/start-developing/#open-the-app-on-your-device).

After changing networks, update the ignored `apps/mobile/.env` setting
`EXPO_PUBLIC_NATIVE_API_URL=http://<new-Mac-LAN-IP>:8000`, restart Metro with
the new address, and reopen that server in the installed development build:

```sh
# From apps/mobile; replace the placeholder with the Mac's current address.
REACT_NATIVE_PACKAGER_HOSTNAME=<new-Mac-LAN-IP> npx expo start --dev-client --lan
```

Also allow SidebySide under iPhone Settings → Privacy & Security → Local
Network. A USB connection supplies installation/debugging; this setup still
loads Metro and API requests over the network. A hotspot uses mobile data.

### Native app reports `Cannot find native module 'ExpoFontLoader'`

The UI's vector icons require `expo-font` in the actual iPhone binary. The
original dependency tree resolved font 57.x for icons while Expo SDK 54 carried
its own nested 14.x copy; the app did not link the font module. The mobile app
now declares SDK-compatible `expo-font` directly and the root override keeps
all consumers on that version. `expo-file-system` is also a direct dependency
so the native constellation renderer can resolve its file-system imports.

After pulling these dependency changes, run `npm ci`, regenerate the iOS
project and install pods as above, then rebuild/reinstall the native app.
Refreshing the website or Metro alone cannot add a missing native module.

### Native Matches import reports `process.emitWarning is not a function`

Three 0.186.1's CommonJS entry uses a Node-only warning API before forwarding
to its ESM build. The native Fiber entry imports Three through CommonJS, so
that wrapper prevented the Matches route from loading on the phone.
`apps/mobile/metro.config.js` maps bare `three` imports to the same ESM file
for iOS and Android. Restart Metro after changing this configuration; no
native rebuild is required for this resolver change.

### Installed app cannot launch until the developer is trusted

If iOS reports an untrusted developer after installation, open **Settings →
General → VPN & Device Management**, select your own Apple Account under
**Developer App**, and complete its trust/verification flow. Follow any restart
prompt, reconnect/unlock the phone, then launch SidebySide again. Trust only the
development account used to sign this build. A successful install alone does
not prove app launch or Bluetooth operation.

### Xcode 27 rejects a dependency's old iOS deployment target

The first Xcode 27 device build rejected AsyncStorage's resource bundle at iOS
13.4 and Maps' privacy bundle at iOS 11.0. The app already targets iOS 15.1, but
React Native 0.81's pod hook raises library targets without updating those
resource bundles. The local `withPodDeploymentTargets` Expo plugin raises
numeric pod deployment targets below 15.1 after that hook, including bundles.
Higher targets are preserved. Keep this in authored configuration; do not edit
the generated Pods project manually.

After adding/changing a Podfile plugin in an existing generated project, run
both prebuild and pod install so Xcode receives the new settings:

```sh
# From apps/mobile, with the pinned Ruby/Bundler and Node on PATH:
bundle exec npx expo prebuild --platform ios
(cd ios && bundle exec pod install)
```

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
CoreDevice changed from `397.28` to `397.30`. The downloaded package's metadata
identifies support for iPhone 16e, iPad Air (M3), and iPad (A16). The connected
iPhone 17 Pro running iOS 26.6.1 still reported the missing-variant error after
the update and reconnect. This update therefore did not resolve preparation
for the current test phone. Use a newer Xcode with a compatible macOS, then
verify image mounting and app installation again; do not keep repeating this
same 16.2 component update as if it supplied iPhone 17 support.

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

Start with two consenting test accounts and approved profiles. Each needs a confirmed conversation request, approved supporting facts, discussion topics, matching consent, and an enabled preview with a display name. The app's readiness checks must pass before enabling Bluetooth. Keep both phones unlocked with SidebySide in the foreground. On the current navigation, controls are under **Connect → Bluetooth discovery**; the old Bluetooth tab redirects to Connect. Leave Location discovery off to isolate the BLE test.

A running matching worker is needed for ranked recommendations, but not to create a BLE session or exchange tokens. A successful authenticated `/v1/ble/encounters` response proves the API accepted a radio encounter even if matching remains pending/unavailable. Never use the absence of a recommendation popup as the only radio test, or dump tokens/profile content into logs.

1. Enable Bluetooth discovery on A; accept Bluetooth permission. Confirm A progresses from `starting` to `live` with scanning and advertising both true. The switch being on while starting is not sufficient evidence.
2. Enable Bluetooth discovery on B. Confirm each phone reads the other's token, submits an authenticated encounter, and gets an appropriate backend result. Radio exchange can be successful even when the matcher honestly returns unavailable/abstained; record those outcomes separately.
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
| Expo prebuild / module autolinking / CocoaPods | macOS 27 / Xcode 27 | — | d09986d + deployment-target fix | Passed with Expo 54 / CocoaPods 1.16.2 |
| Physical Debug build including NearbyBle | iPhone 17 Pro / 26.6.1 | — | d09986d + deployment-target fix | Passed; Xcode 27, arm64, iOS 15.1 minimum |
| Native personal signing | iPhone 17 Pro / 26.6.1 | — | d09986d + deployment-target fix | Passed signature verification; profile includes phone and allows debugging |
| App installation | iPhone 17 Pro / 26.6.1 | — | d09986d + deployment-target fix | Passed via devicectl for app.sidebyside.mobile |
| Native app process launch | iPhone 17 Pro / 26.6.1 | — | c644e43 | Passed after phone-side developer trust; process confirmed running; see subsequent startup verification below |
| Native startup after hotspot/dependency fixes | iPhone 17 Pro / 26.6.1 | — | 35487b7 + native startup fixes | Rebuilt/reinstalled; iOS bundle executes without prior startup errors; visual UI/radio confirmation pending |
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

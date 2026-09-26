# Share SidebySide on the web

Public site: https://side-by-side-three.vercel.app

The Expo web app is hosted by Vercel's `side-by-side` project. Its root directory
is `apps/mobile`; the committed `vercel.json` exports the app and forwards `/api`
to the hosted `sidebyside-api` service. The web app does not depend on Metro or
the development Mac staying online.

## Tester steps

1. Open the public link in Safari or Chrome, create an account or sign in, and
   complete the profile review. If email confirmation is required, open the
   confirmation in the same browser and on the same website that started signup.
2. In Settings, allow matching with approved details and enable preview sharing
   if you want other people to discover you. Review the conversation request.
3. Open Connect, turn on Location discovery, and allow this site's location
   request. Nearby users also need to enable discovery and preview sharing.
4. Keep the website open while discovering. Use Update my location for a fresh
   reading and the radius control to search within 0.1 to 2 miles.
5. Turn Location discovery off to stop publishing nearby presence.

Browser discovery uses the browser's Geolocation API over HTTPS. It does not
start the native Bluetooth module, and the browser UI omits Bluetooth and the
combined location/Bluetooth sharing switch. Native app controls are unchanged.
Browsers can suspend pages in the background; this is foreground discovery,
not continuous tracking when the phone is locked. Location accuracy depends on
the device and environment. Observations worse than the server's accuracy limit
are rejected, with visible retry guidance.

## Production configuration

Vercel production variables:

- `EXPO_PUBLIC_API_URL=/api`
- `EXPO_PUBLIC_SUPABASE_URL`: this project's public Supabase URL
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the project's publishable key

The Supabase Auth Site URL is `https://side-by-side-three.vercel.app`, and the
redirect allowlist includes
`https://side-by-side-three.vercel.app/auth/callback`. Existing native and local
development callbacks remain allowed. Never place service-role or Muse keys in
the client bundle. Set the Spotify callback separately when that integration
is configured.

## Matching prerequisite

The hosted API's health endpoint can be checked at `/api/health`. As of this
deployment, Auth, database access, and Muse are configured, but matching reports
`available: false`, `reason: demo_worker_not_connected`, and
`scope: fictional_demo_only`. Location acquisition and presence publication
remain usable; real participants cannot receive live AI recommendations until
a worker and model policy supporting their profiles are deployed. Connecting
the existing synthetic-only Newton worker does not enable real-user matching.
Do not remove its input restrictions or present fixture scores as real results.

## Verification

The browser harness uses fictional accounts and loopback-only API fixtures.
It checks desktop and phone-sized views, profile/settings navigation, location
permission and on/off controls, match cards, collapse behavior, and 3D rendering.
Run `apps/mobile/tests/navigation-browser.mjs` against an Expo export configured
for its loopback fixture server. The Browser plugin was not available during
this change, so validation used the installed Playwright runtime.

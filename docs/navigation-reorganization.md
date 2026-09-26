# Navigation and Profile Cleanup

## Scope

Integrated on top of upstream `8810df4`, preserving its Bluetooth conversation API,
conversation components, foreground-location lifecycle, and request deadlines.
Includes required optional-device, meetup, and fictional-demo-scope support.
Excludes firmware builds, Quest binaries, model weights, training changes, private
configuration, and deployments. No shared database migrations were applied.

## Screens

- Tabs are Profile, Settings, Matches, Connect. The old Bluetooth link redirects to Connect.
- Profile contains editable fields and approved matching details, not onboarding transcripts.
- The readiness checklist is removed from every screen. Eligibility checks remain enforced.
- Only Settings exposes global matching permission. Saving Profile cannot grant, revoke, or replay stale consent. Initial onboarding saves the profile and opens Settings for an explicit choice; discovery remains optional.
- Settings also owns preview sharing, discovery controls, charm registration, and headset pairing. Muse ideas now run automatically for eligible matches; no separate Muse setting is required.
- Matches has relevance-ranked search, private liked/disliked filters, and six cards per page.
- Connect combines authorized location and BLE recommendations. Notifications last five seconds and transient discoveries last sixty seconds; polling does not reset their lifetime.
- Likes/dislikes are private preferences, not mutual acceptance, training labels, or location/display authorization.

## Runtime Requirements

Deploy frontend and API changes together. Review and apply missing Supabase
migrations in filename order, including prerequisites 006 through 011 and
`202609261430_navigation_preferences.sql`. Do not rerun migrations already recorded
as applied. The navigation migration adds private preferences and scoped RPCs.

`MATCHING_DEMO_WORKER_ENABLED=true` preserves the server-enforced fictional account
scope. This change does not create accounts, launch workers, or authorize real
profiles for Newton processing.

Muse ideas use existing server-side `MUSE_API_KEY` / `MUSE_MODEL` configuration
and approved preview topics. Eligible cards request a starter and source-linked
activities automatically. Existing profile disclosure and matching consent still
apply; the legacy description setting no longer gates generation. Provider
failures return clearly labeled fallback wording. See
[automatic match activities](activity-suggestions.md).

Maps require mutual acceptance and both users' independent location-sharing
permission. Blocking, ending, backgrounding, revoked permission, and expired leases
remove coordinates. Google rendering requires restricted keys:
`EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY`, `GOOGLE_MAPS_IOS_API_KEY`, and/or
`GOOGLE_MAPS_ANDROID_API_KEY`. Native maps require a development rebuild.
OpenStreetMap is an explicitly labeled fallback, not a simulated Google map.

## Verification

Run `npm run lint`, `npm run typecheck`, and `npm test` from the repository root.
Focused API checks cover navigation, consent, discovery, meetup, device authorization,
and retained Bluetooth conversation behavior. Optional inference tests require
separate model dependencies; no models are downloaded by these UI checks.

The browser harness uses fictional loopback-only HTTP/auth fixtures on port 8097.
Set `PREVIEW_EXPORT` to an Expo web export built with fictional URLs on that port,
`PLAYWRIGHT_MODULE` to a Playwright installation, and optionally `BROWSER_RESULTS`
to a task-specific screenshot directory. It checks consent persistence, onboarding,
tab content, pagination, search, preferences, map authorization, notification timing,
and mobile overflow. It closes only its own browser and fixture server.

`supabase/tests/run_navigation.py` runs rollback-only SQL assertions in a dedicated
network-isolated disposable test container. Docker inspection timed out during this
integration, so the SQL suite could not be rerun here. Live Google tiles and physical
Bluetooth/headset behavior were not verified in this change.

# Lunar application theme

This is a presentation-only update based on the approved intake design.
It keeps the existing routes, profile fields, validation, consent, discovery,
Muse activity suggestions, matching, and optional-device behavior.

- Charcoal surfaces, warm peach accents, muted teal, and white orbital lines.
- Local Michroma headings with a system-font fallback; system text for forms.
- Unframed profile and settings sections; bordered cards for connections.
- Local Lunar bitmap and subtle 26-second drift on the authentication screen.
- Reduced-motion support, visible input focus, and readable 16px form text.
- White liked stars and red disliked stars keep their existing meaning.
- No new dependencies, backend changes, database migrations, or native-project edits.

The artwork is reused from the approved intake. Michroma is distributed under
the SIL Open Font License included in `assets/fonts/OFL-Michroma.txt`.

## Verification

From the repository root, run `npm run typecheck`, `npm run lint`, and `npm test`.
The existing navigation harness covers consent, paging, search, preferences,
location-permission revocation, notification dismissal, and the 3D scene.
`LUNAR_VISUAL=1` adds 375x667, 390x844, 430x932, and 1440px layout checks,
font/artwork loading, field sizing/focus, and reduced-motion assertions.

Build fictional fixtures separately from the live backend configuration:

```sh
cd apps/mobile
EXPO_NO_DOTENV=1 EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:8097 \
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=fictional \
EXPO_PUBLIC_API_URL=http://127.0.0.1:8097 \
node ../../node_modules/expo/bin/cli export --platform web --clear \
  --output-dir ../../artifacts/lunar/web --max-workers 2
cd ../..
PREVIEW_EXPORT=artifacts/lunar/web LUNAR_VISUAL=1 \
  node apps/mobile/tests/navigation-browser.mjs
```

Set `PLAYWRIGHT_MODULE` to a locally installed Playwright module when needed.
To inspect the same fictional fixture app interactively, replace `LUNAR_VISUAL=1`
with `PREVIEW_ONLY=1`. The server is bound to `127.0.0.1:8097`; it never connects
to Supabase or the real API. Fixture writes are in memory and disappear on restart.
Do not deploy this test server or use its synthetic session with real services.

The actual app still uses its existing backend configuration. A new development
origin must be allowed by that backend before live authenticated use. The Lunar
preview does not change or restart another worktree's backend.

An iOS JavaScript/asset export is a compatibility check, not an on-device test.
Verify the physical keyboard, safe areas, BLE, and Quest/charm flows on hardware
before shipping the native build.

## Production web deployment

The existing Vercel `side-by-side` project builds `apps/mobile` from `main`.
Enable source files outside the root directory so npm can use the repository's
workspace lockfile. `apps/mobile/vercel.json` exports the actual Expo app to
`dist`, preserves client-side routes, and forwards `/api/*` to the existing
`https://sidebyside-api.vercel.app` backend. API responses must not be cached.
The proxy keeps browser requests same-origin without changing backend CORS or
relaxing authentication, matching consent, or database permissions.

Set these public build variables in the frontend project:

- `EXPO_PUBLIC_SUPABASE_URL`: the existing application Supabase URL.
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: its browser-safe publishable key.
- `EXPO_PUBLIC_API_URL`: `/api` (web only).

Native builds still require an absolute HTTPS `EXPO_PUBLIC_NATIVE_API_URL`.
Do not reuse the web-only `/api` value in a native release without that override.
The fictional test export in `artifacts/lunar/web` is never a deployment input.
Only `apps/mobile/dist`, built with the production variables, is published.
No service-role key belongs in an `EXPO_PUBLIC_*` variable.

Existing native installations do not update from a GitHub or Vercel deployment;
reload a development build against the updated source or build a new release.

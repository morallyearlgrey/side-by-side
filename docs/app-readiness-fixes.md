# App readiness fixes

## Onboarding

- Muse aims for 4-6 answers. The server ends chat at 7 answers, including skips,
  even if the model keeps asking questions. Early profile review remains available.
- Existing overlong sessions hand off to review on resume. A failed final reply
  preserves the previous draft and original answer, and shows an incomplete-draft
  warning instead of an endless retry loop.
- The response adds `answers_count`, `max_answers`, and `draft_incomplete`.
- No chat response grants consent, approves a fact, or saves a confirmed profile.

## Profile and discovery

- Nearby, Bluetooth, Settings, and onboarding permissions show profile readiness:
  a saved profile, confirmed conversation request, approved evidence-backed detail,
  open topics, named/enabled preview, and matching consent.
- Readiness does not turn on discovery. Hardware is not a prerequisite.
- Saved Skills/Interests without an approved matching detail are surfaced in the
  detail editor. The user selects a topic, supplies specifics and a relationship,
  and explicitly adds an approved detail. Its original answer is persisted and
  cited. A bare skill label is not silently promoted to firsthand experience.
- Profile saves omit `discoverable` and `bluetooth_enabled` on both client and
  server. The existing locked publish RPC preserves the current database values.
  This also protects against stale older clients and concurrent pause operations.
- Explicit consent withdrawal still disables Nearby and Bluetooth. No migration
  or model-policy change is required for these fixes.

## Bluetooth

- Encounter previews expire after 60 seconds without a fresh observation, even
  while the local radio session renews. The native encounter cooldown is 45 seconds.
- A 404, failed refresh, or withdrawn preview removes the old card. Superseded,
  expired, or previous-account responses cannot bring it back.
- The banner only renders while its encounter is still a current recommendation.
- This is bounded freshness, not instantaneous remote revocation or exact ranging.

## Deliberately unchanged

- The online matcher still uses approved onboarding evidence only. Instagram,
  Spotify-based matching, and feedback-personalized ranking are not implemented.
- The existing v4 policy abstains when either profile has avoided topics. The app
  now states this limitation clearly and does not encourage removing boundaries.
  Reliable topic-scoped filtering needs separate policy evaluation/versioning.
- The Quest aura remains a separate prototype, not authenticated account-linked
  AR. Original local Quest/Core2 work was not overwritten by these fixes.
- Live matching requires a compatible model worker. The API reported
  `remote_worker_not_connected` during verification; a successful UI build does
  not mean live model inference is available.

## Verification

- `npm test`: mobile unit/regression tests, including stale availability,
  explicit evidence creation, readiness, and BLE expiration/races.
- `npm run typecheck` and `npm run lint`.
- `.venv/bin/ruff check services/api`.
- `.venv/bin/pytest services/api/tests ml/tests -q`: API and ML regressions.
- Isolated browser fixtures checked pause-then-save, adding and approving a saved
  interest with exact evidence, and readiness at 390px and 1280px widths. All API
  writes were intercepted; no real user's settings or consent were changed.
- Native radio behavior and two-person live matching still need device testing.

Restart the API after pulling. Rebuild the native app to pick up the BLE lifecycle
changes; the web preview cannot validate the iPhone radio.

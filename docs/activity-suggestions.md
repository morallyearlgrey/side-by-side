# Automatic match activities

SidebySide offers source-linked activities beside the conversation starter on
current Connect recommendations and accepted Matches. The card appears
automatically; no Muse toggle or generate button is required. Existing matching
consent, independently enabled profile previews, current versions, and block /
connection checks still apply. The legacy `muse_descriptions_enabled` setting is
accepted for old clients but no longer gates generation.

## Catalog and sources

`data/activities/atlanta-v1.json` contains 100 reviewed, primarily local outing
ideas. Each record links to an official source and distinguishes an authored
activity suggestion from an organizer's scheduled program. The first catalog is
evergreen: no current event, open slot, operating hour, ticket price, or booking
is invented. Proposed durations are our suggestions, not opening hours.

See [source notes](activity-sources.md) for source coverage and access caveats.
Some destinations are in the wider Atlanta area and require travel. The API
does not infer travel range, budget, age, student status, or calendar availability
from the existing Nearby presence or matching score. It only recommends entries
marked public; restricted or unknown-access entries remain in the catalog for
future explicitly supported eligibility filters.

Source facts live in `public.activity_catalog`, protected by RLS with direct
access limited to the server role. `source_checked_at` records the review and
`review_after` is a hard expiry. Curators can mark entries cancelled or archived.
For future dated/recurring events, a verified future start and end are required;
an old recurring-program page does not prove a next session. No continuous
scraping service is enabled by this change.

## API and Muse

`POST /v1/matches/description` retains its versioned `MatchTarget` request and
adds a `source` label and an `activities` array to the ready response. Each
activity contains source-owned logistics, the source link, a short invitation,
and a deterministic explanation of its relation to the approved preview topics.

The API filters expired, cancelled, malformed, restricted, and past records,
ranks candidates using both people's approved topics, prefers free activities
when relevance ties, and diversifies venues. Muse chooses up to three activities
from a bounded shortlist and selects grounded invitation/starter wording. Only
approved topic strings and reviewed activity text go to Muse: no raw onboarding
answers, matching-only details, user identifiers, GPS, or model diagnostics.
The validator rejects invented IDs, unsupported logistics and unapproved wording.
The explanation describes available shared topics, not the causal reason for a
model's matching decision.

The existing server-only `MUSE_API_KEY` and `MUSE_MODEL` configure the provider.
The request uses low reasoning effort and a 7,000-token completion ceiling,
which includes internal reasoning. The initial 1,100-token ceiling exhausted
the budget before visible JSON in a live check; the corrected request returned
validated JSON. See [Meta's reasoning documentation](https://dev.meta.ai/docs/reasoning).
Same-context calls coalesce; provider concurrency is four, at most 32 unique
requests wait in flight, and the complete provider deadline is 22 seconds.
Successful wording caches for 15 minutes and fallback wording for one minute,
with at most 128 cache entries per API process. The API rechecks authorization
and current catalog content after generation and cache hits. The client
revalidates mounted cards once per minute and clears sensitive results on loss
of the active disclosure context.

Provider absence or failure returns an honestly labeled template starter and
ranked source records (`source: fallback`, `provider: null`). An empty valid
catalog yields a starter and an explanatory empty activity list. Database/schema
errors remain explicit errors, rather than activating a hidden hardcoded list.

Choosing an activity is a suggestion to discuss together. It does not accept a
connection, share location, RSVP, purchase a ticket, or reserve a place. Existing
connection acceptance and optional meetup-location controls keep their own roles.

## Import and refresh

Validation runs without network access or credentials:

```sh
python3 scripts/import_activity_catalog.py
```

Review `202609261730_activity_catalog.sql`, then run the actual migration/import
in a rollback transaction before committing it to the authorized database:

```sh
python3 scripts/import_activity_catalog.py --env-file services/api/.env --check-db
python3 scripts/import_activity_catalog.py --env-file services/api/.env --apply
```

The importer reads `DATABASE_URL` privately, uses `psql` with credentials outside
command arguments, registers only its own migration if the catalog table is
missing, and upserts the 100 stable IDs atomically. It neither deletes unrelated
catalog entries nor modifies profiles, connections, credentials, or worker data.
Re-running the import is safe: conflicts update only when the incoming
`source_checked_at` is newer. Reimporting unchanged JSON cannot revive an entry a
curator cancelled or archived. A fresh reviewed active record deliberately
reactivates it. Re-review sources before advancing review dates;
do not extend expiry merely to keep stale activities visible.

Verification covers catalog validation, rollback SQL/RLS assertions, two-person
ranking, source freshness, missing context, revocation during generation,
provider failures, invalid output, request coalescing, and mobile lifecycle / link
handling. Physical two-phone discovery and matching-worker readiness remain
separate requirements.

## Implementation verification

- API suite: 276 tests passed; the 64 activity, navigation, and importer tests
  passed again after the live provider configuration fix. API Ruff passed.
- Mobile: 143 tests passed, TypeScript and lint passed, and Expo web export
  succeeded. `apps/mobile/tests/activity-browser.mjs` verified a 390 × 844
  viewport with fictional data: automatic starter and two activities, exact
  source-link navigation, no horizontal overflow, no Muse toggle, and removal
  of ideas after leaving the screen or disabling preview sharing.
- The database migration/import first passed in a rolled-back transaction,
  including a cancelled-record repeat-import check. Committed readback confirms
  100 active rows, 63 distinct venue names, 90 public rows, RLS enabled, and no
  direct anonymous/authenticated SELECT grant. The migration is registered as
  `202609261730`.
- A live read through the application's PostgREST repository validated all 100
  rows. A real `muse-spark-1.3` call using fictional approved interests and that
  catalog returned `source: muse`, three valid activity IDs and a valid starter;
  the low-effort provider request took approximately 6.6 seconds in this check.
- Existing native phone-test servers were preserved. Code push and database
  import do not update an already-running API process or the other checkout's
  Metro bundle. Load the updated code before device verification. The last
  existing API health check reported no connected remote matching worker;
  generating new scored matches still requires that worker.

# Connection Meetup Maps

After both people accept a connection, its card in Matches includes **Find each
other**. Each person separately selects **Share location for 15 minutes**. Only
then does the browser display a map with both labelled positions, accuracy
circles, and the age of the other person's observation. Merely accepting an
invitation or enabling Nearby does not disclose precise coordinates.

## Runtime

- Migration: `supabase/migrations/202609260008_connection_meetup.sql`.
- Authenticated API: `GET/POST/PATCH/DELETE /v1/connections/{id}/location`.
- POST starts a bounded lease, PATCH updates its position without extending it,
  and DELETE stops that exact lease. GET never opts a user in.
- The focused Matches view polls every 10 seconds and requests a new device fix
  approximately every 30 seconds. It does not collect background locations.
- New fixes must be at most 60 seconds old, no more than 5 seconds in the future,
  and accurate to within 250 meters. Indoor positioning may still be imprecise.
- Pins are withheld when either fix exceeds two minutes. Client responses have
  a maximum 20-second validity, so a disconnected client cannot keep showing a
  live-looking pin indefinitely. Local stop, blur, and backgrounding hide pins.
- Either person can stop sharing. Server access also ends after expiry,
  blocking, connection revocation, matching-consent revocation, unavailability,
  or a profile version change. A late update cannot restart a stopped lease;
  a late stop cannot cancel a newer lease.

## Data Boundaries

Precise meetup positions live in a separate RLS-protected table. Public and
authenticated PostgREST clients have no direct access. Only the API's service
role can call the RPC, after binding the actor to a verified account session.
The RPC rechecks both participants and current connection eligibility.

No meetup positions are added to matching profiles, model inputs, nearby
responses, or the Newton worker capability. Sharing does not modify profiles or
invalidate matching scores. Responses are `Cache-Control: no-store`.

Stop and revocation delete affected rows. Expired rows are inaccessible and
deleted on the next RPC for that connection; there is **not** yet a scheduled
retention cleanup job. Add one before production deployment. Previously seen
or copied locations cannot be recalled.

## Map Platforms

Web uses Leaflet 1.9.4 with OpenStreetMap standard tiles, visible attribution,
normal browser caching, and no bulk/offline download. Map tiles reveal the
viewed map area to the tile provider; this is disclosed before opting in.
See the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
Choose an appropriately provisioned tile provider before scaling traffic.

The native implementation currently opens OpenStreetMap with the shared peer
pin, rather than rendering the two-pin embedded web map. It is a static external
link, not live navigation, and cannot be erased from the external browser by
stopping sharing. Native-device behavior has not been verified in this change.

## Verification

- Mobile unit tests cover mutual consent, expired response/lease visibility,
  and clearing points while retaining the identifier needed to retry stopping.
- API tests cover account binding, authentication, outsiders, payload validation,
  lease identifiers, and no-store responses.
- `supabase/tests/meetup.sql` exercises actual PostgreSQL acceptance, opt-ins,
  stop, delayed requests, expiry, stale fixes, blocks, consent, profile changes,
  and client/worker role denial. `--meetup-only` runs this suite without global
  queue claims; all test fixtures are fictional and rolled back.
- Browser visual checks used fictional coordinates at desktop and 390px width,
  including overlapping pins and hiding/reopening the map. No device locations
  were collected or shared during those checks.

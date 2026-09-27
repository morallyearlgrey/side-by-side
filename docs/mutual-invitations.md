# Shared invitations and mutual connections

Connect shows recommendations from the current user's model perspective and a
separate **Invitations** list. Recommendations can differ by direction. An
existing invitation is one shared pair request; both participants can see it
without requiring another recommendation or enabling location/Bluetooth again.

**Accept and invite** explicitly says yes for the sender. The other person must
choose **Accept invitation**. Pending invitations stay on Connect for both
people. Matches and its constellation contain only current requests where both
recorded decisions are accepted. Declined, revoked, expired, blocked, withdrawn,
and outdated profile requests are excluded. Approved shared profile details
remain unavailable before mutual acceptance.

## API and database

- `GET /v1/connections/invitations` returns the actor's current pending requests.
  The actor comes from verified authentication, never a supplied user ID.
- `POST /v1/connections` creates a request from a supported recommendation, or
  accepts an existing current request for the sending actor only. Repeated sends
  reuse the same request. Reverse sends register that actor's explicit yes.
- `PUT /v1/connections/{id}/decision` applies one participant's choice.
- `/v1/connections/page` filters mutual connections before search, counting and
  pagination. `/v1/connections/constellation` applies the same mutual requirement.

Apply `202609270004_mutual_invitations.sql` before deploying the new API/UI. It
adds a service-only invitation RPC and replaces the request/page/constellation
functions. Existing request IDs and decisions remain unchanged; the migration
does not autoaccept for anyone. Pair advisory locking and row locks protect
duplicate/reverse sends and concurrent choices.

Connect polls pending invitations every five seconds while foregrounded.
Refresh and account/focus guards prevent stale cached previews being reused.
Native and web use the same API and components; this change needs no model
retraining or worker modification.

## Verification

- `services/api/tests/test_mutual_invitations.py`: separate authenticated views,
  reverse-score independence, explicit send intent, stale privacy gates,
  rejection/revocation, and strict mutual accepted payloads.
- `apps/mobile/src/features/connect/ConnectionInvitations.test.tsx`: sender and
  recipient controls, account ownership, expiry, inactive/stale query guards,
  and mutual visibility.
- `supabase/tests/mutual_invitations.sql`: real SQL pair lifecycle, duplicate and
  reverse sends, accepted-only pages/constellations, and privacy exclusions.
  Run only in the dedicated rollback test harness with fictional accounts.

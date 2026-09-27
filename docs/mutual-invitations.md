# Shared invitations and mutual connections

Connect shows a shared **connection suggestion** to both people when either
direction has a current, supported recommendation and the pair is eligible and
nearby. Recommendations can differ by direction; the other person's score is
never disclosed. The suggestion begins with both decisions pending. Each person
can accept or decline independently. An existing suggestion remains visible to
both without requiring another recommendation or keeping discovery on.

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

Apply `202609270006_shared_connection_suggestions.sql` before deploying the new
API/UI. It adds a service-only, pair-locked suggestion RPC. Both profile previews,
consents, current eligibility, and each person's selected nearby radius are
checked. For Bluetooth it requires a recent actual encounter. Existing declines,
revocations, and accepted connections for current profile versions suppress
automatic resuggestion. Existing request IDs and decisions remain unchanged;
the migration does not autoaccept for anyone.

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

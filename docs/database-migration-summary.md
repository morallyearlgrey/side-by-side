# Database changes for navigation and optional devices

This is a source-code summary, not confirmation that a remote database was migrated.
Apply migrations in filename order after reviewing the target project's migration history.
Do not blindly replay migrations already recorded there. No production migration was
applied as part of the constellation redesign.

| Migration | Change | Boundary |
| --- | --- | --- |
| `202609260006_demo_worker_scope.sql` | Adds `demo_worker_scopes`, hashed capabilities, readiness heartbeats and scoped claim/publish/fail functions. | A Newton worker can process only its two synthetic accounts and pinned profile versions. No global queue or service-role credential. |
| `202609260007_demo_candidate_scope.sql` | Adds pair-support and candidate-list functions for the fictional demo. | Real accounts are not silently advertised as supported by the demo worker. |
| `202609260008_connection_meetup.sql` | Adds short-lived `connection_location_shares`, the meetup RPC and revocation triggers. | Both sides must accept and independently share; opt-in lasts at most 15 minutes. Stale coordinates, ended connections and changed profiles stop disclosure. |
| `202609260009_optional_device_linking.sql` | Adds pairing tickets, `headset_devices`, device leases and Core2 session/tag metadata. | Hashed credentials, single-use expiring tickets and sequence checks. Optional accessories do not grant matching or location consent. |
| `202609260010_device_display_consent.sql` | Adds independent connection display permissions and a gated headset display projection. | Mutual connection acceptance alone does not authorize AR display. Current permissions, ownership and device sessions are also required. |
| `202609260011_display_signout_barrier.sql` | Revokes headsets and increments display-permission revisions on sign-out, including connections without an earlier opt-in. | A delayed first AR opt-in cannot overwrite a sign-out. |
| `202609261430_navigation_preferences.sql` | Adds private `match_preferences`, redacted connection projections, full-set ranked search and six-item pages. | Likes/dislikes are private UI preferences, not acceptance or training labels. Redaction happens before search. |
| `202609261431_connection_constellation.sql` | Adds a lightweight all-connections graph RPC. | Only current pending/accepted connections with an enabled named preview. Returns request ID, allowed name and the viewer's private preference; no coordinates or private facts. |

## Deployment

1. Compare the target migration history with this ordered set; retain existing data.
2. Run the SQL assertions in a disposable database, then apply only missing migrations
   through the normal Supabase migration workflow.
3. Deploy the API and mobile/web frontend together. Restart the API for the new
   `/v1/connections/constellation` route.
4. With the target API's server-only environment loaded, run the read-only REST check
   from the repository root: `PYTHONPATH=services/api:. python -m sidebyside_api.navigation_preflight`.
   It uses a reserved non-account ID and zero-row table query, checks the real API
   contracts, and exits nonzero on failure. It does not create users, change data,
   start model workers, or print credentials or profile contents.
5. Check with two fictional accounts: ranked search and paging, private preferences,
   graph redaction after block/revoke, and independent meetup/display opt-ins.

The redesign does not change model weights, inference policy, BLE firmware or Quest tracking.

## Constellation schema errors

`PGRST202` (function) and `PGRST205` (table) mean the requested resource is not
visible in PostgREST's schema cache. An installed SQL function alone is not proof
that the REST API can use it. The API now returns the sanitized
`database_schema_unavailable` status instead of an unexplained database failure.

Compare migration history and the actual function signatures first. Apply only
missing migrations; never replay already-applied migrations or weaken permissions.
If SQL objects and service-role grants are correct but REST still reports them
missing, an administrator can request a cache refresh in the Supabase SQL editor:

```sql
NOTIFY pgrst, 'reload schema';
```

After the asynchronous reload, run the preflight again. If it still fails, check
PostgREST logs and the target project configuration rather than continually
resubmitting migrations. See the official [schema cache documentation](https://postgrest.org/en/stable/references/schema_cache.html)
and [error reference](https://docs.postgrest.org/en/stable/references/errors.html).

The Matches view already polls while focused, so it can recover once the API is
available. A legitimate empty graph stays empty; errors must not be converted to
fabricated connections or treated as permission to expose additional profiles.

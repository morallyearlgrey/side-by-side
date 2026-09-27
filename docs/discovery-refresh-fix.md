# Discovery refresh and matching diagnostics

The location and Bluetooth paths use the same approved-profile matching scores.
GPS heartbeats previously called full user invalidation, deleting both kinds of
scores and cancelling pending/running GPU jobs. Migration
`202609270001_discovery_refresh.sql` replaces only the presence trigger with
proximity snapshot invalidation. Profile, consent, block, preview and availability
changes retain their existing full invalidation. Reads and result publication
still check live eligibility; moving away cannot disclose a cached nearby match.
A cancelled job can retry when its pair becomes eligible again within the same
score refresh period, without resetting any concurrently running lease.

The same migration adds a service-only encounter recorder. It checks the live
BLE session, pair and observation time, and advances repeated physical readings
monotonically. Client polling does not create observations. Native observations
carry their actual timestamp, and the UI uses the same two-minute freshness
window as the backend instead of expiring detections between radio readings.

Browser discovery and meetup now share the narrowly checked Safari timestamp
normalization. This corrects the observed Apple-reference epoch signature while
preserving rejection of stale, future and inaccurate positions. Web remains
location-only. Bluetooth and the radius control are native app features.

Discovery responses include aggregate pending, insufficient-evidence,
not-recommended and unavailable counts. Fresh server outcomes take precedence
over a status captured at an earlier Bluetooth observation. Non-recommendations
never become cards or invitations, and private reasons/answers are not exposed.

## High relevance and insufficient evidence

The live Kai/Bryan job audit found successful worker jobs with
`insufficient_support_for_requested_conversation`, in both directions and both
discovery modes. Their confirmed requests did not require firsthand experience.
This reason means the separate Qwen sufficiency result was below the frozen 0.3
threshold. A high relevance score alone is not a recommendation or a probability
of compatibility. The public score for this outcome remains null.

Worker logging now separates numeric relevance, sufficiency, format, diagnostic
calibrated score and final decision. Logs contain no profile IDs, answers or
prompts. The worker must run the updated source to emit these diagnostics; the
model weights, prompts, thresholds and policy identity have not changed.

## Release and checks

1. Run the Python/frontend suites, lint and typecheck. Run
   `supabase/tests/run_discovery_refresh.py` only in the dedicated disposable
   PostGIS container named in that file, with the CI bootstrap installed.
2. Apply only the new migration, record its version, and reload the PostgREST
   schema cache before deploying the API that calls `record_ble_encounter`.
3. Stage and deploy the API using `scripts/stage_vercel_api.py` and the existing
   production project. Push main to build the website; refresh the native
   development bundle. These frontend fixes require no new native module.
4. Update/restart the remote worker to obtain the new numeric diagnostics.

The browser check uses fictional profiles and intercepted API/auth requests. It
covers Safari timestamps, location activation/deactivation, an evidence abstention,
a supported recommendation popup and hidden web Bluetooth/radius controls.
Physical two-phone radio exchange and real-model ranking quality require separate
validation with active consenting devices; unit fixtures do not establish them.

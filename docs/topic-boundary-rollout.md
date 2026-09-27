# Topic boundary matching pilot

The V6 worker and API were deployed on 2026-09-27 after the release checks below.
Do not change anyone's saved boundaries or matching/location consent to make a
recommendation appear.

V6 interprets exact simple English labels from `shared/topic-boundaries.json`.
Both people's exclusions apply to a pair. Whole conflicting optional facts,
their dependent source claims, open topics and format preferences are omitted
from a temporary projection. Required goal, intent or experience conflicts
abstain. Unknown or conditional boundaries still require review. Immutable
answers, evidence, preferences and experience requirements are not rewritten.
An independent affirmative Qwen topic screen checks the projected conversation
before relevance ranking. It abstains on possible topic overlap (uncalibrated
topic score >= 0.01), invalid output or input overflow; >= 0.5 reports a conflict.
These are conservative pilot cutoffs, not validated topic probabilities.
The ranking instruction also excludes semantic references to those topics.
The lexical vocabulary and topic screen can over-filter; the model can still
miss indirect references. This is not a safety guarantee.

Approved conversation topics and catalog activities are filtered before Muse,
including fallback suggestions. Private boundary text is not sent to Muse.
Stored past connections remain history, not current recommendations or ongoing
location authorization.

The weights, experience verifier, calibration and score thresholds are unchanged.
The existing calibration is synthetic, not a probability of friendship, and has
not been revalidated for the boundary-aware prompt.

## Release order

1. Review the diff and run API/mobile tests, typecheck, lint and the SQL tests.
2. Run fixed fictional positive, conflicting and indirectly related topic probes
   on RunPod with the existing pinned models.
3. Apply `202609270011_topic_boundaries.sql`. It adds V6 identity compatibility
   alongside V4/V5 without changing accounts, consent or historical results.
4. Check out the exact reviewed revision on RunPod, retain the existing private
   environment and model cache, and restart `python -m sidebyside_api.worker`.
   No training or model download is required. Confirm a fresh V6 ready heartbeat.
5. Stage the API with `scripts/stage_vercel_api.py`, deploy it, then release the
   mobile/web changes. Do not switch the API while only a V5 worker is ready.
6. Confirm `/health` reports V6 available. Fresh opted-in nearby profiles should
   get V6 jobs and scores; V5 abstentions must not be reused. Check both directions.

Keep the previous API/worker revision for rollback. Roll back both together;
the additive database migration can remain. Never force a recommendation or
reuse stale presence to make a demo pass.

## Release evidence

- Runtime source: `6386e0d`; Qwen, DeBERTa and MiniLM weights unchanged.
- NVIDIA A40: all 12 fixed fictional release probes passed in 62.18 seconds.
  This includes unrelated topics with each supported exclusion, all four
  exclusions together, explicit and indirect conflicts, and unresolved wording.
- The initial prompt-only implementation failed two indirect-conflict probes;
  it was never promoted. The separate topic screen is required by this release.
- 479 API tests, 277 mobile tests, typecheck and lint passed. All migrations
  and discovery/V5/V6 SQL assertions passed in isolated PGlite/PostGIS.
- Migration `202609270011_topic_boundaries.sql` was applied directly; V5 and V6
  identity compatibility were verified. Account settings and consent were not changed.
- Worker runs detached from the web terminal in
  `/workspace/side-by-side-v6-6386e0d`. Operational metadata and a private log
  live in `/workspace/.sidebyside-worker-release/`; no credentials are in Git.
  This survives terminal closure, not a stopped/recreated Pod.
- API deployment: `dpl_ALxDtYKaBpc4A1Si377wWS6MgCj4`. Public health reports
  `online-approved-topic-boundaries-v6` available.
- API rollback: `dpl_5MKjXcuUJWHQe7ewEnYcvKFnySGG`; worker rollback checkout:
  `/workspace/side-by-side-v5-ba1b9be`. Never run V5 and V6 queue workers together.
- Live nearby validation requires fresh device-observed location and opted-in
  eligible accounts. Historical scores and expired locations are not proof of a
  successful new recommendation. Fictional probes do not validate human outcomes.

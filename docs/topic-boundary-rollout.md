# Topic boundary matching pilot

This change is staged, not a production rollout. The current demo can continue
on v5. Do not change anyone's saved boundaries or matching/location consent to
make a recommendation appear.

V6 interprets exact simple English labels from `shared/topic-boundaries.json`.
Both people's exclusions apply to a pair. Whole conflicting optional facts,
their dependent source claims, open topics and format preferences are omitted
from a temporary projection. Required goal, intent or experience conflicts
abstain. Unknown or conditional boundaries still require review. Immutable
answers, evidence, preferences and experience requirements are not rewritten.
The online Qwen instruction also excludes semantic references to those topics.
The lexical vocabulary is deliberately conservative; it can over-filter and
the model can miss indirect references. This is not a safety guarantee.

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
   on RunPod with the existing pinned models. This GPU validation remains pending.
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

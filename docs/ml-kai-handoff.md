# Matching Handoff for Kai

## Repo State

This handoff was checked against Kai's `223082d` main tip, including application
commit `45384fb` and subsequent email-callback, onboarding-completion, and
required-profile-field fixes. Her application files were fast-forwarded into
Bryan's checkout without conflicts. This ML update does not replace the mobile
app, modify database migrations, change API response shapes, or activate a new
production matching policy.

Kai has implemented the Expo app, Swift phone BLE module, FastAPI service,
onboarding, private Supabase queue, and standalone matching worker. Her
[verification notes](verification.md) record application checks and remaining
physical-device tests. The shared Google Doc's older planning-only and
uncommitted-ML descriptions predate those commits.

## Two Different Pipelines

| Area | Existing application | New research baseline |
| --- | --- | --- |
| Entry point | `services/api/sidebyside_api/matching.py` | `ml/matching_v4.py` |
| Identity | `online-approved-onboarding-v1` / `onboarding-only-v1` | `source-aware-evidence-v4` |
| Input | Validated `real_opt_in` onboarding profiles | Validated synthetic bundles plus confirmed request requirements |
| Models | Pinned Qwen 4B or explicitly configured compatible MiniLM head | Same pinned Qwen 4B, MiniLM format encoder, DeBERTa evidence checker |
| Evidence | Owned, approved onboarding facts and existing online gates | Additional request-specific firsthand support checks |
| Sources/history | Onboarding only, no social/history calibration | Source-aware 70/30 when usable social evidence exists, format/history logic |
| Results | `scored`, `abstained`, `unavailable` | `recommend`, `not_recommended`, `insufficient_evidence` |

The completed Newton experiment does not automatically upgrade the API. Do not
claim the app is using v4 merely because it loads the same 4B checkpoint. The
current worker can remain on its honest v1 identity while v4 integration is
developed separately. The same model weights do not imply the same pipeline.

## What This Push Supplies

- Evidence checker, v4 scorer, evaluator, synthetic scenarios, Slurm helpers,
  and regression tests, without weakening the synthetic-only validator.
- [Full evaluation summary](ml-newton-results-852419.md): 19/21 draft positives
  recommended, 0/12 draft negatives recommended, all 24 uncertain cases
  deferred. Two history-format positives remain missed by both versions.
- [Request contract and gate behavior](ml-evidence-v4.md#contract-for-kai).
- Frozen base-policy files in `ml/policies/newton-matching-v3-852098/`:
  `selected_policy.json`, `protocol.json`, and `status.json`. These are exact
  copies of the small synthetic experiment metadata reused by v4, not model
  weights or live credentials. The protocol's source hashes describe the
  historical v3 run, not the current checkout.
- The optional evidence dependency remains `ml/requirements-evidence.txt`.
  The application lockfile is unchanged; its inference extra alone does not
  install SentencePiece or fetch the additional evidence checkpoint.

Use `--policy-dir ml/policies/newton-matching-v3-852098` with the research v4
CLI. Generate synthetic fixtures with `ml.synthetic_v4`; see its `--help` for
arguments. Model weights and raw audit folders remain untracked. The policy
snapshot's readiness flag stays false and the API does not auto-load it.

## Integration Work Still Required

1. Persist the user's current, explicitly confirmed experience requirement
   independently of any candidate. `ProfileDraft` currently has no such field.
   A missing requirement must not silently become `kind: none`; an onboarding
   suggestion is not confirmation. Use the request contract linked above.
2. Keep the existing real-profile validation and server-owned consent/ownership
   checks. Build a dedicated online adapter; never label real users synthetic
   or disable `validate_bundle` to call `score_bundle`.
3. Version the new pipeline and policy in jobs, stored scores, snapshots, and
   worker heartbeats. The current SQL and runtime enforce onboarding-only
   provenance. Add reviewed forward migrations rather than editing applied
   migrations or reusing old score/cache identities.
4. Preserve genuine non-recommendations versus insufficient evidence and
   model outages in the API/UI contract. Never map all of them to a zero score.
   Keep user-facing reasons free of unrevealed private profile evidence.
5. Load the pinned NLI and MiniLM assets alongside Qwen on the selected host,
   and benchmark cold start and uncached requests. The v4 result timings used
   shared caches and are not a live latency promise.
6. Add parity and fail-closed tests for firsthand requests, learning together,
   incomplete evidence, stale confirmations, ownership, and policy changes.
   Retain mutual acceptance and current eligibility as independent checks.

Supporting social evidence/history online also requires approved-source and
feedback contracts that v1 does not have. An onboarding-only evidence-gated
pilot is possible, but it needs its own honest policy identity and evaluation;
it must not claim all source-aware v4 behavior or its benchmark results.

## Hosting and Hardware

Kai already supplied `services/api/sidebyside_api/worker.py`; do not build a
duplicate HTTP service on Newton. The existing worker uses the Supabase queue
and publishes expiring readiness. See [the worker setup](api.md#run-qwen-on-bryans-allocated-newton-gpu).
No worker was started by these research jobs or this push.

Newton's tested `sidebyside` environment is Python 3.11.16, while the application
declares Python >=3.12,<3.14. Use a separate compatible application environment
and preserve the functioning CUDA research environment. Do not blindly run
the application's `uv sync` into the cluster's current research environment.
Use only an authorized compute allocation and a host approved for the data;
keep the privileged Supabase key out of source, screenshots, and Slurm logs.

Phone BLE and Core2 currently use different protocols. Phone BLE uses its
documented GATT token characteristic; the Core2 scanner reads advertisement
service data. They are not interchangeable without a bridge. See
[phone BLE](../contracts/ble.md) and [Core2 hardware](../hardware/README.md).
Quest USB debugging is now authorized; passthrough/aura deployment and any
person tracking remain unverified. BLE alone cannot place an aura in 3D.

# Scores and recommendation decisions

The previous online adapter computed conversational relevance and a second
generic sufficiency classification. The second classification could veto a high
relevance score even when the user had confirmed that no firsthand experience
was required. The adapter then sent `insufficient_evidence` with a null score to
Supabase, so the website had no numeric prediction to recover.

The V5 application policy uses the confirmed conversation request and validated
approved evidence to determine the required checks. The existing firsthand
verifier still runs when the request requires experience. Once those checks pass,
the existing Qwen relevance score and explicit format compatibility determine
`recommend` or `not_recommended`. The extra generic sufficiency classification is
removed from this online path. Qwen weights, relevance prompt, calibration
coefficients, and ranking threshold have not changed. Historical V3/V4 research
code and frozen artifacts are preserved.

This changes application decision policy. It is not evidence of independently
validated real-user recommendation quality or a compatibility probability.
Regression tests use model doubles to reproduce 0.99 relevance with a low old
sufficiency result, verify publication and discovery delivery, and preserve
explicit source/experience failures. A disposable PostGIS test publishes a
99.98% V5 recommendation and confirms historical V4 compatibility.

## App suggestion display cutoff

The app may surface a scored pair at or above **0.15** even if the frozen V5
model decision is `not_recommended` solely because it fell below the model's
0.50 decision threshold. This is an API presentation rule, not a model policy
change: the stored decision, calibration, model weights, and policy hash remain
unchanged. The API includes `model_status` so the presentation decision is
distinguishable from the model's original decision.

`insufficient_evidence`, `unavailable`, explicit format conflicts, scores below
0.15, and invalid scores never become app suggestions. Consent, approved
previews, proximity, blocks, and both people's acceptance are still required.
The score is synthetic-calibrated directional relevance, not a 15% chance of a
successful connection. This display change needs only an API redeploy; the
current GPU worker continues to produce its existing V5 decisions.

## Deployment order

1. Apply `202609270002_contract_score_decisions.sql` and record its migration
   version. It admits both historical V4 and new V5 provenance.
2. Stop the existing application worker and start the updated checkout using its
   existing GPU, offline model cache, and private environment. From the worker
   repository on main:

   ```sh
   git pull --ff-only origin main
   PYTHONPATH=services/api uv run --extra inference python -m sidebyside_api.worker
   ```

   No training or model download is needed. This reloads backend Python code.
3. Check for a fresh ready heartbeat with
   `pipeline_version = online-approved-onboarding-contract-v5` and the pinned V5
   policy hash. Deploy the staged API only after that worker is ready. Avoid
   running old and new workers together: the historical worker claims globally
   and can cancel jobs from a pipeline it does not recognize.
4. Refresh discovery. V4 outcomes are never relabeled as V5. Eligible pairs are
   predicted again under the new policy and immutable profile versions.

The public API deployment must be coordinated with the worker restart. Updating
the website alone cannot recover relevance numbers already discarded by an old
worker.

## Live audit before the change

Saved 99.98% predictions for Demo Alex and Demo Sam retained `recommend` status;
their historical profile versions and location leases are no longer current.
Kai/Bryan worker jobs recorded
`insufficient_support_for_requested_conversation` with null numeric scores. Both
current request contracts were confirmed with `kind: none`. Their historical
raw 99% worker value was not retained in those Supabase results and cannot be
recovered from them. This audit does not establish a current real recommendation.

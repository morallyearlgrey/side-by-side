# Newton Evidence Evaluation: Job 852419

## Decision

Keep v4 and the existing frozen settings as the baseline for controlled,
synthetic demo integration. Do not retune against these 57 evaluation cases.
The targeted insufficient-evidence failure improved without changing any
known-label decisions. This is not clearance for live profiles or a deployed
matching service; `ready_for_live_profiles` remains false.

The run evaluated pretrained, frozen models. It did not train or export new
neural-network weights. The earlier job 852098 supplied scalar calibration
and decision thresholds fitted/selected on its synthetic train/validation sets.

## Verified Artifacts

- Downloaded directory: `artifacts/newton-evidence-v4-852419/` (git-ignored).
- `status.json`: completed, 57 pairs, `parameters_fitted: false`.
- Model: `Qwen/Qwen3-Reranker-4B`, revision
  `22e683669bc0f0bd69640a1354a6d0aebcfeede5`, CUDA float16, Tesla V100 32GB.
- Evidence model: `MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli`, revision
  `eb8b17b1983bca679126ea69b12b5d28c5fe9b9a`, CPU float32.
- Format encoder: `sentence-transformers/all-MiniLM-L6-v2`, revision
  `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`.
- All 25 recorded Python source hashes, schema, dataset, case sidecar, and
  included base-policy file hashes matched the local experiment inputs.
- Full report summaries, including cohorts and missed positives, were
  reproduced from saved decisions and dataset labels.

Artifact SHA-256 fingerprints:

```text
protocol.json ffe7709c2665456614efba2db6950ca012fd4fd7bc5609687de4580d07b3d04d
report.json   0314abc29fa7f1ad7780afb164719864ac2e8b3646ac375c9332bc5b1bc6883f
status.json   830b9f98d6ef22614b94e54332026f86d130ddc8cafd5e61d3e8edddc5426caf
```

## Outcomes

| Measurement | Unchanged v3 | Evidence-gated v4 |
| --- | ---: | ---: |
| Positive cases recommended | 19/21 | 19/21 |
| Positive cases missed | 2/21 | 2/21 |
| Negative cases recommended | 0/12 | 0/12 |
| Unknown cases recommended | 21/24 | 0/24 |
| Unknown cases deferred | 3/24 | 24/24 |
| Known-label coverage | 27/33 (81.8%) | 27/33 (81.8%) |
| Known-label precision | 100% | 100% |
| Known-label recall | 90.5% | 90.5% |
| Known-label F1 | 0.95 | 0.95 |

Coverage means a definite recommendation/non-recommendation rather than
`insufficient_evidence`; it is not accuracy. Six negative cases were explicitly
not recommended and six were deferred. The confusion matrix treats both as
not recommending, so 12 true negatives does not mean 12 definite rejections.
Unknown labels are excluded from precision/recall, not relabeled negative.

All 21 changed decisions were previously recommended unknown cases, now
deferred. The 54 fresh synthetic scenarios improved from 18/21 unknown
recommendations to 0/21; the three known v3 regressions improved from 3/3 to 0/3.
Fresh scenarios share templates and assistant-authored draft judgments; none
of this is an independently reviewed human compatibility benchmark.

## Remaining Misses

`v4_zipper_pair_0014` and `v4_zipper_pair_0017` are positive, history-based
conversation-format cases. Both requests explicitly require no firsthand
experience, so the new evidence gate did not block them.

Onboarding relevance is approximately 0.990 and 0.991, while the existing
history-format affinity is 0.655 for both. The existing score calculation
multiplies relevance by that affinity before synthetic Platt calibration,
producing final scores 0.392 and 0.393, below the fixed 0.5 threshold. Both were
already missed by v3. This is a known limitation of the history/score combination,
not evidence that the new firsthand gate damaged valid matches.

Keep these as documented misses. Any future adjustment needs separate
development/validation examples and a new evaluation, not a threshold chosen
to make these two cases pass.

## Demo Handoff

1. Keep the v4 scorer, three pinned model revisions, and job 852098 policy
   together. Use the strict `ml.matching_v4.score_bundle` path, not v3 alone.
2. Choose an available inference host and measure uncached, end-to-end request
   latency there. The Newton batch allocation ended; it did not start a service.
3. Extend Kai's existing API/worker with a separately versioned v4 adapter,
   first using fictional, approved-profile fixtures. The current runtime is
   onboarding-only v1; this report does not change it.
   Preserve `recommend`, `not_recommended`, and `insufficient_evidence` as
   separate outcomes; missing evidence should invite clarification.
4. Before real-user processing, implement authenticated source ownership,
   current approvals, blocks/availability, and request confirmation on the
   backend. Do not remove synthetic-only validation as a shortcut.
5. Mutual acceptance and profile/AR reveal remain separate application checks.
   A relevance recommendation never grants consent, establishes expertise,
   or certifies that another person is safe.

See [the integration handoff](ml-kai-handoff.md) for the current API boundary
and checked-in policy files. The preceding checklist concerns v4 promotion,
not a claim that Kai's existing v1 application lacks an API or consent checks.

Onboarding remains the primary source: use the existing 70/30 source policy
when eligible social evidence contributes, and 100% onboarding when it does
not. No Instagram connection is required for the controlled demo.

The protocol reports about 77 seconds of Qwen model loading. The v4 scoring
pass took about 9.9 seconds with repeated/shared prompt caches; this is not
an API latency benchmark or a guarantee of instant matching. Peak PyTorch GPU
allocation was about 7.69 GiB, excluding CPU models and other serving overhead.
The 4B weights were loaded on Newton; this results download contains audit
files, not the model weights.

# Newton Matching Results: Job 852098

## Decision

Keep `source_aware_tuned` with frozen Qwen3-Reranker-4B as the provisional
prototype. It won the declared validation comparison before test scoring and
improved recommendation decisions on the new synthetic test. Do not switch to
a larger model or adjust thresholds against these now-inspected test cases.

This is not a release approval. The model still recommends candidates with
missing firsthand experience, and `ready_for_live_profiles` remains false.
No inference service, Supabase integration, or real-data permission is added by
this report. Qwen's weights were not fine-tuned.

## Run and Verification

Bryan's Slurm output reports COMPLETED, exit 0:0, elapsed 00:02:56 on evc12.
Downloaded evidence is in `artifacts/newton-matching-v3-852098/`. Raw artifacts
remain ignored by Git; this report is the shareable summary.

Verified after transfer:

- Artifact status is completed; embedded protocol and selected policy agree
  with their standalone files.
- Dataset, split, and case SHA-256 hashes match the local generated v3 data.
- All 21 recorded ML source hashes match the local source at verification.
- Replaying all 180 source-aware and 20 baseline validation trials reproduces
  every recorded trial, the selected thresholds, and the winning variant.
- Every saved validation/test decision and report metric reproduces from saved
  scores. Independent label/decision counts reproduce all confusion matrices.
- The selection code writes the policy before test inference; selection uses
  validation only, not the subsequently observed test performance.

The dataset has 120 training, 60 validation, and 60 test pairs. Test contains
36 positive, 18 negative, and six unknown draft labels across quilting, lunar
photography, and speedcubing. People and topic families are split-disjoint,
but generation templates and author assumptions are shared. All examples are
synthetic and unreviewed, not measured human connection outcomes.

## Test Comparison

All four rows use the same 60 test pairs and frozen 4B checkpoint. Unknowns are
excluded from binary F1. An abstention counts as not recommending in the binary
confusion matrix, so coverage must be read alongside F1.

| Variant | Positive recommendations / 36 | Negative recommendations / 18 | Known abstentions / 54 | Known coverage | Binary F1 | Unknown recommendations / 6 |
| --- | --- | --- | --- | --- | --- | --- |
| Original fixed 0.5 | 36 | 9 | 0 | 100% | 0.889 | 3 |
| Calibrated baseline | 27 | 3 | 0 | 100% | 0.818 | 2 |
| Source-aware default | 35 | 0 | 10 | 81.5% | 0.986 | 3 |
| Source-aware tuned (selected) | 36 | 0 | 9 | 83.3% | 1.000 | 3 |

The selected pipeline's full breakdown is:

- 36 labeled positives recommended.
- Nine labeled negatives explicitly not recommended.
- Nine labeled negatives deferred as insufficient evidence.
- Three unknown cases recommended despite missing requested experience.
- Three unknown cases deferred because onboarding facts are absent.

Thus, "100% accurate" would be misleading. On this small synthetic set, no
labeled-negative candidate is recommended and no labeled-positive candidate is
missed, but uncertainty handling still fails and nine negatives are not actually
classified. Those nine abstentions cover unrelated topics, activity mismatch,
and explicit current-intent conflicts; correct negative explanations remain
unproven.

Controlled history ordering improves from 5/6 to 6/6 queries. The selected
pipeline also rejects all six history-negative pairs and the three explicit
format-conflict pairs. This supports the MiniLM-based format logic on these
templates, not a claim that the model has learned each person's general type.
Beginners practicing together, reverse sharing, null ratings, unrelated history,
and current preferences overriding past feedback all pass these test examples.

## Remaining Evidence Failure

All three `firsthand_evidence_missing` test cases are incorrectly recommended:

| Example | Synthetic calibrated score | Raw evidence-sufficiency score |
| --- | --- | --- |
| `v3_quilting_pair_0182` | 0.999858 | 0.986879 |
| `v3_astro_pair_0202` | 0.999766 | 0.976847 |
| `v3_stopwatch_pair_0222` | 0.999239 | 0.981167 |

Each immediate request specifically asks for firsthand advice. The candidate's
only fact is `wants_to_try`, explicitly saying they have not finished a successful
attempt. Both relevance and sufficiency still score highly. These are uncertainty
failures, not three extra labeled false positives. The scores are not human
compatibility probabilities.

The next change should make evidence requirements explicit in the input contract
and require topic-relevant, approved support for the requested experience. It
must preserve beginner companionship and the direction of offers to share.
Do not use a global "has any experienced fact" shortcut, keyword detection, or
a higher threshold as a substitute for that check. This report does not
implement the new contract or claim the issue is fixed. Future changes need
new held-out cases; this test set is now development evidence.

## Configuration and Handoff

Authoritative settings are in the downloaded `selected_policy.json`:

| Setting | Value |
| --- | --- |
| Variant | `source_aware_tuned` |
| Qwen revision | `22e683669bc0f0bd69640a1354a6d0aebcfeede5` |
| MiniLM revision | `1110a243fdf4706b3f48f1d95db1a4f5529b4d41` |
| Decision threshold | 0.5 |
| Evidence threshold | 0.3 |
| Format threshold | 0.5 |
| Calibration slope | 1.5246867756684104 |
| Calibration intercept | -1.372945394772712 |

Calibration uses 108 known training labels. Apply the existing implementation,
not just the thresholds: blend sources, attenuate by format compatibility,
calibrate the logit, and enforce structural/evidence/format gates. See
`ml/matching_v3.py` and `ml/tune_matching_v3.py`.

Source weighting is 70/30 only when usable social evidence exists. Nine test
pairs use that blend, 48 use onboarding alone, and three are structurally
deferred before scoring. This run does not establish that 70/30 is optimal.

For Kai, preserve the three response states: `recommend`, `not_recommended`,
and `insufficient_evidence`. Treat missing evidence as needing clarification,
not a low compatibility percentage. Production consent, blocks, availability,
authenticated badge ownership, and mutual acceptance must remain separate hard
application checks; model scores never authorize an AR reveal or approach.
The current experimental scorer still accepts only synthetic bundles. Do not
bypass that validation by labeling real profiles synthetic.

The test's recorded source-aware component times sum to 11.63 seconds, versus
8.23 seconds for the baseline. There are 123 source-aware Qwen task entries and
15 cache hits; model loading took 61.34 seconds. Peak PyTorch allocated GPU
memory was 7.87 GiB on a 32 GB V100. These are shared-cache execution statistics,
not cold-start, concurrent-service, or end-to-end app latency guarantees.

Selected-policy file SHA-256:
`b1e4b4ef1c58f17007400f5064ef97b12d19489d1a78698ca177e2792080bf57`.

A completed batch job is not a serving endpoint, and the downloaded results do
not contain model weights. Serving-host setup and benchmarking remain separate
work after the evidence fix and real-profile contract are addressed.

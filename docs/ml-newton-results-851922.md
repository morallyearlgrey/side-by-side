# Newton Reranker Results: Job 851922

## Run and Verification

Bryan's Slurm output reports COMPLETED, exit 0:0, elapsed 00:06:36 on evc21.
The downloaded artifacts confirm that Qwen3-Reranker-0.6B, 4B, and 8B completed
the comparison. These are frozen pretrained models, not newly trained weights.

Local evidence: `artifacts/newton-rerankers-851922/`, including `status.json`,
`comparison.json`, and each model's protocol, predictions, prompts, and report.
Artifacts remain ignored by Git; this summary is the shareable handoff.

Verification performed after transfer:

- Every model report and prediction file parsed successfully.
- Dataset, cases, and split hashes match `data/generated/coverage-v2-01/`.
- All recorded ML source hashes match the local source files.
- Checkpoint revisions, prompt inputs, threshold, hardware, dtype, and other
  comparison contracts pass the suite's `summarize_runs` checks.
- Separate per-mode metrics equal the corresponding model report entries.
- All nine confusion matrices were independently recomputed from predictions
  and the matching local labels; they agree with the reports.

The benchmark contains 40 synthetic, assistant-labeled, unreviewed development
cases. Only 36 have binary labels (18 positive, 18 negative); four are unknown
and excluded from F1 and the correct-count denominator. These are not measured
human conversation outcomes or a fresh independent validation set.

## Full-Input Comparison

Inputs: approved onboarding facts, approved post facts, and earlier feedback.
Threshold: 0.5 fixed before the run. No tuning was performed after inspection.

| Model | Correct / 36 | F1 | False positives | False negatives | Median / p95 pair time | Peak allocated GPU memory |
| --- | --- | --- | --- | --- | --- | --- |
| 0.6B | 31 | 0.857 | 2 | 3 | 42 / 84 ms | 1.31 GiB |
| 4B | 33 | 0.919 | 2 | 1 | 133 / 238 ms | 7.89 GiB |
| 8B | 33 | 0.919 | 2 | 1 | 172 / 331 ms | 15.61 GiB |

Timings are for 40 uncached directional pairs, batch size 1, float16 on a
Tesla V100-PCIE-32GB. They include tokenization, transfer, and synchronized
inference, but exclude model loading, downloads, network/API overhead, and
application logic. First inference took 9.58, 1.71, and 2.46 seconds respectively;
the earlier 0.6B run may include shared first-use overhead. Do not use total run
time to claim that a larger model is faster. Loading alone took 3.24, 15.96,
and 24.58 seconds. Memory is PyTorch peak allocation, not whole-system usage or
the minimum deployment memory requirement.

The previous small learned head scored F1 0.714 on the same paired full-input
comparison. This is development evidence of improvement, not a production claim.

## What Additional Inputs Changed

| Model | Onboarding-only F1 | Add posts F1 | Add history F1 | History ordering with feedback |
| --- | --- | --- | --- | --- |
| 0.6B | 0.889 | 0.857 | 0.857 | 1 / 2 |
| 4B | 0.919 | 0.919 | 0.919 | 1 / 2 |
| 8B | 0.889 | 0.919 | 0.919 | 2 / 2 |

Only six prompt inputs change when adding posts; four change when adding
history. The other comparisons reuse identical cached inputs, not additional
independent examples. Posts correct one 8B animation case, flip one correct
0.6B case to incorrect, and change no 4B binary decisions. History changes no
binary decisions for any model. This does not establish a general benefit
from social enrichment or personalization.

The 8B model orders both controlled history comparisons correctly, but its
positive-minus-negative margins are only 0.005431 and 0.000556. It still scores
both history-negative examples above 0.98. Thus, correct ordering is not the
same as rejecting an unsuitable conversation format. There are only two such
queries; neither reliability nor robustness is established.

The proposed 70% onboarding / 30% Instagram policy was NOT implemented or tested
by this run. The current reranker jointly reads the available approved facts.

## Concrete Failures

- All models accept both draft-negative history examples, despite the viewer
  explicitly asking for a format consistent with previously useful sessions.
  These are `challenge_history_pair_1473` and `challenge_history_pair_1474`.
- 4B misses `challenge_zines_pair_1445`: two beginners explicitly welcome
  practicing printmaking together, but it scores the opportunity 0.143.
- 8B misses `challenge_transit_pair_1455`: a person offering map-design experience
  and a beginner welcoming advice score 0.480, just below the frozen threshold.
  Do not adjust the threshold against this already-inspected case.
- 0.6B misses three sharing-direction opportunities involving transit diagrams
  and animation (`1449`, `1457`, `1463`).
- None abstains on the four unknown-labeled cases. Their scores range from
  0.950-0.997 (0.6B), 0.981-0.999 (4B), and 0.712-0.964 (8B). These are not
  calibrated probabilities. Unknown is not a negative label; these are warning
  signs about uncertainty handling, not four additional counted errors.

The unknown cases also need annotation review: their immediate requests ask
for practical/firsthand help while broader profile goals welcome fellow
beginners. Define how the immediate request takes precedence and have Bryan
and Kai judge the cases before treating them as an uncertainty benchmark.

The separate Jane/John Italy diagnostic passes the 0.5 threshold in both
directions for all three models. Scores are 0.998/0.996 (0.6B), 0.996/0.991
(4B), and 0.999/0.958 (8B). This familiar example is outside the 40-case benchmark
and does not validate general travel matching.

## Provisional Decision and Handoff

4B is the provisional engineering default for the next prototype evaluation:
it ties 8B on labeled classification with about half the allocated GPU memory
and a lower measured median latency. Keep 8B as a challenger because its history
ordering is better here. Neither is a finalized or deployed matcher, and 4B's
missed beginner case is a real regression relative to the other two models.

Next steps, not implemented by this report:

1. Independently review fresh cases covering beginner companionship, both
   directions of learning/sharing, contradictory goals, insufficient evidence,
   and conversation-format preferences. Preserve this development set unchanged.
2. Define evidence sufficiency and explicit preference handling outside a single
   relevance score. A low score and insufficient evidence are different states.
3. Implement and validate separate source-channel scoring for the proposed
   onboarding-first policy; do not label the existing joint score as 70/30.
4. Select/calibrate thresholds on separate reviewed validation data and retain
   an untouched final test. Do not silently retune against this report's errors.
5. Benchmark the chosen model on the intended serving host before offering an
   API to Kai. A completed Slurm job is not an always-on inference endpoint;
   this transfer copied reports, not model weights or a running service.

Consent, availability, blocks, and profile-reveal authorization remain hard
application gates. The current offline code remains synthetic-only and is not
connected to live profiles, Supabase, Core2 discovery, or Quest rendering.

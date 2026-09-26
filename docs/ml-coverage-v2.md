# Coverage-v2 Controlled Experiment

This follows the [pilot failure analysis](ml-first-run.md). The model architecture
and feature semantics are unchanged. All new labels are assistant-authored
synthetic drafts, not human-reviewed facts or real conversation outcomes.

**Status: broader coverage and improved history-enabled results, still not
demo-ready.** All 48 engineering tests pass. A real local CPU run and comparison
of saved checkpoints completed; no simulated encoder was used for these results.

## Changes Fixed Before Training

- 712 fictional profiles with one to nine facts, rather than near-uniform profiles.
- 1,480 directional pairs: 1,080 labeled training, 216 labeled validation, 36 labeled
  challenge cases, plus 148 unknowns excluded from binary fitting/evaluation.
- Missing and present preferences, missing and present posts, short and long
  profiles, and missing and present history occur with both positive and negative
  labels in training/validation. Every conversation mode has both classes.
- Overlapping topic/experience with conflicting current intent; novice companionship
  versus unknown firsthand expertise; two-way sharing; independently assigned
  background interests with varied roles.
- Controlled opposite-history viewers with identical present-day features and
  explicit requests for a conversation format like earlier useful sessions.
- Forty blind training-review cases and forty blind challenge-review cases.

The 15 original scenario topics are now development/training material. Three new
families are validation; five other families form the challenge. Challenge profiles
use separately authored wording, but the same assistant wrote both sets and the
history construction is shared. This is a stronger engineering check, not an
independent human benchmark. The original Italy example remains a development
diagnostic and is not included in fitting or the new challenge.

## Fixed Experiment Settings

- Frozen MiniLM revision `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`.
- Unchanged 71 -> 64 -> 16 -> 1 neural head, feature builder, optimizer and loss.
- CPU, seed 42, at most 60 epochs, patience 10, batch size 32.
- Training-only normalization; validation-only early stopping and thresholds.
- Three predeclared ablations: onboarding only, with posts, with history.
- Same cosine and logistic baselines. Compare the previous checkpoints on the
  SAME new challenge, not their old easy test set.
- Unreviewed-synthetic override is explicit. No claims of human validation.

The data recipe and engineering tests were checked before training. A missing
negative story-exchange category was caught and corrected before this run.
The active frozen dataset is `data/generated/coverage-v2-01`; the earlier
`coverage-v2` directory is an unused generation draft, not the experiment dataset.

## Measured Results

All entries below use the SAME new 40-case challenge: 36 labeled cases (18 positive,
18 negative) and four unknowns excluded from binary metrics. Thresholds come from
each checkpoint's original validation set; no thresholds were tuned on this test.

| Model inputs | Previous neural F1 | New neural F1 | New logistic F1 |
| --- | ---: | ---: | ---: |
| Onboarding only | 0.519 | 0.519 | 0.519 |
| Plus approved posts | 0.621 | 0.552 | 0.500 |
| Plus earlier feedback | 0.400 | 0.714 | 0.714 |

The history-enabled model improved, but onboarding-only did not and the posts-only
variant regressed. This is not an across-the-board fix. The new history model
correctly classified 18 negatives and 10 positives, missing eight intended positives.
That is precision 1.000 and recall 0.556 on this tiny synthetic set, not a guarantee
of zero false positives in real use. F1 is not the percentage of successful matches.
Logistic regression ties its overall F1; no neural advantage is established.

The two opposite-history ranking checks improve from 0/2 to 2/2 for the neural head.
The new positive-minus-negative margins are about 1.0. The history-blind variants
tie both candidates, as expected from their identical non-history features. This
only verifies the controlled mechanism under shared synthetic assumptions. There
are just two such queries; the older logistic model already ordered both correctly
with tiny margins, and the new logistic model also passes both. Do not present this
as validated personal preference learning.

For candidates missing conversation preferences, history-enabled neural F1 rises
from 0.222 to 0.667 on the challenge. All 25 role-pair similarity columns now vary
in training. Constant features in the history model fall from 29 to six; the six
remaining flags are intent/fact/openness presence. Missing goals and missing
openness are not newly validated by this experiment. No test feature activates a
formerly constant training column. These are coverage improvements, not proof
that all feature interactions are learned well.

Validation F1 remains much easier: 0.974 / 0.974 / 1.000 for the three new neural
variants. That gap reinforces the limitation of generated training/validation
templates even after adding more examples.

## Italy Diagnostic

Without including the Jane/John fixture in training or changing the threshold,
the new history-enabled checkpoint scores Jane -> John at 0.9999926 and
John -> Jane at 1.0, versus 0.282 and 0.022 previously. Both now cross 0.500.
These saturated scores are uncalibrated, not near-certain human compatibility.
Passing this previously known development example is not independent validation.

## Remaining Failures

The eight false negatives include all four beginner-companionship cases, the
accessible-map advice case, and three reverse-sharing cases. The model still
struggles with independently worded invitations and intent. We have recorded
these failures, not edited their labels or tuned the model until they pass.

Before further training, Bryan and Kai should review whether the labels, stated
openness, and current goals actually justify each proposed match. For a new data
revision, author different practice-partner and two-way-sharing examples, vary
wording independently of the label, and reserve ANOTHER fresh evaluation set.
This challenge is now diagnostic/development evidence if used to guide that work.
Any replacement model should beat the simpler baseline on reviewed cases, not just
score highly on more generated copies of the same assumptions.

## Reproduction Artifacts

- `artifacts/local-coverage-v2-01/`: saved heads, normalization, validation-selected
  thresholds, baseline parameters, training history, provenance and feature coverage.
- `artifacts/coverage-v2-comparison.json`: old/new predictions, thresholds, overall
  and subgroup metrics, and history-ranking margins.
- `artifacts/italy-coverage-v2-inspection.md`: selected facts and all 71 raw inputs
  for the new Jane -> John score.
- `data/generated/coverage-v2-01/`: frozen dataset, split manifest and review packets.

Commands are in [the ML README](../ml/README.md#broader-data-and-blind-review).
Generated data and artifacts remain local and gitignored. Do not overwrite them
when starting a new run; use a new output directory.

## Review Still Required

Start with [training review](../data/generated/coverage-v2-01/review-training.md)
and [challenge review](../data/generated/coverage-v2-01/review-challenge.md).
Each has a companion JSONL with blank reviewer, decision, rubric, time and reason.
Keep Bryan's and Kai's initial judgments independent. The answer key is separate.
No labels have been marked human-reviewed on either person's behalf.

Next steps must follow the measured results and actual review, not extra GPU time
or threshold changes chosen to make one example pass. No cluster submission,
commit, push, API deployment, or live-data ingestion is part of this experiment.

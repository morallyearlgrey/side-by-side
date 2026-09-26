# First Local Training Run

Status: engineering pipeline verified; learned matcher **not demo-ready**.

This experiment used the frozen MiniLM encoder and actual PyTorch training on
the local Mac CPU. It was not a simulated embedding run and was not a Newton
submission. The separate Newton GPU environment check passed earlier, but the
project training job has not yet run there.

## Data and Evaluation

- 120 fictional profiles across 15 scenario families.
- 270 directional pairs; 30 unknown labels excluded from binary training.
- 144 labeled training pairs, 48 validation pairs, 48 test pairs.
- People, scenario families, and historical partners kept within their split.
- Shared sentence templates and role patterns remain across splits.
- Encoder: `sentence-transformers/all-MiniLM-L6-v2`, revision
  `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`.
- Seed 42, at most 60 epochs, patience 10; all three variants selected epoch 60.
- Labels were unreviewed synthetic drafts; the explicit smoke-test override was used.

| Inputs | Neural test F1 | Logistic test F1 | Cosine test F1 |
| --- | ---: | ---: | ---: |
| Onboarding only | 1.000 | 1.000 | 0.933 |
| Plus approved post facts | 1.000 | 1.000 | 0.929 |
| Plus earlier feedback | 1.000 | 1.000 | 0.929 |

These numbers only demonstrate fit to a small template-driven pilot. They do not
prove a neural advantage over logistic regression, a benefit from posts/history,
or real-world human compatibility. The held-out candidate pools are small and
easy; their perfect ranking scores should not be used as a project quality claim.

## A More Informative Sanity Check

We then scored the separately written `data/samples/v2/italy-example.json`, which
was not included in this training bundle. Both directions are intended positive
illustrations, not observed human outcomes.

| Direction | Uncalibrated neural score | Validation-selected threshold |
| --- | ---: | ---: |
| Jane seeking Italy advice -> John offering it | 0.282 | 0.500 |
| John offering Italy advice -> Jane seeking it | 0.022 | 0.500 |

Both fall below the threshold. This is evidence that the pilot-trained head does
not generalize reliably even to an independently phrased illustration. We did
not tune to this example or quietly relabel it. Treat it as a discovered failure
case, not an untouched benchmark after using it for further development.

## Follow-up Diagnostic: Missing Optional Fields

After Bryan reproduced the inspector output, we compared its features with the
actual training feature ranges. Every training pair had both conversation-style
preference-presence flags set to 1. John's preferences are missing, so his flag is
0 and the preference cosine is 0. The training preference cosines ranged from
approximately 0.105 to 0.692; missing is therefore outside the observed range,
even though the feature contract correctly includes missingness flags. Supplying
a mask does not teach the model its meaning without suitable examples.

For a diagnostic only, setting the standardized preference features to their
training means while holding the history-enabled model fixed moved Jane -> John
from 0.282 to 0.506. Setting only history features to their training means moved
it to 0.422. These artificial interventions are not actual profile changes,
causal attribution to a single feature, or recommended production imputations.
They show sensitivity worth addressing, not that either change fixes matching.

The same example also activates some role-pair comparisons that were always
zero during training. Across independently trained checkpoints, Jane -> John
scores 0.197 for onboarding-only, 0.673 with posts, and 0.282 with history;
John -> Jane remains low in all three. These are separate fitted models, so
their differences do not isolate a causal effect of posts or history.

Corrective data work should include positive AND negative examples with missing
preferences, missing history, varied numbers/combinations of interests, and
independently written language. Missingness must not systematically encode the
label. Do not invent John's preferences, lower the threshold to pass this one
case, or claim a personalization benefit from this pilot. No weights, features,
thresholds, or annotations were changed during this diagnostic.

Next: independently review labels with Bryan and Kai, write varied examples with
hard intent contrasts and diverse profile lengths, add cases where past feedback
actually changes the preferred candidate, and reserve a NEW evaluation set before
retraining. More GPU time or more copies of the same templates will not resolve
the dataset limitation.

## Artifacts

- `artifacts/local-pilot-v1/metrics.json`: all baseline and ablation metrics.
- `artifacts/local-pilot-v1/provenance.json`: data, code, encoder and environment metadata.
- `artifacts/local-pilot-v1/with_history/matcher.pt`: research-only saved head.
- `data/generated/pilot-v1/review.jsonl`: drafts for review; not automatically imported.

Artifacts and generated data are local and gitignored. No commit, push, remote
installation, or cluster submission was performed as part of this experiment.

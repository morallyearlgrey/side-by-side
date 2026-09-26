# Qwen Reranker Experiment

This is a separate zero-shot alternative to the MiniLM + 71-feature scoring head.
The existing generators, embeddings, neural/logistic checkpoints, and dataset
labels are not replaced or modified.

**Result: better general semantic matching on this development set, not a complete
replacement for preference learning or uncertainty handling.** The real frozen
model ran locally; these are not test-double predictions.

## Measured Results

Same 36 labeled cases, four unknowns excluded, zero eligibility/length abstentions:

| Inputs | Coverage-v2 neural F1 | Coverage-v2 logistic F1 | Qwen zero-shot F1 |
| --- | ---: | ---: | ---: |
| Onboarding only | 0.519 | 0.519 | 0.889 |
| Plus approved posts | 0.552 | 0.500 | 0.857 |
| Plus earlier feedback | 0.714 | 0.714 | 0.857 |

For the full-input comparison, the old head found 10/18 intended positives with
0/18 false positives. Qwen found 15/18 intended positives, but incorrectly suggested
2/18 negatives. Its precision is 0.882 and recall 0.833. F1 is not a percentage
chance of friendship. Adding history did not improve Qwen's aggregate F1; the
onboarding-only variant did best on this small development set. That observation
does not justify selecting a production configuration without fresh evaluation.

Specific results:

- All four previously missed beginner-companionship cases now score positive.
- Candidates missing conversation preferences: full-input Qwen F1 0.933, compared
  with 0.667 for the trained head, on 18 labeled cases.
- Both Italy directions score positive: 0.9981 and 0.9964, at the unchanged 0.5
  threshold. This is a known development diagnostic, not independent validation.
- Three reverse-sharing cases remain false negatives in the full-input mode.
- Both false positives are history-format mismatches. Qwen rates both formats
  highly and orders only one of the two opposite-preference queries correctly,
  with margins around 0.0001. The trained history head passed both controlled
  rankings. Qwen has NOT demonstrated the desired personalization behavior.
- All four cases labeled unknown for insufficient firsthand experience receive
  high scores (approximately 0.951-0.997). They are excluded from binary F1, but
  this is an important uncertainty failure, not something to hide behind the score.

The change alters both the pretrained model and the representation: Qwen sees
approved text directly rather than a 71-number summary. This experiment cannot
attribute the gain solely to parameter count.

## Measured Latency

For the 40 uncached, full-input pairs on the Apple M2 GPU:

- Median: 0.445 seconds per directional pair; p95: 0.694 seconds.
- First uncached pair: 3.007 seconds; model loading: 7.555 seconds, separately.
- Full-input scoring totaled 21.926 seconds, excluding dataset validation/loading.
- Subsequent ablations reused identical prompts: 36 cache hits for with-posts,
  34 for onboarding-only. Their wall times are not independent throughput measurements.

These timings do not include networking or a complete app workflow and do not
predict Quest/Core2 latency. The badge/headset would need a separate scoring service;
no such integration was added here.

## What to Do Next

Keep this as a candidate semantic scorer and keep the prior models for comparison.
Do not silently replace the personalized scorer or make match requests from high
Qwen scores alone. A next controlled experiment could combine text relevance with
explicit, separately tested history features, trained only on reviewed data. That
hybrid has not been implemented or validated in this run.

First, Bryan and Kai should independently review new examples, including uncertain
experience, declined formats, two-way sharing, and unrelated past feedback. Test
unknown/abstention behavior separately from binary relevance. Preserve deterministic
eligibility and mutual consent outside every model. No prompt or threshold was
retuned after seeing these results.

## Fixed Protocol

- Model: [Qwen/Qwen3-Reranker-0.6B](https://huggingface.co/Qwen/Qwen3-Reranker-0.6B),
  pinned to `e61197ed45024b0ed8a2d74b80b4d909f1255473`.
- All weights frozen. No training, fine-tuning, prompt search, or threshold fitting.
- One task-specific instruction, `directional-approved-text-v1`, fixed before this run.
- Threshold: 0.5, fixed before scoring. Scores are not calibrated human-match probabilities.
- Same 40-case synthetic development challenge as coverage-v2; 36 labeled cases
  and four unknowns. Unknowns are scored for inspection but excluded from binary metrics.
- All three input modes: with history, with approved posts, onboarding only.
- Prior baselines retain their own validation-selected thresholds. Comparisons
  are joined by case ID and evaluated on common scorable cases, with coverage reported.
- Separate Italy diagnostic after the benchmark, not part of its aggregate metrics.
- Local Apple M2 GPU, 16 GB system memory, float32, SDPA, batch size 1. No Newton job.
- 4,096-token cap; overlong inputs cause abstention rather than silent truncation.
  Preflight found 461-921 tokens across the 120 case/mode combinations.

This challenge has already informed development and the choice of task instruction.
It is NOT a new untouched test set or independent human validation. The assistant
authored both the synthetic labels and the matching instruction. Improvements here
must be confirmed on freshly written, independently reviewed examples.

## What the Model Reads

The viewer query contains the requested conversation mode/goal, explicit current
intent, open discussion topics, conversation preferences, approved detailed facts
with their roles, and eligible earlier feedback. The candidate document contains
the same approved profile fields without another person's private feedback history.

Earlier feedback includes the viewer's explicit useful/talk-again ratings, the
earlier context, and that partner's approved facts and stated conversation style.
Acceptance alone and absent ratings are not interpreted as dislikes. Feedback
comments are excluded. History is omitted entirely from non-history ablations.

The model does NOT receive target labels, annotation reasons, rubrics, case
categories, person IDs, example IDs, raw unapproved captions, unapproved facts,
or all of someone's raw onboarding answers. IDs appear only outside the model
input in local audit files. Prompts do contain fictional matching-only information
for research and must not be reused as public profiles or AR output.

Current validation remains in force: synthetic-only records, owned evidence,
timestamp checks, current snapshots, viewer-owned strictly earlier feedback, and
explicit split isolation. Boundaries, missing openness, or insufficient approved
facts cause abstention before the model is called. Production blocking, availability,
proximity, and mutual consent are still separate and NOT implemented by this scorer.

## Scoring and Performance

The implementation follows the publisher's [Transformers scoring recipe](https://huggingface.co/Qwen/Qwen3-Reranker-0.6B#using-transformers):
frame an instruction, query, and document; evaluate the final-token logits for
`no` and `yes`; normalize just those two values with softmax. No generated explanation
or chain of thought is required. The final projection is computed only for the
last token, and the KV cache is disabled for this single-forward-pass workload.

The model and tokenizer load exclusively from the explicitly downloaded local
cache. Remote model code is disabled and only safetensors weights are accepted.
Profile text is not sent to a hosted model. JSON escaping prevents input strings
from adding chat delimiter tokens; this is not a guarantee against semantic prompt
injection and the path remains a synthetic-data research tool.

Identical text inputs are cached across ablations. Latency percentiles exclude
cache hits and separately disclose the first uncached call and model loading.
Measurements include tokenization, device transfer, and synchronized inference,
but exclude the one-time model download. A toy challenge is not a throughput or
production concurrency benchmark.

## Reproduce

Run from the project root. The 1.19 GB model weight file has already been downloaded
into `.venv-ml/hf-cache`; the full cache must be present to run offline elsewhere.
The isolated environment's existing Transformers 4.57.6 supports the architecture;
no package upgrade is necessary.

```bash
HF_HOME=.venv-ml/hf-cache HF_HUB_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 TOKENIZERS_PARALLELISM=false .venv-ml/bin/python -m ml.benchmark_reranker --dataset data/generated/coverage-v2-01/dataset.json --splits data/generated/coverage-v2-01/splits.json --cases data/generated/coverage-v2-01/cases.json --baselines artifacts/coverage-v2-comparison.json --diagnostic data/samples/v2/italy-example.json --out artifacts/qwen-reranker-v1 --device mps --dtype float32 --revision e61197ed45024b0ed8a2d74b80b4d909f1255473 --max-tokens 4096
```

Use a NEW output directory on repeat runs. For CPU, use `--device cpu`; for an
allocated Newton GPU use `--device cuda --dtype float16`. The model does not
silently fall back to another device. A sandbox may not expose the Apple GPU;
the local experiment was explicitly authorized to use it outside the sandbox.
GPU support and timing on Newton have not been tested for this model.

Artifacts:

- `protocol.json`: model revision, exact instruction/template, fixed threshold,
  dataset/split/source hashes, package versions, and device settings.
- `report.json`: all ablation metrics, slices, latency, and case-aligned baseline comparisons.
- `<mode>/predictions.json`: scores, abstentions, input lengths, prompt hashes, and timing.
- `<mode>/prompts.jsonl`: synthetic query/document payloads for auditing; no target labels.
- `development-diagnostic.json`: separate Italy results and input text.

All outputs remain local and gitignored. Nothing is pushed, deployed, or submitted
to the cluster by this experiment.

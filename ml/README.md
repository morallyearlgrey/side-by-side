# SidebySide Matching Experiments

This is an offline, synthetic-first training pipeline, separate from the Next.js
app. It trains **directional conversational relevance**, not friendship,
personality, safety, attraction, or consent. It is not connected to Supabase,
Instagram, the badge, or the Quest yet.

The [first local run report](../docs/ml-first-run.md) records the successful
pipeline test and an important out-of-template failure. Its checkpoint is not a
production-ready matcher.

The [coverage-v2 experiment](../docs/ml-coverage-v2.md) adds varied missing fields,
multi-interest profiles, controlled history contrasts, and a separately written
40-case draft challenge. It does not replace human review with generated labels.

The [Qwen reranker experiment](../docs/ml-qwen-reranker.md) is a separate frozen
text-pair model: it reads approved details jointly instead of receiving the 71
summary numbers. Its weights, prompt, and 0.5 threshold are fixed for a zero-shot
development comparison. It does not replace the existing learned scorer.

The [Newton model-size comparison](../docs/ml-newton-rerankers.md) prepares the
same evaluation for pinned 0.6B, 4B, and 8B checkpoints in an independent Slurm
job. The [job 851922 results](../docs/ml-newton-results-851922.md) now record the
completed comparison, provisional model choice, and remaining limitations.

## What Is Implemented

1. Validation of the existing v2 JSON Schema plus reference ownership, quoted
   evidence, event time, current profile versions, and viewer-owned history.
2. A deterministic synthetic engineering pilot: 120 fictional people, 15 scenario
   families, 270 directional pairs, 30 unknown labels, and 30 earlier feedback
   records. No real social data is downloaded or sent to a service.
3. Frozen `sentence-transformers/all-MiniLM-L6-v2` encoding of individual facts,
   explicit goals, conversation preferences, and available discussion topics.
4. A small PyTorch network, with cosine and logistic-regression comparisons.
5. Three ablations on identical examples: onboarding only, added approved post
   facts, and added earlier feedback.
6. Saved weights, normalization, encoder commit, code/data fingerprints, split
   assignments, training curves, predictions, and evaluation metrics.
7. Checkpoint-based offline scoring and a Newton Slurm job script.

The extractor/onboarding LLM is NOT implemented here. This code starts at the
approved structured facts, not raw screenshots or an Instagram login.

## Input and Feature Contract

The existing bundle format is in
[`data/schemas/matching-dataset-v2.schema.json`](../data/schemas/matching-dataset-v2.schema.json).
Do not use the older v1 JSONL examples as training input.

Only confirmed, matching-allowed facts enter the encoder. Each fact retains its
topic, specific details, and stated motivation. Experience and aspiration remain
different categorical roles. Missing motivation remains missing. Raw captions
and answers are evidence records, not extra unapproved ranking features.

The encoder produces normalized 384-dimensional vectors. We encode facts
separately and select at most six per person using the viewer's current intent.
The head receives **71 semantic comparison features**, not arbitrary handcrafted
embeddings or raw user IDs:

| Block | Values |
| --- | ---: |
| Best similarity for each ordered pair of five fact roles | 25 |
| Viewer/candidate role-presence flags | 10 |
| Conversation mode | 6 |
| Goal/fact, fact/fact, reverse-goal, preference and openness similarities | 6 |
| Missing-information flags | 8 |
| Earlier useful/not-useful and talk-again/not-again history, kept separate | 16 |

The network is `71 -> 64 -> 16 -> 1`, with ReLU and dropout, trained using
`BCEWithLogitsLoss` and AdamW. The final sigmoid is an **uncalibrated relevance
score**, not a measured probability of a successful conversation.

History compares the current candidate with earlier partners' approved facts
and stated conversation preferences, weighted by relevance of the earlier
conversation to today's goal. Acceptance alone is not usefulness. Null ratings
are not dislikes. We do not infer sensitive attributes or a demographic "type."
This implements memory features; it does not demonstrate that personalization
has been learned well. That needs discriminating human-reviewed examples and,
later, authorized human feedback.

The feature path is shared by training and scoring. Labels, rubrics, explanations,
IDs, posting frequency, and follower counts are not predictive inputs. Duplicates
with normalized-identical semantic fields and role are collapsed; differently
worded duplicate claims still need upstream semantic deduplication. Individual
texts exceeding the encoder's 256-wordpiece limit are truncated; this first
English-language baseline is not validated for long or multilingual profiles.

## Safety and Validation Limits

- Only `synthetic_only` bundles containing synthetic records are accepted. A
  claimed consent flag is not proof: real-data training stays blocked until
  consent receipts, platform permission checks, and revocation are implemented.
- Image evidence is rejected in this first pipeline. Caption/self-report evidence
  must quote its source. A matching quote does not prove the normalized fact is
  semantically correct; reviewers must check that, including willingness to share.
- Profile snapshots must be current at their prediction time. Future posts,
  future answers, stale snapshots, future ratings, and another person's private
  history are rejected.
- Any nonempty free-text `avoid_topics` list makes offline scoring abstain for
  boundary review. This is deliberately conservative, not a semantic boundary
  classifier. Missing candidate openness or approved facts also causes abstention.
- Production blocks, availability, proximity, consent, and restricted-topic
  eligibility MUST be checked outside this model. No score authorizes an intro,
  AR reveal, or display of `matching_only` evidence. The scorer returns no private
  profile text and explicitly marks its results as research-only.
- Unknown labels are excluded from binary loss and classified metrics. This does
  not teach calibrated uncertainty or guarantee abstention on all unknown cases.

## Local Quick Start

Run commands from the repository root, one at a time. Installation downloads
packages; the first training command also downloads the public MiniLM encoder.
No external LLM key is needed.

```bash
python3 -m venv .venv-ml
```
```bash
source .venv-ml/bin/activate
```
```bash
python -m pip install -r ml/requirements.txt
```
```bash
python -m pytest ml/tests -q
```
```bash
python -m ml.synthetic --out data/generated/pilot-v1
```
```bash
python -m ml.validation data/generated/pilot-v1/dataset.json
```
```bash
python -m ml.train --dataset data/generated/pilot-v1/dataset.json --splits data/generated/pilot-v1/splits.json --out artifacts/pilot-v1 --device cpu --mode all --allow-unreviewed-synthetic
```
```bash
python -m ml.predict --dataset data/samples/v2/italy-example.json --model-dir artifacts/pilot-v1/with_history
```

The generated data and output directories must not already exist; choose another
name for a new experiment. The `--allow-unreviewed-synthetic` switch is an
intentional opt-in for engineering tests. Without it the trainer requires every
used label to be marked reviewed. That marker is an audit declaration, not a
verification of who actually reviewed it.

## Inspect One Match

Run this on the Mac, not a Newton login node. It uses CPU and the local model
cache from the first experiment; no cluster allocation or new training is needed.

```bash
HF_HOME=.venv-ml/hf-cache HF_HUB_OFFLINE=1 .venv-ml/bin/python -m ml.inspect_pair --model-dir artifacts/local-pilot-v1/with_history
```

The default case is Jane -> John from the Italy example. The output contains the
selected facts, six-component previews of their 384-dimensional vectors, the
full fact-to-fact cosine matrix, role-pair summaries, all 71 raw features, and
the checkpoint's final score. These diagnostics are **not feature attributions**:
they show inputs, not how much each input caused a model decision. They include
synthetic `matching_only` text for local debugging and must not become an AR
display or a public profile endpoint. Real data remains rejected.

- Reverse direction: add `--example-id john_to_jane_v2`.
- Inspect a different bundle: add `--dataset PATH --example-id EXAMPLE_ID`.
- Save Markdown: add `--out artifacts/inspection-NAME.md` (must be a new file).
- Machine-readable output: add `--format json`.
- Encoder-only inspection: omit `--model-dir`; use `--revision` with the encoder
  commit from a prior run when offline. Without a cached model/revision, remove
  `HF_HUB_OFFLINE=1` to download it.

For the six-fact-comparison Italy diagnostic, the aspiration -> experience cosine
was 0.7911, but the trained neural score was only 0.2820. This localizes a problem
to investigate in feature aggregation/training/generalization; it does not prove
all embedding comparisons work. See the [manual test protocol](../docs/matching-test-protocol.md).

## Broader Data and Blind Review

The v1 generator is preserved for reproducibility. The v2 recipe generates 712
fictional profiles and 1,480 directional pairs, including 148 unknown labels.
After excluding unknowns: 1,080 train, 216 validation, 36 challenge test pairs.
Training uses 15 scenario families, validation uses three separate families, and
the 40-case challenge uses five further families. Unknown challenge cases remain
visible for review and inspection but are excluded from classification metrics.

```bash
python -m ml.synthetic_v2 --out data/generated/coverage-v2-01
```

Choose another output name if it already exists. Each generated directory includes:

- `dataset.json` and `splits.json`: the existing v2 schema and explicit assignments.
- `cases.json`: review categories, never model inputs.
- `coverage.json`: label counts for missing preferences, posts, history, profile
  lengths, and conversation modes. Presence and absence are represented across
  both positive and negative labels in training and validation.
- `review-training.md` / `.jsonl`: 40 sampled training examples, without draft labels.
- `review-challenge.md` / `.jsonl`: all 40 challenge examples, without draft labels.
- `draft-answer-key.json`: assistant judgments; open AFTER independent review.
- `review-manifest.json`: source dataset hash and an explicit unreviewed marker.

Bryan and Kai should review independently using `positive`, `negative`, or
`unknown`, record their names, time, rubric, and reasoning in separate copies of
the JSONL, then resolve differences. Exporting or reading a packet does not mark
any record reviewed. There is no automatic review importer; update only the
specific agreed labels in a NEW dataset and preserve the original review files.
Mark those labels `human_annotation` / `human_reviewed: true`, then revalidate.
These are still judgments about fictional conversations, not observed outcomes.

Controlled history cases give two viewers the same present-day facts and goals,
but opposite earlier ratings of conversation formats. They explicitly request a
format like the sessions they found useful. A history-blind model cannot satisfy
both rankings. This tests a mechanism under stated synthetic assumptions, not
whether one rating predicts real compatibility. Other cases include null ratings
and feedback about different conversations.

The challenge's ordinary profiles are separately worded, not generated from the
training sentence templates. Its controlled history construction is intentionally
shared with training. The author and annotation assumptions are shared throughout;
this is not an independent human benchmark. Do not repeatedly tune against it.

Reproduce the controlled local experiment with the already-cached encoder:

```bash
HF_HOME=.venv-ml/hf-cache HF_HUB_OFFLINE=1 .venv-ml/bin/python -m ml.train --dataset data/generated/coverage-v2-01/dataset.json --splits data/generated/coverage-v2-01/splits.json --out artifacts/local-coverage-v2-01 --device cpu --seed 42 --epochs 60 --patience 10 --batch-size 32 --revision 1110a243fdf4706b3f48f1d95db1a4f5529b4d41 --mode all --allow-unreviewed-synthetic
```

Each run now also records `feature_coverage.json` per mode: training ranges,
constant inputs, and validation/test values outside those ranges. Some flags are
constant by design after eligibility checks; not every constant is a data defect.
The audit does not change normalization or suppress test-time values.

Compare old and new SAVED models on the same challenge, without refitting or
reselecting thresholds:

```bash
HF_HOME=.venv-ml/hf-cache HF_HUB_OFFLINE=1 .venv-ml/bin/python -m ml.compare_runs --dataset data/generated/coverage-v2-01/dataset.json --splits data/generated/coverage-v2-01/splits.json --cases data/generated/coverage-v2-01/cases.json --runs artifacts/local-pilot-v1 artifacts/local-coverage-v2-01 --out artifacts/coverage-v2-comparison.json
```

This reports neural/logistic/cosine scores, known-label metrics, missing-field and
case-category slices, and whether the two opposite-history rankings are correct.
Reported test failures become development evidence if used for future changes;
reserve another fresh set before the next model-selection cycle.

## Newton Setup and Submission

Confirmed for Bryan: account `cvelissaris`, partition `normal`, successful V100
16 GB and 32 GB GPU calculations, Conda environment `sidebyside`, and PyTorch
`2.13.0+cu126`. The separate reranker bundle has been transferred to Newton.
Earlier jobs passed GPU preflight but failed on a missing `jsonschema` dependency.
Job 851922 subsequently completed all three model evaluations, verified in the
transferred artifacts. See the [reranker run notes](../docs/ml-newton-rerankers.md)
and [results](../docs/ml-newton-results-851922.md). The commands below describe
initial setup, not a requirement to reinstall a working environment.

UCF requires package installation on a compute node. From the login node:

```bash
srun --account=cvelissaris --partition=normal --nodes=1 --ntasks=1 --cpus-per-task=2 --mem=8G --gres=gpu:1 --time=00:30:00 --pty bash
```
```bash
module load anaconda/anaconda-2024.10
```
```bash
conda activate sidebyside
```

After changing into the copied/cloned repository root:

```bash
python -m pip install --no-cache-dir torch==2.13.0 --index-url https://download.pytorch.org/whl/cu126
```
```bash
python -m pip install -r ml/requirements.txt
```
```bash
python -m pytest ml/tests -q
```

The explicit CUDA 12.6 wheel supports V100. Keep it; a bare upgrade from PyPI can
select a different CUDA build. The requirements file accepts the already
installed `2.13.0+cu126` wheel. No torchvision/torchaudio is required.

Generate a fresh pilot if it was not copied, validate it, and exit the interactive
session. From the repository root on the login node, submit:

```bash
sbatch ml/slurm/train.sbatch data/generated/pilot-v1/dataset.json data/generated/pilot-v1/splits.json --allow-unreviewed-synthetic
```
```bash
squeue -u br123310
```

This requests one GPU, two CPUs, 8 GB RAM, and at most 30 minutes. Outputs go to
`artifacts/newton-JOBID`; logs are `slurm-sidebyside-JOBID.out` and `.err` in the
submission directory. The job fails rather than silently using CPU if CUDA is
missing. The first run needs outbound access to Hugging Face or a populated
model cache. Override an allocation account with `sbatch --account=YOUR_ACCOUNT`
when another teammate runs it. Do not run the trainer on the login node.

Cluster jobs were submitted by Bryan, not by Codex. Updating this Git repository
does not update the separate Newton experiment snapshot or any running job.

## Evaluation and Review

People and their scenario families are assigned before pairs are partitioned.
Both endpoints AND every historical partner must be in the same split. All
versions of one user share an assignment. A manifest is explicit and inspectable;
unknown/missing groups or cross-split history are errors.

Scaling and logistic regression fit only the training set. Early stopping and
classification thresholds use validation only. Test rows are reserved for final
reporting. Each ablation independently uses the same seed and rows; do not pick
an ablation based on test performance and then call that an untouched final test.
NDCG@3 is reported only for queries with both positive and negative candidates,
along with candidate-pool size and query count. Small pools can still inflate it.

**This generated pilot is a plumbing test.** It shares sentence templates across
splits, repeats easy intent patterns, has tiny ranking pools, and does not have
counterfactual histories that make personalization necessary. Disjoint people
and scenarios do not remove those biases. Good synthetic metrics do not validate
real-world matching, prove a neural net beats a simpler model, or show that social
enrichment helps.

Before real model selection, Bryan and Kai should review 30-50 initial pairs in
`review.jsonl`, compare judgments independently, and revise the dataset bundle.
The review sidecar is not automatically imported. Mark actual reviewed labels
`source: human_annotation`, `human_reviewed: true`, preserve the rubric rules,
then revalidate; never mark a whole file reviewed without reading it.

Add genuinely different examples and reserve new untouched scenario/template
families: same topic but different intent, complementary goals without shared
keywords, two beginners learning together, uncertain post interpretations,
explicitly corrected facts, no social account, multilingual/long descriptions,
and differing past preferences between otherwise similar candidates. Some of
these require richer extraction/input handling before this baseline supports
them. Current synthetic defaults cover only a subset.

Keep a separately human-reviewed evaluation set. An LLM can draft labels, but
training and judging on one generator's preferences is not evidence of human
connection. Explicit past feedback changes inference features immediately;
network weights change only when we run a new training job.

## Sources

- [MiniLM model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
- [SentenceTransformer API](https://sbert.net/docs/package_reference/sentence_transformer/model.html)
- [PyTorch install versions](https://pytorch.org/get-started/previous-versions/)
- [UCF Conda guidance](https://arcc.ist.ucf.edu/docs/software/anaconda/)
- [UCF Slurm submission](https://arcc.ist.ucf.edu/docs/scheduler/scripts/)

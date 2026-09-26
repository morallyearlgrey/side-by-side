# Automated Matching Experiment V3

## Status

Implemented and locally tested; the full Newton 4B experiment has not yet run.
This experiment makes the engineering choices automatically. Bryan and Kai do
not need to annotate examples to launch it. Every generated label stays marked
synthetic and unreviewed. Results cannot establish real-world compatibility.

The existing 4B reranker and all prior results are preserved. This adds a
candidate pipeline and compares it with the old one, not an automatic app rollout.

## Automatic Decisions

- Frozen Qwen3-Reranker-4B, at the same pinned revision as job 851922.
- Separate onboarding and social relevance channels. The primary channel uses
  onboarding facts. Social comparisons cover candidate posts, viewer posts, and
  both when present; only confirmed matching-allowed facts are eligible.
- Primary relevance is `0.7 * onboarding + 0.3 * mean(usable_social_legs)`.
  A social leg is usable at a fixed raw relevance cutoff of 0.5. Missing, failed,
  or below-cutoff legs are omitted; with none, the weights become 1.0/0.0.
  These source weights are a product heuristic, not learned importance or proof
  that the two source-score distributions are calibrated equally.
- Exact normalized duplicate claims are not counted in both channels. A mixed
  source claim enters a channel only when that source's quote fully supports the
  detail; ambiguous mixed claims are omitted pending upstream decomposition.
- A separate Qwen evidence-sufficiency task can abstain rather than call missing
  evidence a negative match. This remains an imperfect model judgment, not a
  verified factuality or safety detector.
- Conversation-format compatibility uses the frozen MiniLM encoder already used
  by the first matching experiment, not another Qwen yes/no judgment. Current
  explicit style preferences take precedence. Otherwise, at most six recent
  usable feedback records contribute, weighted by context and format affinity.
  A normalized cosine above 0.5 is linearly mapped to affinity 0-1. Exact normalized
  text matches have affinity 1. Relevant positive support is divided by total
  positive/negative support; below total support 0.2, there is no penalty.
- `conversation_useful` is the primary rating; `would_talk_again` is used only
  when usefulness is unknown. Acceptance alone and unknown ratings are not
  dislikes. This is contextual feedback aggregation, not inferred personality.
- Format compatibility attenuates the relevance blend, never boosts it. Missing
  candidate style is not a penalty. Format embeddings have the existing 256-token
  encoder limit and are not validated for long or multilingual preferences.
- A regularized scalar logistic calibration is fit on known synthetic training
  labels. Unknown labels are excluded, and a nonpositive fitted slope falls back
  to identity rather than reversing rankings. This is NOT human-probability
  calibration and does not change Qwen's weights.
- Validation searches 180 combinations: decision thresholds 0.05 through 1.0 in
  0.05 steps, evidence thresholds 0.3/0.5/0.7, and style thresholds 0.3/0.5/0.7.
  Source weights, affinity rules, prompts, and Qwen weights are not grid-tuned.

Selection cost is fixed in code: `2*false_positive + false_negative +
2*unknown_recommended + 0.5*positive_abstention + 0.25*negative_abstention`.
Abstaining on a labeled positive already counts as a missed recommendation;
coverage and unknown handling are reported separately. These costs are prototype
priorities, not measurements of real-world harm.

The existing baseline gets its own training-only calibration and validation-only
threshold tuning. Four variants are compared on validation: original fixed 0.5,
calibrated baseline, new default policy, and new tuned policy. The validation
winner is written to `selected_policy.json` BEFORE test inference starts; exact
ties favor the simpler existing path. No variant is declared production-ready.

## Dataset and Checks

`python -m ml.synthetic_v3 --out data/generated/source-aware-v3` reproduces:

| Split | Pairs | Positive | Negative | Unknown | Topic families |
| --- | --- | --- | --- | --- | --- |
| Train | 120 | 72 | 36 | 12 | 6 |
| Validation | 60 | 36 | 18 | 6 | 3 |
| Test | 60 | 36 | 18 | 6 | 3 |

There are 180 fictional profiles, 24 fictional posts, and 84 earlier feedback
records. People, domains, and historical partners do not cross splits. All
splits still share generation templates, annotation assumptions, and an author;
they are NOT an independent human test. The existing 40-case set is unchanged.

Cases include firsthand help versus wishes, beginner companionship, both sharing
directions, onboarding absence, viewer/candidate social evidence, irrelevant
posts, explicit current intent, opposite history preferences, null ratings,
unrelated feedback, and current preferences overriding history.

Tests cover source separation/deduplication, unavailable components, label/ID
exclusion, synthetic-only gates, temporal validation inherited from v2, no
positive-recall inflation through abstention, format aggregation, the default
v1 prompt remaining unchanged, Slurm failure handling, and transfer failure
preventing submission. Flipping test labels does not change selected policies.

### Local Model Diagnostics

The first offline 0.6B/Mac diagnostic used only 11 espresso training examples,
not validation or test examples. Its Qwen-only style judgment failed to separate
opposing formats. The subsequent pinned MiniLM comparison, reusing unchanged
0.6B relevance scores, correctly separated the four opposite-history examples
and the explicit-style-conflict example. These contain known closely controlled
formats; they do not prove generalization to differently worded preferences.

The 0.6B evidence check still accepted a novice for firsthand advice, and the
relevance task still missed an explicit current-intent conflict. They are not
claimed fixed. The full 4B run will measure these failures, coverage, and the
tradeoffs of automatic threshold selection. Test doubles establish plumbing,
not semantic quality.

## Launch From Bryan's Mac

The prepared archive is `artifacts/sidebyside-matching-v3-newton.tar.gz`.
Run in a Mac terminal, not inside Newton SSH:

```bash
bash /Users/bryantaylan/Documents/Playground/side-by-side/ml/slurm/submit_matching_v3_from_mac.sh
```

The helper asks for Newton authentication in the terminal, creates a new private
timestamped remote directory, transfers the archive, verifies its SHA-256,
extracts it, and submits the batch job. It never overwrites the earlier reranker
experiment or sends credentials into chat. Transfer failures prevent submission.
It prints the new directory and job ID. No recurring monitoring is configured.

The job uses the working environment's Python directly, a 32 GB V100, four CPUs,
48 GB RAM, and a two-hour ceiling. It runs a GPU preflight, explicitly stages the
small pinned public MiniLM encoder if needed, then performs all inference offline.
The 4B weights reuse `$HOME/.cache/sidebyside-qwen`. It does not reload Conda,
install packages, run models on the login node, or fine-tune 4B weights.

To recreate the transfer archive after generating the dataset, run from repo root:

```bash
COPYFILE_DISABLE=1 tar --exclude='__pycache__' --exclude='*.pyc' --exclude='.DS_Store' -czf artifacts/sidebyside-matching-v3-newton.tar.gz ml data/schemas data/samples data/generated/source-aware-v3 docs
```

## Results for Kai

Within the new remote directory, results land in
`artifacts/newton-matching-v3-JOB_ID/`:

- `protocol.json`: model, encoder, instructions, source/data hashes, packages,
  source policy, threshold grid, and limitations.
- `selected_policy.json`: trained scalar calibration, validation-chosen settings
  for both candidates, and the validation-selected variant.
- `validation-trials.json`: every tested configuration and its selection cost.
- `report.json`: validation/test results, category slices, mistakes, history
  ordering, candidate ranking, measured execution times, and GPU memory.
- Per-split components, baseline scores, decisions, and synthetic prompt audits.
- `status.json`: running/completed/failed status; use Slurm accounting as well
  because abrupt scheduler termination can leave a stale running status.

The decision states are `recommend`, `not_recommended`, and
`insufficient_evidence`. A recommendation is not mutual consent and must never
directly reveal a profile/aura. Availability, blocks, authenticated badge mapping,
and mutual acceptance remain separate. No live API or Supabase integration is
added here; real profile processing remains blocked by the synthetic-only gate.

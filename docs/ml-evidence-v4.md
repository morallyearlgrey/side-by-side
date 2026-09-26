# Firsthand Evidence Fix (V4)

## Status

Implemented in `ml/matching_v4.py`, using `ml/evidence.py` for local textual
entailment. This is the strict entry point for new offline scoring. Older v3
experiments remain available for reproduction and comparison, not as the fixed
scorer. Existing Newton artifacts and selected thresholds are not overwritten.

The three known Newton test failures now abstain before model inference because
the candidate has no approved `experienced` fact. This behavior is tested even
against an always-positive model double and does not depend on another training
job. Unknown requirements also abstain; they are never assumed to mean none.

Real local diagnostics cover 12 evidence cases and six complete scoring flows
with the cached Qwen 0.6B. [Newton job 852419](ml-newton-results-852419.md) has now
completed the actual pinned 4B evaluation: unsupported recommendations fell
from 21/24 to 0/24, with all 33 known-label decisions unchanged. Two positive
history cases remain below threshold. Keep the settings unchanged as the
controlled synthetic demo baseline. No HTTP service, real-user permission
checks, or onboarding extractor is implemented by this research package. Kai's
application now has an API and onboarding implementation, but its matcher
still uses onboarding-only v1, not this v4 pipeline. See
[the current integration handoff](ml-kai-handoff.md).

## Prepared 4B Newton Evaluation

`ml.evaluate_v4` compares the unchanged v3 pipeline with the evidence-gated v4
pipeline using the actual pinned Qwen3-Reranker-4B checkpoint, CUDA float16, and
the selected policy from job 852098. There is no 0.6B fallback, weight training,
threshold tuning, or automatic selection against these evaluation cases.

`ml.synthetic_v4` produces 57 synthetic draft cases: 54 fresh cases across
backpack zipper repair, film scanning, and balcony planters, plus the three
known v3 failures marked as a separate regression cohort. Cases include
onboarding and owned-post support, unsupported extraction, future plans,
third-party attribution, unapproved extra information, novice companionship,
reverse sharing, unrelated posts, current intent, and history-based formats.
Fresh means newly authored development scenarios, not independent human data.

The report separates unknown recommendations, positive abstentions, known-label
coverage, confusion counts, categories, and cohorts. It saves every decision,
component, evidence check, and prompt. Shared caches make its timings unsuitable
for comparing serving latency. A completed Slurm job means the experiment ran,
not that the matcher met a production-quality threshold.

The prepared archive is `artifacts/sidebyside-evidence-v4-newton.tar.gz`.
From **Mac Terminal, not inside a Newton SSH session**, submit with:

```bash
bash /Users/bryantaylan/Documents/Playground/side-by-side/ml/slurm/submit_evidence_v4_from_mac.sh
```

Enter the Newton password only in Terminal. The helper checks the transferred
archive hash, uses a new timestamped remote directory, and prints the job ID.
It never overwrites earlier experiment snapshots. Submission has not been
confirmed until `Submitted batch job ...` appears.

The Slurm script requests one V100 32GB GPU, four CPUs, 48GB RAM, and a one-hour
ceiling. It invokes the existing environment's Python directly, without Conda
activation or module reload. SentencePiece installs into a private per-job
overlay, leaving the working CUDA environment untouched. Pinned NLI and MiniLM
weights download publicly on the allocated compute node; the 4B weights must
already be cached in `$HOME/.cache/sidebyside-qwen`. Inference is offline.

Inside the printed Newton experiment directory, inspect a job using its number:

```bash
sacct -j JOBID --format=JobID,State,ExitCode,Elapsed,NodeList
tail -n 40 slurm-sidebyside-evidence-v4-JOBID.out slurm-sidebyside-evidence-v4-JOBID.err
```

Results land in `artifacts/newton-evidence-v4-JOBID/`, including `status.json`,
`protocol.json`, `report.json`, and `v3/` and `v4/` audit files. The new model's
checkpoint ID and revision are recorded explicitly in the protocol.

## Contract for Kai

Add `context.evidence_requirement` to each immediate conversation request:

```json
{
  "mode": "learn",
  "goal": "I want advice from someone who has repaired a cracked canoe paddle blade.",
  "evidence_requirement": {
    "version": 1,
    "kind": "firsthand",
    "subject": "candidate",
    "claim": "I have repaired a cracked canoe paddle blade.",
    "confirmation": "confirmed"
  }
}
```

For two beginners explicitly happy to learn together:

```json
{
  "mode": "find_activity_partner",
  "goal": "Try paddle repair together; neither of us needs prior experience.",
  "evidence_requirement": {
    "version": 1,
    "kind": "none",
    "subject": null,
    "claim": null,
    "confirmation": "confirmed"
  }
}
```

The onboarding LLM may propose this structure, but `confirmed` means the user
approved the interpretation of their current request. Preserve the requested
activity, constraints, and outcome in the first-person claim; do not broaden it
to manufacture support or claim that an attempted task succeeded. When unclear,
use `kind: "unresolved"`, null subject/claim, and pending confirmation. Ask whether
the user needs firsthand advice or welcomes learning together.

This is request metadata, independent of the candidate and training labels.
It must remain identical across candidates for the same viewer, time, mode, and
goal. A new goal requires fresh interpretation/approval; do not reuse a stale
confirmation. In a future service, load authenticated, versioned request state
on the backend, not arbitrary client-supplied approval flags.

`learn` firsthand requirements check the candidate; `share` checks the offering
viewer. `both` requires both endpoints, for example when exchanging firsthand
stories. Beginners are not rejected simply for having no experience when the
request explicitly sets `kind: "none"`. The additive version-1 requirement is
optional in the v2 JSON Schema for legacy-file compatibility, but mandatory
for the new CLI. Missing metadata makes the shared scorer abstain.

## Gate Behavior

1. Preserve existing schema, ownership, timestamp, boundary, and onboarding gates.
2. Require an explicit, confirmed experience requirement or explicit none.
3. For a firsthand request, select only confirmed, matching-allowed `experienced`
   facts from the correct person. `interested`, `wants_to_try`, `learning`, and
   `can_share` alone cannot establish completed experience.
4. For each eligible fact, use the full referenced onboarding answer or owned
   post caption. An extracted excerpt must not remove a negation or attribution.
   Do not treat normalized details, goals, labels, or willingness as source proof.
5. Check both that the request is within the approved fact's meaning and that
   the full source supports the independently confirmed claim using
   frozen `MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli`, revision
   `eb8b17b1983bca679126ea69b12b5d28c5fe9b9a`. It is an NLI classifier, not a
   generative instruction-following model. See the [publisher's model card](https://huggingface.co/MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli).
6. At least one eligible fact must pass both checks with entailment >= 0.8 and no source attached
   to that fact with contradiction >= 0.8. An unrelated experience cannot unlock
   the request or veto another supported fact. Cross-fact conflict resolution is
   not established; source extraction and user corrections remain important.
   Extra, unapproved information in a long answer cannot bypass the approved-fact
   scope check. A normalized claim cannot substitute for the source-support check.
7. Only after the gate passes, run unchanged Qwen relevance prompts, 70/30 source
   blending, format/history handling, and the selected v3 calibration. Requirement
   metadata is removed from those prompts so it cannot act as candidate evidence.

Unavailable checks, unsupported claims, and unclear evidence all yield
`insufficient_evidence` with no ranking score, not a negative judgment about the
person. Limits fail closed: 512 tokens per source/claim pair and 16 distinct
source texts per fact, with no truncation. Matching eligibility and source
approval still apply; this is not a way to read unconnected social accounts.

Thresholds are fixed prototype gates, not calibrated probabilities of truth.
The classifier can still make mistakes, especially with ambiguity, sarcasm,
conflicting records, languages outside its English training, or incorrectly
confirmed request claims. It checks text support, not actual expertise. Do not
use it to certify a person or authorize an introduction/AR reveal.

## Local Verification

The initial Qwen-only support check was rejected after the real 0.6B diagnostic
accepted aspirations and third-party achievements. NLI rejected those examples
but also deferred a quote that omitted the requested canoe-paddle detail. That
conservative result is retained as a clarification case, not hidden as a success.

The expanded NLI diagnostic passed 12 development cases: five supported accounts
(including paraphrases and a failed attempt when only an attempt was requested)
and seven unsupported/underspecified accounts. Six real 0.6B scoring flows also
behaved as intended: firsthand support, learning together, and offering advice
were recommended; a novice seeking to provide firsthand advice, unapproved extra
information in a source, and a normalized claim contradicted by its source were
all deferred.
The 0.6B checks used identity calibration, not the 4B-fitted coefficients.

These are assistant-authored synthetic regressions, not fresh held-out human
accuracy. Reports are local ignored files `artifacts/firsthand-v4-smoke-0.6b.json`,
`artifacts/firsthand-v4-smoke-nli.json`, `artifacts/firsthand-v4-verification.json`,
and `artifacts/firsthand-v4-final-flows.json` (final code fingerprints and flows).
The production-readiness flag remains false. The completed 4B synthetic
evaluation is documented separately; actual serving-host latency/memory
measurements, independent human review, and live-profile authorization remain
necessary.

## Setup and Scoring

Use the existing ML environment. The extra dependency is deliberately separate
so installing the verifier does not replace the cluster's working CUDA PyTorch:

```bash
python -m pip install -r ml/requirements-evidence.txt
```

Explicitly stage the public checkpoint in the intended machine's `HF_HOME`:

```bash
python -c 'from huggingface_hub import snapshot_download; snapshot_download(repo_id="MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli", revision="eb8b17b1983bca679126ea69b12b5d28c5fe9b9a", token=False, allow_patterns=["*.json", "model.safetensors", "spm.model"], max_workers=2)'
```

Loading/scoring is offline, with safetensors and no remote code. The evidence
checkpoint and SentencePiece are already installed in Bryan's local ML cache
and environment, not automatically on Newton or Kai's laptop. For optional
real-checkpoint regressions from the repo root on Bryan's Mac:

```bash
HF_HOME="$PWD/.venv-ml/hf-cache" HF_HUB_OFFLINE=1 SIDEBYSIDE_EVIDENCE_MODEL_TESTS=1 .venv-ml/bin/python -m pytest ml/tests/test_evidence_model.py -q
```

The v4 CLI accepts a v2 synthetic bundle containing the new requirements and a
completed 4B v3 policy directory. For example, on an allocated GPU node with
the checkpoints already cached (replace `PATH_TO_APPROVED_SYNTHETIC_BUNDLE`):

```bash
HF_HOME="$HOME/.cache/sidebyside-qwen" HF_HUB_OFFLINE=1 python -m ml.matching_v4 \
  --dataset PATH_TO_APPROVED_SYNTHETIC_BUNDLE \
  --policy-dir ml/policies/newton-matching-v3-852098 \
  --out artifacts/firsthand-v4-new-run --device cuda --dtype float16
```

There is no silent migration from labels or keyword matching. A preexisting
output directory is rejected. Results include decisions, component/evidence
audits, and pinned model/policy/code/schema fingerprints. `score_bundle` is the
shared strict adapter for a future API; do not use the older v3-only scorer or
remove the synthetic-only validation to process live users.

# Online onboarding evidence V4

## What changed

The app uses `online-approved-onboarding-evidence-v4` with policy
`onboarding-evidence-v4`. Qwen 4B remains the relevance model. The upgrade adds
explicit conversation requirements, DeBERTa evidence checks, MiniLM conversation
format comparison, and the frozen selected V3 calibration. It replaces the
application's original Qwen-only/learned-head V1 serving path.

This is an **onboarding-only online pilot**. Its adapter validates `real_opt_in`
profiles and shares low-level V4 scoring without forging a synthetic bundle or
loosening the research validator. Only user-approved onboarding facts and their
owned, timestamped original answers enter inference. Imported social content and
feedback history are excluded; source weights are 1.0 onboarding and 0.0 social.
The broader research CLI and its synthetic-only restrictions remain unchanged.

Bryan's [V3 run](ml-newton-results-852098.md) and
[V4 evaluation](ml-newton-results-852419.md) completed on Newton. They evaluated
synthetic draft cases. Their metrics do not transfer to this narrower online
adapter or establish real-user accuracy. Integration tests with model doubles
check contracts and decision handling, not neural model quality. No online
worker, uncached serving latency, or real-user quality evaluation was verified
as part of this integration.

## Pinned assets and identity

All three checkpoints must exist in the inference host's cache:

| Role | Model | Revision |
| --- | --- | --- |
| Relevance and sufficiency | `Qwen/Qwen3-Reranker-4B` | `22e683669bc0f0bd69640a1354a6d0aebcfeede5` |
| Firsthand textual support | `MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli` | `eb8b17b1983bca679126ea69b12b5d28c5fe9b9a` |
| Conversation-format comparison | `sentence-transformers/all-MiniLM-L6-v2` | `1110a243fdf4706b3f48f1d95db1a4f5529b4d41` |

The frozen policy is
`ml/policies/newton-matching-v3-852098/selected_policy.json`, SHA-256:

```text
b1e4b4ef1c58f17007400f5064ef97b12d19489d1a78698ca177e2792080bf57
```

It retains decision/evidence/style thresholds 0.5/0.3/0.5 and the selected
synthetic Platt calibration. Firsthand entailment and contradiction thresholds
remain 0.8. These are fixed research settings, not calibrated probabilities of
truth, compatibility, or a successful conversation. The artifact's
`ready_for_live_profiles: false` research declaration is preserved.

`services/api/sidebyside_api/matching_policy.py` pins this identity. Jobs,
scores, snapshots, and heartbeats carry the policy fingerprint; score/readiness
metadata also names the evidence and format models, prompt, and feature
versions. Changing assets or policy requires a deliberate versioned deployment
and cache invalidation. A stale V1 heartbeat or result cannot satisfy V4
readiness. `MATCHING_PROVIDER=minilm`, smaller Qwen models, and mismatched
revisions are explicitly unsupported in this serving path.

## Confirm the current conversation request

Profile review and Settings store a `conversation_request` with the immutable
profile version:

```json
{
  "mode": "learn",
  "goal": "Get firsthand advice on repairing a cracked canoe paddle blade.",
  "evidence_requirement": {
    "version": 1,
    "kind": "firsthand",
    "subject": "candidate",
    "claim": "I have repaired a cracked canoe paddle blade.",
    "confirmation": "confirmed"
  }
}
```

A confirmed request needs a nonempty goal matching `current_goal`, and its mode
must match `settings.matching_context`. For `learn`, firsthand experience must
come from the candidate or both people; for `share`, from the viewer or both.
The claim must retain the requested activity, constraints, and outcome.

`kind: "none"`, null subject/claim, and explicit confirmation allow a request
without firsthand experience, such as two beginners learning together.
`kind: "unresolved"` must remain pending. Muse proposals are always pending;
the person reviews the interpretation. Changing the mode, goal, requirement,
subject, or claim requires fresh confirmation. Legacy profiles are not silently
migrated to “no experience required”: their owners review the request in Settings.
This review is separate from fact approval, matching consent, and disclosure.

The evidence gate checks only confirmed, matching-allowed `experienced` facts
from the required person. It checks both the approved fact's scope and the full
referenced answer against the claim, so a selected excerpt cannot remove a
negation or attribution. Aspirations, interest, willingness, and normalized
facts alone cannot establish firsthand support. The classifier checks textual
support, not real-world truth or expertise. Boundary and input-limit failures
remain conservative; absent support is not a judgment about the person.

## Decisions shown by the app

| Result | Score | Product behavior |
| --- | --- | --- |
| `recommend` | Finite [0,1] | Ranked in Nearby; eligible for BLE invitation/banner |
| `not_recommended` | Finite [0,1] | Separate count; no ranking or BLE invitation |
| `insufficient_evidence` | `null` | Separate count; review missing/unclear request or evidence |
| `unavailable` | `null` | Separate count; inference configuration/assets/runtime need attention |

Nearby additionally reports `pending_count` for pairs awaiting a current result.
Recommendations are sorted descending with UUID tie-breaks. Eligibility, blocks,
availability, consent, and mutual-acceptance disclosure gates remain mandatory.
Private evidence checks and prompts are never public explanations.

## Run on an allocated GPU

Use the same application commit on the API and worker. Apply migrations through
`202609260003` before starting either new process; the forward migration adds
request/provenance fields and invalidates obsolete matching work and results.
It preserves historical profile versions and does not grant confirmation.
See [database setup](database-runtime.md).

Bryan must use his own authenticated Newton session and approved GPU allocation.
The reported research Python is 3.11; the application requires 3.12 or 3.13.
Create a **separate application environment** and verify its CUDA support rather
than modifying the working research environment. From the repository root:

```sh
export UV_PROJECT_ENVIRONMENT=.venv-app-evidence
uv sync --python 3.12 --extra inference
uv run --extra inference python -c 'import sys, torch, sentencepiece; print(sys.version); print("CUDA available:", torch.cuda.is_available())'
```

The inference extra includes `sentencepiece==0.2.1`. Package installation does
not stage model weights. Copy or explicitly provision the three approved pinned
checkpoints on the target host separately. Confirm the actual cache location;
Bryan reported `/home/br123310/.cache/sidebyside-qwen` for Qwen, but that alone
does not establish that the other two models are there. Snapshot presence can
be checked offline:

```sh
export HF_HOME=/home/br123310/.cache/sidebyside-qwen
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
uv run --extra inference python - <<'PY'
from huggingface_hub import snapshot_download
models = {
    "Qwen/Qwen3-Reranker-4B": "22e683669bc0f0bd69640a1354a6d0aebcfeede5",
    "MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli": "eb8b17b1983bca679126ea69b12b5d28c5fe9b9a",
    "sentence-transformers/all-MiniLM-L6-v2": "1110a243fdf4706b3f48f1d95db1a4f5529b4d41",
}
for model, revision in models.items():
    snapshot_download(repo_id=model, revision=revision, local_files_only=True, token=False)
    print(model, "snapshot present")
PY
```

This checks snapshot presence; worker warming verifies that every needed weight,
tokenizer, and configuration file can actually load. Missing assets never
trigger a download or fallback. Qwen uses CUDA/float16 below; the evidence and
format models use CPU. Allow host RAM/CPU capacity as well as GPU memory.

Configure the API on the laptop/server:

```dotenv
MATCHING_EXECUTION=remote
WORKER_ENABLED=false
MATCHING_WARM_ON_STARTUP=false
MATCHING_PROVIDER=qwen
MATCHING_MODEL_ID=Qwen/Qwen3-Reranker-4B
MATCHING_MODEL_REVISION=22e683669bc0f0bd69640a1354a6d0aebcfeede5
```

On the allocated worker host, provide `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` through protected environment/secrets storage. Do
not commit keys or include them in command output. Then run:

```sh
export MATCHING_PROVIDER=qwen
export MATCHING_MODEL_ID=Qwen/Qwen3-Reranker-4B
export MATCHING_MODEL_REVISION=22e683669bc0f0bd69640a1354a6d0aebcfeede5
export MATCHING_DEVICE=cuda
export MATCHING_DTYPE=float16
PYTHONPATH=services/api uv run --extra inference python -m sidebyside_api.worker
```

The worker needs outbound Supabase access and an environment approved for the
consenting users' data. It exposes no HTTP port. It warms all models, claims
private database jobs, and publishes version-checked scores. Heartbeats refresh
every 20 seconds and expire after 90 seconds; a stopped allocation becomes
unavailable. Verify `/health` and the authenticated app's model readiness before
expecting recommendations. No training, policy tuning, or research batch is
launched by this command.

For local inference, use the same cached assets with `MATCHING_EXECUTION=local`,
`WORKER_ENABLED=true`, and `MATCHING_WARM_ON_STARTUP=true`; choose an explicitly
supported Qwen device/dtype. Run one API process for the initial deployment.
No serving latency or memory guarantee has been measured for this configuration.

## RunPod worker

RunPod uses the standalone queue worker: Vercel remains the app-facing API, and
the Pod polls Supabase outbound without exposing a public inference endpoint.
Use [`services/api/deploy/runpod/README.md`](../services/api/deploy/runpod/README.md)
for the Pod setup. First stage the pinned Qwen, DeBERTa, and MiniLM models and
run the fictional-only GPU preflight without database credentials. Then
configure Vercel for remote matching and start the worker with the current
Supabase `service_role` key supplied only inside the Pod session. That key
bypasses RLS; worker consent and eligibility checks are application safeguards,
not a restricted database role. Never put the key in an app, source control,
screenshots, or chat. The Pod container disk may be erased when stopped, so use
mounted persistent storage if the model cache must survive a stop.

## Verification before a pilot

```sh
uv run ruff check services/api
uv run --extra inference pytest services/api/tests ml/tests
python3 supabase/tests/run.py --env-file services/api/.env
npm run typecheck
npm run lint
npm test
```

Contract tests, model doubles, and rollback-only database checks establish
implementation behavior. They do not replace a controlled run with all real
pinned models, an uncached serving measurement on the deployment host, or
independent review of recommendations. Keep the historical research artifacts
and synthetic-only training restrictions intact.

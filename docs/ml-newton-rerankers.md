# Newton Model-Size Comparison

## Status

Bryan submitted job 851663; it failed CUDA initialization on evc22. A subsequent
32 GB V100 diagnostic passed a GPU calculation with 31.73 GiB VRAM. Job 851881
then reached evc21 but reported repeated Conda deactivation/initialization errors.
Jobs 851899 and 851906 used the revised direct-Python launcher on evc21 and passed
the GPU preflight, then failed while importing the missing `jsonschema` package.
Bryan subsequently reported job 851922 completed with exit 0:0 in 00:06:36 on
evc21. Its downloaded reports now confirm all three model evaluations completed;
the local input/source hashes and saved metrics were checked. See the
[results and limitations](ml-newton-results-851922.md). Scheduler status is
user-reported; the model artifacts were inspected directly after transfer.

The local launcher now defaults to the 32 GB V100 and directly invokes the
existing environment's Python, avoiding the Anaconda module reload. This launcher
change is locally tested with stub GPU/model code; Bryan's logs verify the real
Newton GPU preflight, and job 851922's transferred reports verify model evaluation.
Noninteractive SSH authentication was unavailable; Bryan must transfer and submit
from his own terminal. No password belongs in chat, source files, or job scripts.

This compares already-trained models. It does not train or fine-tune them.
App, Supabase, badge, and Quest work can continue independently. After Slurm
accepts the batch job and returns its job ID, it runs independently of the laptop
or chat. This is not true of an interactive `srun --pty bash` session. See the
[UCF batch-job guide](https://arcc.ist.ucf.edu/docs/scheduler/scripts/).

The transfer bundle is a separate snapshot of ML code, schema, fictional data,
and baseline predictions. Extract it into a NEW directory, leave that snapshot
unchanged during the job, and keep developing in the regular app repository.
No Git commit/push is required. No `.env`, credentials, private exports, app code,
model weights, or Python virtual environment are included.

## Fixed Experiment

| Model | Pinned revision |
| --- | --- |
| Qwen3-Reranker-0.6B | `e61197ed45024b0ed8a2d74b80b4d909f1255473` |
| Qwen3-Reranker-4B | `22e683669bc0f0bd69640a1354a6d0aebcfeede5` |
| Qwen3-Reranker-8B | `77d193c791ed757ca307ee72715aa132723da912` |

Same instruction, threshold 0.5, 40-case development challenge, all three input
modes, token cap 4096, batch size 1, float16, and one allocated GPU for every size.
The 0.6B model is rerun there for fair hardware/dtype comparison rather than
comparing its Mac timing directly with Newton results. Unknown labels remain
outside binary F1 and their predictions are included separately in the report.
No prompt/threshold tuning or automatic winner selection occurs.

These are the EXISTING synthetic development cases. Fresh examples independently
reviewed by Bryan and Kai are still required before claiming generalization.
The Italy diagnostic is kept separate. Reported timings are model inference,
not app/network/Quest latency. GPU memory statistics cover the PyTorch allocator,
not all process memory or other GPU users.

The [4B model files](https://huggingface.co/Qwen/Qwen3-Reranker-4B/tree/22e683669bc0f0bd69640a1354a6d0aebcfeede5)
and [8B model files](https://huggingface.co/Qwen/Qwen3-Reranker-8B/tree/77d193c791ed757ca307ee72715aa132723da912)
are about 8 GB and 16.4 GB respectively. All three checkpoints need about 26 GB
of storage. Choose a writable cache location with at least 30 GB free AND enough
user quota; filesystem free space alone does not prove quota availability.

The updated batch script requests one `gpu:tesla_v100-pcie-32gb:1`, account `cvelissaris`,
partition `normal`, four CPUs, 48 GB host RAM, and a two-hour limit. The GPU type
comes from Bryan's node listing and successful diagnostic. Other nodes of the
same type still need the per-job preflight; a working diagnostic is not a fleet
health check. The earlier bundle requested an H100.
Queue delay and download duration are unknown; two hours is a ceiling, not an
estimated runtime. The script rejects a GPU with less than 30 GiB VRAM rather
than silently quantizing, changing models, or falling back to a login-node CPU.

## Transfer From the Mac

Run this in a Mac terminal and authenticate there:

```bash
scp /Users/bryantaylan/Documents/Playground/side-by-side/artifacts/sidebyside-reranker-newton-v1.tar.gz br123310@newton.ist.ucf.edu:~/
```

Then log in:

```bash
ssh br123310@newton.ist.ucf.edu
```

On Newton, run each command separately. If the directory already exists, choose
a NEW name rather than extracting over an active experiment.

```bash
mkdir "$HOME/sidebyside-reranker-eval-v1"
```

```bash
tar -xzf "$HOME/sidebyside-reranker-newton-v1.tar.gz" -C "$HOME/sidebyside-reranker-eval-v1"
```

```bash
cd "$HOME/sidebyside-reranker-eval-v1"
```

## Environment and Submission

The updated script invokes `$HOME/.conda/envs/sidebyside/bin/python` directly.
Set `SIDEBYSIDE_PYTHON` to an absolute executable path if this environment lives
elsewhere. It does not reload the site Anaconda module, call `conda activate`,
run `conda init`, or install/upgrade anything. Direct invocation does not run
Conda activation hooks; the actual GPU calculation and library imports must pass
on Newton before calling this recovery verified. Inherited Conda state no longer
triggers a module-driven deactivation loop in this script. If dependencies are
missing, use an allocated compute session
to install `ml/requirements.txt`; preserve the working CUDA-enabled PyTorch
installation. UCF requires environment creation/package installs on a
[compute node](https://arcc.ist.ucf.edu/docs/software/anaconda/), not the login node.

### Recovering the Already-Transferred V1 Bundle

Cancel only the affected job (`scancel 851881`) and check that it has left the
queue before resubmitting. Do not repeatedly cancel a job stuck in COMPLETING;
that may need ARCC support. The saved v1 tarball still contains the old launcher.
From a Mac terminal, transfer the revised launcher under a new name, retaining
the old launcher and all prior logs/results:

```bash
scp /Users/bryantaylan/Documents/Playground/side-by-side/ml/slurm/rerankers.sbatch br123310@newton.ist.ucf.edu:~/sidebyside-reranker-eval-v1/ml/slurm/rerankers-direct-python.sbatch
```

Then on Newton:

```bash
cd "$HOME/sidebyside-reranker-eval-v1"
```

```bash
sbatch ml/slurm/rerankers-direct-python.sbatch "$HOME/.cache/sidebyside-qwen"
```

The first stdout lines identify the job, node, Python executable, visible GPU
selection, PyTorch runtime, and GPU memory. The preflight has a best-effort
90-second timeout and runs a tiny float16 calculation before downloading models.
It does not reset or override Slurm's `CUDA_VISIBLE_DEVICES`. Only `GPU preflight
PASSED; starting model comparison` establishes that this job passed initialization.

For an updated full bundle, the normal submission below uses `rerankers.sbatch`.

Choose a cache path. This home-directory example is valid only if its quota has
room; an existing authorized group/scratch location may be more appropriate.

```bash
sbatch ml/slurm/rerankers.sbatch "$HOME/.cache/sidebyside-qwen"
```

Only after you see `Submitted batch job JOB_ID` has submission succeeded.
Downloads happen explicitly inside the allocation, use pinned public safetensors
files, and never upload profiles. Scoring then runs strictly offline. If compute
nodes cannot reach Hugging Face, the job records download failure; the weights
will need to be staged through an authorized transfer path before retrying.

Check jobs:

```bash
squeue -u br123310
```

Substitute the returned numeric job ID below:

```bash
tail -f slurm-sidebyside-rerankers-JOB_ID.out
```

Stopping `tail` with Ctrl-C does not cancel a batch job. Cancel deliberately with:

```bash
scancel JOB_ID
```

## Results and Recovery

Outputs land in `artifacts/newton-rerankers-JOB_ID/` inside the separate bundle:

- `status.json`: atomic per-model progress and failures. An abrupt scheduler kill
  may leave the last recorded state as running; use Slurm status/logs too.
- `comparison.json`: aligned metrics, history contrasts, unknown-case scores,
  latency, memory, and an explicit all-models-completed flag.
- `0.6B/`, `4B/`, `8B/`: per-model protocols, predictions, prompt audits, and reports.
- Separate `.out` and `.err` job logs in the bundle root.

Each model runs in a fresh subprocess; its GPU allocations disappear when it
exits. A model failure is recorded, completed models are preserved, remaining
models are attempted, and the suite exits nonzero. Different data, checkpoints,
prompt hashes, thresholds, precision, or hardware invalidate the comparison.

Resubmitting creates a new job-specific output directory and reuses complete
cached downloads. It does not overwrite or resume partially written result files.
To avoid rerunning successful sizes, append sizes to the submission command:

```bash
sbatch ml/slurm/rerankers.sbatch "$HOME/.cache/sidebyside-qwen" 4B 8B
```

That is a partial comparison, not automatically merged with another GPU's run.
After completion, transfer the whole output directory and both logs back to the
Mac. No automatic monitoring or result retrieval has been configured.
Job 851922's results were
manually transferred and verified as described in the linked results report.

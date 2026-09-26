#!/bin/bash
#SBATCH --job-name=sidebyside-rerankers
#SBATCH --account=cvelissaris
#SBATCH --partition=normal
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=4
#SBATCH --mem=48G
#SBATCH --gres=gpu:tesla_v100-pcie-32gb:1
#SBATCH --time=02:00:00
#SBATCH --output=slurm-sidebyside-rerankers-%j.out
#SBATCH --error=slurm-sidebyside-rerankers-%j.err

set -euo pipefail

# Submit from the separate experiment bundle, not the app's live working copy.
: "${SLURM_JOB_ID:?Submit using sbatch; do not run inference on the login node}"
cd "${SLURM_SUBMIT_DIR:?Submit using sbatch from the experiment bundle root}"
printf 'Starting job %s on %s\n' "$SLURM_JOB_ID" "$(hostname)"
if [[ $# -lt 1 ]]; then
    printf '%s\n' 'Usage: sbatch ml/slurm/rerankers.sbatch ABSOLUTE_HF_CACHE_DIRECTORY [0.6B 4B 8B]'
    exit 2
fi
export HF_HOME="$1"
shift
if [[ "$HF_HOME" != /* ]]; then
    printf '%s\n' 'Use an absolute cache path on a writable filesystem with at least 30 GB free and sufficient quota.'
    exit 2
fi
if [[ $# -eq 0 ]]; then
    set -- 0.6B 4B 8B
fi

# Use the installed environment directly. Reloading the site Anaconda module
# can loop on inherited CONDA_SHLVL when the new shell lacks Conda functions.
PYTHON_BIN="${SIDEBYSIDE_PYTHON:-$HOME/.conda/envs/sidebyside/bin/python}"
if [[ "$PYTHON_BIN" != /* || ! -x "$PYTHON_BIN" ]]; then
    printf 'Missing environment Python: %s. Set SIDEBYSIDE_PYTHON to its absolute path.\n' "$PYTHON_BIN" >&2
    exit 2
fi
export PATH="${PYTHON_BIN%/*}:$PATH"
export PYTHONNOUSERSITE=1

export PYTHONUNBUFFERED=1
export TOKENIZERS_PARALLELISM=false
export OMP_NUM_THREADS="${SLURM_CPUS_PER_TASK}"
export HF_HUB_DISABLE_TELEMETRY=1
export HF_HUB_DISABLE_XET=1
export HF_HUB_DOWNLOAD_TIMEOUT=120
unset HF_HUB_OFFLINE

# All inference happens in this allocation. No training or login-node inference.
# Timeout is best-effort; a driver stuck in the kernel may still need an admin.
timeout --kill-after=5s 90s "$PYTHON_BIN" -u - <<'PY'
import os
import sys

print("Python:", sys.executable, flush=True)
print("CUDA_VISIBLE_DEVICES:", os.environ.get("CUDA_VISIBLE_DEVICES"), flush=True)
import torch

print("PyTorch:", torch.__version__, "CUDA runtime:", torch.version.cuda, flush=True)
torch.cuda.init()
gpu = torch.cuda.get_device_properties(0)
print("GPU:", gpu.name, "VRAM GiB:", round(gpu.total_memory / 1024**3, 2), flush=True)
if gpu.total_memory < 30 * 1024**3:
    raise RuntimeError("Full comparison needs a GPU with at least 30 GiB")
x = torch.ones((32, 32), device="cuda", dtype=torch.float16)
if (x @ x).sum().item() != 32768:
    raise RuntimeError("GPU calculation returned an unexpected result")
torch.cuda.synchronize()
print("GPU preflight PASSED; starting model comparison", flush=True)
PY
exec "$PYTHON_BIN" -u -m ml.reranker_suite \
    --dataset data/generated/coverage-v2-01/dataset.json \
    --splits data/generated/coverage-v2-01/splits.json \
    --cases data/generated/coverage-v2-01/cases.json \
    --baselines artifacts/coverage-v2-comparison.json \
    --diagnostic data/samples/v2/italy-example.json \
    --out "artifacts/newton-rerankers-${SLURM_JOB_ID}" \
    --device cuda --dtype float16 --max-tokens 4096 --download --sizes "$@"

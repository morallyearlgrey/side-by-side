#!/bin/bash
#SBATCH --job-name=sidebyside-matching-v3
#SBATCH --account=cvelissaris
#SBATCH --partition=normal
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=4
#SBATCH --mem=48G
#SBATCH --gres=gpu:tesla_v100-pcie-32gb:1
#SBATCH --time=02:00:00
#SBATCH --output=slurm-sidebyside-matching-v3-%j.out
#SBATCH --error=slurm-sidebyside-matching-v3-%j.err

set -euo pipefail
: "${SLURM_JOB_ID:?Submit with sbatch; do not run inference on the login node}"
cd "${SLURM_SUBMIT_DIR:?Submit from the experiment bundle root}"
if [[ $# -ne 1 || "$1" != /* ]]; then
    printf '%s\n' 'Usage: sbatch ml/slurm/matching_v3.sbatch ABSOLUTE_EXISTING_HF_CACHE' >&2
    exit 2
fi
export HF_HOME="$1"
PYTHON_BIN="${SIDEBYSIDE_PYTHON:-$HOME/.conda/envs/sidebyside/bin/python}"
if [[ "$PYTHON_BIN" != /* || ! -x "$PYTHON_BIN" ]]; then
    printf 'Missing environment Python: %s\n' "$PYTHON_BIN" >&2
    exit 2
fi
export PATH="${PYTHON_BIN%/*}:$PATH"
export PYTHONNOUSERSITE=1 PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1
export HF_HUB_DISABLE_TELEMETRY=1 TOKENIZERS_PARALLELISM=false
export OMP_NUM_THREADS="${SLURM_CPUS_PER_TASK:-4}"
printf 'Starting source-aware experiment %s on %s\n' "$SLURM_JOB_ID" "$(hostname)"
timeout --kill-after=5s 90s "$PYTHON_BIN" -u - <<'PY'
import os
import sys
import torch

print("Python:", sys.executable, flush=True)
print("CUDA_VISIBLE_DEVICES:", os.environ.get("CUDA_VISIBLE_DEVICES"), flush=True)
print("PyTorch:", torch.__version__, "CUDA:", torch.version.cuda, flush=True)
torch.cuda.init()
gpu = torch.cuda.get_device_properties(0)
print("GPU:", gpu.name, "VRAM GiB:", gpu.total_memory / 1024**3, flush=True)
if gpu.total_memory < 30 * 1024**3:
    raise RuntimeError("This launcher requires the verified class of GPU with at least 30 GiB")
x = torch.ones((32, 32), device="cuda", dtype=torch.float16)
if (x @ x).sum().item() != 32768:
    raise RuntimeError("GPU calculation returned an unexpected result")
torch.cuda.synchronize()
print("GPU preflight PASSED", flush=True)
PY
# Stage only the small public format encoder; the pinned 4B weights are already
# in Bryan's cache. The subsequent process keeps HF_HUB_OFFLINE=1.
HF_HUB_OFFLINE=0 "$PYTHON_BIN" -u - <<'PY'
from huggingface_hub import snapshot_download
snapshot_download(repo_id="sentence-transformers/all-MiniLM-L6-v2",
                  revision="1110a243fdf4706b3f48f1d95db1a4f5529b4d41", token=False,
                  allow_patterns=["*.json", "*.txt", "model.safetensors"], max_workers=2)
print("Format encoder staged; all subsequent inference is offline.", flush=True)
PY
exec "$PYTHON_BIN" -u -m ml.tune_matching_v3 \
    --dataset data/generated/source-aware-v3/dataset.json \
    --splits data/generated/source-aware-v3/splits.json \
    --cases data/generated/source-aware-v3/cases.json \
    --out "artifacts/newton-matching-v3-${SLURM_JOB_ID}" \
    --device cuda --dtype float16 --model-size 4B

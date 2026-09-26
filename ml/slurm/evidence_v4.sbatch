#!/bin/bash
#SBATCH --job-name=sidebyside-evidence-v4
#SBATCH --account=cvelissaris
#SBATCH --partition=normal
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=4
#SBATCH --mem=48G
#SBATCH --gres=gpu:tesla_v100-pcie-32gb:1
#SBATCH --time=01:00:00
#SBATCH --output=slurm-sidebyside-evidence-v4-%j.out
#SBATCH --error=slurm-sidebyside-evidence-v4-%j.err

set -euo pipefail
: "${SLURM_JOB_ID:?Submit with sbatch; do not run inference on the login node}"
cd "${SLURM_SUBMIT_DIR:?Submit from the experiment bundle root}"
if [[ $# -ne 1 || "$1" != /* ]]; then
    printf '%s\n' 'Usage: sbatch ml/slurm/evidence_v4.sbatch ABSOLUTE_EXISTING_HF_CACHE' >&2
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
unset PYTHONHOME PYTHONPATH
printf 'Starting actual Qwen 4B evidence evaluation %s on %s\n' "$SLURM_JOB_ID" "$(hostname)"
timeout --kill-after=5s 90s "$PYTHON_BIN" -u - <<'PY'
import os
import sys
import torch
import jsonschema
import transformers
import sentence_transformers

print("Python:", sys.executable, flush=True)
print("CUDA_VISIBLE_DEVICES:", os.environ.get("CUDA_VISIBLE_DEVICES"), flush=True)
print("PyTorch:", torch.__version__, "CUDA:", torch.version.cuda, flush=True)
torch.cuda.init()
gpu = torch.cuda.get_device_properties(0)
print("GPU:", gpu.name, "VRAM GiB:", gpu.total_memory / 1024**3, flush=True)
if gpu.total_memory < 30 * 1024**3:
    raise RuntimeError("This launcher requires a GPU with at least 30 GiB")
x = torch.ones((32, 32), device="cuda", dtype=torch.float16)
if (x @ x).sum().item() != 32768:
    raise RuntimeError("GPU calculation returned an unexpected result")
torch.cuda.synchronize()
print("GPU preflight PASSED", flush=True)
PY
# A per-job overlay leaves the working CUDA environment and concurrent jobs alone.
DEPS="$SLURM_SUBMIT_DIR/.runtime-${SLURM_JOB_ID}"
mkdir "$DEPS"
"$PYTHON_BIN" -m pip install --disable-pip-version-check --no-input --only-binary=:all: \
    --no-deps --timeout 30 --retries 2 --target "$DEPS" -r ml/requirements-evidence.txt
export PYTHONPATH="$DEPS"
HF_HUB_OFFLINE=0 timeout --kill-after=5s 600s "$PYTHON_BIN" -u - <<'PY'
import sentencepiece
from huggingface_hub import snapshot_download
from ml.evidence import MODEL_ID, MODEL_REVISION
from ml.features import ENCODER_ID
from ml.matching_v3 import FORMAT_ENCODER_REVISION

for model, revision, patterns in (
    (MODEL_ID, MODEL_REVISION, ["*.json", "model.safetensors", "spm.model"]),
    (ENCODER_ID, FORMAT_ENCODER_REVISION, ["*.json", "*.txt", "model.safetensors"]),
):
    snapshot_download(repo_id=model, revision=revision, token=False,
                      allow_patterns=patterns, max_workers=2)
print("Pinned evidence and format models staged; inference is offline.", flush=True)
PY
exec "$PYTHON_BIN" -u -m ml.evaluate_v4 \
    --dataset data/generated/evidence-v4-eval-01/dataset.json \
    --cases data/generated/evidence-v4-eval-01/cases.json \
    --policy-dir artifacts/newton-matching-v3-852098 \
    --out "artifacts/newton-evidence-v4-${SLURM_JOB_ID}"

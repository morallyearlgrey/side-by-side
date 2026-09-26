#!/bin/bash
#SBATCH --job-name=sidebyside-pilot
#SBATCH --account=cvelissaris
#SBATCH --partition=normal
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=2
#SBATCH --mem=8G
#SBATCH --gres=gpu:1
#SBATCH --time=00:30:00
#SBATCH --output=slurm-sidebyside-%j.out
#SBATCH --error=slurm-sidebyside-%j.err

set -euo pipefail

# Submit from the repository root; each run gets a new output directory.
cd "${SLURM_SUBMIT_DIR:?Submit this script using sbatch from the repository root}"
if [[ $# -lt 2 ]]; then
    printf '%s\n' 'Usage: sbatch ml/slurm/train.sbatch DATASET_JSON SPLITS_JSON [--allow-unreviewed-synthetic]'
    exit 2
fi
dataset="$1"
splits="$2"
shift 2

module load anaconda/anaconda-2024.10
source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate sidebyside

export PYTHONUNBUFFERED=1
export TOKENIZERS_PARALLELISM=false
export OMP_NUM_THREADS="${SLURM_CPUS_PER_TASK}"
export CUBLAS_WORKSPACE_CONFIG=:4096:8

python -c "import torch; assert torch.cuda.is_available(); assert torch.version.cuda == '12.6', 'Install the cu126 wheel for V100 compatibility'; print(torch.__version__, torch.cuda.get_device_name(0))"
python -m ml.train \
    --dataset "$dataset" \
    --splits "$splits" \
    --out "artifacts/newton-${SLURM_JOB_ID}" \
    --device cuda \
    --mode all \
    "$@"

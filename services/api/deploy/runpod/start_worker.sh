#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-}"
if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
fi

STAGE_MODELS=0
PREFLIGHT_ONLY=0
for arg in "$@"; do
    case "$arg" in
        --stage-models) STAGE_MODELS=1 ;;
        --preflight-only) PREFLIGHT_ONLY=1 ;;
        *) echo "Unknown option: $arg" >&2; exit 2 ;;
    esac
done
if [[ "${DOWNLOAD_MODELS:-0}" == "1" ]]; then
    STAGE_MODELS=1
fi

export PYTHONUNBUFFERED=1
export HF_HOME="${HF_HOME:-/workspace/hf-cache}"
export HF_HUB_DISABLE_TELEMETRY="${HF_HUB_DISABLE_TELEMETRY:-1}"
export HF_HUB_DISABLE_IMPLICIT_TOKEN="${HF_HUB_DISABLE_IMPLICIT_TOKEN:-1}"
# Avoid requiring the optional hf_transfer package on managed Pod images.
export HF_HUB_ENABLE_HF_TRANSFER=0
export TOKENIZERS_PARALLELISM="${TOKENIZERS_PARALLELISM:-false}"
export MATCHING_PROVIDER="${MATCHING_PROVIDER:-qwen}"
export MATCHING_MODEL_ID="${MATCHING_MODEL_ID:-Qwen/Qwen3-Reranker-4B}"
export MATCHING_MODEL_REVISION="${MATCHING_MODEL_REVISION:-22e683669bc0f0bd69640a1354a6d0aebcfeede5}"
export MATCHING_DEVICE="${MATCHING_DEVICE:-cuda}"
export MATCHING_DTYPE="${MATCHING_DTYPE:-float16}"
export MATCHING_EXECUTION=local
export WORKER_ENABLED=true

mkdir -p "$HF_HOME" artifacts

PYTHON_BIN="${PYTHON_BIN:-python3.12}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    PYTHON_BIN=python3
fi

if ! "$PYTHON_BIN" - <<'PY'
import sys
raise SystemExit(0 if (3, 12) <= sys.version_info[:2] < (3, 14) else 1)
PY
then
    echo "Python 3.12 or 3.13 is required. Set PYTHON_BIN to a compatible interpreter." >&2
    exit 2
fi

if [[ ! -x .venv-runpod/bin/python ]]; then
    if ! command -v uv >/dev/null 2>&1; then
        "$PYTHON_BIN" -m pip install --disable-pip-version-check 'uv==0.11.16'
        export PATH="$HOME/.local/bin:$PATH"
    fi
    UV="${UV:-$(command -v uv || true)}"
    if [[ -z "$UV" ]]; then
        echo "uv was installed but is not on PATH. Set UV to its executable path and retry." >&2
        exit 2
    fi
    "$UV" venv --python "$PYTHON_BIN" .venv-runpod
    "$UV" pip install --python .venv-runpod/bin/python \
        --requirements pyproject.toml --extra inference --group dev \
        --torch-backend cu126 'torch==2.13.0+cu126' --strict
fi

PYTHON=.venv-runpod/bin/python
export PYTHONPATH="services/api:."

if [[ "$STAGE_MODELS" == "1" ]]; then
    "$PYTHON" services/api/deploy/runpod/stage_models.py
fi

"$PYTHON" services/api/deploy/runpod/preflight.py

if [[ "$PREFLIGHT_ONLY" == "1" ]]; then
    echo "Preflight complete. No Supabase connection or account data was used."
    exit 0
fi

: "${SUPABASE_URL:?Set SUPABASE_URL in the Pod environment}"
: "${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY in the Pod environment}"

echo "Starting SidebySide matching worker. Leave this process running during the demo."
exec "$PYTHON" -m sidebyside_api.worker

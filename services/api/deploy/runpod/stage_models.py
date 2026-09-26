"""Download the exact pinned model snapshots needed by the online worker."""

import os

# The accelerated transfer backend is optional and may be enabled globally in
# hosted environments without its package being installed.
os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "0"

from huggingface_hub import snapshot_download

from sidebyside_api.matching_policy import (
    EVIDENCE_MODEL_ID,
    EVIDENCE_REVISION,
    FORMAT_ENCODER_ID,
    MINILM_REVISION,
    QWEN_MODEL_ID,
    QWEN_REVISION,
)

MODELS = (
    (QWEN_MODEL_ID, QWEN_REVISION),
    (EVIDENCE_MODEL_ID, EVIDENCE_REVISION),
    (FORMAT_ENCODER_ID, MINILM_REVISION),
)


def main():
    for model_id, revision in MODELS:
        print(f"Staging {model_id}@{revision}", flush=True)
        path = snapshot_download(
            repo_id=model_id,
            revision=revision,
            token=False,
            local_files_only=False,
        )
        print(f"Cached {model_id}: {path}", flush=True)


if __name__ == "__main__":
    main()

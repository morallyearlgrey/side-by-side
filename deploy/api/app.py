"""Hosted API entrypoint; inference runs in the existing remote worker."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "services/api"))

from sidebyside_api.config import Settings  # noqa: E402
from sidebyside_api.main import create_app  # noqa: E402

# A ready production worker must be read from model_worker_heartbeats.
# The separate demo capability serves only its explicitly scoped test accounts.
settings = Settings(
    _env_file=None,
    matching_execution="remote",
    matching_demo_worker_enabled=False,
    worker_enabled=False,
    matching_warm_on_startup=False,
)
app = create_app(settings)

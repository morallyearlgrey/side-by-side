import runpy
import subprocess
import sys
from pathlib import Path

from conftest import iso
from sidebyside_api.jobs import MatchingJobs
from sidebyside_api.matching import MatchingRuntime
from sidebyside_api.matching_policy import PIPELINE, POLICY, POLICY_SHA256

ENTRYPOINT = Path(__file__).resolve().parents[3] / "deploy/api/app.py"


def test_hosted_staging_includes_pinned_policy_and_boundary_catalog(tmp_path):
    root = ENTRYPOINT.parents[2]
    stage = runpy.run_path(str(root / "scripts/stage_vercel_api.py"))["stage"]
    destination = tmp_path / "release"
    stage(destination)
    assert not list(destination.rglob(".env"))
    result = subprocess.run([sys.executable, "-c",
        "import sys; sys.path.insert(0, 'services/api'); "
        "from sidebyside_api.matching_policy import load_policy; "
        "assert load_policy()['topic_boundaries']['unknown'] == 'boundary_review_required'"],
        cwd=destination, capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr


async def test_hosted_entrypoint_uses_ready_production_worker(repo, monkeypatch):
    from sidebyside_api import main

    captured = []
    monkeypatch.setattr(main, "create_app", lambda settings: captured.append(settings))
    # Legacy deployment environment values cannot divert the hosted API to the
    # scoped demo registry or cause it to start inference in a serverless process.
    monkeypatch.setenv("MATCHING_DEMO_WORKER_ENABLED", "true")
    monkeypatch.setenv("MATCHING_EXECUTION", "local")
    monkeypatch.setenv("WORKER_ENABLED", "true")
    monkeypatch.setenv("MATCHING_WARM_ON_STARTUP", "true")
    runpy.run_path(str(ENTRYPOINT))
    settings = captured[0]
    assert not settings.worker_enabled and not settings.matching_warm_on_startup
    repo.tables["model_worker_heartbeats"] = [{
        "model_id": settings.matching_model_id,
        "model_revision": settings.matching_model_revision,
        "pipeline_version": PIPELINE,
        "policy": POLICY,
        "policy_sha256": POLICY_SHA256,
        "status": "ready",
        "expires_at": iso(60),
    }]
    metadata = await MatchingJobs(repo, MatchingRuntime(settings), settings).model_readiness()
    assert metadata["available"] and metadata["execution"] == "remote"
    assert not settings.matching_demo_worker_enabled
    assert not any(call[:2] == ("rpc", "demo_worker_readiness") for call in repo.calls)

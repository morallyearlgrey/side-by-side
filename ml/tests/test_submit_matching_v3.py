"""Test the upload helper against inert SSH/SCP doubles, never the cluster."""

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.fixture
def helper(tmp_path):
    root = tmp_path / "project with spaces"
    script = root / "ml/slurm/submit_matching_v3_from_mac.sh"
    script.parent.mkdir(parents=True)
    source = Path(__file__).resolve().parents[1] / "slurm/submit_matching_v3_from_mac.sh"
    script.write_text(source.read_text())
    (root / "artifacts").mkdir()
    archive = root / "artifacts/sidebyside-matching-v3-newton.tar.gz"
    archive.write_text("not a real archive; transfer tools are stubbed")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "calls.jsonl"
    stub = f'''#!{sys.executable}
import json, os, sys
from pathlib import Path
name = Path(sys.argv[0]).name
with open(os.environ["CALL_LOG"], "a") as stream:
    stream.write(json.dumps([name, sys.argv[1:]]) + "\\n")
if "-O" in sys.argv:
    raise SystemExit(0)
if os.environ.get("FAIL_TOOL") == name:
    raise SystemExit(7)
if "sbatch " in sys.argv[-1]:
    print("Submitted batch job STUB_ONLY")
'''
    for name in ("ssh", "scp"):
        path = bin_dir / name
        path.write_text(stub)
        path.chmod(0o755)
    def run(fail=""):
        env = {**os.environ, "PATH": f"{bin_dir}:/usr/bin:/bin", "CALL_LOG": str(log), "FAIL_TOOL": fail}
        result = subprocess.run(["/bin/bash", str(script)], env=env, text=True, capture_output=True, timeout=15)
        calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
        return result, calls
    return run, archive


def test_upload_uses_fresh_directory_and_submits_only_after_copy(helper):
    run, _ = helper
    result, calls = run()
    assert result.returncode == 0, result.stderr
    assert [c[0] for c in calls] == ["ssh", "scp", "ssh", "ssh"]
    assert 'mkdir "$HOME/sidebyside-matching-v3-' in calls[0][1][-1]
    assert "sbatch ml/slurm/matching_v3.sbatch" in calls[2][1][-1]
    assert "Submitted batch job STUB_ONLY" in result.stdout
    assert "-O" in calls[3][1]


@pytest.mark.parametrize("fail", ["ssh", "scp"])
def test_transfer_failure_never_submits(helper, fail):
    run, _ = helper
    result, calls = run(fail)
    assert result.returncode != 0
    assert not any("sbatch " in c[1][-1] for c in calls)


def test_missing_bundle_never_connects(helper):
    run, archive = helper
    archive.unlink()
    result, calls = run()
    assert result.returncode == 2 and not calls

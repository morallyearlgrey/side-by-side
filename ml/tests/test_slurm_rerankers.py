"""Exercise the real launcher with stub CUDA/model code, never a real GPU/job."""

import os
from pathlib import Path
import subprocess
import sys

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "slurm/rerankers.sbatch"


@pytest.fixture
def launcher(tmp_path):
    home = tmp_path / "home"
    python = home / ".conda/envs/sidebyside/bin/python"
    python.parent.mkdir(parents=True)
    python.symlink_to(sys.executable)
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name in ("module", "conda"):
        command = bin_dir / name
        command.write_text('#!/bin/bash\nprintf "Unexpected Conda/module call\\n" >&2\nexit 99\n')
        command.chmod(0o755)
    # macOS need not have GNU timeout; subprocess.run bounds each stubbed test.
    timeout = bin_dir / "timeout"
    timeout.write_text('#!/bin/bash\nshift 2\nexec "$@"\n')
    timeout.chmod(0o755)
    (bundle / "torch.py").write_text('''
import os
from types import SimpleNamespace
__version__ = "stub"
version = SimpleNamespace(cuda="stub")
float16 = "float16"
class Cuda:
    def init(self):
        if os.environ.get("STUB_CUDA_FAIL"):
            raise RuntimeError("stub CUDA initialization failed")
    def get_device_properties(self, index):
        return SimpleNamespace(name="stub GPU", total_memory=int(os.environ.get("STUB_VRAM_GIB", "32")) * 1024**3)
    def synchronize(self):
        pass
cuda = Cuda()
class Tensor:
    def __matmul__(self, other):
        return self
    def sum(self):
        return self
    def item(self):
        return int(os.environ.get("STUB_GPU_RESULT", "32768"))
def ones(*args, **kwargs):
    return Tensor()
''')
    (bundle / "ml").mkdir()
    (bundle / "ml/__init__.py").write_text("")
    (bundle / "ml/reranker_suite.py").write_text('''
import os, sys
print("SUITE", repr(sys.argv[1:]), flush=True)
raise SystemExit(int(os.environ.get("STUB_SUITE_EXIT", "0")))
''')
    (bundle / "ml/tune_matching_v3.py").write_text('from .reranker_suite import *\n')
    (bundle / "huggingface_hub.py").write_text('def snapshot_download(**kwargs):\n    print("STUB_DOWNLOAD", kwargs["repo_id"])\n')
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(("CONDA", "BASH_FUNC_"))
                   and key not in ("BASH_ENV", "PYTHONHOME", "PYTHONPATH", "SIDEBYSIDE_PYTHON")}
    environment.update(HOME=str(home), PATH=f"{bin_dir}:/usr/bin:/bin",
                       SLURM_SUBMIT_DIR=str(bundle), SLURM_JOB_ID="test-123",
                       SLURM_CPUS_PER_TASK="4", CUDA_VISIBLE_DEVICES="0")

    def run(overrides=None, sizes=(), script=SCRIPT):
        return subprocess.run(["/bin/bash", str(script), str(tmp_path / "cache"), *sizes],
                              env={**environment, **(overrides or {})}, text=True,
                              capture_output=True, timeout=15)

    return run


@pytest.mark.parametrize("conda_level", ["0", "2"])
def test_direct_environment_handles_inherited_conda_without_module_reload(launcher, conda_level):
    result = launcher({"CONDA_SHLVL": conda_level, "CONDA_PREFIX": "/inherited/environment"})
    assert result.returncode == 0, result.stderr
    assert "CUDA_VISIBLE_DEVICES: 0" in result.stdout
    assert "GPU preflight PASSED" in result.stdout
    assert "'--sizes', '0.6B', '4B', '8B'" in result.stdout
    assert "Unexpected Conda/module call" not in result.stderr


def test_explicit_python_and_selected_sizes(launcher):
    result = launcher({"SIDEBYSIDE_PYTHON": sys.executable}, sizes=("4B", "8B"))
    assert result.returncode == 0, result.stderr
    assert "'--sizes', '4B', '8B'" in result.stdout


@pytest.mark.parametrize("python", ["/nonexistent/sidebyside/python", "python"])
def test_missing_or_relative_python_fails_before_suite(launcher, python):
    result = launcher({"SIDEBYSIDE_PYTHON": python})
    assert result.returncode == 2
    assert "Missing environment Python" in result.stderr
    assert "SUITE" not in result.stdout


@pytest.mark.parametrize("override,message", [
    ({"STUB_CUDA_FAIL": "1"}, "stub CUDA initialization failed"),
    ({"STUB_VRAM_GIB": "16"}, "at least 30 GiB"),
    ({"STUB_GPU_RESULT": "0"}, "unexpected result"),
])
def test_preflight_failure_prevents_model_suite(launcher, override, message):
    result = launcher(override)
    assert result.returncode != 0
    assert message in result.stderr
    assert "SUITE" not in result.stdout


def test_suite_exit_status_is_preserved(launcher):
    assert launcher({"STUB_SUITE_EXIT": "7"}).returncode == 7


def test_requires_a_slurm_job(launcher):
    result = launcher({"SLURM_JOB_ID": ""})
    assert result.returncode != 0
    assert "do not run inference on the login node" in result.stderr
    assert "SUITE" not in result.stdout


def test_matching_v3_uses_cached_4b_and_direct_python(launcher):
    result = launcher({"CONDA_SHLVL": "2"}, script=SCRIPT.with_name("matching_v3.sbatch"))
    assert result.returncode == 0, result.stderr
    assert "'--model-size', '4B'" in result.stdout
    assert "GPU preflight PASSED" in result.stdout
    assert "Unexpected Conda/module call" not in result.stderr


@pytest.mark.parametrize("overrides", [{"STUB_CUDA_FAIL": "1"}, {"STUB_VRAM_GIB": "16"},
                                      {"STUB_GPU_RESULT": "0"}, {"SLURM_JOB_ID": ""}])
def test_matching_v3_preflight_blocks_inference(launcher, overrides):
    result = launcher(overrides, script=SCRIPT.with_name("matching_v3.sbatch"))
    assert result.returncode != 0
    assert "SUITE" not in result.stdout


def test_matching_v3_preserves_exit_code_and_rejects_extra_args(launcher):
    script = SCRIPT.with_name("matching_v3.sbatch")
    assert launcher({"STUB_SUITE_EXIT": "7"}, script=script).returncode == 7
    result = launcher(sizes=("8B",), script=script)
    assert result.returncode == 2
    assert "SUITE" not in result.stdout

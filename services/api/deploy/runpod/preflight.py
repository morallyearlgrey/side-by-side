"""No-secret RunPod inference check for the pinned matching worker."""

import asyncio
import json
import math
import os
import sys
import time

from sidebyside_api.config import Settings
from sidebyside_api.matching import MatchingRuntime
from sidebyside_api.matching_policy import provenance


class PreflightError(RuntimeError):
    pass


def check_cuda():
    import torch

    if not torch.cuda.is_available():
        raise PreflightError("CUDA is not available inside this pod")
    if sys.version_info < (3, 12) or sys.version_info >= (3, 14):
        raise PreflightError("Use Python 3.12 or 3.13 for the application environment")
    value = torch.ones((32, 32), device="cuda", dtype=torch.float16)
    if not torch.isfinite(value @ value).all().item():
        raise PreflightError("GPU fp16 matmul failed")
    torch.cuda.synchronize()
    props = torch.cuda.get_device_properties(0)
    return {
        "python": sys.version.split()[0],
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "gpu": props.name,
        "vram_gib": round(props.total_memory / 1024**3, 2),
    }


def finite(value, label):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        raise PreflightError(f"{label} was not finite")
    return value


def probe(runtime):
    import numpy as np

    started = time.perf_counter()
    relevance = runtime.model.score(
        "Fictional demo: a beginner wants firsthand advice about wheel-thrown pottery.",
        "Fictional demo: I have practiced wheel throwing for two years and enjoy helping beginners.",
    )
    evidence = runtime.evidence_model.check(
        "I have practiced wheel throwing.",
        ["I have practiced wheel throwing for two years and enjoy helping beginners."],
    )
    embeddings = runtime.format_encoder.encode([
        "A relaxed one-on-one conversation",
        "A small group discussion",
    ])
    if np.shape(embeddings) != (2, 384) or not np.isfinite(embeddings).all():
        raise PreflightError("MiniLM did not return finite 384-dimensional embeddings")
    return {
        "relevance": finite(relevance.get("uncalibrated_relevance_score"), "relevance"),
        "textual_support": finite(evidence.get("support_score"), "textual_support"),
        "textual_contradiction": finite(evidence.get("contradiction_score"), "textual_contradiction"),
        "embedding_shape": [2, 384],
        "probe_seconds": round(time.perf_counter() - started, 3),
    }


async def run():
    settings = Settings(
        _env_file=None,
        matching_provider="qwen",
        matching_model_id="Qwen/Qwen3-Reranker-4B",
        matching_model_revision="22e683669bc0f0bd69640a1354a6d0aebcfeede5",
        matching_device="cuda",
        matching_dtype="float16",
        matching_execution="local",
        worker_enabled=False,
        matching_warm_on_startup=False,
    )
    runtime = MatchingRuntime(settings)
    started = time.perf_counter()
    await runtime.warm()
    if not runtime.assets_ready:
        raise PreflightError(runtime.reason or "model assets did not warm")
    results = await asyncio.to_thread(probe, runtime)
    return {
        "status": "passed",
        "scope": "fixed_fictional_inputs_only",
        **provenance(),
        "warm_seconds": round(time.perf_counter() - started, 3),
        "probes": results,
    }


def main():
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    try:
        device = check_cuda()
        report = {**asyncio.run(run()), "device": device}
    except PreflightError as exc:
        print(f"Preflight FAILED: {exc}", flush=True)
        raise SystemExit(1) from None
    print(json.dumps(report, indent=2), flush=True)
    print("Preflight PASSED. No account data, database job, or public service was used.", flush=True)


if __name__ == "__main__":
    main()

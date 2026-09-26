"""Bounded Meta completions with metadata-only latency logging."""

import asyncio
import logging
import time

logger = logging.getLogger("uvicorn.error")


async def completion(settings, client, *, messages, max_tokens, deadline_seconds, purpose, schema=None):
    started = time.monotonic()
    status = None
    usage = {}
    outcome = "error"
    payload = {"model": settings.muse_model, "messages": messages,
               "reasoning_effort": settings.muse_reasoning_effort,
               "max_completion_tokens": max_tokens}
    if schema is not None:
        payload["response_format"] = {"type": "json_schema", "json_schema": {
            "name": purpose, "schema": schema,
        }}
    try:
        # HTTP read timeouts reset for each chunk. This bounds the entire call,
        # including connection-pool waits, without retrying a paid generation.
        async with asyncio.timeout(deadline_seconds):
            response = await client.post(
                "https://api.meta.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.muse_api_key.get_secret_value()}"},
                json=payload,
                timeout=deadline_seconds,
            )
            status = response.status_code
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError("Invalid completion response")
            usage = data.get("usage")
            usage = usage if isinstance(usage, dict) else {}
            choice = data["choices"][0]
            if not isinstance(choice, dict):
                raise ValueError("Invalid completion choice")
            if choice.get("finish_reason") not in (None, "stop"):
                raise ValueError("Incomplete completion")
            text = choice["message"]["content"]
            outcome = "received"
            return text
    finally:
        # Never log prompts, answers, response text, account IDs, or credentials.
        details = usage.get("completion_tokens_details")
        details = details if isinstance(details, dict) else {}
        tokens = usage.get("completion_tokens")
        reasoning = details.get("reasoning_tokens")
        logger.info(
            "muse_completion purpose=%s model=%s effort=%s elapsed_ms=%d status=%s outcome=%s completion_tokens=%s reasoning_tokens=%s",
            purpose, settings.muse_model, settings.muse_reasoning_effort,
            round((time.monotonic() - started) * 1000), status, outcome,
            tokens if type(tokens) is int else None, reasoning if type(reasoning) is int else None,
        )

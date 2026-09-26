import json
import logging

import httpx
import pytest
from pydantic import ValidationError
from sidebyside_api.config import Settings
from sidebyside_api.muse import completion


def test_unsupported_reasoning_none_rejected_before_provider_call():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, muse_reasoning_effort="none")


@pytest.mark.parametrize("usage", [None, [], {"completion_tokens_details": "private unexpected text"},
    {"completion_tokens": "private unexpected text", "completion_tokens_details": {"reasoning_tokens": "private unexpected text"}},
    {"completion_tokens": 123, "completion_tokens_details": {"reasoning_tokens": 45}}])
async def test_latency_log_has_only_metadata_and_malformed_usage_cannot_hide_reply(caplog, usage):
    async def respond(request):
        assert json.loads(request.content)["reasoning_effort"] == "low"
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": "private reply"}}],
                                        "usage": usage})

    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            text = await completion(Settings(_env_file=None, muse_api_key="private key", muse_reasoning_effort="low"),
                                    client, messages=[{"role": "user", "content": "private answer"}],
                                    max_tokens=2000, deadline_seconds=1, purpose="test")
    assert text == "private reply"
    assert "elapsed_ms=" in caplog.text and "effort=low" in caplog.text
    assert "private" not in caplog.text

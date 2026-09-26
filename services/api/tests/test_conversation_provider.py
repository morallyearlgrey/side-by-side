import asyncio
import json

import httpx
import pytest
from sidebyside_api.config import Settings
from sidebyside_api.conversation import ConversationIdeas, conversation_context


def context(**changes):
    inputs = {
        "viewer_id": "viewer-private-id", "candidate_id": "candidate-private-id",
        "viewer_version": "viewer-version", "candidate_version": "candidate-version",
        "viewer_preview": {"display_name": "Alice", "interests": ["  pottery\t design  "]},
        "candidate_preview": {"display_name": "Bob", "interests": ["Pottery design", "Hiking"]},
        "score": {"model_id": "model", "model_revision": "revision", "pipeline_version": "pipeline",
                  "policy": "policy", "policy_sha256": "policy-hash", "reason": "private diagnosis"},
    }
    inputs.update(changes)
    return conversation_context(**inputs)


def settings(key="test-key"):
    return Settings(_env_file=None, muse_api_key=key)


def reply(opener="What interests you most about pottery design?"):
    return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({"opener": opener})}}]})


def test_reason_is_grounded_only_in_shared_preview_and_exact_overlap():
    result = context()
    assert result["reason"] == "You both list Pottery design as an interest."
    assert result["topic"] == "Pottery design"
    assert len(result["key"]) == 64
    # Similar words are not evidence that both people claimed the same interest.
    single = context(viewer_preview={"interests": ["pottery"]})
    assert single["reason"] == "Bob lists Pottery design as an interest."
    disabled = context(viewer_preview={"enabled": False, "interests": ["Pottery design"]})
    assert disabled == context(viewer_preview=None)
    empty = context(candidate_preview={"display_name": "Bob", "interests": []})
    assert empty["topic"] is None
    assert empty["reason"] == "You are nearby and both available to connect."


def test_context_key_tracks_versions_preview_and_model_provenance_not_private_diagnostics():
    original = context()
    assert context(candidate_version="new-version")["key"] != original["key"]
    assert context(viewer_version="new-viewer-version")["key"] != original["key"]
    assert context(candidate_id="another-person")["key"] != original["key"]
    assert context(candidate_preview={"display_name": "Bob", "interests": ["Hiking"]})["key"] != original["key"]
    assert context(score={"policy_sha256": "another-policy"})["key"] != original["key"]
    private = {"display_name": "Bob", "interests": ["Pottery design", "Hiking"],
               "facts": [{"details": "private diagnosis"}], "answers": ["private answer"]}
    assert context(candidate_preview=private) == original
    safe_score = {"model_id": "model", "model_revision": "revision", "pipeline_version": "pipeline",
                  "policy": "policy", "policy_sha256": "policy-hash"}
    assert context(score={**safe_score, "reason": "a different private diagnosis"}) == original
    assert context(score={**safe_score, "model_revision": "new-revision"})["key"] != original["key"]
    assert context(score={**safe_score, "pipeline_version": "new-pipeline"})["key"] != original["key"]
    assert context(score={**safe_score, "policy_sha256": "new-policy"})["key"] != original["key"]


def test_display_text_is_bounded_and_controls_removed():
    result = context(viewer_preview=None, candidate_preview={
        "display_name": "Bob\u202e\n Smith" + "x" * 100,
        "interests": ["Pottery\x00\t design" + "x" * 600],
    })
    assert "\u202e" not in result["reason"]
    assert "\x00" not in result["reason"]
    assert len(result["topic"]) == 500
    assert len(result["reason"]) <= 603
    provider = ConversationIdeas(settings(), None)
    assert provider.fallback(result)["opener"] == "What drew you to that interest?"


async def test_muse_receives_only_reason_and_topic_and_validated_result_is_cached():
    requests = []

    def handle(request):
        requests.append(request)
        return reply()

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        provider = ConversationIdeas(settings(), client)
        result = await provider.suggest(context())
        assert result["source"] == "muse"
        assert result["context_key"] == context()["key"]
        assert result["reason"] == context()["reason"]
        assert await provider.suggest(context()) == result
    assert len(requests) == 1
    payload = json.loads(requests[0].content)
    assert payload["model"] == settings().muse_model
    assert payload["reasoning_effort"] == "minimal"
    assert payload["max_completion_tokens"] == 2000  # Includes Muse's reasoning tokens.
    content = json.loads(payload["messages"][1]["content"])
    assert content == {"reason": "Both people list this as an interest in their shared previews.",
                       "topic": "Pottery design"}
    wire = requests[0].content.decode()
    for private in ("Alice", "Bob", "viewer-private-id", "candidate-private-id", "private diagnosis", "viewer-version"):
        assert private not in wire
    assert "untrusted JSON data" in payload["messages"][0]["content"]


@pytest.mark.parametrize("response", [
    httpx.Response(503),
    httpx.Response(200, json={"choices": []}),
    httpx.Response(200, json={"choices": [{"finish_reason": "length", "message": {"content": None}}]}),
    httpx.Response(200, json={"choices": [{"message": {"content": "not JSON"}}]}),
    httpx.Response(200, json={"choices": [{"message": {"content": '{"opener":"   "}'}}]}),
    httpx.Response(200, json={"choices": [{"message": {"content": '{"opener":"What do you like?","extra":"secret"}'}}]}),
    reply("What do you like? What else?"),
    reply("You both have years of pottery experience."),
    reply("What " + "x" * 240 + "?"),
])
async def test_bad_provider_responses_use_honest_fallback_and_brief_cache(response):
    calls = 0

    def handle(request):
        nonlocal calls
        calls += 1
        return response

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        provider = ConversationIdeas(settings(), client)
        result = await provider.suggest(context())
        assert result == {"context_key": context()["key"], "reason": context()["reason"],
                          "opener": "What interests you most about Pottery design?", "source": "fallback"}
        assert await provider.suggest(context()) == result
    assert calls == 1


async def test_missing_credentials_skips_network_and_does_not_claim_muse():
    def handle(request):
        raise AssertionError("No credentials must not invoke Muse")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        provider = ConversationIdeas(settings(""), client)
        result = await provider.suggest(context(candidate_preview={"interests": []}))
        assert result["source"] == "fallback"
        assert result["opener"] == "What would you enjoy talking about today?"


async def test_duplicate_requests_share_generation_and_caller_cancellation_does_not_cancel_others():
    entered, release = asyncio.Event(), asyncio.Event()
    calls = 0

    async def handle(request):
        nonlocal calls
        calls += 1
        entered.set()
        await release.wait()
        return reply()

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        provider = ConversationIdeas(settings(), client)
        first = asyncio.create_task(provider.suggest(context()))
        await entered.wait()
        second = asyncio.create_task(provider.suggest(context()))
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        release.set()
        result = await second
        assert result["source"] == "muse"
        assert calls == 1
        assert not provider._inflight


async def test_deadline_includes_semaphore_wait_and_pending_queue_is_bounded():
    entered = asyncio.Event()
    calls = 0

    async def handle(request):
        nonlocal calls
        calls += 1
        entered.set()
        await asyncio.Event().wait()

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        provider = ConversationIdeas(settings(), client, timeout_seconds=0.03, concurrency=1, pending_limit=2)
        first = asyncio.create_task(provider.suggest(context()))
        await entered.wait()
        second = asyncio.create_task(provider.suggest(context(candidate_version="two")))
        await asyncio.sleep(0)
        assert len(provider._inflight) == 2
        saturated = await provider.suggest(context(candidate_version="three"))
        assert saturated["source"] == "fallback"
        results = await asyncio.wait_for(asyncio.gather(first, second), timeout=0.3)
        assert all(result["source"] == "fallback" for result in results)
        assert calls <= 2
        assert not provider._inflight


async def test_cache_bounds_and_expiry_allow_fresh_generation():
    calls = 0

    def handle(request):
        nonlocal calls
        calls += 1
        return reply()

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        provider = ConversationIdeas(settings(), client, cache_size=2)
        await provider.suggest(context(candidate_version="one"))
        await provider.suggest(context(candidate_version="two"))
        await provider.suggest(context(candidate_version="three"))
        assert len(provider._cache) == 2
        await provider.suggest(context(candidate_version="one"))
        assert calls == 4
        expires = ConversationIdeas(settings(), client, cache_ttl_seconds=0)
        await expires.suggest(context())
        await expires.suggest(context())
        assert calls == 6

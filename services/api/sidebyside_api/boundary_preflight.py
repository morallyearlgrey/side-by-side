"""Offline V6 release probes using fixed fictional profiles, never database data."""

import asyncio
import copy
import json
import time
from datetime import UTC, datetime, timedelta
from uuid import NAMESPACE_URL, uuid5

from .config import Settings
from .matching import MatchingRuntime
from .matching_policy import PIPELINE, POLICY_SHA256
from .suggestion_policy import suggestible_score


def fictional_profile(name, topic="pottery", goal="Practice making a clay mug together"):
    def identifier(kind):
        return str(uuid5(NAMESPACE_URL, f"sidebyside.invalid/boundary-preflight/{name}/{kind}"))

    now = datetime.now(UTC)
    answer = f"I am learning {topic} and want to {goal[0].lower() + goal[1:]} with someone."
    return {
        "user_id": identifier("user"), "profile_version_id": identifier("version"),
        # This is only the online adapter shape. These fixtures never become accounts.
        "data_origin": "real_opt_in", "valid_from": (now - timedelta(seconds=1)).isoformat(),
        "current_goal": goal, "conversation_intent": "find_activity_partner",
        "open_to_discussing": [topic], "conversation_preferences": [], "avoid_topics": [],
        "conversation_request": {"mode": "find_activity_partner", "goal": goal,
            "evidence_requirement": {"version": 1, "kind": "none", "subject": None,
                                     "claim": None, "confirmation": "confirmed"}},
        "onboarding_answers": [{"answer_id": identifier("answer"), "user_id": identifier("user"),
            "answer_text": answer, "answered_at": (now - timedelta(seconds=2)).isoformat(),
            "question_key": "interests"}],
        "facts": [{"fact_id": "fixture-interest", "topic": topic, "relationship": "learning",
            "details": answer, "motivation": None, "confirmation": "confirmed", "matching_allowed": True,
            "sharing_scope": "matching_only", "evidence": [{"source_type": "onboarding_answer",
                "reference_id": identifier("answer"), "channel": "self_report", "support": answer}]}],
    }


def probes():
    result = []
    for boundary in (None, "politics", "religion", "dating", "sexual content"):
        viewer, candidate = fictional_profile("viewer"), fictional_profile("candidate")
        viewer["avoid_topics"] = [boundary] if boundary else []
        result.append((f"unrelated_{boundary or 'baseline'}", viewer, candidate, True))
    for name, topic, goal, boundary in (
        ("explicit_conflict", "election campaigning", "Practice election campaigning together", "politics"),
        ("indirect_conflict", "Donald Trump's speeches", "Discuss Donald Trump's recent speeches", "politics"),
        ("indirect_romance", "candlelit dinners as a couple", "Find a partner for candlelit dinners as a couple", "dating"),
    ):
        viewer, candidate = fictional_profile("viewer", topic, goal), fictional_profile("candidate", topic, goal)
        candidate["avoid_topics"] = [boundary]
        result.append((name, viewer, candidate, False))
    viewer, candidate = fictional_profile("viewer"), fictional_profile("candidate")
    viewer["avoid_topics"] = ["politics except local issues"]
    result.append(("unresolved_boundary", viewer, candidate, False))
    return result


async def run():
    # Explicit empty credentials override inherited settings, and no Repository
    # or HTTP client is constructed. Model loaders only read the pinned cache.
    settings = Settings(_env_file=None, supabase_url="", supabase_anon_key="",
                        supabase_service_role_key="", muse_api_key="", spotify_client_id="",
                        matching_execution="local", worker_enabled=False,
                        matching_device="cuda", matching_dtype="float16")
    runtime = MatchingRuntime(settings)
    print("Loading pinned models for fictional-only boundary probes; no database connection.", flush=True)
    started = time.monotonic()
    await runtime.warm()
    if not runtime.assets_ready:
        raise SystemExit("Boundary preflight failed: " + (runtime.reason or "models_unavailable"))
    results = []
    for name, viewer, candidate, expected in probes():
        original = copy.deepcopy((viewer, candidate))
        score = await runtime.score(viewer, candidate, "find_activity_partner")
        shown = suggestible_score({"status": score.status, "reason": score.reason, "final_score": score.score})
        passed = shown == expected and score.status != "unavailable" and (viewer, candidate) == original
        results.append({"probe": name, "passed": passed, "status": score.status,
                        "reason": score.reason, "would_show_suggestion": shown})
        print(json.dumps(results[-1]), flush=True)
    report = {"passed": all(p["passed"] for p in results), "scope": "fixed_fictional_inputs_only",
              "pipeline_version": PIPELINE, "policy_sha256": POLICY_SHA256,
              "elapsed_seconds": round(time.monotonic() - started, 2), "probes": results}
    print(json.dumps(report), flush=True)
    return report["passed"]


if __name__ == "__main__":
    raise SystemExit(0 if asyncio.run(run()) else 1)

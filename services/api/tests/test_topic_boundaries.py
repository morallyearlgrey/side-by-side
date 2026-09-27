import copy
import json
from uuid import uuid4

import pytest
from sidebyside_api.matching import OnlineEvidenceBuilder, OnlineProfile
from sidebyside_api.topic_boundaries import scoped_profiles, topic_boundaries
from test_matching import ModelDouble, confirmed_profile, loaded_runtime


@pytest.mark.parametrize("label,text", [
    ("politics", "election campaigning"), ("religion", "church worship"),
    ("dating", "flirting"), ("romance", "a romantic date night"),
    ("sex", "sexual topics"), ("sexual content", "erotic literature"),
    (" POLITICS. ", "geopolitical debate"), ("ＰＯＬＩＴＩＣＳ", "political science"),
])
def test_supported_categories_and_synonyms(label, text):
    boundary = topic_boundaries({"avoid_topics": [label]})
    assert not boundary.unresolved and boundary.excludes(text)
    assert not boundary.excludes("Pottery class in Essex")
    assert not boundary.excludes("Godot game coding and sexagesimal numbers")


@pytest.mark.parametrize("labels", [["politics except local issues"], ["private topic"],
                                   ["politics", "private topic"], ["no restrictions"]])
async def test_unknown_boundaries_stop_before_model(labels):
    viewer, runtime = confirmed_profile(), loaded_runtime()
    viewer["avoid_topics"] = labels
    result = await runtime.score(viewer, confirmed_profile(), "casual_chat")
    assert result.reason == "boundary_review_required" and result.score is None
    assert not runtime.model.calls


@pytest.mark.parametrize("owner", ["viewer", "candidate", "both"])
async def test_unrelated_supported_boundary_reaches_real_ranking_contract(owner):
    viewer, candidate, runtime = confirmed_profile(), confirmed_profile(), loaded_runtime()
    for profile in ([viewer, candidate] if owner == "both" else [viewer] if owner == "viewer" else [candidate]):
        profile["avoid_topics"] = ["politics"]
    before = copy.deepcopy([viewer, candidate])
    result = await runtime.score(viewer, candidate, "casual_chat")
    assert result.status == "recommend"
    assert "exclude these conversation topics" in runtime.model.calls[-1][2]
    assert [viewer, candidate] == before
    assert "politics" not in result.model_dump_json()


@pytest.mark.parametrize("topic_score,reason", [(0.99, "topic_boundary_conflict"),
    (0.5, "topic_boundary_conflict"), (0.01, "boundary_review_required"),
    (float("nan"), "boundary_review_required"), (None, "boundary_review_required"),
    (-0.1, "boundary_review_required"), (1.1, "boundary_review_required")])
async def test_semantic_topic_screen_precedes_relevance_and_clears_cache(topic_score, reason):
    viewer, candidate = confirmed_profile(), confirmed_profile()
    candidate["avoid_topics"] = ["politics"]
    runtime = loaded_runtime(ModelDouble(topic_score=topic_score))
    result = await runtime.score(viewer, candidate, "casual_chat")
    assert result.status == "insufficient_evidence" and result.score is None
    assert result.reason == reason
    assert len(runtime.model.calls) == 1
    assert runtime.model.cache == {}
    assert not runtime.evidence_model.calls


async def test_topic_screen_does_not_send_boundary_label_as_profile_content():
    viewer, candidate = confirmed_profile(), confirmed_profile()
    candidate["avoid_topics"] = ["politics"]
    runtime = loaded_runtime()
    await runtime.score(viewer, candidate, "casual_chat")
    query, document, _ = runtime.model.calls[0]
    assert "political" in query and "politics" not in document
    assert "avoid_topics" not in document and "onboarding_answers" not in document


async def test_topic_screen_failure_does_not_become_zero_or_a_recommendation():
    viewer = confirmed_profile()
    viewer["avoid_topics"] = ["politics"]
    result = await loaded_runtime(ModelDouble(overflow=True)).score(viewer, confirmed_profile(), "casual_chat")
    assert result.reason == "boundary_review_required" and result.score is None


async def test_boundary_does_not_force_a_recommendation():
    viewer = confirmed_profile()
    viewer["avoid_topics"] = ["politics"]
    runtime = loaded_runtime(ModelDouble(relevance=0.001))
    result = await runtime.score(viewer, confirmed_profile(), "casual_chat")
    assert result.status == "not_recommended" and result.score < .15


@pytest.mark.parametrize("field", ["current_goal", "conversation_intent", "request_goal", "claim"])
async def test_required_conflict_abstains_without_changing_request(field):
    viewer, candidate, runtime = confirmed_profile(), confirmed_profile(), loaded_runtime()
    candidate["avoid_topics"] = ["politics"]
    if field == "claim":
        viewer = confirmed_profile("firsthand", "casual_chat", "candidate", "I organized an election campaign.")
    elif field == "request_goal":
        viewer["conversation_request"]["goal"] = "Discuss elections"
    else:
        viewer[field] = "Discuss elections"
    result = await runtime.score(viewer, candidate, "casual_chat")
    assert result.reason == "topic_boundary_conflict" and result.score is None
    assert not runtime.model.calls and not runtime.evidence_model.calls


def add_fact(profile, text, *, source=None):
    fact = copy.deepcopy(profile["facts"][0])
    answer = copy.deepcopy(profile["onboarding_answers"][0])
    answer["answer_id"] = str(uuid4())
    answer["answer_text"] = source or text
    fact.update(fact_id=str(uuid4()), topic=text, details=text, motivation=None)
    fact["evidence"][0].update(reference_id=answer["answer_id"], support=text)
    profile["onboarding_answers"].append(answer)
    profile["facts"].append(fact)


def test_pair_projection_filters_claims_sources_topics_and_preferences_bilaterally():
    viewer, candidate = confirmed_profile(), confirmed_profile()
    viewer["avoid_topics"] = ["politics"]
    candidate["avoid_topics"] = ["religion"]
    for p in (viewer, candidate):
        add_fact(p, "I enjoy election campaigning.")
        add_fact(p, "I enjoy church history.")
        add_fact(p, "I enjoy sculpture.", source="I enjoy sculpture. Also politics.")
        p["open_to_discussing"] += ["elections", "church history"]
        p["conversation_preferences"] += ["political debate", "quiet conversation"]
    original = copy.deepcopy([viewer, candidate])
    builder = OnlineEvidenceBuilder(OnlineProfile.from_record(viewer), OnlineProfile.from_record(candidate), "casual_chat")
    tasks = builder.build(builder.pair)["tasks"]
    for p in builder.profiles.values():
        assert len(p["facts"]) == 1
        assert p["open_to_discussing"] == ["pottery"]
        assert p["conversation_preferences"] == ["quiet conversation"]
        assert len(p["onboarding_answers"]) == 4
    assert [viewer, candidate] == original
    for task in tasks:
        for text in (task["query"], task["document"]):
            assert "election" not in text and "church" not in text and "sculpture" not in text
    assert json.loads(tasks[0]["query"])["viewer"]["approved_facts"]


@pytest.mark.parametrize("field,reason", [("facts", "insufficient_approved_facts"),
                                         ("open_to_discussing", "candidate_openness_missing")])
async def test_no_remaining_evidence_stays_unscored(field, reason):
    viewer, candidate, runtime = confirmed_profile(), confirmed_profile(), loaded_runtime()
    viewer["avoid_topics"] = ["politics"]
    if field == "facts":
        candidate["facts"][0]["motivation"] = "political debate"
    else:
        candidate["open_to_discussing"] = ["political debate"]
    result = await runtime.score(viewer, candidate, "casual_chat")
    assert result.reason == reason and result.score is None
    assert not runtime.model.calls


def test_no_boundaries_leave_full_profile_unchanged():
    profiles = [confirmed_profile(), confirmed_profile()]
    projected, reason = scoped_profiles(*profiles)
    assert reason is None and projected == profiles


def test_no_boundary_instruction_does_not_change_existing_model_prompt():
    from sidebyside_api.topic_boundaries import BoundaryAwareReranker

    from ml.matching_v3 import RELEVANCE
    model = ModelDouble()
    BoundaryAwareReranker(model, topic_boundaries({})).score("query", "document", instruction=RELEVANCE)
    assert model.calls == [("query", "document", RELEVANCE)]

import copy
import json

import pytest
from jsonschema import ValidationError

from ml.dataset_builder import DatasetBuilder, fact
from ml.matching_v3 import SourceAwareBuilder
from ml.matching_v4 import (FIRSTHAND_METHOD, FIRSTHAND_THRESHOLD, evidence_plan,
                            experience_claims, score_bundle, score_evidence_aware)
from ml.reranker import INSTRUCTION
from ml.synthetic_v3 import generate
from ml.tune_matching_v3 import DEFAULT_POLICY, IDENTITY, decide
from ml.validation import validate_bundle


def requirement(kind="firsthand", subject="candidate", confirmation="confirmed"):
    return {"version": 1, "kind": kind, "subject": subject if kind == "firsthand" else None,
            "claim": "I have repaired a cracked canoe paddle blade." if kind == "firsthand" else None,
            "confirmation": confirmation}


class ModelDouble:
    """Tests gate control flow, not semantic correctness of a real model."""
    def __init__(self, support=0.95, error=None):
        self.support, self.error, self.calls = support, error, []

    def score(self, query, document, *, instruction=INSTRUCTION):
        self.calls.append((query, document, instruction))
        return {"uncalibrated_relevance_score": 0.99,
                "abstain_reason": None,
                "cache_hit": False, "elapsed_seconds": 0.0, "input_tokens": 1,
                "prompt_sha256": "test-double"}

    def check(self, claim, quotes):
        self.calls.append((claim, json.dumps(quotes), FIRSTHAND_METHOD))
        return {"support_score": self.support, "contradiction_score": 0.0, "abstain_reason": self.error}


def fixture(candidate_role="experienced", *, source="answer", mode="learn"):
    b = DatasetBuilder("firsthand-regression", 1)
    goal = "I need advice from someone who has actually repaired a canoe paddle's cracked blade."
    viewer = b.profile("paddle", "test", "learner",
                       [fact("paddle repair", "wants_to_try", "My canoe paddle blade is cracked; I have never repaired one.")],
                       goal, ["Canoe paddle repair"])
    detail = ("I repaired my cracked canoe paddle blade with a bonded patch and have paddled with it since."
              if candidate_role == "experienced" else "I bought a cracked paddle but have not attempted a repair.")
    candidate = b.profile("paddle", "test", "partner",
                          [fact("paddle repair", "interested", "I enjoy discussing canoe paddle repair."),
                           fact("paddle repair", candidate_role, detail, source)],
                          "I welcome questions about paddle repair.", ["Canoe paddle repair"])
    b.pair(viewer, candidate, mode, goal, None, "Synthetic gate test", "fresh_paddle")
    pair = b.bundle["training_pairs"][0]
    pair["context"]["evidence_requirement"] = requirement()
    return b.bundle, pair, viewer, candidate


def decision(bundle, pair, model=None, **options):
    model = model or ModelDouble()
    records, prompts = score_evidence_aware(SourceAwareBuilder(bundle, **options), [pair], model, evidence_model=model)
    return decide(records[0], IDENTITY, DEFAULT_POLICY), records[0], prompts, model


@pytest.mark.parametrize("role", ["interested", "wants_to_try", "learning", "can_share"])
def test_interest_and_willingness_never_satisfy_experience(role):
    bundle, pair, _, _ = fixture(role)
    result, _, prompts, model = decision(bundle, pair)
    assert result["decision"] == "insufficient_evidence"
    assert result["reason"] == "required_firsthand_experience_missing"
    assert result["score"] is None and not prompts and not model.calls


def test_known_newton_failures_are_blocked_without_using_labels():
    bundle, _, cases = generate()
    pairs = [p for p in bundle["training_pairs"]
             if cases[p["example_id"]]["case"] == "firsthand_evidence_missing"
             and cases[p["example_id"]]["split"] == "test"]
    assert len(pairs) == 3
    claims = {"v3_quilting_pair_0182": "I have joined fabric blocks with aligned corners.",
              "v3_astro_pair_0202": "I have taken sharp telescope pictures of the moon.",
              "v3_stopwatch_pair_0222": "I have recognized a last-layer cube pattern without pausing."}
    for p in pairs:
        p["context"]["evidence_requirement"] = requirement()
        p["context"]["evidence_requirement"]["claim"] = claims[p["example_id"]]
    model = ModelDouble(support=1.0)
    records, _ = score_evidence_aware(SourceAwareBuilder(bundle), pairs, model)
    assert not model.calls
    assert all(decide(r, IDENTITY, DEFAULT_POLICY)["decision"] == "insufficient_evidence" for r in records)
    # The guard consumes no label or rubric; even a mislabeled positive cannot bypass it.
    for p in pairs:
        p["label"]["relevant_connection"] = 1
        p["label"]["rubric"] = dict.fromkeys(p["label"]["rubric"], "yes")
    again, _ = score_evidence_aware(SourceAwareBuilder(bundle), pairs, ModelDouble())
    assert again == records


@pytest.mark.parametrize("contract, reason", [
    (None, "evidence_requirement_missing"),
    (requirement("unresolved"), "evidence_requirement_unresolved"),
    (requirement(confirmation="pending"), "evidence_requirement_unresolved"),
    (requirement("none", confirmation="pending"), "evidence_requirement_unresolved"),
])
def test_legacy_and_unconfirmed_requirements_fail_closed(contract, reason):
    bundle, pair, _, _ = fixture()
    if contract is None:
        del pair["context"]["evidence_requirement"]
    else:
        pair["context"]["evidence_requirement"] = contract
    result, _, _, model = decision(bundle, pair)
    assert result["reason"] == reason and not model.calls


@pytest.mark.parametrize("mode", ["find_activity_partner", "collaborate", "learn"])
def test_two_beginners_can_choose_to_learn_together(mode):
    bundle, pair, _, _ = fixture("wants_to_try", mode=mode)
    pair["context"].update(goal="Try repairing our paddles together; neither of us needs prior experience.",
                           evidence_requirement=requirement("none"))
    result, _, _, model = decision(bundle, pair)
    assert result["decision"] == "recommend"
    assert all(call[2] != FIRSTHAND_METHOD for call in model.calls)


def test_source_quotes_are_checked_without_ids_labels_or_goals_as_evidence():
    bundle, pair, _, candidate = fixture()
    pair["label"]["reason"] = "PRIVATE_LABEL_REASON"
    candidate["current_goal"] = "WILLINGNESS_IS_NOT_EXPERIENCE"
    candidate["open_to_discussing"] = ["SECRET_NOT_EVIDENCE"]
    result, _, _, model = decision(bundle, pair)
    assert result["decision"] == "recommend"
    query, document, instruction = model.calls[0]
    assert instruction == FIRSTHAND_METHOD
    assert query == pair["context"]["evidence_requirement"]["claim"]
    assert json.loads(document) == [candidate["facts"][1]["details"]]
    for secret in [pair["example_id"], candidate["user_id"], "PRIVATE_LABEL_REASON", "WILLINGNESS_IS_NOT_EXPERIENCE", "SECRET_NOT_EVIDENCE"]:
        assert secret not in query + document


@pytest.mark.parametrize("support, error", [(None, None), (float("nan"), None), (float("inf"), None),
                                          (-1, None), (1.1, None), (0.99, "input_exceeds_token_limit")])
def test_failed_or_invalid_evidence_check_cannot_be_bypassed(support, error):
    bundle, pair, _, _ = fixture()
    result, _, _, model = decision(bundle, pair, ModelDouble(support, error))
    assert result["reason"] == "firsthand_evidence_unavailable"
    assert len(model.calls) == 1 and result["score"] is None


def test_unrelated_experience_needs_specific_support_not_just_experienced_role():
    bundle, pair, _, candidate = fixture()
    candidate["facts"][1]["topic"] = "bread baking"
    candidate["facts"][1]["details"] = "I baked a loaf of bread."
    candidate["facts"][1]["evidence"][0]["support"] = "I baked a loaf of bread."
    candidate["onboarding_answers"][1]["answer_text"] = "I baked a loaf of bread."
    result, _, _, model = decision(bundle, pair, ModelDouble(0.1))
    assert result["reason"] == "required_firsthand_experience_unsupported"
    assert len(model.calls) == 1
    assert "bread" in model.calls[0][1] and "paddle" in model.calls[0][0]


@pytest.mark.parametrize("source", ["answer", "post"])
def test_confirmed_onboarding_or_owned_post_experience_is_eligible(source):
    bundle, pair, _, _ = fixture(source=source)
    result, record, _, _ = decision(bundle, pair)
    assert result["decision"] == "recommend" and "firsthand_candidate" in record["firsthand_checks"]
    if source == "post":
        result, _, _, model = decision(bundle, pair, include_social=False)
        assert result["reason"] == "required_firsthand_experience_missing" and not model.calls


@pytest.mark.parametrize("confirmation, allowed", [("pending", False), ("rejected", False), ("confirmed", False)])
def test_unapproved_experience_cannot_unlock_match(confirmation, allowed):
    bundle, pair, _, candidate = fixture(source="post")
    candidate["facts"][1].update(confirmation=confirmation, matching_allowed=allowed, sharing_scope="matching_only")
    result, _, _, model = decision(bundle, pair)
    assert result["reason"] == "required_firsthand_experience_missing" and not model.calls


def test_share_checks_the_offering_viewer_not_the_beginner_candidate():
    bundle, pair, viewer, candidate = fixture()
    pair["viewer_profile_version_id"], pair["candidate_profile_version_id"] = candidate["profile_version_id"], viewer["profile_version_id"]
    pair["context"].update(mode="share", goal="Offer my firsthand experience repairing a cracked canoe paddle.",
                           evidence_requirement=requirement(subject="viewer"))
    result, record, _, _ = decision(bundle, pair)
    assert result["decision"] == "recommend" and set(record["firsthand_checks"]) == {"firsthand_viewer"}
    pair["context"]["evidence_requirement"]["subject"] = "candidate"
    result, _, _, model = decision(bundle, pair)
    assert result["reason"] == "experience_direction_conflict" and not model.calls


def test_both_subjects_requires_both_to_have_experience():
    bundle, pair, _, _ = fixture()
    pair["context"].update(mode="exchange_stories", evidence_requirement=requirement(subject="both"))
    result, _, _, model = decision(bundle, pair)
    assert result["reason"] == "required_firsthand_experience_missing" and not model.calls


def test_request_requirement_cannot_change_by_candidate():
    bundle, pair, _, _ = fixture()
    other = copy.deepcopy(pair)
    other["example_id"] = "different_candidate"
    other["candidate_profile_version_id"] = "another_profile"
    other["context"]["evidence_requirement"] = requirement("none")
    candidate = copy.deepcopy(bundle["profiles"][1])
    candidate.update(profile_version_id="another_profile", user_id="another_user")
    bundle["profiles"].append(candidate)
    bundle["training_pairs"].append(other)
    with pytest.raises(ValueError, match="must not change with the candidate"):
        score_evidence_aware(SourceAwareBuilder(bundle), [pair, other], ModelDouble())


@pytest.mark.parametrize("bad", [requirement(subject=None), requirement("none", confirmation="invalid"),
                                {**requirement(), "version": 2}, {**requirement(), "extra": True}])
def test_invalid_contract_fails_schema_validation(bad):
    bundle, pair, _, _ = fixture()
    pair["context"]["evidence_requirement"] = bad
    with pytest.raises(ValidationError):
        validate_bundle(bundle)


def test_real_data_and_foreign_pairs_still_fail():
    bundle, pair, _, _ = fixture()
    with pytest.raises(ValueError, match="validated bundle"):
        evidence_plan(SourceAwareBuilder(bundle), {**pair, "example_id": "foreign"})
    bundle["training_basis"] = "mixed_authorized"
    with pytest.raises(ValueError, match="consent"):
        SourceAwareBuilder(bundle)


def test_shared_entry_point_enforces_guard_with_saved_calibration():
    bundle, _, _, _ = fixture("wants_to_try")
    selected = {"recommended_variant": "source_aware_tuned", "policy": DEFAULT_POLICY,
                "calibration": {"kind": "synthetic_platt", "slope": 1.5246867756684104,
                                "intercept": -1.372945394772712}}
    result = score_bundle(bundle, ModelDouble(support=1), selected)
    assert result["decisions"][0]["score"] is None
    assert result["decisions"][0]["decision"] == "insufficient_evidence"
    assert result["decisions"][0]["research_only"] is True
    assert FIRSTHAND_THRESHOLD == 0.8


def test_missing_verifier_fails_closed_without_relevance_calls():
    bundle, pair, _, _ = fixture()
    model = ModelDouble()
    rows, _ = score_evidence_aware(SourceAwareBuilder(bundle), [pair], model)
    assert rows[0]["abstain_reason"] == "firsthand_verifier_unavailable"
    assert not model.calls


def test_conflicting_quotes_cannot_be_rescued_by_another_supported_quote():
    bundle, pair, _, _ = fixture()

    class Conflicted:
        def check(self, claim, quotes):
            return {"support_score": 0.99, "contradiction_score": 0.99, "abstain_reason": None}

    model = ModelDouble()
    rows, _ = score_evidence_aware(SourceAwareBuilder(bundle), [pair], model, evidence_model=Conflicted())
    assert rows[0]["abstain_reason"] == "firsthand_evidence_conflicting"
    assert not model.calls


def test_contract_does_not_change_relevance_inputs():
    bundle, pair, _, _ = fixture()
    with_contract = SourceAwareBuilder(bundle).build(pair)
    del pair["context"]["evidence_requirement"]
    assert SourceAwareBuilder(bundle).build(pair) == with_contract


def test_bad_evidence_scores_can_be_serialized_safely():
    bundle, pair, _, _ = fixture()
    _, record, _, _ = decision(bundle, pair, ModelDouble(float("nan")))
    json.dumps(record, allow_nan=False)


def test_normalized_detail_is_not_used_as_source_proof():
    bundle, pair, _, candidate = fixture()
    candidate["facts"][1]["details"] = "SECRET_UNSUPPORTED_NORMALIZATION"
    _, tasks = evidence_plan(SourceAwareBuilder(bundle), pair)
    assert tasks[0]["claims"][0]["approved_details"] == "SECRET_UNSUPPORTED_NORMALIZATION"
    assert "SECRET_UNSUPPORTED_NORMALIZATION" not in json.dumps(tasks[0]["claims"][0]["sources"])


@pytest.mark.parametrize("source", ["answer", "post"])
def test_excerpt_cannot_strip_third_party_attribution(source):
    bundle, pair, _, candidate = fixture(source=source)
    quote = candidate["facts"][1]["evidence"][0]["support"]
    full = 'My friend said: "' + quote + '". I have never repaired a paddle myself.'
    if source == "answer":
        candidate["onboarding_answers"][1]["answer_text"] = full
    else:
        bundle["posts"][0]["caption"] = full
    _, tasks = evidence_plan(SourceAwareBuilder(bundle), pair)
    assert tasks[0]["claims"][0]["sources"] == [full]


def test_unrelated_experience_does_not_veto_a_supported_experience():
    bundle, pair, _, candidate = fixture()
    other = copy.deepcopy(candidate["facts"][1])
    other.update(fact_id="bread", topic="baking", details="I baked bread.")
    other["evidence"][0].update(reference_id="bread_answer", support="I baked bread.")
    candidate["facts"].insert(0, other)
    answer = copy.deepcopy(candidate["onboarding_answers"][1])
    answer.update(answer_id="bread_answer", answer_text="I baked bread.")
    candidate["onboarding_answers"].append(answer)

    class TwoClaims:
        def check(self, claim, quotes):
            unrelated = quotes == ["I baked bread."]
            return {"support_score": 0.01 if unrelated else 0.99,
                    "contradiction_score": 0.99 if unrelated else 0.01, "abstain_reason": None}

    rows, _ = score_evidence_aware(SourceAwareBuilder(bundle), [pair], ModelDouble(), evidence_model=TwoClaims())
    assert decide(rows[0], IDENTITY, DEFAULT_POLICY)["decision"] == "recommend"


def test_unapproved_content_in_long_source_does_not_expand_approved_fact():
    bundle, pair, _, candidate = fixture()
    fact = candidate["facts"][1]
    fact["topic"], fact["details"] = "baking", "I baked bread."
    fact["evidence"][0]["support"] = "I baked bread."
    candidate["onboarding_answers"][1]["answer_text"] = "I baked bread. I also repaired a canoe paddle blade."

    class ScopeCheck:
        def check(self, claim, quotes):
            assert quotes == ["I baked bread."]  # Do not reach the unrelated source text.
            return {"support_score": 0.01, "contradiction_score": 0.01, "abstain_reason": None}

    ranker = ModelDouble()
    records, _ = score_evidence_aware(SourceAwareBuilder(bundle), [pair], ranker, evidence_model=ScopeCheck())
    assert records[0]["abstain_reason"] == "required_firsthand_experience_unsupported"
    assert not ranker.calls


def test_correct_normalized_claim_cannot_override_contradicting_source():
    bundle, pair, _, candidate = fixture()
    text = "I want to repair my canoe paddle but I have not attempted it."
    candidate["facts"][1]["evidence"][0]["support"] = text
    candidate["onboarding_answers"][1]["answer_text"] = text

    class SourceCheck:
        def check(self, claim, quotes):
            contradicted = quotes == [text]
            return {"support_score": 0.01 if contradicted else 0.99,
                    "contradiction_score": 0.99 if contradicted else 0.01, "abstain_reason": None}

    ranker = ModelDouble()
    records, _ = score_evidence_aware(SourceAwareBuilder(bundle), [pair], ranker, evidence_model=SourceCheck())
    assert records[0]["abstain_reason"] == "firsthand_evidence_conflicting"
    assert not ranker.calls


def test_cli_writes_versioned_audit_and_refuses_overwrite(tmp_path, monkeypatch):
    from ml import matching_v4
    from ml.matching_v3 import FORMAT_ENCODER_REVISION
    from ml.reranker import MODEL_REVISIONS
    from ml.validation import read_json, write_json

    bundle, _, _, _ = fixture()
    dataset, policy, out = tmp_path / "data.json", tmp_path / "policy", tmp_path / "out"
    policy.mkdir()
    write_json(dataset, bundle)
    write_json(policy / "selected_policy.json", {"recommended_variant": "source_aware_tuned",
               "calibration": IDENTITY, "policy": DEFAULT_POLICY})
    write_json(policy / "status.json", {"state": "completed"})
    write_json(policy / "protocol.json", {"model": {"id": "Qwen/Qwen3-Reranker-4B",
               "revision": MODEL_REVISIONS["Qwen/Qwen3-Reranker-4B"]},
               "format_encoder": {"revision": FORMAT_ENCODER_REVISION}})

    class Engine(ModelDouble):
        def metadata(self):
            return {"id": "test-double-not-a-real-checkpoint"}

    monkeypatch.setattr(matching_v4, "EvidenceVerifier", lambda **kw: Engine())
    monkeypatch.setattr(matching_v4, "TextEncoder", lambda **kw: Engine())
    monkeypatch.setattr(matching_v4, "QwenReranker", lambda **kw: Engine())
    monkeypatch.setattr("sys.argv", ["matching_v4", "--dataset", str(dataset),
                                    "--policy-dir", str(policy), "--out", str(out)])
    matching_v4.main()
    assert read_json(out / "decisions.json")[0]["decision"] == "recommend"
    audit = read_json(out / "protocol.json")
    assert audit["evidence_policy"] == matching_v4.POLICY_VERSION
    assert audit["ready_for_live_profiles"] is False
    assert len(audit["dataset_sha256"]) == 64 and "evidence.py" in audit["source_sha256"]
    with pytest.raises(ValueError, match="Output already exists"):
        matching_v4.main()


def test_cli_requires_explicit_contract_before_loading_models(tmp_path, monkeypatch):
    from ml import matching_v4
    from ml.validation import write_json

    bundle, pair, _, _ = fixture()
    del pair["context"]["evidence_requirement"]
    dataset = tmp_path / "data.json"
    write_json(dataset, bundle)
    monkeypatch.setattr("sys.argv", ["matching_v4", "--dataset", str(dataset),
                                    "--policy-dir", str(tmp_path / "nonexistent"), "--out", str(tmp_path / "out")])
    with pytest.raises(ValueError, match="explicit evidence_requirement"):
        matching_v4.main()

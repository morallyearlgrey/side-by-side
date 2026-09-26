from types import SimpleNamespace

import pytest
import torch

from ml.evidence import EvidenceVerifier


def fake_verifier(logits=None, tokens=10):
    verifier = EvidenceVerifier.__new__(EvidenceVerifier)
    verifier.device, verifier.max_tokens, verifier.max_quotes = "cpu", 512, 16
    verifier.cache = {}
    seen = []

    def tokenize(premise, hypothesis, **kwargs):
        seen.append((premise, hypothesis, kwargs))
        return {"input_ids": torch.ones((1, tokens), dtype=torch.long)}

    def model(**kwargs):
        return SimpleNamespace(logits=torch.tensor([[8.0, -2.0, -5.0]] if logits is None else logits))

    verifier.tokenizer, verifier.model = tokenize, model
    return verifier, seen


def test_premise_is_source_quote_and_hypothesis_is_requested_claim():
    verifier, calls = fake_verifier()
    result = verifier.check("I have repaired a paddle.", ["I repaired my canoe paddle last month."])
    assert calls[0][:2] == ("I repaired my canoe paddle last month.", "I have repaired a paddle.")
    assert calls[0][2]["truncation"] is False
    assert result["support_score"] > 0.99 and result["contradiction_score"] < 0.01
    assert result["abstain_reason"] is None
    assert verifier.check("I have repaired a paddle.", ["I repaired my canoe paddle last month."])["cache_hit"]
    assert len(calls) == 1
    verifier.check("I have built a boat.", ["I repaired my canoe paddle last month."])
    assert len(calls) == 2


@pytest.mark.parametrize("logits", [[[0.0, 0.0, float("nan")]], [[1.0, 2.0]], [[float("inf"), 0.0, 0.0]]])
def test_invalid_logits_abstain(logits):
    verifier, _ = fake_verifier(logits)
    result = verifier.check("claim", ["quote"])
    assert result["abstain_reason"] == "invalid_evidence_logits" and result["support_score"] is None


def test_neutral_and_contradictory_evidence_are_not_entailment():
    for logits, winner in [([[0.0, 8.0, -5.0]], "neutral"), ([[0.0, -5.0, 8.0]], "contradiction")]:
        verifier, _ = fake_verifier(logits)
        result = verifier.check("claim", ["quote"])
        assert result["quote_scores"][0][winner] > 0.99
        assert result["support_score"] < 0.01


def test_long_text_and_quote_overflow_fail_closed_without_truncation():
    verifier, calls = fake_verifier(tokens=513)
    assert verifier.check("claim", ["quote"])["abstain_reason"] == "evidence_exceeds_token_limit"
    verifier, calls = fake_verifier()
    assert verifier.check("claim", [str(i) for i in range(17)])["abstain_reason"] == "evidence_quote_limit"
    assert not calls
    assert verifier.check("claim", [])["support_score"] is None


def test_empty_claims_and_quotes_are_rejected():
    verifier, _ = fake_verifier()
    for claim, quotes in [(" ", ["q"]), ("claim", [" "]), ("claim", [None]), ("claim", "q")]:
        with pytest.raises(ValueError):
            verifier.check(claim, quotes)

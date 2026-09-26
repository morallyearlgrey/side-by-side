"""Opt-in, offline checkpoint regressions; these are development cases, not a benchmark."""

import os

import pytest
import torch

from ml.evidence import EvidenceVerifier
from ml.matching_v4 import evidence_failure

pytestmark = pytest.mark.skipif(os.environ.get("SIDEBYSIDE_EVIDENCE_MODEL_TESTS") != "1",
                               reason="Opt-in real-model tests require the explicitly staged evidence checkpoint")


@pytest.fixture(scope="module")
def verifier():
    before = torch.get_num_threads()
    torch.set_num_threads(2)
    try:
        yield EvidenceVerifier(device="cpu")
    finally:
        torch.set_num_threads(before)


@pytest.mark.parametrize("claim, source, supported", [
    ("I have repaired a cracked canoe paddle blade.",
     "I repaired my cracked canoe paddle blade with a bonded patch and have paddled with it since.", True),
    ("I have repaired a cracked canoe paddle blade.",
     "A split ran along the blade of my canoe paddle. I patched the split and paddled again after the repair.", True),
    ("I have grown tomatoes in containers.",
     "Last summer I grew tomato plants in pots on my balcony and picked ripe fruit from them.", True),
    ("I have replaced brake pads on a bicycle.",
     "I changed the worn rim-brake pads on my bike and tested the brakes on a short ride.", True),
    ("I have attempted to root plant cuttings in water.",
     "I tried rooting cuttings in water, but they rotted before forming roots.", True),
    ("I have successfully rooted plant cuttings in water.",
     "I tried rooting cuttings in water, but they rotted before forming roots.", False),
    ("I have replaced brake pads on a bicycle.",
     "Next month I plan to replace my bicycle brake pads. I have not attempted it yet.", False),
    ("I have repaired a cracked canoe paddle blade.",
     'My friend said: "I repaired my cracked canoe paddle blade." I have never repaired a paddle myself.', False),
    ("I have repaired a cracked canoe paddle blade.",
     "I baked a loaf of sourdough bread and served it to my friends.", False),
    ("I have repaired a cracked canoe paddle blade.",
     "I hope to repair a cracked canoe paddle blade one day. I have not attempted it.", False),
    ("I have repaired a cracked canoe paddle blade.", "I have never repaired a canoe paddle blade.", False),
    ("I have repaired a cracked canoe paddle blade.",
     "I repaired my cracked paddle blade with a bonded patch and have paddled with it since.", False),
])
def test_pinned_checkpoint_support_and_scope(verifier, claim, source, supported):
    assert (evidence_failure(verifier.check(claim, [source])) is None) == supported

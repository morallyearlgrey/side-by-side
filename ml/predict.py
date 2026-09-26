"""Offline research scoring. This is not a consent or production eligibility API."""

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from .features import (ENCODER_ID, FEATURE_VERSION, FeatureBuilder, TextEncoder,
                       eligibility_reason, feature_names)
from .model import Matcher, predict_scores
from .validation import read_json, require, validate_bundle


def score_pairs(bundle, model_dir, *, device="cpu", encoder=None):
    validate_bundle(bundle)
    model_dir = Path(model_dir)
    config = read_json(model_dir / "config.json")
    require(config["feature_version"] == FEATURE_VERSION and config["feature_names"] == feature_names(),
            "Checkpoint feature contract does not match this code")
    require(config["input_dim"] == len(feature_names()), "Checkpoint feature dimension mismatch")
    if encoder is None:
        require(config["encoder"]["id"] == ENCODER_ID, "Unsupported encoder")
        encoder = TextEncoder(device=device, revision=config["encoder"]["revision"])
    require(encoder.metadata() == config["encoder"], "Scoring encoder differs from training encoder")
    state = torch.load(model_dir / "matcher.pt", map_location="cpu", weights_only=True)
    mean, scale = state["mean"].numpy(), state["scale"].numpy()
    require(mean.shape == scale.shape == (len(feature_names()),), "Invalid normalization shape")
    require(np.isfinite(mean).all() and np.isfinite(scale).all() and (scale > 0).all(), "Invalid normalization")
    model = Matcher(len(feature_names())).to(device)
    model.load_state_dict(state["state_dict"], strict=True)
    builder = FeatureBuilder(bundle, encoder, mode=config["mode"], top_k=config["top_k"])
    builder.warm(bundle["training_pairs"])
    result = []
    for pair in bundle["training_pairs"]:
        viewer = builder.profiles[pair["viewer_profile_version_id"]]
        candidate = builder.profiles[pair["candidate_profile_version_id"]]
        gate = eligibility_reason(viewer, candidate, config["mode"])
        score = None
        if gate is None:
            features = (builder.build(pair) - mean) / scale
            score = float(predict_scores(model, features[None, :], device)[0])
        result.append({"example_id": pair["example_id"], "uncalibrated_relevance_score": score,
                       "abstain_reason": gate, "research_only": True, "requires_mutual_consent": True,
                       "production_eligibility_checked": False})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    args = parser.parse_args()
    print(json.dumps(score_pairs(read_json(args.dataset), args.model_dir, device=args.device), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()

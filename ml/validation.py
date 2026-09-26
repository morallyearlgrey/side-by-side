"""Structural and cross-record validation for the existing v2 contract."""

import argparse
import json
import re
from datetime import datetime
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "data/schemas/matching-dataset-v2.schema.json"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def timestamp(value):
    require(isinstance(value, str) and re.fullmatch(
        r"\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})", value
    ), f"Invalid timezone-aware timestamp: {value!r}")
    return datetime.fromisoformat(value.upper().replace("Z", "+00:00"))


FORMATS = FormatChecker()


@FORMATS.checks("date-time", raises=(ValueError, TypeError))
def is_timestamp(value):
    if not isinstance(value, str):
        return True
    timestamp(value)
    return True


def index_unique(records, key):
    result = {}
    for record in records:
        require(record[key] not in result, f"Duplicate {key}: {record[key]}")
        result[record[key]] = record
    return result


def read_json(path):
    with Path(path).open() as stream:
        return json.load(stream)


def write_json(path, value):
    with Path(path).open("x") as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write("\n")


def validate_bundle(bundle):
    Draft202012Validator(read_json(SCHEMA), format_checker=FORMATS).validate(bundle)
    # This prototype has no consent-receipt or revocation service. Fail closed.
    require(bundle["training_basis"] == "synthetic_only",
            "Only synthetic data is supported until training-consent verification exists.")
    for collection in ("profiles", "posts", "feedback", "training_pairs"):
        require(all(row["data_origin"] == "synthetic" for row in bundle[collection]),
                f"Non-synthetic record in {collection}")

    profiles = index_unique(bundle["profiles"], "profile_version_id")
    posts = index_unique(bundle["posts"], "post_id")
    feedback = index_unique(bundle["feedback"], "feedback_id")
    index_unique(bundle["training_pairs"], "example_id")
    versions = {}
    for profile in profiles.values():
        key = (profile["user_id"], timestamp(profile["valid_from"]))
        require(key not in versions, "Ambiguous simultaneous profile versions")
        versions[key] = profile["profile_version_id"]
    owners = {p["user_id"] for p in profiles.values()}
    for post in posts.values():
        require(post["owner_user_id"] in owners, "Post owner has no profile")
        require(timestamp(post["posted_at"]) <= timestamp(post["available_at"]),
                "Post available before it was posted")

    for profile in profiles.values():
        valid = timestamp(profile["valid_from"])
        answers = index_unique(profile["onboarding_answers"], "answer_id")
        index_unique(profile["facts"], "fact_id")
        for answer in answers.values():
            require(timestamp(answer["answered_at"]) <= valid, "Answer postdates profile snapshot")
        for fact in profile["facts"]:
            for evidence in fact["evidence"]:
                ref = evidence["reference_id"]
                if evidence["source_type"] == "onboarding_answer":
                    require(ref in answers, "Evidence must reference this profile's own answer")
                    source = answers[ref]["answer_text"]
                else:
                    require(ref in posts, "Unknown evidence post")
                    post = posts[ref]
                    require(post["owner_user_id"] == profile["user_id"], "Evidence post owner mismatch")
                    require(timestamp(post["available_at"]) <= valid, "Post postdates profile snapshot")
                    require(evidence["channel"] == "caption",
                            "Image evidence requires a review workflow not implemented in this trainer")
                    source = post["caption"]
                require(evidence["support"].strip() and evidence["support"] in source,
                        "Evidence support must be an exact nonempty source excerpt")
            if fact["relationship"] == "can_share":
                require(any(e["source_type"] == "onboarding_answer" for e in fact["evidence"]),
                        "can_share requires explicit onboarding evidence, not just a post")

    def endpoints(record, at):
        ids = [record["viewer_profile_version_id"], record["candidate_profile_version_id"]]
        require(all(key in profiles for key in ids), "Unknown profile reference")
        viewer, candidate = [profiles[key] for key in ids]
        require(viewer["user_id"] != candidate["user_id"], "Self-pair is not valid")
        for profile in (viewer, candidate):
            valid = timestamp(profile["valid_from"])
            require(valid <= at, "Profile postdates prediction or feedback")
            require(not any(user == profile["user_id"] and valid < time <= at
                            for user, time in versions), "Stale profile snapshot at event time")
        return viewer, candidate

    for row in feedback.values():
        endpoints(row, timestamp(row["observed_at"]))
    pair_keys = set()
    for pair in bundle["training_pairs"]:
        at = timestamp(pair["as_of"])
        viewer, _ = endpoints(pair, at)
        key = (pair["viewer_profile_version_id"], pair["candidate_profile_version_id"],
               at, pair["context"]["mode"], pair["context"]["goal"])
        require(key not in pair_keys, "Duplicate directional prediction opportunity")
        pair_keys.add(key)
        for ref in pair["prior_feedback_ids"]:
            require(ref in feedback, "Unknown feedback reference")
            history = feedback[ref]
            require(profiles[history["viewer_profile_version_id"]]["user_id"] == viewer["user_id"],
                    "History belongs to another viewer")
            require(timestamp(history["observed_at"]) < at, "Feedback must precede prediction")
    return bundle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    args = parser.parse_args()
    bundle = validate_bundle(read_json(args.dataset))
    print(json.dumps({"valid": True, **{key: len(bundle[key]) for key in
          ("profiles", "posts", "feedback", "training_pairs")}}, indent=2))


if __name__ == "__main__":
    main()

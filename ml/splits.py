"""Explicit person/scenario-family splits; never randomly split pair rows."""

from .validation import require

SPLITS = ("train", "validation", "test")


def partition_pairs(bundle, manifest):
    require(manifest.get("version") == 1, "Unsupported split manifest")
    require(manifest.get("dataset_id") == bundle["dataset_id"], "Split dataset_id mismatch")
    profiles = {p["profile_version_id"]: p for p in bundle["profiles"]}
    feedback = {h["feedback_id"]: h for h in bundle["feedback"]}
    user_groups = manifest["user_groups"]
    groups = manifest["group_splits"]
    require(set(user_groups) == {p["user_id"] for p in profiles.values()},
            "Every user must have exactly one group assignment")
    require(set(groups) == set(user_groups.values()), "Missing or unused scenario-family group")
    require(all(split in SPLITS for split in groups.values()), "Unknown split name")
    result = {split: [] for split in SPLITS}
    for pair in bundle["training_pairs"]:
        refs = [pair["viewer_profile_version_id"], pair["candidate_profile_version_id"]]
        for key in pair["prior_feedback_ids"]:
            history = feedback[key]
            refs.extend([history["viewer_profile_version_id"], history["candidate_profile_version_id"]])
        assigned = {groups[user_groups[profiles[ref]["user_id"]]] for ref in refs}
        require(len(assigned) == 1, "Pair/history crosses train/validation/test boundary")
        result[assigned.pop()].append(pair)
    return result

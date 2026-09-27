"""App display cutoff for scored matches; model decisions remain unchanged."""

import math

MIN_SUGGESTION_SCORE = 0.15


def suggestible_score(score):
    """Show a scored pair only when the model's evidence checks passed.

    A below-threshold model result can still be an app suggestion. Explicit
    format conflicts, abstentions, unavailable results, and invalid scores
    never qualify.
    """
    if not score:
        return False
    value = score.get("final_score")
    if type(value) not in (int, float) or not math.isfinite(value) or not MIN_SUGGESTION_SCORE <= value <= 1:
        return False
    return score.get("status") == "recommend" or (
        score.get("status") == "not_recommended" and score.get("reason") == "below_threshold"
    )

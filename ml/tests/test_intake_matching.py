import copy
import json
from uuid import uuid4

import unittest

from ml.intake_matching import CONSENT_VERSION, review_record, score_intake_batch


def stored_row(name, goal):
    receipt = str(uuid4())
    return {
        "receipt_id": receipt,
        "created_at": "2026-09-26T10:00:00Z",
        "payload": {
            "version": "hackgt-intake-v1",
            "consent_version": CONSENT_VERSION,
            "consent": True,
            "data_origin": "real_opt_in",
            "training_allowed": False,
            "public_sharing_allowed": False,
            "answers": {
                "display_name": name,
                "interests": "I like urban sketching and documenting old train stations.",
                "experience": "I made a travel journal during a regional train trip in Italy.",
                "current_goal": goal if len(goal) >= 40 else f"{goal} I want to discuss this specific subject in depth.",
                "open_topics": "Sketchbooks, train travel, and choosing places to draw.",
                "boundaries": "No sales pitches.",
                "experience_preference": "either",
            },
        },
    }


class FakeModel:
    def __init__(self, scores):
        self.scores = scores
        self.prompts = []

    def score(self, query, document, *, instruction):
        request = json.loads(query)
        goal = request["requested_conversation"]["current_goal"].split()[0]
        self.prompts.append((query, document, instruction))
        score = self.scores[goal]
        return {"uncalibrated_relevance_score": score, "abstain_reason": None,
                "prompt_sha256": "a" * 64}


class IntakeMatchingTests(unittest.TestCase):
    def test_adapter_preserves_exact_answer_sources_and_rejects_old_consent(self):
        row = stored_row("Real name excluded from model input", "I want to learn urban sketching.")
        adapted = review_record(row)
        experience = next(a for a in adapted["answers"] if a["question_key"] == "experience_preference")
        self.assertEqual(experience["answer_id"], f"{row['receipt_id']}:experience_preference")
        self.assertEqual(experience["answer_text"], "either")
        self.assertEqual(adapted["display_name"], "Real name excluded from model input")
        row["payload"]["consent_version"] = "private-pilot-v1"
        with self.assertRaisesRegex(ValueError, "consent_not_eligible"):
            review_record(row)

    def test_pair_score_uses_weaker_direction_and_keeps_answer_provenance_without_names(self):
        rows = [
            review_record(stored_row("Secret Person A", "goal-a")),
            review_record(stored_row("Secret Person B", "goal-b")),
        ]
        fake = FakeModel({"goal-a": 0.91, "goal-b": 0.62})
        result = score_intake_batch(rows, fake)
        self.assertEqual(result["pairs"][0]["pair_score"], 0.62)
        self.assertEqual(result["pairs"][0]["directional_scores"], {
            f"{rows[0]['participant_id']}:{rows[1]['participant_id']}": 0.91,
            f"{rows[1]['participant_id']}:{rows[0]['participant_id']}": 0.62,
        })
        self.assertEqual(len(fake.prompts), 2)
        self.assertNotIn("Secret Person", " ".join(q + d for q, d, _ in fake.prompts))
        self.assertEqual(len(result["pairs"][0]["input_answer_ids"][
            f"{rows[0]['participant_id']}:{rows[1]['participant_id']}"]), 6)
        self.assertFalse(result["training_performed"])

    def test_invalid_source_ids_and_model_abstention_do_not_create_fake_rankings(self):
        records = [review_record(stored_row("A", "goal-a")), review_record(stored_row("B", "goal-b"))]
        altered = copy.deepcopy(records[0])
        altered["answers"][0]["answer_id"] = "some-other-source"
        with self.assertRaisesRegex(ValueError, "invalid_answer_provenance"):
            score_intake_batch([altered, records[1]], FakeModel({"goal-a": 0.9, "goal-b": 0.8}))

        class AbstainingModel:
            def score(self, *_args, **_kwargs):
                return {"uncalibrated_relevance_score": None, "abstain_reason": "input_exceeds_token_limit"}

        result = score_intake_batch(records, AbstainingModel())
        self.assertEqual(result["pairs"], [])
        self.assertEqual(result["abstentions"][0]["reason"], "inference_unavailable")

    def test_batch_limits_and_duplicate_people_fail_closed(self):
        records = [review_record(stored_row(str(i), f"goal-{i}")) for i in range(21)]
        with self.assertRaisesRegex(ValueError, "participant_count_out_of_range"):
            score_intake_batch(records, FakeModel({}))
        with self.assertRaisesRegex(ValueError, "duplicate_participant"):
            score_intake_batch([records[0], records[0]], FakeModel({}))


if __name__ == "__main__":
    unittest.main()

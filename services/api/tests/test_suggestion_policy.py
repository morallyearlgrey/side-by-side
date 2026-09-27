"""The app display rule must not rewrite model outcomes or bypass abstentions."""

import httpx
import pytest
from pydantic import SecretStr
from sidebyside_api.config import Settings
from sidebyside_api.main import create_app
from sidebyside_api.matching_policy import load_policy
from sidebyside_api.suggestion_policy import MIN_SUGGESTION_SCORE, suggestible_score


def test_display_cutoff_is_separate_from_frozen_model_policy():
    assert MIN_SUGGESTION_SCORE == 0.0
    assert load_policy()["policy"]["decision_threshold"] == 0.5


async def test_health_exposes_app_cutoff_without_changing_model_policy():
    app = create_app(Settings(_env_file=None, supabase_url="", supabase_service_role_key=SecretStr(""), worker_enabled=False))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["matching"]["suggestion_display_threshold"] == 0.0


@pytest.mark.parametrize(('status', 'reason', 'value', 'expected'), [
    ('recommend', 'above_threshold', 0.9, True),
    ('recommend', 'above_threshold', 0.0, True),
    ('not_recommended', 'below_threshold', 0.0, True),
    ('not_recommended', 'below_threshold', 0.15, True),
    ('not_recommended', 'below_threshold', 0.149, True),
    ('not_recommended', 'below_threshold', -0.001, False),
    ('not_recommended', 'below_threshold', 1.001, False),
    ('not_recommended', 'unknown_reason', 0.9, False),
    ('not_recommended', 'supported_format_conflict', 0.9, False),
    ('insufficient_evidence', 'insufficient_approved_facts', 0.9, False),
    ('unavailable', 'component_unavailable', 0.9, False),
    ('recommend', 'above_threshold', float('nan'), False),
    ('recommend', 'above_threshold', float('inf'), False),
    ('recommend', 'above_threshold', True, False),
    ('recommend', 'above_threshold', '0', False),
    ('recommend', 'above_threshold', None, False),
])
def test_scored_suggestions_respect_cutoff_and_evidence(status, reason, value, expected):
    assert suggestible_score({'status': status, 'reason': reason, 'final_score': value}) is expected

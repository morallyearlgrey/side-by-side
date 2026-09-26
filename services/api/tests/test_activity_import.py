"""The catalog import rejects duplicates and stale or invented schedules before SQL."""
import importlib.util
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "activity_import", Path(__file__).resolve().parents[3] / "scripts/import_activity_catalog.py",
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def catalog(tmp_path):
    checked = datetime.now(UTC) - timedelta(hours=1)
    record = {
        "id": "sample", "kind": "evergreen", "title": "Walk together", "summary": "Choose a comfortable walking pace.",
        "venue": "Example park", "area": "Atlanta", "tags": ["walking"], "cost": "free",
        "cost_note": "No admission fee; transport extra.", "eligibility": "public", "eligibility_note": "Check park notices.",
        "duration_minutes": 30, "indoor": False, "source_url": "https://example.org/park", "source_name": "Example park",
        "source_checked_at": checked.isoformat(), "review_after": (checked + timedelta(days=30)).isoformat(),
        "starts_at": None, "ends_at": None, "status": "active",
    }
    rows = [{**record, "id": f"activity-{i}", "title": f"Walk {i}"} for i in range(100)]
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(rows))
    return path, rows


def test_valid_reviewed_catalog(tmp_path):
    path, _ = catalog(tmp_path)
    assert len(module.validate(path)) == 100


@pytest.mark.parametrize("change", [
    lambda rows: rows.pop(),
    lambda rows: rows[1].update(id=rows[0]["id"]),
    lambda rows: rows[1].update(title=rows[0]["title"]),
    lambda rows: rows[0].update(review_after="2020-01-01T00:00:00Z"),
    lambda rows: rows[0].update(source_url="http://example.org/park"),
    lambda rows: rows[0].update(source_url="https://secret@example.org/park"),
    lambda rows: rows[0].update(kind="event"),
    lambda rows: rows[0].update(starts_at="2030-01-01T00:00:00Z"),
])
def test_rejects_unpublishable_catalog(tmp_path, change):
    path, rows = catalog(tmp_path)
    change(rows)
    path.write_text(json.dumps(rows))
    with pytest.raises(ValueError):
        module.validate(path)


def test_source_quotes_remain_literal_sql(tmp_path):
    _, rows = catalog(tmp_path)
    rows[0]["summary"] = "Meet at the park's entrance; don't run."
    sql = module.build_sql(rows, apply=False)
    assert "park''s entrance; don''t run." in sql
    assert sql.rstrip().endswith("rollback;")
    assert "delete from" not in sql.lower()

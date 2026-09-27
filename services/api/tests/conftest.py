import copy
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sidebyside_api.errors import AppError
from sidebyside_api.onboarding import OPENING


def iso(delta=0):
    return (datetime.now(UTC) + timedelta(seconds=delta)).isoformat()


def profile_record(user_id=None, version_id=None):
    user_id, version_id, answer_id = user_id or str(uuid4()), version_id or str(uuid4()), str(uuid4())
    return {"user_id": user_id, "profile_version_id": version_id, "onboarding_session_id": str(uuid4()),
            "data_origin": "real_opt_in", "valid_from": iso(-1), "conversation_request": None,
            "current_goal": "Practice pottery together", "conversation_intent": "find_activity_partner",
            "open_to_discussing": ["pottery"], "conversation_preferences": [], "avoid_topics": [],
            "onboarding_answers": [{"answer_id": answer_id, "user_id": user_id, "answer_text": "I am learning pottery.",
                                     "answered_at": iso(-2), "question_key": "interests"}],
            "facts": [{"fact_id": "pottery", "topic": "pottery", "relationship": "learning",
                       "details": "I am learning pottery.", "motivation": None,
                       "evidence": [{"source_type": "onboarding_answer", "reference_id": answer_id,
                                     "channel": "self_report", "support": "I am learning pottery."}],
                       "confirmation": "confirmed", "matching_allowed": True,
                       "sharing_scope": "matching_only"}]}


class MemoryRepository:
    """Test double only. Production has no memory/fake auth or score mode."""

    def __init__(self):
        self.tables = {}
        self.calls = []
        self.candidates = []
        self.eligibility = True
        self.rpc_values = {}

    def matches(self, row, filters):
        for key, expression in (filters or {}).items():
            if key == "or":
                # Business tests for OR queries inject only the target records.
                continue
            operator, value = expression.split(".", 1)
            actual = row.get(key)
            if operator == "eq" and str(actual).lower() != str(value).lower():
                return False
            if operator == "neq" and str(actual) == value:
                return False
            if operator == "is" and value == "null" and actual is not None:
                return False
            if operator == "gt" and (actual is None or actual <= value):
                return False
            if operator == "gte" and (actual is None or actual < value):
                return False
            if operator == "in" and str(actual) not in value.strip("()").split(","):
                return False
        return True

    async def select(self, table, filters=None, *, columns="*", order=None, limit=None):
        rows = [copy.deepcopy(row) for row in self.tables.get(table, []) if self.matches(row, filters)]
        if order:
            field, direction = order.split(".", 1)
            rows.sort(key=lambda row: row.get(field, ""), reverse=direction == "desc")
        return rows[:limit] if limit else rows

    async def one(self, table, filters=None, **kwargs):
        rows = await self.select(table, filters, limit=1, **kwargs)
        return rows[0] if rows else None

    async def insert(self, table, data, *, on_conflict=None, ignore=False):
        self.calls.append(("insert", table, copy.deepcopy(data)))
        rows = self.tables.setdefault(table, [])
        if on_conflict:
            existing = next((row for row in rows if all(row.get(key) == data.get(key) for key in on_conflict.split(","))), None)
            if existing:
                if ignore:
                    return []
                existing.update(copy.deepcopy(data))
                return [copy.deepcopy(existing)]
        row = copy.deepcopy(data)
        if table == "onboarding_answers":
            row.setdefault("answered_at", iso())
        if table == "phone_ble_sessions":
            row.setdefault("issued_at", iso())
            row.setdefault("revoked_at", None)
        rows.append(row)
        return [copy.deepcopy(row)]

    async def update(self, table, filters, data):
        self.calls.append(("update", table, copy.deepcopy(data)))
        result = []
        for row in self.tables.get(table, []):
            if self.matches(row, filters):
                row.update(copy.deepcopy(data))
                result.append(copy.deepcopy(row))
        return result

    async def delete(self, table, filters):
        removed = [row for row in self.tables.get(table, []) if self.matches(row, filters)]
        self.tables[table] = [row for row in self.tables.get(table, []) if row not in removed]
        return removed

    async def rpc(self, name, params):
        self.calls.append(("rpc", name, copy.deepcopy(params)))
        if name in self.rpc_values:
            return copy.deepcopy(self.rpc_values[name])
        if name == "eligible_pair":
            return self.eligibility
        if name == "nearby_candidates":
            return copy.deepcopy(self.candidates)
        if name == "record_ble_encounter":
            session = next(row for row in self.tables["phone_ble_sessions"]
                           if row["session_id"] == params["p_session_id"])
            rows = self.tables.setdefault("encounters", [])
            existing = next((row for row in rows
                if row["observer_user_id"] == params["p_observer_id"]
                and row.get("observed_session_id") == params["p_session_id"]), None)
            incoming = {"observer_user_id": params["p_observer_id"],
                "observed_user_id": session["user_id"], "observed_session_id": params["p_session_id"],
                "observed_at": params["p_observed_at"], "rssi": params["p_rssi"]}
            if existing is None:
                rows.append(incoming)
            elif datetime.fromisoformat(incoming["observed_at"]) > datetime.fromisoformat(existing["observed_at"]):
                existing.update(incoming)
            return None
        if name == "start_onboarding":
            rows = self.tables.setdefault("onboarding_sessions", [])
            for row in rows:
                if row["user_id"] == params["p_user_id"] and row["status"] != "completed":
                    return copy.deepcopy(row)
            row = {"session_id": str(uuid4()), "user_id": params["p_user_id"], "status": "in_progress", "revision": 0,
                   "turns": [{"id": str(uuid4()), "role": "assistant", "content": OPENING,
                              "question_key": "interests", "created_at": iso()}], "draft": {}}
            rows.append(row)
            return copy.deepcopy(row)
        if name == "append_onboarding_exchange":
            for row in self.tables["onboarding_sessions"]:
                if row["session_id"] == params["p_session_id"] and row["user_id"] == params["p_user_id"]:
                    if row["revision"] != params["p_expected_revision"]:
                        raise AppError(409, "conflict", "Conflict")
                    row["turns"].extend(params["p_turns"])
                    row["revision"] += 1
                    row["status"] = params["p_status"]
                    if params["p_draft"] is not None:
                        row["draft"] = params["p_draft"]
                    return copy.deepcopy(row)
        if name in ("invalidate_user_matches", "fail_matching_job", "publish_matching_result"):
            return True
        if name == "claim_matching_jobs":
            return []
        raise AssertionError(f"Unexpected RPC {name}")


@pytest.fixture
def repo():
    return MemoryRepository()

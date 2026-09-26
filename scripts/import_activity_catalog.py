#!/usr/bin/env python3
"""Validate the reviewed Atlanta catalog, optionally migrate/upsert it atomically.

Validation needs only Python. Applying needs psql and DATABASE_URL, supplied by
the process environment or --env-file. Credentials never appear in psql argv.
Use --check-db to exercise the same transaction and roll it back before --apply.
This script never creates people, changes profiles, or deletes catalog rows.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
MIGRATION_VERSION = "202609261730"
MIGRATION = ROOT / "supabase/migrations/202609261730_activity_catalog.sql"
FIELDS = {
    "id", "kind", "title", "summary", "venue", "area", "tags", "cost", "cost_note",
    "eligibility", "eligibility_note", "duration_minutes", "indoor", "source_url",
    "source_name", "source_checked_at", "review_after", "starts_at", "ends_at", "status",
}


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Catalog timestamps must include a timezone")
    return parsed.astimezone(UTC)


def validate(path):
    rows = json.loads(path.read_text())
    if not isinstance(rows, list) or len(rows) != 100:
        raise ValueError("The reviewed v1 catalog must contain exactly 100 records")
    ids, identities = set(), set()
    now = datetime.now(UTC)
    for row in rows:
        if not isinstance(row, dict) or set(row) != FIELDS:
            raise ValueError("Each record must contain exactly the documented catalog fields")
        if not isinstance(row["id"], str) or len(row["id"]) > 100 or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", row["id"]):
            raise ValueError("Invalid activity ID")
        identity = (row["title"].strip().casefold(), row["venue"].strip().casefold())
        if row["id"] in ids or identity in identities:
            raise ValueError("Duplicate activity ID or title/venue")
        ids.add(row["id"])
        identities.add(identity)
        for key, limit in {"title": 160, "summary": 400, "venue": 160, "area": 100,
                           "cost_note": 200, "eligibility_note": 200, "source_name": 100}.items():
            if not isinstance(row[key], str) or not row[key].strip() or len(row[key]) > limit:
                raise ValueError(f"Invalid {key} in {row['id']}")
        for key, choices in {
            "kind": {"evergreen", "recurring", "event"}, "cost": {"free", "paid", "unknown"},
            "eligibility": {"public", "gt_community", "students", "unknown"}, "status": {"active"},
        }.items():
            if row[key] not in choices:
                raise ValueError(f"Invalid {key} in {row['id']}")
        if type(row["indoor"]) is not bool or type(row["duration_minutes"]) is not int or not 5 <= row["duration_minutes"] <= 480:
            raise ValueError("Invalid activity duration or indoor flag")
        if (not isinstance(row["tags"], list) or not 1 <= len(row["tags"]) <= 16
                or any(not isinstance(tag, str) or not tag.strip() or len(tag) > 80 or tag != tag.lower() for tag in row["tags"])):
            raise ValueError("Activity tags must be bounded lowercase strings")
        source = urlparse(row["source_url"])
        if source.scheme != "https" or not source.hostname or source.username or source.password:
            raise ValueError("Activity sources must be public HTTPS URLs")
        checked, review = timestamp(row["source_checked_at"]), timestamp(row["review_after"])
        if checked > now or review <= now or review <= checked:
            raise ValueError("Activity source review is stale or in the future")
        if row["kind"] == "evergreen":
            if row["starts_at"] is not None or row["ends_at"] is not None:
                raise ValueError("Evergreen activity must not claim an event schedule")
        elif not row["starts_at"] or not row["ends_at"] or not now < timestamp(row["starts_at"]) < timestamp(row["ends_at"]):
            raise ValueError("Dated/recurring activities require a future, verified occurrence")
    return rows


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def database_env(path):
    values = {}
    if path:
        for line in path.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"').strip("'")
    values.update(os.environ)
    url = urlparse(values.get("DATABASE_URL", ""))
    if url.scheme not in ("postgres", "postgresql") or not url.hostname:
        raise ValueError("Configure DATABASE_URL or pass --env-file")
    env = dict(os.environ, PGHOST=url.hostname, PGPORT=str(url.port or 5432),
               PGDATABASE=url.path.lstrip("/"), PGUSER=unquote(url.username or ""),
               PGPASSWORD=unquote(url.password or ""), PGCONNECT_TIMEOUT="15",
               PGSSLMODE=parse_qs(url.query).get("sslmode", ["require"])[0])
    return env


def build_sql(rows, apply):
    columns = sorted(FIELDS)
    names = ",".join(columns)
    updates = ",".join(f"{name}=excluded.{name}" for name in columns if name != "id")
    ids = ",".join(literal(row["id"]) for row in rows)
    payload = literal(json.dumps(rows, ensure_ascii=False))
    migration = MIGRATION.read_text()
    # psql conditions run inside the transaction; an advisory lock serializes
    # repeat imports without locking any user or matching tables.
    return f"""\\set ON_ERROR_STOP on
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(261730);
select to_regclass('public.activity_catalog') is null as catalog_missing \\gset
\\if :catalog_missing
{migration}
insert into supabase_migrations.schema_migrations(version,name,statements)
values ({literal(MIGRATION_VERSION)},'activity_catalog',array[{literal(migration)}]);
\\endif
insert into public.activity_catalog({names})
select {names} from jsonb_populate_recordset(null::public.activity_catalog,{payload}::jsonb)
on conflict(id) do update set {updates}, updated_at=now()
where excluded.source_checked_at > public.activity_catalog.source_checked_at;
do $$ begin
  if (select count(*) from public.activity_catalog where id in ({ids})) <> 100 then
    raise exception 'Catalog import count mismatch';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.activity_catalog'::regclass)
     or has_table_privilege('anon','public.activity_catalog','SELECT')
     or has_table_privilege('authenticated','public.activity_catalog','SELECT')
     or has_table_privilege('authenticated','public.activity_catalog','INSERT')
     or has_table_privilege('authenticated','public.activity_catalog','UPDATE')
     or has_table_privilege('authenticated','public.activity_catalog','DELETE') then
    raise exception 'Catalog permissions do not match server-only access';
  end if;
end $$;
select 'catalog_rows='||count(*) from public.activity_catalog where id in ({ids});
select 'eligible_public_rows='||count(*) from public.activity_catalog
where id in ({ids}) and eligibility='public' and status='active' and review_after>now();
{'' if apply else f"""
-- A repeat import must not revive an item that a curator has withdrawn.
update public.activity_catalog set status='cancelled' where id={literal(rows[0]['id'])};
insert into public.activity_catalog({names})
select {names} from jsonb_populate_recordset(null::public.activity_catalog,{payload}::jsonb)
on conflict(id) do update set {updates}, updated_at=now()
where excluded.source_checked_at > public.activity_catalog.source_checked_at;
do $$ begin
  if (select status from public.activity_catalog where id={literal(rows[0]['id'])}) <> 'cancelled' then
    raise exception 'Repeat import revived a cancelled activity';
  end if;
end $$;
"""}
notify pgrst, 'reload schema';
{"commit" if apply else "rollback"};
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=ROOT / "data/activities/atlanta-v1.json")
    parser.add_argument("--env-file", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check-db", action="store_true", help="Exercise migration/import and roll back")
    mode.add_argument("--apply", action="store_true", help="Commit this migration and catalog upsert")
    args = parser.parse_args()
    try:
        rows = validate(args.catalog)
        print(f"Validated {len(rows)} unique activities from {len({r['source_url'] for r in rows})} source pages.")
        if not (args.apply or args.check_db):
            return 0
        result = subprocess.run(["psql", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
                                input=build_sql(rows, args.apply), text=True, capture_output=True,
                                env=database_env(args.env_file), check=False, timeout=90)
        if result.returncode:
            # psql may echo input SQL and connection details. Never print those.
            print("Database transaction failed and was rolled back; diagnostic details suppressed.", file=sys.stderr)
            return result.returncode
        for line in result.stdout.splitlines():
            if line.startswith(("catalog_rows=", "eligible_public_rows=")):
                print(line)
        print("Catalog committed." if args.apply else "Database checks passed; transaction rolled back.")
        return 0
    except (ValueError, OSError, subprocess.TimeoutExpired) as exc:
        print(str(exc) if isinstance(exc, ValueError) else "Unable to read input or complete database operation.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

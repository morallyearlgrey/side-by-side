#!/usr/bin/env python3
"""Run real PostgreSQL/PostGIS assertions in one transaction, always rolled back.

Needs psql and DATABASE_URL (or --env-file). --migrate validates a fresh schema
without applying anything permanently. With no --migrate, tests the already
migrated database. No Supabase project credentials are logged.
"""

import argparse
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import parse_qs, unquote, urlparse


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--migrate", action="store_true")
    args = parser.parse_args()
    values = dict(os.environ)
    if args.env_file:
        for line in args.env_file.read_text().splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"').strip("'")
    url = urlparse(values.get("DATABASE_URL", ""))
    if url.scheme not in ("postgres", "postgresql") or not url.hostname:
        parser.error("Configure a valid DATABASE_URL; no connection attempted")
    env = dict(os.environ)
    env.update(
        PGHOST=url.hostname,
        PGPORT=str(url.port or 5432),
        PGDATABASE=url.path.lstrip("/"),
        PGUSER=unquote(url.username or ""),
        PGPASSWORD=unquote(url.password or ""),
        PGCONNECT_TIMEOUT="15",
        PGSSLMODE=parse_qs(url.query).get("sslmode", ["require"])[0],
    )
    root = Path(__file__).resolve().parents[1]
    sql = "\\set ON_ERROR_STOP on\n\\o /dev/null\nbegin;\nset local lock_timeout='10s';\nset local statement_timeout='60s';\n"
    if args.migrate:
        sql += "do $$ begin if to_regclass('public.profiles') is not null then raise exception 'Migration test requires an empty application schema'; end if; end $$;\n"
        for migration in sorted((root / "migrations").glob("*.sql")):
            sql += migration.read_text() + "\n"
    else:
        # Remove only this test suite's known fictional rows inside this rollback
        # transaction, then rebuild fresh presence. Never touch unrelated IDs.
        sql += """
do $$ begin
  if exists(select 1 from auth.users where id::text like '10000000-0000-4000-8000-00000000000_'
    and email not like 'synthetic-%@sidebyside.invalid') then
    raise exception 'Fixture UUID collision with non-test account';
  end if;
end $$;
delete from auth.users where id in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004') and email like 'synthetic-%@sidebyside.invalid';
"""
    sql += (root / "seed.sql").read_text() + "\n"
    sql += (root / "tests" / "runtime.sql").read_text() + "\n"
    sql += "rollback;\n\\o\n\\echo All runtime database assertions passed; transaction rolled back.\n"
    result = subprocess.run(
        ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1"],
        input=sql,
        text=True,
        env=env,
        capture_output=True,
        check=False,
    )
    # On SQL failure psql exits, closing its connection and rolling back the
    # uncommitted transaction, including extensions, tables and auth fixtures.
    if result.stdout:
        print(result.stdout.strip())
    if result.stderr:
        output = result.stderr.replace(values.get("DATABASE_URL", ""), "[DATABASE_URL]")
        if url.password:
            output = output.replace(unquote(url.password), "[PASSWORD]")
        print(output.strip(), file=sys.stderr)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())

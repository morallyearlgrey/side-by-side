"""Read-only deployment check against the same PostgREST API used by the app."""

import asyncio
import sys

import httpx

from .config import Settings
from .errors import AppError
from .repository import Repository

PROBE_USER = "00000000-0000-0000-0000-000000000000"


async def check_navigation(repo: Repository) -> None:
    # Never inspect real connections or manufacture accounts for this check.
    if await repo.one("profiles", {"user_id": f"eq.{PROBE_USER}"}, columns="user_id"):
        raise AppError(503, "probe_user_exists", "The reserved probe ID is in use; check aborted.")
    expected_page = {"items": [], "page": 1, "pages": 1, "total": 0, "page_size": 6}
    graph = await repo.rpc("navigation_constellation", {"p_user_id": PROBE_USER})
    page = await repo.rpc("navigation_connections_page", {
        "p_user_id": PROBE_USER, "p_query": "", "p_filter": "all", "p_page": 1,
    })
    preferences = await repo.request("GET", "match_preferences", params={
        "select": "preference", "limit": "0",
    })
    if graph != {"nodes": []} or page != expected_page or preferences != []:
        raise AppError(503, "navigation_contract_mismatch",
                       "The navigation API returned an unexpected shape; check its migrations.")


async def run() -> None:
    async with httpx.AsyncClient(timeout=20) as client:
        await check_navigation(Repository(Settings(), client))


def main() -> None:
    try:
        asyncio.run(run())
    except AppError as exc:
        print(f"Navigation preflight FAILED [{exc.code}]: {exc.message}", file=sys.stderr)
        if exc.code == "database_schema_unavailable":
            print("Check migration history and the PostgREST schema cache. "
                  "See docs/database-migration-summary.md.", file=sys.stderr)
        raise SystemExit(1) from None
    print("Navigation preflight PASSED: constellation, connection paging and preferences. "
          "No accounts or records were changed. This is not an account-level UI test.")


if __name__ == "__main__":
    main()

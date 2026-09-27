import httpx

from .errors import AppError


class Repository:
    """Private server-side PostgREST access. Actor identity comes only from verified Auth.

    Cross-user operations use restrictive SQL RPCs. No raw database method is exposed
    through an API route. PostgREST errors never return SQL details or payloads to clients.
    """

    def __init__(self, settings, client: httpx.AsyncClient):
        self.settings, self.client = settings, client

    async def request(self, method, path, *, params=None, data=None, prefer=None):
        if not self.settings.database_configured:
            raise AppError(503, "database_not_configured", "Supabase is not configured.")
        key = self.settings.supabase_service_role_key.get_secret_value()
        headers = {"apikey": key, "Authorization": f"Bearer {key}"}
        if prefer:
            headers["Prefer"] = prefer
        try:
            response = await self.client.request(
                method, f"{self.settings.supabase_url.rstrip('/')}/rest/v1/{path}",
                params=params, json=data, headers=headers,
            )
        except httpx.HTTPError as exc:
            raise AppError(503, "database_unavailable", "Please try again shortly.") from exc
        if response.status_code == 409:
            raise AppError(409, "conflict", "This record changed. Refresh and try again.")
        if response.status_code == 429:
            raise AppError(429, "rate_limited", "Wait a minute before trying again.")
        if response.status_code >= 400:
            try:
                payload = response.json()
                code = payload.get("code") if isinstance(payload, dict) else None
            except ValueError:
                code = None
            if path == 'rpc/record_ble_encounter':
                if code == 'PT404':
                    raise AppError(404, 'encounter_not_available', 'This encounter is not available.')
                if code == 'PT422':
                    raise AppError(422, 'stale_encounter', 'The Bluetooth observation is no longer fresh.')
            if code in ("PGRST202", "PGRST205"):
                raise AppError(503, "database_schema_unavailable",
                               "This feature is temporarily unavailable while the database API is updated.")
            if code == "40001":
                raise AppError(409, "conflict", "This record changed. Refresh and retry your saved answer.")
            if code in ("P0001", "22023", "23514", "42501"):
                raise AppError(409, "operation_not_allowed", "This operation is not currently allowed. Refresh and check your settings.")
            raise AppError(503, "database_error", "The database operation could not be completed.")
        return response.json() if response.content else None

    async def select(self, table, filters=None, *, columns="*", order=None, limit=None):
        params = {"select": columns, **(filters or {})}
        if order:
            params["order"] = order
        if limit:
            params["limit"] = str(limit)
        return await self.request("GET", table, params=params)

    async def one(self, table, filters=None, **kwargs):
        rows = await self.select(table, filters, limit=1, **kwargs)
        return rows[0] if rows else None

    async def insert(self, table, data, *, on_conflict=None, ignore=False):
        resolution = "ignore-duplicates" if ignore else "merge-duplicates"
        prefer = f"resolution={resolution},return=representation" if on_conflict else "return=representation"
        return await self.request("POST", table, params={"on_conflict": on_conflict} if on_conflict else None,
                                  data=data, prefer=prefer)

    async def update(self, table, filters, data):
        return await self.request("PATCH", table, params=filters, data=data, prefer="return=representation")

    async def delete(self, table, filters):
        return await self.request("DELETE", table, params=filters, prefer="return=representation")

    async def rpc(self, name, params):
        return await self.request("POST", f"rpc/{name}", data=params)

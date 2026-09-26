from uuid import UUID

import httpx
from fastapi import Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .errors import AppError

bearer = HTTPBearer(auto_error=False)


class SupabaseAuthenticator:
    """Delegate JWT verification AND user validity to the project's trusted Auth server."""

    def __init__(self, settings, client: httpx.AsyncClient):
        self.settings, self.client = settings, client

    async def verify(self, credentials: HTTPAuthorizationCredentials | None) -> str:
        if not credentials or credentials.scheme.lower() != "bearer":
            raise AppError(401, "authentication_required", "Sign in to continue.")
        if not self.settings.auth_configured:
            raise AppError(503, "auth_not_configured", "Supabase authentication is not configured.")
        try:
            response = await self.client.get(
                f"{self.settings.supabase_url.rstrip('/')}/auth/v1/user",
                headers={"apikey": self.settings.supabase_anon_key.get_secret_value(),
                         "Authorization": f"Bearer {credentials.credentials}"},
            )
        except httpx.HTTPError as exc:
            raise AppError(503, "auth_unavailable", "Authentication is temporarily unavailable.") from exc
        if response.status_code in (401, 403):
            raise AppError(401, "invalid_session", "Sign in again to continue.")
        if response.status_code != 200:
            raise AppError(503, "auth_unavailable", "Authentication is temporarily unavailable.")
        try:
            user = response.json()
            if user.get("is_anonymous"):
                raise ValueError("Anonymous discovery is not supported")
            return str(UUID(user["id"]))
        except (ValueError, KeyError, TypeError) as exc:
            raise AppError(401, "invalid_session", "A registered account is required.") from exc


async def current_user(request: Request) -> str:
    return await request.app.state.auth.verify(await bearer(request))

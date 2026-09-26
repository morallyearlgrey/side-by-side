import base64
import hashlib
import json
import secrets
from datetime import timedelta
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken

from .errors import AppError
from .jobs import now


class Spotify:
    """Account connection only. Spotify Content is excluded from profile/model inputs."""

    def __init__(self, repo, settings, client):
        self.repo, self.settings, self.client = repo, settings, client
        self.cipher = None
        key = settings.spotify_token_encryption_key.get_secret_value()
        if key:
            try:
                self.cipher = Fernet(key.encode())
            except (ValueError, TypeError):
                pass

    def readiness(self):
        available = bool(self.cipher and self.settings.spotify_client_id and self.settings.spotify_redirect_uri)
        return {"available": available, "reason": None if available else "spotify_not_configured",
                "matching_supported": False,
                "scope": "user-read-private"}

    def require_ready(self):
        if not self.readiness()["available"]:
            raise AppError(503, "spotify_not_configured", "Spotify account connection has not been configured.")

    async def status(self, user_id):
        row = await self.repo.one("provider_connections", {"user_id": f"eq.{user_id}", "provider": "eq.spotify", "revoked_at": "is.null"})
        return {**self.readiness(), "connected": bool(row), "display": row["display_data"] if row else None}

    async def connect(self, user_id):
        self.require_ready()
        state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        await self.repo.insert("provider_oauth_states", {
            "state_hash": hashlib.sha256(state.encode()).hexdigest(), "user_id": user_id, "provider": "spotify",
            "code_verifier_ciphertext": self.cipher.encrypt(verifier.encode()).decode(),
            "redirect_uri": self.settings.spotify_redirect_uri,
            "expires_at": (now() + timedelta(minutes=10)).isoformat(),
        })
        return {"authorization_url": "https://accounts.spotify.com/authorize?" + urlencode({
            "response_type": "code", "client_id": self.settings.spotify_client_id,
            "redirect_uri": self.settings.spotify_redirect_uri, "scope": "user-read-private",
            "state": state, "code_challenge_method": "S256", "code_challenge": challenge}),
            "expires_in_seconds": 600}

    async def callback(self, state, code=None, error=None):
        self.require_ready()
        if not state or len(state) > 128:
            raise AppError(400, "invalid_oauth_state", "Restart the Spotify connection.")
        # Atomic conditional UPDATE consumes the single-use state before exchanging a code.
        rows = await self.repo.update("provider_oauth_states", {
            "state_hash": f"eq.{hashlib.sha256(state.encode()).hexdigest()}",
            "provider": "eq.spotify", "consumed_at": "is.null", "expires_at": f"gt.{now().isoformat()}"},
            {"consumed_at": now().isoformat()})
        if not rows:
            raise AppError(400, "invalid_oauth_state", "This Spotify connection request expired or was already used.")
        state_row = rows[0]
        if error or not code:
            return False
        try:
            verifier = self.cipher.decrypt(state_row["code_verifier_ciphertext"].encode()).decode()
            response = await self.client.post("https://accounts.spotify.com/api/token", data={
                "grant_type": "authorization_code", "code": code, "redirect_uri": state_row["redirect_uri"],
                "client_id": self.settings.spotify_client_id, "code_verifier": verifier})
            response.raise_for_status()
            tokens = response.json()
            profile = await self.client.get("https://api.spotify.com/v1/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
            profile.raise_for_status()
            account = profile.json()
            # No email, history, playlists, genres, audio, derived traits or model inputs.
            display = {"display_name": account.get("display_name"),
                       "spotify_url": account.get("external_urls", {}).get("spotify")}
            await self.repo.insert("provider_connections", {
                "user_id": state_row["user_id"], "provider": "spotify", "provider_account_id": account["id"],
                "granted_scopes": tokens.get("scope", "").split(),
                "encrypted_token": self.cipher.encrypt(json.dumps(tokens).encode()).decode(),
                "token_expires_at": (now() + timedelta(seconds=tokens.get("expires_in", 3600))).isoformat(),
                "display_data": display, "connected_at": now().isoformat(), "revoked_at": None,
            }, on_conflict="user_id,provider")
            return True
        except (httpx.HTTPError, KeyError, ValueError, InvalidToken) as exc:
            raise AppError(503, "spotify_connection_failed", "Spotify could not finish the connection. Please start again.") from exc

    async def disconnect(self, user_id):
        await self.repo.update("provider_connections", {"user_id": f"eq.{user_id}", "provider": "eq.spotify"}, {
            "encrypted_token": None, "token_expires_at": None, "display_data": {}, "revoked_at": now().isoformat()})
        await self.repo.delete("provider_oauth_states", {"user_id": f"eq.{user_id}", "provider": "eq.spotify"})
        return {"connected": False}

import asyncio
from contextlib import asynccontextmanager, suppress
from typing import Annotated
from urllib.parse import urlencode
from uuid import UUID

import httpx
from fastapi import Depends, FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse

from .auth import SupabaseAuthenticator, bearer, current_user
from .badges import BadgeRegistration, BadgeReport, Badges
from .config import Settings
from .conversation import ConversationIdeas
from .errors import AppError
from .jobs import MatchingJobs, now
from .matching import MatchingRuntime
from .models import (
    ConnectionRequest,
    ConsentRequest,
    ConversationIdeaRequest,
    DecisionRequest,
    EncounterRequest,
    FeedbackRequest,
    MessageRequest,
    PresenceRequest,
    ProfileAnswerRequest,
    ReviewRequest,
)
from .onboarding import MuseProvider, Onboarding
from .repository import Repository
from .service import Application
from .spotify import Spotify

User = Annotated[str, Depends(current_user)]


def create_app(settings=None, *, repository=None, authenticator=None, muse=None, runtime=None, client=None):
    config = settings or Settings()
    http = client or httpx.AsyncClient(timeout=httpx.Timeout(20), follow_redirects=False)
    repo = repository or Repository(config, http)
    model = runtime or MatchingRuntime(config)
    onboarding = Onboarding(repo, muse or MuseProvider(config, http))
    jobs = MatchingJobs(repo, model, config)
    spotify = Spotify(repo, config, http)
    application = Application(repo, onboarding, jobs, spotify, config, ConversationIdeas(config, http))
    badges = Badges(repo)

    @asynccontextmanager
    async def lifespan(app):
        worker = None
        if config.matching_warm_on_startup and config.matching_execution == "local":
            await model.warm()
        if config.worker_enabled and config.database_configured and config.matching_execution == "local":
            worker = asyncio.create_task(jobs.run())
        yield
        jobs.closed = True
        if worker:
            worker.cancel()
            with suppress(asyncio.CancelledError):
                await worker
        if client is None:
            await http.aclose()

    app = FastAPI(title="SidebySide API", version="0.1.0", lifespan=lifespan)
    app.state.auth = authenticator or SupabaseAuthenticator(config, http)
    app.state.application = application
    app.add_middleware(CORSMiddleware, allow_origins=config.cors_origins,
                       allow_credentials=False, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                       allow_headers=["Authorization", "Content-Type"])

    @app.middleware("http")
    async def private_response(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/v1/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(AppError)
    async def app_error(request: Request, error: AppError):
        headers = {"WWW-Authenticate": "Bearer"} if error.status == 401 else {}
        return JSONResponse({"error": {"code": error.code, "message": error.message}}, status_code=error.status, headers=headers)

    @app.get("/health")
    async def health():
        return {"status": "ok", "database_configured": config.database_configured,
                "auth_configured": config.auth_configured, "matching": await jobs.model_readiness() if config.database_configured else model.metadata(),
                "muse": onboarding.provider.readiness(), "spotify": spotify.readiness()}

    @app.get("/v1/me")
    async def me(user_id: User):
        return await application.me(user_id)

    @app.get("/v1/onboarding")
    async def get_onboarding(user_id: User):
        await application.ensure_profile(user_id)
        return onboarding.response(await onboarding.session(user_id))

    @app.post("/v1/onboarding/messages")
    async def message(body: MessageRequest, user_id: User):
        return await onboarding.send(user_id, body)

    @app.post("/v1/onboarding/review")
    async def review(body: ReviewRequest, user_id: User):
        return await application.review(user_id, body)

    @app.patch("/v1/profile")
    async def profile(body: ReviewRequest, user_id: User):
        return await application.review(user_id, body, editing=True)

    @app.post("/v1/profile/answers")
    async def add_answer(body: ProfileAnswerRequest, user_id: User):
        return await application.add_answer(user_id, body)

    @app.patch("/v1/settings")
    async def settings_patch(body: dict, user_id: User):
        return await application.update_settings(user_id, body)

    @app.post("/v1/consents")
    async def consent(body: ConsentRequest, user_id: User):
        return await application.set_consent(user_id, body.purpose, body.granted)

    @app.put("/v1/presence")
    async def presence(body: PresenceRequest, user_id: User):
        return await application.presence(user_id, body)

    @app.delete("/v1/presence")
    async def remove_presence(user_id: User):
        await application.update_settings(user_id, {"discoverable": False})
        await repo.delete("presence", {"user_id": f"eq.{user_id}"})
        return {"discoverable": False}

    @app.get("/v1/nearby")
    async def nearby(user_id: User, cursor: Annotated[str | None, Query(max_length=512)] = None,
                     limit: Annotated[int, Query(ge=1, le=50)] = 20):
        return await jobs.nearby(user_id, cursor, limit)

    @app.post("/v1/ble/sessions")
    async def start_ble(user_id: User):
        return await application.start_ble(user_id)

    @app.delete("/v1/ble/sessions")
    async def stop_ble(user_id: User):
        return await application.stop_ble(user_id)

    @app.post("/v1/ble/encounters")
    async def encounter(body: EncounterRequest, user_id: User):
        return await application.encounter(user_id, body)

    @app.post("/v1/ble/conversation-ideas")
    async def conversation_idea(body: ConversationIdeaRequest, user_id: User):
        return await application.conversation_idea(user_id, body)

    @app.get("/v1/badges")
    async def list_badges(user_id: User):
        return await badges.list(user_id)

    @app.post("/v1/badges", status_code=201)
    async def register_badge(body: BadgeRegistration, user_id: User):
        await application.ensure_profile(user_id)
        return await badges.register(user_id, body)

    @app.put("/v1/badges/state")
    async def report_badge(body: BadgeReport, request: Request):
        # Device credentials are accepted only here, never as account sessions.
        return await badges.report(await bearer(request), body)

    @app.delete("/v1/badges/{device_id}")
    async def revoke_badge(device_id: UUID, user_id: User):
        return await badges.revoke(user_id, device_id)

    @app.get("/v1/connections")
    async def connections(user_id: User):
        return await application.connections(user_id)

    @app.post("/v1/connections")
    async def request_connection(body: ConnectionRequest, user_id: User):
        return await application.request_connection(user_id, body)

    @app.put("/v1/connections/{request_id}/decision")
    async def decide(request_id: UUID, body: DecisionRequest, user_id: User):
        return await application.decide(user_id, request_id, body.decision)

    @app.post("/v1/feedback")
    async def feedback(body: FeedbackRequest, user_id: User):
        return await application.feedback(user_id, body)

    @app.post("/v1/blocks/{blocked_id}")
    async def block(blocked_id: UUID, user_id: User):
        if str(blocked_id) == user_id:
            raise AppError(422, "invalid_block", "Choose another account.")
        await repo.insert("user_blocks", {"blocker_user_id": user_id, "blocked_user_id": str(blocked_id)},
                          on_conflict="blocker_user_id,blocked_user_id", ignore=True)
        return {"blocked": True}

    @app.delete("/v1/blocks/{blocked_id}")
    async def unblock(blocked_id: UUID, user_id: User):
        await repo.delete("user_blocks", {"blocker_user_id": f"eq.{user_id}", "blocked_user_id": f"eq.{blocked_id}"})
        return {"blocked": False}

    @app.get("/v1/integrations/spotify")
    async def spotify_status(user_id: User):
        return await spotify.status(user_id)

    @app.post("/v1/integrations/spotify/connect")
    async def spotify_connect(user_id: User):
        await application.ensure_profile(user_id)
        return await spotify.connect(user_id)

    @app.get("/v1/integrations/spotify/callback")
    async def spotify_callback(state: str, code: str | None = None, error: str | None = None):
        connected = await spotify.callback(state, code, error)
        return RedirectResponse(config.mobile_return_uri + "?" + urlencode({"spotify": "connected" if connected else "cancelled"}), status_code=303)

    @app.delete("/v1/integrations/spotify")
    async def spotify_disconnect(user_id: User):
        return await spotify.disconnect(user_id)

    @app.delete("/v1/me")
    async def delete_account(user_id: User):
        # Explicit authenticated account deletion cascades raw data and derived records.
        key = config.supabase_service_role_key.get_secret_value()
        try:
            response = await http.delete(f"{config.supabase_url.rstrip('/')}/auth/v1/admin/users/{user_id}",
                headers={"apikey": key, "Authorization": f"Bearer {key}"})
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise AppError(503, "deletion_failed", "Account deletion did not complete. Try again.") from exc
        return {"deleted": True, "deleted_at": now().isoformat()}

    return app


app = create_app()

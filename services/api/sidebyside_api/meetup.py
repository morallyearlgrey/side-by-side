from uuid import UUID

from .errors import AppError
from .jobs import row_value
from .models import PresenceRequest, StrictModel


class MeetupUpdate(PresenceRequest):
    share_id: UUID


class MeetupStop(StrictModel):
    share_id: UUID


class Meetup:
    def __init__(self, repo):
        self.repo = repo

    async def state(self, user_id, request_id, action="read", point=None, share_id=None):
        connection = await self.repo.one("connection_requests", {"request_id": f"eq.{request_id}"})
        if not connection or user_id not in (connection["requester_user_id"], connection["recipient_user_id"]):
            raise AppError(404, "connection_not_found", "Connection not found.")
        # SQL rechecks mutual acceptance, consent, profile versions, blocks and expiry
        # while holding the same connection lock as accept/revoke operations.
        return row_value(await self.repo.rpc("connection_meetup", {
            "p_user_id": user_id, "p_request_id": str(request_id), "p_action": action,
            "p_point": point.model_dump(mode="json", exclude={"share_id"}) if point else None,
            "p_share_id": str(share_id) if share_id else None,
        }))

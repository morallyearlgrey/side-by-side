"""Discovery map estimates, produced by a service-only SQL privacy boundary."""

from .jobs import row_value


class LocationMap:
    def __init__(self, repo):
        self.repo = repo

    async def state(self, user_id):
        # The RPC atomically rechecks consent, previews, blocks, discovery
        # leases and BLE sessions. Exact presence coordinates never leave SQL.
        return row_value(await self.repo.rpc("discovery_location_map", {"p_viewer_id": user_id}))

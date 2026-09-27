"""Read-side navigation and private preferences. No device or matching-worker changes."""
import hashlib
import json
from datetime import datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from .auth import current_user
from .errors import AppError
from .jobs import now, row_value
from .models import Preview, StrictModel


class MatchTarget(StrictModel):
    candidate_id: UUID
    viewer_version_id: UUID
    candidate_version_id: UUID
    mode: Literal['nearby', 'ble'] = 'nearby'
    connection_id: UUID | None = None


class PreferenceRequest(MatchTarget):
    preference: Literal['liked', 'disliked']


def event_key(viewer_id, candidate_id, viewer_version, candidate_version):
    # Deliberately independent of poll, GPS snapshot, BLE token rotation and source.
    return hashlib.sha256(json.dumps([viewer_id, candidate_id, viewer_version, candidate_version]).encode()).hexdigest()


class Navigation:
    def __init__(self, application, descriptions):
        self.app, self.repo, self.jobs = application, application.repo, application.jobs
        self.descriptions = descriptions

    async def target(self, actor, target):
        peer = str(target.candidate_id)
        viewer, candidate = await self.jobs.profile(actor), await self.jobs.profile(peer)
        if (not viewer or not candidate or actor == peer
                or viewer['current_profile_version_id'] != str(target.viewer_version_id)
                or candidate['current_profile_version_id'] != str(target.candidate_version_id)):
            raise AppError(409, 'profile_changed', 'This match changed. Refresh before continuing.')
        if target.connection_id:
            projection = row_value(await self.repo.rpc('navigation_connection', {
                'p_user_id': actor, 'p_request_id': str(target.connection_id)}))
            if (not projection or projection.get('status') not in ('accepted', 'pending')
                    or projection.get('candidate_id') != peer
                    or projection.get('viewer_version_id') != str(target.viewer_version_id)
                    or projection.get('candidate_version_id') != str(target.candidate_version_id)):
                raise AppError(404, 'match_unavailable', 'This connection is no longer available.')
        else:
            if not await self.repo.one('profile_previews', {'user_id': f'eq.{peer}', 'enabled': 'eq.true'}):
                raise AppError(404, 'match_unavailable', 'This preview is no longer available.')
            if not await self.jobs.eligible(actor, peer, target.mode):
                raise AppError(404, 'match_unavailable', 'This suggestion is no longer available.')
            if target.mode == 'nearby':
                radius = viewer.get('settings', {}).get('discovery_radius_m', 3218.688)
                if not any(c['user_id'] == peer and c['distance_m'] <= radius for c in await self.jobs.candidates(actor)):
                    raise AppError(404, 'match_unavailable', 'This suggestion is outside your discovery radius.')
            elif not await self.repo.one('encounters', {'observer_user_id': f'eq.{actor}',
                    'observed_user_id': f'eq.{peer}', 'observed_at': f'gt.{(now()-timedelta(minutes=2)).isoformat()}'}):
                raise AppError(404, 'match_unavailable', 'A recent Bluetooth encounter is required.')
            score = await self.jobs.latest_score(actor, peer, str(target.viewer_version_id), str(target.candidate_version_id))
            if not score or score['status'] != 'recommend':
                raise AppError(409, 'match_unavailable', 'A supported recommendation is required.')
        return viewer, candidate

    async def discoveries(self, actor, location=True, bluetooth=False):
        viewer = await self.jobs.profile(actor)
        if not viewer or not viewer.get('current_profile_version_id') or not await self.app.consent(actor):
            return {'items': []}
        candidates = {}
        radius = viewer.get('settings', {}).get('discovery_radius_m', 3218.688)
        if location and viewer.get('discoverable'):
            for row in await self.jobs.candidates(actor):
                if row['distance_m'] <= radius:
                    candidates[row['user_id']] = {'nearby'}
        if bluetooth and viewer.get('bluetooth_enabled'):
            rows = await self.repo.select('encounters', {'observer_user_id': f'eq.{actor}',
                'observed_at': f'gt.{(now()-timedelta(minutes=2)).isoformat()}'}, limit=100)
            for row in rows:
                peer = row['observed_user_id']
                if await self.jobs.eligible(actor, peer, 'ble'):
                    candidates.setdefault(peer, set()).add('ble')
        items = []
        counts = {'candidate_count': 0, 'pending_count': 0, 'not_recommended_count': 0,
                  'insufficient_evidence_count': 0, 'unavailable_count': 0}
        for peer, sources in candidates.items():
            candidate = await self.jobs.profile(peer)
            preview = await self.repo.one('profile_previews', {'user_id': f'eq.{peer}', 'enabled': 'eq.true'})
            if not candidate or not preview:
                continue
            own_version, peer_version = viewer['current_profile_version_id'], candidate['current_profile_version_id']
            score = await self.jobs.latest_score(actor, peer, own_version, peer_version)
            mode = 'nearby' if 'nearby' in sources else 'ble'
            if not await self.jobs.eligible(actor, peer, mode):
                continue
            counts['candidate_count'] += 1
            if score is None:
                await self.jobs.enqueue(actor, peer, mode)
            # Scores are directional. Either person's current supported result
            # can offer one shared suggestion, with neither decision accepted.
            # The reverse score is never included in this viewer's response.
            reverse = await self.jobs.latest_score(peer, actor, peer_version, own_version)
            shared = None
            if self.app.recommended_score(score) or self.app.recommended_score(reverse):
                shared = row_value(await self.repo.rpc('suggest_connection_pair', {
                    'p_viewer_id': actor, 'p_candidate_id': peer,
                    'p_lifetime_seconds': 86400, 'p_mode': mode}))
            if score is None:
                counts['pending_count'] += 1
                continue
            if score['status'] != 'recommend':
                key = f"{score['status']}_count"
                if key in counts:
                    counts[key] += 1
                else:
                    counts['unavailable_count'] += 1
                continue
            if not self.app.recommended_score(score):
                counts['unavailable_count'] += 1
                continue
            if not shared:
                # A prior decline/revocation or the other person's tighter
                # radius can suppress the pair without a recurring popup.
                continue
            target = MatchTarget(candidate_id=peer, viewer_version_id=own_version, candidate_version_id=peer_version, mode=mode)
            # Recheck authorization after asynchronous score/preview reads.
            try:
                await self.target(actor, target)
            except AppError:
                continue
            preference = await self.repo.one('match_preferences', {'user_id': f'eq.{actor}', 'candidate_id': f'eq.{peer}',
                'viewer_version_id': f'eq.{own_version}', 'candidate_version_id': f'eq.{peer_version}'})
            items.append({**target.model_dump(mode='json'), 'event_key': event_key(actor, peer, own_version, peer_version),
                'status': 'recommend', 'sources': sorted(sources),
                'preview': Preview.model_validate({k: v for k, v in preview['preview'].items()
                    if k in ('display_name', 'interests')}).model_dump(exclude={'enabled'}),
                'preference': preference['preference'] if preference else None,
                'score': score['final_score'], 'valid_until': min(now()+timedelta(seconds=20),
                    datetime.fromisoformat(score['expires_at'].replace('Z', '+00:00'))).isoformat()})
        items.sort(key=lambda item: (-item['score'], item['candidate_id']))
        return {'items': items[:50], **counts, 'radius_m': radius,
                'model': await self.jobs.model_readiness(actor)}

    async def preference(self, actor, body):
        await self.target(actor, body)
        return row_value(await self.repo.rpc('navigation_preference', {
            'p_user_id': actor, 'p_candidate_id': str(body.candidate_id),
            'p_viewer_version_id': str(body.viewer_version_id), 'p_candidate_version_id': str(body.candidate_version_id),
            'p_preference': body.preference, 'p_mode': body.mode,
            'p_connection_id': str(body.connection_id) if body.connection_id else None}))


def navigation_router(application, descriptions):
    router = APIRouter(prefix='/v1')
    nav = Navigation(application, descriptions)
    user = Annotated[str, Depends(current_user)]

    @router.get('/connections/constellation')
    async def constellation(actor: user):
        return row_value(await nav.repo.rpc('navigation_constellation', {'p_user_id': actor}))

    @router.get('/connections/invitations')
    async def invitations(actor: user):
        # Pair requests are shared by both participants. Their reverse model
        # score and current discovery transport do not gate this inbox.
        result = row_value(await nav.repo.rpc('navigation_invitations', {'p_user_id': actor}))
        return {'items': [item for item in result['items'] if item.get('status') == 'pending']}

    @router.get('/connections/page')
    async def page(actor: user, q: Annotated[str, Query(max_length=200)] = '',
                   filter: Literal['all', 'liked', 'disliked'] = 'all',
                   page: Annotated[int, Query(ge=1, le=1000000)] = 1):
        result = row_value(await nav.repo.rpc('navigation_connections_page', {
            'p_user_id': actor, 'p_query': q, 'p_filter': filter, 'p_page': page}))
        # SQL filters before search/pagination. Keep the API fail-closed while
        # older database deployments are being replaced.
        result['items'] = [item for item in result['items'] if item.get('status') == 'accepted'
            and item.get('requester_decision') == item.get('recipient_decision') == 'accepted']
        return result

    @router.get('/discoveries')
    async def discoveries(actor: user, location: bool = True, bluetooth: bool = False):
        return await nav.discoveries(actor, location, bluetooth)

    @router.put('/match-preferences')
    async def preference(actor: user, body: PreferenceRequest):
        return await nav.preference(actor, body)

    @router.post('/matches/description')
    async def description(actor: user, body: MatchTarget):
        await nav.target(actor, body)
        return await descriptions.describe(nav, actor, body)

    @router.put('/profile/preview')
    async def preview(actor: user, body: Preview):
        await application.ensure_profile(actor)
        await nav.repo.insert('profile_previews', {'user_id': actor, 'enabled': body.enabled,
            'preview': body.model_dump(exclude={'enabled'})}, on_conflict='user_id')
        await application.jobs.schedule_user(actor)
        return body

    return router

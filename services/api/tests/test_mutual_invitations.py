"""Fictional accounts. Real SQL lifecycle assertions live in mutual_invitations.sql."""
from copy import deepcopy
from uuid import uuid4

import httpx
import pytest
from conftest import iso
from sidebyside_api.config import Settings
from sidebyside_api.errors import AppError
from sidebyside_api.main import create_app
from sidebyside_api.models import ConnectionRequest
from test_discovery import add_score, add_user, configured_application
from test_meetup import AccountAuth


def invitation_pair(repo):
    app = configured_application(repo)
    actor, viewer, own = add_user(repo)
    peer, candidate, other = add_user(repo)
    repo.tables['profile_previews'] = [
        {'user_id': actor, 'enabled': True, 'preview': {'display_name': 'Fictional Amy', 'interests': ['pottery']}},
        {'user_id': peer, 'enabled': True, 'preview': {'display_name': 'Fictional Steve', 'interests': ['pottery']}},
    ]
    row = {'request_id': str(uuid4()), 'requester_user_id': actor, 'recipient_user_id': peer,
        'requester_profile_version_id': own['profile_version_id'],
        'recipient_profile_version_id': other['profile_version_id'],
        'requester_decision': 'accept', 'recipient_decision': 'pending',
        'created_at': iso(-10), 'expires_at': iso(600)}
    repo.tables['connection_requests'] = [row]
    return app, actor, peer, viewer, candidate, row


async def test_reverse_explicit_send_accepts_existing_invitation_without_reverse_prediction(repo):
    app, actor, peer, viewer, candidate, row = invitation_pair(repo)
    # A new invitation would fail: no fresh proximity/encounters and reverse
    # prediction is insufficient. An existing invitation remains actionable.
    add_score(repo, app.settings, candidate, viewer, status='insufficient_evidence')
    repo.rpc_values['decide_connection'] = {**row, 'recipient_decision': 'accept'}
    result = await app.request_connection(peer, ConnectionRequest(candidate_id=actor, mode='ble'))
    assert result['status'] == 'accepted'
    assert result['request_id'] == row['request_id']
    assert next(call for call in repo.calls if call[:2] == ('rpc', 'decide_connection')) == ('rpc', 'decide_connection', {
        'p_user_id': peer, 'p_request_id': row['request_id'], 'p_decision': 'accept'})
    assert not any(call[:2] == ('rpc', 'request_connection') for call in repo.calls)


async def test_repeat_send_never_accepts_on_behalf_of_other_participant(repo):
    app, actor, peer, _, _, row = invitation_pair(repo)
    repo.rpc_values['decide_connection'] = deepcopy(row)
    result = await app.request_connection(actor, ConnectionRequest(candidate_id=peer))
    assert result['status'] == 'pending' and result['recipient_decision'] == 'pending'
    assert next(call for call in repo.calls if call[:2] == ('rpc', 'decide_connection'))[2]['p_user_id'] == actor


async def test_supported_zero_score_can_start_mutual_invitation(repo):
    app, actor, peer, viewer, candidate, row = invitation_pair(repo)
    repo.tables['connection_requests'] = []
    repo.candidates = [{'user_id': peer, 'distance_m': 10}]
    add_score(repo, app.settings, viewer, candidate, value=0.0, status='not_recommended')
    repo.tables['match_scores'][-1]['reason'] = 'below_threshold'
    repo.rpc_values['request_connection'] = row
    result = await app.request_connection(actor, ConnectionRequest(candidate_id=peer))
    assert result['status'] == 'pending'
    assert repo.tables['match_scores'][-1]['status'] == 'not_recommended'
    assert any(call[:2] == ('rpc', 'request_connection') for call in repo.calls)


@pytest.mark.parametrize(('status', 'value'), [('insufficient_evidence', .99),
    ('not_recommended', .99), ('recommend', None), ('recommend', float('nan')), ('recommend', 99)])
async def test_new_invitation_still_requires_valid_supported_recommendation(repo, status, value):
    app, actor, peer, viewer, candidate, _ = invitation_pair(repo)
    repo.tables['connection_requests'] = []
    repo.candidates = [{'user_id': peer, 'distance_m': 10}]
    add_score(repo, app.settings, viewer, candidate, value=value, status=status)
    with pytest.raises(AppError) as error:
        await app.request_connection(actor, ConnectionRequest(candidate_id=peer))
    assert error.value.code == 'score_not_ready'
    assert not any(call[:2] == ('rpc', 'request_connection') for call in repo.calls)


@pytest.mark.parametrize('change', ['expiry', 'profile', 'withdrawal', 'blocked'])
async def test_old_invitation_does_not_bypass_current_eligibility(repo, change):
    app, actor, peer, _, candidate, row = invitation_pair(repo)
    if change == 'expiry':
        row['expires_at'] = iso(-1)
    elif change == 'profile':
        candidate['current_profile_version_id'] = str(uuid4())
    elif change == 'withdrawal':
        repo.tables['consent_receipts'][1]['revoked_at'] = iso()
    else:
        repo.eligibility = False
    with pytest.raises(AppError):
        await app.request_connection(peer, ConnectionRequest(candidate_id=actor))
    assert not any(call[:2] == ('rpc', 'decide_connection') for call in repo.calls)


@pytest.mark.parametrize('terminal', ['decline', 'revoke'])
async def test_terminal_invitation_projection_redacts_preview(repo, terminal):
    app, actor, _, _, _, row = invitation_pair(repo)
    row['recipient_decision'] = terminal
    result = await app.connection_projection(actor, row)
    assert result['preview'] is result['shared_profile'] is None
    assert result['status'] in ('declined', 'revoked')


async def test_invitation_route_owner_scoped_and_accepted_page_checks_both_decisions(repo):
    actor, peer = str(uuid4()), str(uuid4())
    pending = {'request_id': str(uuid4()), 'status': 'pending', 'requester_decision': 'accepted', 'recipient_decision': 'pending'}
    accepted = {'request_id': str(uuid4()), 'status': 'accepted', 'requester_decision': 'accepted', 'recipient_decision': 'accepted'}
    inconsistent = {**pending, 'status': 'accepted'}
    repo.rpc_values['navigation_invitations'] = {'items': [pending, accepted]}
    repo.rpc_values['navigation_connections_page'] = {'items': [pending, inconsistent, accepted],
        'page': 1, 'pages': 1, 'total': 1, 'page_size': 6}
    app = create_app(Settings(_env_file=None, worker_enabled=False), repository=repo, authenticator=AccountAuth(actor))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='https://test') as client:
        assert (await client.get('/v1/connections/invitations')).status_code == 401
        headers = {'Authorization': 'Bearer verified-session'}
        response = await client.get('/v1/connections/invitations?user_id='+peer, headers=headers)
        assert response.status_code == 200 and response.json()['items'] == [pending]
        assert response.headers['cache-control'] == 'no-store'
        assert repo.calls[-1] == ('rpc', 'navigation_invitations', {'p_user_id': actor})
        assert (await client.get('/v1/connections/page', headers=headers)).json()['items'] == [accepted]


async def test_two_authenticated_browsers_move_same_invitation_to_matches_only_after_mutual_acceptance(repo):
    projection_app, actor, peer, viewer, candidate, row = invitation_pair(repo)
    viewer['discoverable'] = candidate['discoverable'] = False
    add_score(repo, projection_app.settings, candidate, viewer, status='insufficient_evidence')
    original_rpc = repo.rpc

    async def lifecycle_rpc(name, params):
        if name == 'decide_connection':
            repo.calls.append(('rpc', name, deepcopy(params)))
            assert params['p_user_id'] in (actor, peer)
            field = 'requester_decision' if params['p_user_id'] == actor else 'recipient_decision'
            row[field] = params['p_decision']
            return deepcopy(row)
        if name in ('navigation_invitations', 'navigation_connections_page'):
            repo.calls.append(('rpc', name, deepcopy(params)))
            projection = await projection_app.connection_projection(params['p_user_id'], row)
            state = 'pending' if name == 'navigation_invitations' else 'accepted'
            items = [projection] if projection['status'] == state else []
            return {'items': items} if name == 'navigation_invitations' else {
                'items': items, 'total': len(items), 'page': 1, 'pages': 1, 'page_size': 6}
        return await original_rpc(name, params)

    repo.rpc = lifecycle_rpc
    apps = [create_app(Settings(_env_file=None, worker_enabled=False), repository=repo, authenticator=AccountAuth(owner))
        for owner in (actor, peer)]
    headers = {'Authorization': 'Bearer verified-session'}
    async with (httpx.AsyncClient(transport=httpx.ASGITransport(apps[0]), base_url='https://test', headers=headers) as sender,
                httpx.AsyncClient(transport=httpx.ASGITransport(apps[1]), base_url='https://test', headers=headers) as recipient):
        for browser in (sender, recipient):
            pending = (await browser.get('/v1/connections/invitations')).json()['items']
            assert len(pending) == 1 and pending[0]['request_id'] == row['request_id']
            assert pending[0]['shared_profile'] is None
            assert (await browser.get('/v1/connections/page')).json()['items'] == []
        response = await recipient.put(f'/v1/connections/{row["request_id"]}/decision', json={'decision': 'accepted'})
        assert response.status_code == 200 and response.json()['status'] == 'accepted'
        for browser in (sender, recipient):
            assert (await browser.get('/v1/connections/invitations')).json()['items'] == []
            matches = (await browser.get('/v1/connections/page')).json()['items']
            assert len(matches) == 1 and matches[0]['request_id'] == row['request_id']
            assert matches[0]['requester_decision'] == matches[0]['recipient_decision'] == 'accepted'
        await sender.put(f'/v1/connections/{row["request_id"]}/decision', json={'decision': 'revoked'})
        for browser in (sender, recipient):
            assert (await browser.get('/v1/connections/page')).json()['items'] == []

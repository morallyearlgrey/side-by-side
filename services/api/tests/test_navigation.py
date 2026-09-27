"""Only fictional profiles and mocked Muse HTTP; no real model/database calls."""
import json
from uuid import uuid4

import httpx
import pytest
from conftest import iso
from pydantic import SecretStr
from sidebyside_api.config import Settings
from sidebyside_api.errors import AppError
from sidebyside_api.main import create_app
from sidebyside_api.match_descriptions import MatchDescriptions, allowed_wording, grounding
from sidebyside_api.models import ProfileDraft, ReviewRequest
from sidebyside_api.navigation import MatchTarget, Navigation, PreferenceRequest, event_key
from sidebyside_api.onboarding import MuseProvider
from test_conversation_request import add_profile
from test_discovery import add_score, add_user, configured_application
from test_meetup import AccountAuth


def pair(repo):
    application = configured_application(repo)
    actor, viewer, own = add_user(repo)
    peer, candidate, other = add_user(repo)
    viewer['settings'] = candidate['settings'] = {'muse_descriptions_enabled': True}
    repo.tables['profile_previews'] = [
        {'user_id': p, 'enabled': True, 'preview': {'display_name': 'Fictional person', 'interests': ['pottery']}}
        for p in (actor, peer)]
    repo.candidates = [{'user_id': peer, 'profile_version_id': other['profile_version_id'], 'distance_m': 300, 'preview': repo.tables['profile_previews'][1]['preview']}]
    add_score(repo, application.settings, viewer, candidate)
    target = MatchTarget(candidate_id=peer, viewer_version_id=own['profile_version_id'], candidate_version_id=other['profile_version_id'])
    return application, actor, target, own, other


async def test_private_preference_bound_to_actor_not_acceptance_or_feedback(repo):
    app, actor, target, _, _ = pair(repo)
    repo.rpc_values['navigation_preference'] = {'preference': 'liked'}
    nav = Navigation(app, None)
    body = PreferenceRequest(**target.model_dump(), preference='liked')
    assert await nav.preference(actor, body) == {'preference': 'liked'}
    call = repo.calls[-1]
    assert call[1] == 'navigation_preference' and call[2]['p_user_id'] == actor
    assert not any(c[1] in ('feedback', 'request_connection', 'connection_meetup', 'connection_display_permission') for c in repo.calls)
    repo.eligibility = False
    with pytest.raises(AppError):
        await nav.preference(actor, body)


async def test_discoveries_dedupe_cross_source_and_reject_pending_radio(repo):
    app, actor, target, _, _ = pair(repo)
    repo.tables['encounters'] = [{'observer_user_id': actor, 'observed_user_id': str(target.candidate_id), 'observed_at': iso()}]
    nav = Navigation(app, None)
    result = await nav.discoveries(actor, True, True)
    assert len(result['items']) == 1
    item = result['items'][0]
    assert item['sources'] == ['ble', 'nearby'] and 'latitude' not in str(result)
    first_key = item['event_key']
    assert (await nav.discoveries(actor, False, True))['items'][0]['event_key'] == first_key
    repo.tables['match_scores'][0]['status'] = 'insufficient_evidence'
    withheld = await nav.discoveries(actor, True, True)
    assert withheld['items'] == []
    assert withheld['candidate_count'] == 1
    assert withheld['insufficient_evidence_count'] == 1
    assert withheld['pending_count'] == 0
    assert 'reason' not in withheld and 'preview' not in withheld
    assert event_key(actor, str(target.candidate_id), str(target.viewer_version_id), str(uuid4())) != first_key


@pytest.mark.parametrize('status', ['insufficient_evidence', 'not_recommended', 'unavailable'])
async def test_location_outcomes_distinguish_detected_profiles_from_empty_area(repo, status):
    app, actor, _, _, _ = pair(repo)
    repo.tables['match_scores'][0].update(status=status, reason='Private counterpart evidence')
    result = await Navigation(app, None).discoveries(actor, True, False)
    assert result['items'] == []
    assert result['candidate_count'] == 1
    assert result[f'{status}_count'] == 1
    assert result['pending_count'] == 0
    assert 'Private counterpart evidence' not in str(result)


async def test_discovery_never_counts_withdrawn_preview_or_ineligible_pair(repo):
    app, actor, _, _, _ = pair(repo)
    repo.eligibility = False
    result = await Navigation(app, None).discoveries(actor)
    assert result['candidate_count'] == 0 and result['items'] == []
    repo.eligibility = True
    repo.tables['profile_previews'][1]['enabled'] = False
    result = await Navigation(app, None).discoveries(actor)
    assert result['candidate_count'] == 0 and result['items'] == []


async def test_invalid_recommendation_score_is_reported_as_unavailable(repo):
    app, actor, _, _, _ = pair(repo)
    repo.tables['match_scores'][0]['final_score'] = None
    result = await Navigation(app, None).discoveries(actor)
    assert result['items'] == []
    assert result['unavailable_count'] == 1


async def test_99_percent_recommendation_reaches_location_and_bluetooth_frontend(repo):
    app, actor, target, _, _ = pair(repo)
    repo.tables['match_scores'][0]['final_score'] = 0.9998361202710789
    repo.tables['encounters'] = [{'observer_user_id': actor,
        'observed_user_id': str(target.candidate_id), 'observed_at': iso()}]
    result = await Navigation(app, None).discoveries(actor, True, True)
    assert len(result['items']) == 1
    assert result['items'][0]['status'] == 'recommend'
    assert result['items'][0]['score'] == 0.9998361202710789
    assert result['items'][0]['sources'] == ['ble', 'nearby']
    assert result['insufficient_evidence_count'] == result['pending_count'] == 0


async def test_fifteen_percent_app_suggestion_reaches_discoveries_and_description(repo):
    app, actor, target, _, _ = pair(repo)
    repo.tables['match_scores'][0].update(status='not_recommended', reason='below_threshold', final_score=.15)
    nav = Navigation(app, None)
    result = await nav.discoveries(actor)
    assert len(result['items']) == 1 and result['items'][0]['score'] == .15
    assert result['items'][0]['model_status'] == 'not_recommended'
    assert result['not_recommended_count'] == 0
    await nav.target(actor, target)
    assert repo.tables['match_scores'][0]['status'] == 'not_recommended'


async def test_one_directional_recommendation_creates_shared_pair_without_leaking_reverse_score(repo):
    app, actor, target, _, _ = pair(repo)
    peer = str(target.candidate_id)
    viewer, candidate = repo.tables['profiles']
    repo.tables['match_scores'][0]['status'] = 'not_recommended'
    repo.tables['match_scores'][0]['final_score'] = .17
    add_score(repo, app.settings, candidate, viewer, value=.99)
    result = await Navigation(app, None).discoveries(actor)
    assert result['items'] == [] and result['not_recommended_count'] == 1
    assert '.99' not in str(result) and '0.99' not in str(result)
    assert ('rpc', 'suggest_connection_pair', {'p_viewer_id': actor,
        'p_candidate_id': peer, 'p_lifetime_seconds': 86400, 'p_mode': 'nearby'}) in repo.calls


async def test_prior_decline_suppresses_repeat_recommendation_popup(repo):
    app, actor, _, _, _ = pair(repo)
    repo.rpc_values['suggest_connection_pair'] = None
    result = await Navigation(app, None).discoveries(actor)
    assert result['items'] == []
    assert result['candidate_count'] == 1


async def test_radius_is_real_server_filter_and_snapshot_scope(repo):
    app, actor, target, _, _ = pair(repo)
    await app.update_settings(actor, {'discovery_radius_m': 200})
    assert (await app.jobs.nearby(actor))['items'] == []
    assert (await Navigation(app, None).discoveries(actor))['items'] == []
    with pytest.raises(AppError):
        await Navigation(app, None).target(actor, target)
    for value in (0, -1, 5000, float('inf'), float('nan')):
        with pytest.raises(AppError):
            await app.update_settings(actor, {'discovery_radius_m': value})
    await app.update_settings(actor, {'discovery_radius_m': 3218.688})
    page = await app.jobs.nearby(actor)
    await app.update_settings(actor, {'discovery_radius_m': 1000})
    with pytest.raises(AppError, match='radius'):
        await app.jobs.nearby(actor, app.jobs.cursor(page['snapshot_id'], 0))


@pytest.mark.parametrize('path', ['/v1/connections/page', '/v1/connections/constellation', '/v1/discoveries'])
async def test_new_reads_require_verified_auth(repo, path):
    owner = str(uuid4())
    app = create_app(Settings(_env_file=None, worker_enabled=False), repository=repo, authenticator=AccountAuth(owner))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
        assert (await client.get(path)).status_code == 401
    assert not repo.calls


async def test_saved_connection_controls_are_authenticated_and_actor_scoped(repo):
    actor, request_id = str(uuid4()), str(uuid4())
    repo.rpc_values['connection_history_preference'] = {'preference': 'liked'}
    repo.rpc_values['delete_connection_history'] = {'deleted': 2}
    app = create_app(Settings(_env_file=None, worker_enabled=False), repository=repo, authenticator=AccountAuth(actor))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
        assert (await client.put(f'/v1/connections/{request_id}/preference', json={'preference': 'liked'})).status_code == 401
        assert (await client.delete(f'/v1/connections/{request_id}')).status_code == 401
    assert not repo.calls
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test',
                                 headers={'Authorization': 'Bearer verified-session'}) as client:
        response = await client.put(f'/v1/connections/{request_id}/preference',
                                    json={'preference': 'liked', 'user_id': str(uuid4())})
        assert response.status_code == 422  # Extra actor fields are forbidden.
        response = await client.put(f'/v1/connections/{request_id}/preference', json={'preference': 'liked'})
        assert response.status_code == 200 and response.json() == {'preference': 'liked'}
        assert repo.calls[-1][1:] == ('connection_history_preference',
            {'p_user_id': actor, 'p_request_id': request_id, 'p_preference': 'liked'})
        response = await client.delete(f'/v1/connections/{request_id}?user_id={uuid4()}')
        assert response.status_code == 200 and response.json() == {'deleted': 2}
        assert repo.calls[-1][1:] == ('delete_connection_history',
            {'p_user_id': actor, 'p_request_id': request_id})


async def test_saved_connection_memory_is_authenticated_and_actor_scoped(repo):
    actor, request_id = str(uuid4()), str(uuid4())
    expected = {'available': True, 'preview': {'display_name': 'Fictional person', 'interests': ['art']},
                'facts': [], 'common_interests': ['art'], 'ideas': None}
    repo.rpc_values['navigation_connection_memory'] = expected
    app = create_app(Settings(_env_file=None, worker_enabled=False), repository=repo, authenticator=AccountAuth(actor))
    path = f'/v1/connections/{request_id}/memory'
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
        assert (await client.get(path)).status_code == 401
    assert not repo.calls
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test',
                                 headers={'Authorization': 'Bearer verified-session'}) as client:
        response = await client.get(path+'?user_id='+str(uuid4()))
        assert response.status_code == 200 and response.json() == expected
        assert repo.calls[-1][1:] == ('navigation_connection_memory',
            {'p_user_id': actor, 'p_request_id': request_id})
        repo.rpc_values['navigation_connection_memory'] = None
        assert (await client.get(path)).status_code == 404


async def test_constellation_is_authenticated_owner_scoped_and_not_page_limited(repo):
    actor = str(uuid4())
    nodes = [{'request_id': str(uuid4()), 'display_name': 'Fictional person', 'preference': 'liked'} for _ in range(13)]
    repo.rpc_values['navigation_constellation'] = {'nodes': nodes}
    app = create_app(Settings(_env_file=None, worker_enabled=False), repository=repo, authenticator=AccountAuth(actor))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test', headers={'Authorization': 'Bearer verified-session'}) as client:
        response = await client.get('/v1/connections/constellation?user_id='+str(uuid4()))
        assert response.status_code == 200 and response.headers['cache-control'] == 'no-store'
        assert response.json() == {'nodes': nodes}
        assert repo.calls[-1][1:] == ('navigation_constellation', {'p_user_id': actor})


async def test_query_route_uses_db_page_not_legacy_cap_and_validates_query(repo):
    actor = str(uuid4())
    repo.rpc_values['navigation_connections_page'] = {'items': [], 'total': 0, 'page': 1, 'pages': 1, 'page_size': 6}
    app = create_app(Settings(_env_file=None, worker_enabled=False), repository=repo, authenticator=AccountAuth(actor))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test', headers={'Authorization': 'Bearer verified-session'}) as client:
        response = await client.get('/v1/connections/page?q=ceramics&filter=liked&page=3')
        assert response.status_code == 200 and response.headers['cache-control'] == 'no-store'
        assert repo.calls[-1][2] == {'p_user_id': actor, 'p_query': 'ceramics', 'p_filter': 'liked', 'p_page': 3}
        for suffix in ('page=0', 'filter=private', 'q='+'x'*201):
            assert (await client.get('/v1/connections/page?'+suffix)).status_code == 422
        assert (await client.get('/v1/nearby?radius_m=5000')).status_code == 422


async def test_muse_receives_only_preview_topics_and_validated_internal_citations(repo):
    app, actor, target, own, other = pair(repo)
    requests = []
    async def respond(request):
        payload = json.loads(request.content)
        requests.append(payload)
        sources = json.loads(payload['messages'][-1]['content'])['sources']
        description, starters = allowed_wording('pottery')
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps({'description': description[0],
            'conversation_starter': starters[0], 'citations': sources, 'activities': []})}}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        provider = MuseProvider(Settings(_env_file=None, muse_api_key=SecretStr('fictional-test-key')), http)
        descriptions = MatchDescriptions(provider)
        nav = Navigation(app, descriptions)
        result = await descriptions.describe(nav, actor, target)
        assert result['status'] == 'ready' and result['provider'] == 'Muse'
        assert (await descriptions.describe(nav, actor, target)) == result and len(requests) == 1
        assert 'I am learning pottery.' not in str(requests) and 'onboarding_answers' not in str(requests)
        assert own['facts'][0]['evidence'][0]['reference_id'] not in str(requests)
        assert 'citations' not in result
        repo.tables['profiles'][1]['settings'] = {'muse_descriptions_enabled': False}
        assert (await descriptions.describe(nav, actor, target)) == result
        assert len(requests) == 1
    assert grounding(own, other, {'interests': ['secret']}, {'interests': ['secret']}) is None


@pytest.mark.parametrize('change', ['permission', 'profile', 'block', 'preview'])
async def test_inflight_muse_cannot_revive_revoked_context(repo, change):
    app, actor, target, _, _ = pair(repo)
    async def respond(request):
        sources = json.loads(json.loads(request.content)['messages'][-1]['content'])['sources']
        if change == 'permission':
            repo.tables['consent_receipts'][1]['revoked_at'] = iso()
        elif change == 'profile':
            repo.tables['profiles'][1]['current_profile_version_id'] = str(uuid4())
        elif change == 'block':
            repo.eligibility = False
        else:
            repo.tables['profile_previews'][1]['enabled'] = False
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps({'description': allowed_wording('pottery')[0][0],
            'conversation_starter': allowed_wording('pottery')[1][0], 'citations': sources, 'activities': []})}}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        descriptions = MatchDescriptions(MuseProvider(Settings(_env_file=None, muse_api_key=SecretStr('fictional')), http))
        with pytest.raises(AppError):
            await descriptions.describe(Navigation(app, descriptions), actor, target)
        assert not descriptions.cache


async def test_muse_rejects_invented_traits_with_explicit_fallback(repo):
    app, actor, target, _, _ = pair(repo)
    async def respond(request):
        sources = json.loads(json.loads(request.content)['messages'][-1]['content'])['sources']
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps({'description': 'You are both expert potters and adventurous.',
            'conversation_starter': 'How long have you been experts?', 'citations': sources, 'activities': []})}}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        provider = MuseProvider(Settings(_env_file=None, muse_api_key=SecretStr('fictional')), http)
        descriptions = MatchDescriptions(provider)
        result = await descriptions.describe(Navigation(app, descriptions), actor, target)
        assert result['status'] == 'ready' and result['source'] == 'fallback' and result['provider'] is None
        assert 'expert' not in json.dumps(result)
        provider.settings.muse_api_key = SecretStr('')
        assert (await descriptions.describe(Navigation(app, descriptions), actor, target))['source'] == 'fallback'


@pytest.mark.parametrize('granted', [False, True])
@pytest.mark.parametrize('stale_choice', [None, False, True])
async def test_profile_edit_preserves_current_consent_and_evidence(repo, granted, stale_choice):
    import copy

    actor, row = add_profile(repo)
    if not granted:
        repo.tables['consent_receipts'][0]['revoked_at'] = iso()
    answers = copy.deepcopy(repo.tables['onboarding_answers'])
    receipts = copy.deepcopy(repo.tables['consent_receipts'])
    request = ReviewRequest(profile=ProfileDraft.model_validate({k: row[k] for k in ProfileDraft.model_fields}),
        settings={'matching_context': 'learn'}, matching_consent=stale_choice, update_preview=False)
    result = await configured_application(repo).review(actor, request, editing=True)
    assert result['matching_consent'] is granted
    assert repo.tables['consent_receipts'] == receipts
    assert repo.tables['onboarding_answers'] == answers
    assert not any(c[1] in ('consent_receipts', 'phone_ble_sessions') for c in repo.calls)
    publication = next(c[2] for c in repo.calls if c[:2] == ('rpc', 'publish_profile'))
    assert publication['p_preview'] == {}
    assert publication['p_profile']['facts'][0]['evidence'] == row['facts'][0]['evidence']


@pytest.mark.parametrize('explicit_choice', [None, False, True])
async def test_initial_review_preserves_opt_out_without_hidden_consent(repo, explicit_choice):
    actor, row = add_profile(repo)
    repo.tables['profiles'][0]['current_profile_version_id'] = None
    repo.tables['consent_receipts'] = []
    repo.rpc_values['start_onboarding'] = {'session_id': row['onboarding_session_id'], 'status': 'awaiting_confirmation'}
    request = ReviewRequest(profile=ProfileDraft.model_validate({k: row[k] for k in ProfileDraft.model_fields}),
        settings={'matching_context': 'learn'}, matching_consent=explicit_choice)
    result = await configured_application(repo).review(actor, request)
    assert result['matching_consent'] is (explicit_choice is True)
    if explicit_choice is None:
        assert not any(c[1] == 'consent_receipts' for c in repo.calls)


async def test_settings_consent_is_durable_owner_scoped_and_never_enables_discovery(repo):
    actor, _ = add_profile(repo)
    repo.tables['consent_receipts'] = []
    app = create_app(Settings(_env_file=None, worker_enabled=False), repository=repo, authenticator=AccountAuth(actor))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test', headers={'Authorization': 'Bearer verified-session'}) as client:
        for granted in (True, True, False):
            result = await client.post('/v1/consents', json={'purpose': 'personal_matching', 'granted': granted})
            assert result.status_code == 200 and result.json()['granted'] is granted
            assert (await app.state.application.consent(actor)) is granted
            assert not repo.tables['profiles'][0]['discoverable'] and not repo.tables['profiles'][0]['bluetooth_enabled']
        assert len(repo.tables['consent_receipts']) == 1
        assert repo.tables['consent_receipts'][0]['user_id'] == actor
        forged = await client.post('/v1/consents', json={'purpose': 'personal_matching', 'granted': True, 'user_id': str(uuid4())})
        assert forged.status_code == 422

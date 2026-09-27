"""Scoped description generation with fictional profiles and mocked Muse only."""

import copy
import json
from uuid import UUID, uuid4

import httpx
import pytest
from sidebyside_api.activities import candidates
from sidebyside_api.config import Settings
from sidebyside_api.errors import AppError
from sidebyside_api.match_descriptions import MatchDescriptions, approved_topics, grounding
from sidebyside_api.navigation import Navigation
from sidebyside_api.onboarding import MuseProvider
from sidebyside_api.topic_boundaries import topic_boundaries
from test_activities import activity, response, valid_reply
from test_discovery import add_score
from test_navigation import pair


def add_topic(version, topic, **changes):
    fact = copy.deepcopy(version['facts'][0])
    fact.update(topic=topic, **changes)
    version['facts'].insert(0, fact)


@pytest.mark.parametrize('side', [0, 1])
@pytest.mark.parametrize('label,excluded', [
    ('politics', 'elections'), ('religion', 'religious art'), ('dating', 'dating'),
    ('romance', 'romantic walks'), ('sex', 'sexual art'), ('sexual content', 'erotic art'),
])
async def test_description_only_sends_pair_scoped_approved_topics(repo, side, label, excluded):
    app, actor, target, own, other = pair(repo)
    (own, other)[side]['avoid_topics'] = [label]
    for index, version in enumerate((own, other)):
        add_topic(version, excluded)
        repo.tables['profile_previews'][index]['preview']['interests'] = [excluded, 'pottery', 'private unapproved topic']
    repo.tables['activity_catalog'] = [activity('unsafe', summary=excluded), activity('safe')]
    originals = copy.deepcopy(repo.tables)
    requests = []

    def respond(request):
        requests.append(request)
        return response(valid_reply(request))

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        descriptions = MatchDescriptions(MuseProvider(Settings(_env_file=None, muse_api_key='fictional'), client))
        result = await descriptions.describe(Navigation(app, descriptions), actor, target)
    assert result['source'] == 'muse'
    assert result['basis'] == 'shared_preview_topic'
    assert [item['id'] for item in result['activities']] == ['safe']
    payload = json.loads(json.loads(requests[0].content)['messages'][-1]['content'])
    assert payload['approved_topics'] == {'viewer': ['pottery'], 'candidate': ['pottery']}
    assert [source['quote'] for source in payload['sources']] == ['pottery', 'pottery']
    wire = requests[0].content.decode()
    for private in (label, excluded, 'private unapproved topic', 'avoid_topics', 'I am learning pottery.'):
        assert private not in wire
    assert repo.tables == originals


@pytest.mark.parametrize('field', ['details', 'motivation'])
def test_safe_label_does_not_approve_a_fact_that_depends_on_excluded_topics(repo, field):
    _, _, _, own, other = pair(repo)
    own['avoid_topics'] = ['politics']
    other['facts'][0][field] = 'Pottery used for political campaigns'
    preview = {'interests': ['pottery']}
    assert approved_topics(other, preview, boundaries=topic_boundaries(own, other)) == []
    assert grounding(own, other, preview, preview) is None


def test_full_cited_answer_is_checked_without_rewriting_support_or_source(repo):
    _, _, _, own, other = pair(repo)
    own['avoid_topics'] = ['politics']
    other['onboarding_answers'][0]['answer_text'] += ' I also like political campaigns.'
    originals = copy.deepcopy([own, other])
    preview = {'interests': ['pottery']}
    assert approved_topics(other, preview, boundaries=topic_boundaries(own, other)) == []
    assert grounding(own, other, preview, preview) is None
    assert [own, other] == originals


@pytest.mark.parametrize('changes', [
    {'title': 'Political art'}, {'summary': 'Discuss elections'}, {'venue': 'Political center'},
    {'area': 'Political district'}, {'tags': ['pottery', 'elections']},
    {'cost_note': 'Supports political campaigns'}, {'eligibility_note': 'Political discussion'},
    {'source_name': 'Political art group'}, {'source_url': 'https://example.org/politics'},
    {'id': 'political-park'},
])
async def test_full_public_activity_text_is_filtered_before_shortlist_and_venue_dedup(repo, changes):
    repo.tables['activity_catalog'] = [
        {**activity(f'a-{index}', venue='Shared park', tags=['pottery']), **changes}
        for index in range(8)
    ]
    repo.tables['activity_catalog'].append(activity('z-safe', venue='Shared park', tags=['pottery']))
    result = await candidates(repo, ['pottery'], ['pottery'], limit=1,
                              boundaries=topic_boundaries({'avoid_topics': ['politics']}))
    assert [item.id for item in result] == ['z-safe']


async def test_invitation_options_are_filtered_before_activity_selection(repo, monkeypatch):
    repo.tables['activity_catalog'] = [activity('a-unsafe'), activity('z-safe')]
    monkeypatch.setattr('sidebyside_api.activities.invitation_options', lambda item:
                        ['Talk politics?'] if item.id == 'a-unsafe' else ['Explore the park?'])
    result = await candidates(repo, [], [], limit=1,
                              boundaries=topic_boundaries({'avoid_topics': ['politics']}))
    assert [item.id for item in result] == ['z-safe']


@pytest.mark.parametrize('provider', ['ready', 'offline', 'invalid'])
async def test_no_safe_catalog_candidates_never_revives_forbidden_fallbacks(repo, provider):
    app, actor, target, own, _ = pair(repo)
    own['avoid_topics'] = ['politics']
    repo.tables['activity_catalog'] = [activity(summary='Discuss politics together')]

    def respond(request):
        assert json.loads(json.loads(request.content)['messages'][-1]['content'])['activities'] == []
        return response(valid_reply(request)) if provider == 'ready' else httpx.Response(503)

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        descriptions = MatchDescriptions(MuseProvider(Settings(_env_file=None,
            muse_api_key='' if provider == 'offline' else 'fictional'), client))
        result = await descriptions.describe(Navigation(app, descriptions), actor, target)
    assert result['activities'] == []
    assert 'activities_message' in result
    assert 'politic' not in json.dumps(result)


@pytest.mark.parametrize('side', [0, 1])
@pytest.mark.parametrize('conflict', ['unknown', 'goal', 'intent', 'request_goal', 'requirement'])
async def test_unresolvable_pair_skips_muse_and_preserves_saved_history(repo, side, conflict):
    app, actor, target, own, other = pair(repo)
    profile = (own, other)[side]
    profile['avoid_topics'] = ['politics']
    if conflict == 'unknown':
        profile['avoid_topics'].append('private nuanced boundary')
    elif conflict == 'goal':
        profile['current_goal'] = 'Discuss elections'
    elif conflict == 'intent':
        profile['conversation_intent'] = 'political discussion'
    elif conflict == 'request_goal':
        profile['conversation_request'] = {'goal': 'Discuss elections'}
    else:
        profile['conversation_request'] = {'evidence_requirement': {'claim': 'political experience'}}
    request_id = str(uuid4())
    target = target.model_copy(update={'connection_id': UUID(request_id)})
    repo.rpc_values['navigation_connection'] = {
        'status': 'accepted', 'candidate_id': str(target.candidate_id),
        'viewer_version_id': str(target.viewer_version_id),
        'candidate_version_id': str(target.candidate_version_id),
    }
    repo.tables['connection_match_ideas'] = [{'request_id': request_id, 'ideas': {'description': 'Saved politics discussion'}}]
    repo.tables['connection_memories'] = [{'request_id': request_id, 'notes': 'Historical conversation'}]
    original = copy.deepcopy(repo.tables)

    def respond(request):
        raise AssertionError('Unresolved pair must not reach Muse')

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        descriptions = MatchDescriptions(MuseProvider(Settings(_env_file=None, muse_api_key='fictional'), client))
        result = await descriptions.describe(Navigation(app, descriptions), actor, target)
    assert result == {'status': 'unavailable', 'message': 'Conversation ideas are not available for these profiles.'}
    assert repo.tables == original
    assert not any(call[1] == 'save_connection_match_ideas' for call in repo.calls)


async def test_new_profile_version_invalidates_target_and_cached_ideas_with_same_preview(repo):
    app, actor, target, own, _ = pair(repo)
    requests = []

    def respond(request):
        requests.append(request)
        return response(valid_reply(request))

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        descriptions = MatchDescriptions(MuseProvider(Settings(_env_file=None, muse_api_key='fictional'), client))
        nav = Navigation(app, descriptions)
        await descriptions.describe(nav, actor, target)
        version = {**copy.deepcopy(own), 'profile_version_id': str(uuid4()), 'avoid_topics': ['politics']}
        repo.tables['profile_versions'].append(version)
        repo.tables['profiles'][0]['current_profile_version_id'] = version['profile_version_id']
        with pytest.raises(AppError) as error:
            await descriptions.describe(nav, actor, target)
        assert error.value.code == 'profile_changed'
        assert len(requests) == 1
        add_score(repo, app.settings, *repo.tables['profiles'])
        updated = target.model_copy(update={'viewer_version_id': UUID(version['profile_version_id'])})
        await descriptions.describe(nav, actor, updated)
        assert len(requests) == 2


async def test_boundary_edit_during_generation_discards_result_before_saving(repo):
    app, actor, target, own, _ = pair(repo)

    def respond(request):
        own['avoid_topics'] = ['politics']
        return response(valid_reply(request))

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        descriptions = MatchDescriptions(MuseProvider(Settings(_env_file=None, muse_api_key='fictional'), client))
        with pytest.raises(AppError) as error:
            await descriptions.describe(Navigation(app, descriptions), actor, target)
        assert error.value.code == 'description_changed'
        assert not descriptions.cache
    assert not any(call[1] == 'save_connection_match_ideas' for call in repo.calls)


async def test_saved_historical_ideas_are_not_grounding_for_new_suggestions(repo):
    app, actor, target, own, _ = pair(repo)
    own['avoid_topics'] = ['politics']
    request_id = str(uuid4())
    target = target.model_copy(update={'connection_id': UUID(request_id)})
    history = {'description': 'Old political discussion', 'conversation_starter': 'Discuss elections?'}
    repo.rpc_values['navigation_connection'] = {
        'status': 'accepted', 'candidate_id': str(target.candidate_id),
        'viewer_version_id': str(target.viewer_version_id),
        'candidate_version_id': str(target.candidate_version_id), 'ideas': history,
    }
    repo.rpc_values['save_connection_match_ideas'] = None
    repo.rpc_values['navigation_connection_memory'] = {'ideas': history}

    def respond(request):
        assert 'political' not in request.content.decode()
        assert 'elections' not in request.content.decode()
        return response(valid_reply(request))

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        descriptions = MatchDescriptions(MuseProvider(Settings(_env_file=None, muse_api_key='fictional'), client))
        nav = Navigation(app, descriptions)
        result = await descriptions.describe(nav, actor, target)
        assert result['basis'] == 'shared_preview_topic' and 'pottery' in result['conversation_starter']
        assert await nav.connection_memory(actor, request_id) == {'ideas': history}
    assert 'political' not in json.dumps(result)

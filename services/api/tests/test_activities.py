"""Fictional source catalog, verified fake profiles, and mocked Muse only."""

import asyncio
import copy
import json

import httpx
import pytest
from conftest import iso
from pydantic import SecretStr
from sidebyside_api.activities import Activity, activity_reason, candidates, eligible
from sidebyside_api.config import Settings
from sidebyside_api.errors import AppError
from sidebyside_api.jobs import now
from sidebyside_api.match_descriptions import MatchDescriptions, allowed_wording, approved_topics
from sidebyside_api.navigation import Navigation
from sidebyside_api.onboarding import MuseProvider
from test_navigation import pair


def activity(identifier='fictional-park', **overrides):
    return {'id': identifier, 'kind': 'evergreen', 'title': 'Explore the fictional park',
            'summary': 'An imagined park used only in tests.', 'venue': identifier, 'area': 'Atlanta',
            'tags': ['walking', 'outdoors'], 'cost': 'free', 'cost_note': 'No admission charge.',
            'eligibility': 'public', 'eligibility_note': 'Public trails.', 'duration_minutes': 45,
            'indoor': False, 'source_url': 'https://example.org/park', 'source_name': 'Fictional park',
            'source_checked_at': iso(-60), 'review_after': iso(3600),
            'starts_at': None, 'ends_at': None, 'status': 'active', **overrides}


def valid_reply(request):
    payload = json.loads(request.content)
    sources = json.loads(payload['messages'][-1]['content'])
    topic = sources['sources'][0]['quote'] if sources['sources'] else None
    descriptions, starters = allowed_wording(topic)
    result = {'description': descriptions[0], 'conversation_starter': starters[0],
              'citations': sources['sources'],
              'activities': [{'activity_id': a['activity_id'], 'invitation': a['invitation_options'][0]}
                             for a in sources['activities'][:3]]}
    return result


def response(value):
    return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(value)}}]})


async def test_rank_benefits_both_people_before_many_interests_for_one(repo):
    repo.tables['activity_catalog'] = [
        activity('one-person', tags=['walking', 'photography', 'gardens']),
        activity('both-people', tags=['walking', 'art'], cost='paid'),
        activity('neither-person', tags=['games']),
    ]
    result = await candidates(repo, ['walking', 'photography', 'gardens'], ['art'])
    assert [item.id for item in result] == ['both-people', 'one-person', 'neither-person']
    assert activity_reason(result[0], ['walking'], ['art'])[0] == 'both_interests'
    assert activity_reason(result[1], ['walking'], ['art'])[0] == 'one_interest'


async def test_tag_ranking_ignores_stopwords_and_normalizes_small_explicit_aliases(repo):
    repo.tables['activity_catalog'] = [activity('unrelated', tags=['the', 'and', 'in']),
        activity('related', tags=['arts', 'walk'])]
    result = await candidates(repo, ['the art and walking'], ['walks in a park'])
    assert [item.id for item in result] == ['related', 'unrelated']
    assert activity_reason(result[1], ['the art and walking'], ['walks in a park'])[0] == 'general_activity'


@pytest.mark.parametrize('changes', [
    {'eligibility': 'gt_community'}, {'eligibility': 'students'}, {'eligibility': 'unknown'},
    {'eligibility_note': 'Ages 21+.'}, {'status': 'cancelled'}, {'status': 'archived'},
    {'review_after': iso(-1)}, {'source_checked_at': iso(60)},
    {'kind': 'event'}, {'kind': 'recurring'},
    {'kind': 'event', 'starts_at': iso(-100), 'ends_at': iso(100)},
    {'kind': 'event', 'starts_at': iso(-200), 'ends_at': iso(-100)},
    {'kind': 'event', 'starts_at': iso(200), 'ends_at': iso(100)},
])
async def test_restricted_unverified_cancelled_or_expired_records_are_excluded(repo, changes):
    repo.tables['activity_catalog'] = [activity(**changes)]
    assert await candidates(repo, [], []) == []


async def test_invalid_source_url_is_not_shown_and_duplicates_do_not_fill_list(repo):
    repo.tables['activity_catalog'] = [activity('bad-link', source_url='javascript:alert(1)'),
        activity('park-a', venue='Same park'), activity('park-b', venue='Same park'),
        activity('other-park', venue='Other park')]
    assert {item.id for item in await candidates(repo, [], [])} == {'park-a', 'other-park'}
    assert eligible(Activity.model_validate(activity('future-event', kind='event',
        starts_at=iso(600), ends_at=iso(3600))), now())


async def test_no_shared_topic_still_uses_muse_with_truthful_generic_opener(repo):
    app, actor, target, own, other = pair(repo)
    other['facts'][0]['topic'] = 'art'
    repo.tables['profile_previews'][1]['preview']['interests'] = ['art']
    repo.tables['activity_catalog'] = [activity(tags=['pottery', 'art'])]
    requests = []

    async def respond(request):
        requests.append(request)
        return response(valid_reply(request))

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        descriptions = MatchDescriptions(MuseProvider(Settings(_env_file=None, muse_api_key=SecretStr('fictional')), http))
        result = await descriptions.describe(Navigation(app, descriptions), actor, target)
    assert result['source'] == 'muse' and result['basis'] == 'approved_preview_topics'
    assert result['activities'][0]['basis'] == 'both_interests'
    assert 'both chose' not in result['description']
    sent = requests[0].content.decode()
    assert actor not in sent and str(target.candidate_id) not in sent and 'I am learning pottery.' not in sent
    assert own['onboarding_answers'][0]['answer_id'] not in sent
    assert 'Private name' not in sent and 'latitude' not in sent


async def test_muse_selects_and_orders_real_shortlist_records_and_server_retains_facts(repo):
    app, actor, target, _, _ = pair(repo)
    repo.tables['activity_catalog'] = [activity('place-'+str(index)) for index in range(6)]

    async def respond(request):
        value = valid_reply(request)
        sources = json.loads(json.loads(request.content)['messages'][-1]['content'])
        choices = sources['activities']
        assert json.loads(request.content)["reasoning_effort"] == "minimal"
        assert len(choices) == 6 and all('summary' in item and 'tags' in item for item in choices)
        value['activities'] = [{'activity_id': choices[index]['activity_id'],
                                'invitation': choices[index]['invitation_options'][1]} for index in (5, 2, 4)]
        return response(value)

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        descriptions = MatchDescriptions(MuseProvider(Settings(_env_file=None, muse_api_key=SecretStr('fictional')), http))
        result = await descriptions.describe(Navigation(app, descriptions), actor, target)
    assert result['source'] == 'muse'
    assert [item['id'] for item in result['activities']] == ['place-5', 'place-2', 'place-4']
    assert result['activities'][0]['cost'] == 'free'
    assert result['activities'][0]['source_name'] == 'Fictional park'


def test_unapproved_or_uncorroborated_topics_never_reach_muse(repo):
    _, _, _, own, _ = pair(repo)
    assert approved_topics(own, {'interests': ['secret', 'pottery']}) == ['pottery']
    own['facts'][0]['confirmation'] = 'unconfirmed'
    assert approved_topics(own, {'interests': ['pottery']}) == []
    own['facts'][0]['confirmation'] = 'confirmed'
    own['facts'][0]['evidence'][0]['support'] = 'invented quotation'
    assert approved_topics(own, {'interests': ['pottery']}) == []


@pytest.mark.parametrize('change', ['id', 'invitation', 'extra_source_fact', 'duplicate'])
async def test_muse_invented_activities_or_facts_are_replaced_with_labeled_fallback(repo, change):
    app, actor, target, _, _ = pair(repo)
    repo.tables['activity_catalog'] = [activity()]

    async def respond(request):
        value = valid_reply(request)
        if change == 'id':
            value['activities'][0]['activity_id'] = 'invented-event'
        elif change == 'invitation':
            value['activities'][0]['invitation'] = 'Meet at 8pm for a free concert with guaranteed tickets.'
        elif change == 'extra_source_fact':
            value['activities'][0]['price'] = 0
        else:
            value['activities'].append(copy.deepcopy(value['activities'][0]))
        return response(value)

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        descriptions = MatchDescriptions(MuseProvider(Settings(_env_file=None, muse_api_key=SecretStr('fictional')), http))
        result = await descriptions.describe(Navigation(app, descriptions), actor, target)
    assert result['source'] == 'fallback' and result['provider'] is None
    assert result['activities'][0]['source_url'] == 'https://example.org/park'
    assert 'invented-event' not in str(result) and '8pm' not in str(result)


@pytest.mark.parametrize('change', ['cancel', 'expire', 'source', 'preview'])
async def test_inflight_activity_or_preview_change_invalidates_entire_response(repo, change):
    app, actor, target, _, _ = pair(repo)
    repo.tables['activity_catalog'] = [activity()]

    async def respond(request):
        value = valid_reply(request)
        if change == 'cancel':
            repo.tables['activity_catalog'][0]['status'] = 'cancelled'
        elif change == 'expire':
            repo.tables['activity_catalog'][0]['review_after'] = iso(-1)
        elif change == 'source':
            repo.tables['activity_catalog'][0]['source_url'] = 'https://example.org/changed'
        else:
            repo.tables['profile_previews'][0]['preview']['interests'] = []
        return response(value)

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        descriptions = MatchDescriptions(MuseProvider(Settings(_env_file=None, muse_api_key=SecretStr('fictional')), http))
        with pytest.raises(AppError, match='changed'):
            await descriptions.describe(Navigation(app, descriptions), actor, target)
        assert not descriptions.cache


async def test_concurrent_polls_share_one_muse_call_and_cache_rechecks_catalog(repo):
    app, actor, target, _, _ = pair(repo)
    repo.tables['activity_catalog'] = [activity()]
    started, release = asyncio.Event(), asyncio.Event()
    calls = 0

    async def respond(request):
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()
        return response(valid_reply(request))

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        descriptions = MatchDescriptions(MuseProvider(Settings(_env_file=None, muse_api_key=SecretStr('fictional')), http))
        nav = Navigation(app, descriptions)
        requests = [asyncio.create_task(descriptions.describe(nav, actor, target)) for _ in range(12)]
        await started.wait()
        release.set()
        results = await asyncio.gather(*requests)
        assert calls == 1 and all(result == results[0] for result in results)
        assert await descriptions.describe(nav, actor, target) == results[0] and calls == 1
        repo.tables['activity_catalog'][0]['status'] = 'cancelled'
        refreshed = await descriptions.describe(nav, actor, target)
        assert refreshed['activities'] == [] and calls == 2


async def test_total_provider_deadline_returns_fallback_and_does_not_retry_on_poll(repo):
    app, actor, target, _, _ = pair(repo)
    calls = 0

    async def respond(request):
        nonlocal calls
        calls += 1
        await asyncio.Event().wait()

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        descriptions = MatchDescriptions(MuseProvider(Settings(_env_file=None, muse_api_key=SecretStr('fictional')), http))
        descriptions.provider_deadline = 0.01
        nav = Navigation(app, descriptions)
        result = await descriptions.describe(nav, actor, target)
        assert result['source'] == 'fallback' and result['activities'] == []
        assert 'activities_message' in result
        assert await descriptions.describe(nav, actor, target) == result and calls == 1


async def test_missing_catalog_schema_is_explicit_and_never_calls_muse(repo):
    app, actor, target, _, _ = pair(repo)
    select = repo.select

    async def missing(table, *args, **kwargs):
        if table == 'activity_catalog':
            raise AppError(503, 'database_schema_unavailable', 'Schema not available')
        return await select(table, *args, **kwargs)

    repo.select = missing
    async with httpx.AsyncClient() as http:
        descriptions = MatchDescriptions(MuseProvider(Settings(_env_file=None), http))
        with pytest.raises(AppError) as error:
            await descriptions.describe(Navigation(app, descriptions), actor, target)
        assert error.value.code == 'database_schema_unavailable'
        assert not descriptions.cache

from sidebyside_api.config import Settings
from sidebyside_api.main import create_app


async def test_demo_readiness_is_actor_scoped_without_loading_a_model(repo):
    settings = Settings(_env_file=None, worker_enabled=False, matching_execution='remote', matching_demo_worker_enabled=True)
    jobs = create_app(settings, repository=repo).state.application.jobs
    repo.rpc_values['demo_worker_readiness'] = {'status': 'ready'}
    result = await jobs.model_readiness('fictional-owner')
    assert result['available'] and result['scope'] == 'fictional_demo_only'
    assert repo.calls[-1] == ('rpc', 'demo_worker_readiness', {'p_user_id': 'fictional-owner'})
    repo.rpc_values['demo_worker_readiness'] = {'status': 'offline'}
    assert not (await jobs.model_readiness('fictional-owner'))['available']


async def test_demo_candidates_and_eligibility_use_private_scope(repo):
    settings = Settings(_env_file=None, worker_enabled=False, matching_demo_worker_enabled=True)
    jobs = create_app(settings, repository=repo).state.application.jobs
    repo.rpc_values['demo_worker_candidates'] = []
    assert await jobs.candidates('fictional-owner') == []
    assert repo.calls[-1][1] == 'demo_worker_candidates'
    repo.rpc_values['demo_worker_pair_supported'] = False
    assert not await jobs.eligible('fictional-owner', 'fictional-peer')
    assert not any(call[1] == 'eligible_pair' for call in repo.calls)


async def test_ordinary_discovery_preserves_existing_two_mile_rpc(repo):
    jobs = create_app(Settings(_env_file=None, worker_enabled=False), repository=repo).state.application.jobs
    await jobs.candidates('fictional-owner')
    assert repo.calls[-1] == ('rpc', 'nearby_candidates', {'p_viewer_id': 'fictional-owner', 'p_radius_m': 3218.688})

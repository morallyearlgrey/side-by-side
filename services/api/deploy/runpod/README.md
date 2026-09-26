# RunPod matching worker

This is a standalone queue worker for the pinned SidebySide matching pipeline.
It polls Supabase outbound and exposes no public inference endpoint. Vercel
remains the app-facing API; the Pod only loads the models, claims eligible
matching jobs, and publishes version-checked results.

## 1. Stage and verify the model

The deployment files must be present in the repository checkout on the Pod.
First publish them to the branch you plan to clone; they are not in GitHub yet
from this working tree. Then, from the RunPod terminal, clone the project if it
is not already there. Use your normal GitHub authentication flow if the
repository asks for it; never put a GitHub token in a clone URL or chat.

```sh
git clone --branch codex/runpod-matching-worker https://github.com/morallyearlgrey/side-by-side.git /workspace/side-by-side
cd /workspace/side-by-side
bash services/api/deploy/runpod/start_worker.sh --stage-models --preflight-only
```

This installs an isolated Python 3.12/3.13 environment, downloads the three
pinned model snapshots, and loads them on the Pod GPU using fixed fictional
probes. It does not connect to Supabase or process account data. The first
download needs outbound Hugging Face access and enough free disk for the
weights. The container disk is temporary; if you stop the Pod, its contents may
be erased. A mounted persistent volume at `/workspace` will preserve the
checkout and model cache across stops.

The starter uses a separate Python environment and the repo's tested CUDA 12.6
PyTorch build rather than changing the template's preinstalled PyTorch. The
preflight stops if CUDA, any pinned model, or inference probes fail. Fix that
first; do not add credentials to troubleshoot model loading.

## 2. Configure the backend

The app-facing API stays on Vercel and must point at the remote worker. Set
these server-side Vercel environment variables, then redeploy the API:

```dotenv
MATCHING_EXECUTION=remote
WORKER_ENABLED=false
MATCHING_WARM_ON_STARTUP=false
MATCHING_PROVIDER=qwen
MATCHING_MODEL_ID=Qwen/Qwen3-Reranker-4B
MATCHING_MODEL_REVISION=22e683669bc0f0bd69640a1354a6d0aebcfeede5
```

Confirm Supabase migrations through `202609260003` are already applied before
starting the worker. Do not apply migrations from the Pod as part of this
runbook.

## 3. Add the worker credential and start

For a one-session demo, enter the URL and hidden key prompt in the RunPod
terminal below. Use the Supabase `service_role` key for the current code, not
the app's publishable key. The URL is not secret; the service-role key is highly
privileged and bypasses Supabase row-level security. It must never be in the
app, source control, screenshots, or chat.

If you instead save the key in RunPod Pod environment settings, it is available
to processes inside the Pod, including anyone with terminal/root access; it is
not isolated from the running Pod. Only do that on a Pod and account you
control. Supabase recommends server-side-only handling of these keys.

The worker rechecks both users' personal-matching consent, availability,
blocks, profile versions, and nearby/Bluetooth eligibility before scoring.
This is an application-level eligibility gate, not a restricted database role:
the service-role credential itself has broader access. Keep the Pod private
and rotate the key if it is exposed.

In the RunPod terminal, set the public project URL and enter the key at the
silent prompt. The key is not echoed or added to shell history. It remains
available to processes in this Pod session while the worker runs.

```sh
cd /workspace/side-by-side
export SUPABASE_URL='https://YOUR_PROJECT.supabase.co'
read -r -s -p 'Supabase service_role key (input hidden): ' SUPABASE_SERVICE_ROLE_KEY
printf '\n'
export SUPABASE_SERVICE_ROLE_KEY
bash services/api/deploy/runpod/start_worker.sh
```

Keep that terminal process running during the demo. The worker sends a
readiness heartbeat every 20 seconds; the API considers it stale after 90
seconds.

## 4. Verify and control cost

Verify readiness from the deployed API:

```sh
curl -fsS https://YOUR_API_HOST/health
```

`matching.available` should become `true` within about 90 seconds of the worker
warming successfully. Then use two eligible, consenting app profiles to
confirm the queue produces results. If the Pod stops, the heartbeat expires and
the API reports inference unavailable.

At the price shown in your RunPod screenshot, the A40 plus container disk is
about `$0.50/hour` (roughly `$12/day` if left running continuously). Stop the
Pod outside the demo; a stopped Pod will not process matches, and its container
disk may not retain the model cache.

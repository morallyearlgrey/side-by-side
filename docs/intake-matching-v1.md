# Intake Matching v1

This is a private evaluation pipeline for the HackGT intake dashboard. It is
separate from app-account matching and the Newton research jobs.

## Input and consent

- The worker accepts only `pilot-review-v1` records from real opt-in responses
  whose consent version is `private-pilot-runpod-v2`.
- The response is adapted as its original six answer sources. The adapter does
  not extract or manufacture confirmed profile facts.
- Display names and receipt IDs are not included in model prompts. Answer IDs
  are retained in result provenance.
- `training_allowed` and `public_sharing_allowed` must remain false. No model
  training or fine-tuning occurs.
- Older responses remain viewable to organizers but cannot be queued.

## Scoring

For each unordered pair, Qwen scores each participant's current goal against
the other person's interests, experience, goal, open topics, and stated
experience preference. Both participants' boundaries are included as
constraints. The pair's sort key is the lower of its two directional raw
relevance scores; ties are deterministic by receipt ID.

The Qwen yes-token score is uncalibrated for these raw intake prompts. It is a
relative ordering signal for this pilot, not a human compatibility probability,
friendship prediction, or automatic decision to introduce people. The worker
returns all successfully scored pairs, including low-scoring ones, and reports
inference abstentions separately. It does not make one-to-one assignments, so
one participant may appear in several high-ranked pairs.

The pilot uses no Instagram evidence. There is no generated match explanation
or conversation starter in this result contract. Pair results retain the answer
IDs supplied as inputs to each direction, privately for authorized organizers;
these IDs are not model-extracted evidence for the score.

## Serving

The app-facing process creates a private batch row. The RunPod process polls
Supabase with its service-role credential and writes a private result after
rechecking each participant's current consent. It exposes no HTTP port. The
dashboard reads batches only after organizer authentication. A fresh worker
heartbeat is required before queueing. `INTAKE_MATCHING_ENABLED` defaults to
false and must be enabled only on the approved RunPod worker after applying
`202609261700_pilot_matching_worker.sql` and deploying the updated code.

The model/prompt/pipeline identity is stored alongside each result. Keep
exports, logs, screenshots, and local copies private; free text can identify
participants. Delete result copies when deleting a participant's response.

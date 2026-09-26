# Muse response latency

The mobile onboarding guide and match wording call Meta's hosted Muse API.
They do not use the university Qwen matching worker. A health response of
`matching.reason=remote_worker_not_connected` requires starting the matching
worker; changing Muse settings does not restore recommendations.

## Request settings

- Keep `muse-spark-1.3` on the Standard tier.
- Set `MUSE_REASONING_EFFORT=minimal` by default for short onboarding questions,
  conversation starters, and activity wording. Meta documents this as the
  shortest reasoning pass; `none` is unsupported. Increasing effort increases
  latency. These settings belong to each API request, not the playground.
- Retain enough completion tokens for both hidden reasoning and the validated
  JSON draft. A token ceiling is not a requirement to generate that many tokens.
- Onboarding has a 25-second total provider deadline, configurable with
  `MUSE_ONBOARDING_TIMEOUT_SECONDS` from 1 to 30 seconds. The phone request cap
  is 45 seconds, replacing the former two-minute wait. The provider deadline
  excludes database/authentication work; the phone cap covers the whole request.
- Citation records contain only the saved answer ID and exact answer text.
  Account IDs, session IDs, and timestamps are unnecessary provider context.
- All three Muse paths request schema-constrained JSON output. Local schema,
  exact-evidence, and activity-catalog checks still validate the result.
- Answers are saved before generation. Failures preserve the answer for an
  explicit retry with its existing message ID. No automatic paid generation
  retry is added.

Evidence checks and explicit profile approval still apply. Faster generation
does not approve facts, grant matching consent, or bypass match eligibility.

## Measurements

On September 26, 2026, fictional short onboarding prompts using the original
effort setting completed in 19.75, 22.19, and 23.61 seconds. The first same-input
comparison at minimal effort took 7.40 seconds versus 23.61 seconds; reasoning
tokens fell from 2,157 to 282. Both responses passed schema and exact-evidence
validation with two facts.

Two six-answer fictional conversations at minimal effort completed in 8.57 and
6.98 seconds with valid grounded drafts. These are small live provider samples,
not a latency SLA, production percentile, or independent quality evaluation.
An initial minimal-effort sample failed validation; invalid output remains an
error rather than being accepted to improve latency numbers.

The failing sample used an empty intent string instead of null. After adding
schema-constrained decoding and clarifying unknown intent, the final short
samples took 6.22, 3.68, and 4.56 seconds. Two long samples with constrained
decoding took 6.25 and 5.51 seconds. All five passed schema and exact-evidence
checks. Separate live samples produced a Muse conversation starter in 1.84
seconds and three catalog-grounded activity choices in 3.14 seconds.

Verification: 287 API tests, API Ruff, mobile TypeScript, and mobile lint passed.
The local phone-test API was restarted with the new code; health responded
successfully. The remote matching worker remained disconnected.

## Operation

Restart the API after pulling these backend changes. Metro serves the small
JavaScript timeout change without a new native build. Existing worker launch
instructions are in [online-evidence-v4.md](online-evidence-v4.md#run-on-an-allocated-gpu).

`muse_completion` logs record purpose, model, effort, elapsed milliseconds,
HTTP status, transport outcome, and token counts. They contain no prompts,
answers, generated text, account IDs, or credentials. `outcome=received` means
the provider returned content; downstream schema/evidence checks may still
reject it.

Provider documentation: [reasoning](https://dev.meta.ai/docs/reasoning) and
[structured output](https://dev.meta.ai/docs/structured-output).

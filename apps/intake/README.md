# SidebySide HackGT Intake

An independent, opt-in form for a **private matching evaluation**. It does not change the mobile app or connect to Newton. It is not a training pipeline or an instant match service.

## Deployed project

The separate Vercel project is `kais-projects-288a47c2/sidebyside-intake`, with the public address https://sidebyside-intake.vercel.app. It was deployed from this package using the CLI, not from the repository root. Source is on `codex/intake-pilot`; the existing app/API projects and `main` were not modified. Automatic Git deployments are not connected.

The intake-only Supabase migration `202609261600` has been applied and recorded. Production credentials are stored as Vercel Secrets, not in the repository. Do not reapply that migration. Preview deployments have no production credentials and remain closed. Real intake answers must not be sent to Newton.

After reviewing and testing future changes, deploy from `apps/intake` with the authorized Vercel account:

```sh
npm exec --yes --package=vercel -- vercel link --yes --scope kais-projects-288a47c2 --project sidebyside-intake
npm exec --yes --package=vercel -- vercel deploy --prod --yes --scope kais-projects-288a47c2
```

Verify the local `.vercel/project.json` identifies `sidebyside-intake` before deployment. Keep `.vercel/` and `.env*` files private and ignored. Do not use these commands from the mobile app directory.

## Local preview

```sh
cd apps/intake
npm ci --workspaces=false
npm run dev --workspaces=false
```

Open http://localhost:8090. The preview is loopback-only, keeps the draft in memory, and validates submissions without storing anything. It ignores production credentials. Reloading clears answers. No live database setup is needed. Use fictional answers for tests.

```sh
npm test --workspaces=false
npm run build --workspaces=false
# With the preview running and Playwright + Chrome installed:
PLAYWRIGHT_MODULE=/absolute/path/to/playwright npm run test:browser --workspaces=false
```

## What participants submit

- A name or nickname; no email, location, account, social media, or device access.
- Specific interests and motivations, a firsthand experience they are willing to share, a current goal, open topics, optional boundaries, and their preference for experienced help or learning together.
- A review of every answer and explicit, versioned consent to private matching evaluation. Model training and public sharing are explicitly excluded.

The private record has a server timestamp, request/receipt IDs, the original answers, consent version, `data_origin: real_opt_in`, `training_allowed: false`, and `public_sharing_allowed: false`. Do not treat these as fictional profiles or silently infer approved facts. Free text is participant-supplied data, not model instructions.

## Setup reference (for another environment)

1. Review and apply only `supabase/migrations/202609261600_private_pilot_intake.sql` to the existing project. It adds two isolated tables and one service-only function, with no changes to app profiles, users, location permissions, or matching queues. Do not blindly apply unrelated pending migrations.
2. Import this repository in Vercel with **Root Directory `apps/intake`**, Node 24.x, and the supplied `vercel.json`. This package has its own lockfile and is deliberately not a root workspace.
3. Set server-only variables from `.env.example`: Supabase URL/service-role key, the exact HTTPS origin without trailing slash, a random secret of at least 32 characters, and `INTAKE_OPEN=true`. Never put the service key in a `VITE_` variable, client code, or chat. `INTAKE_OPEN=false` keeps collection closed.
4. Configure only the intended production domain to accept responses. Preview deployments should remain closed or use an isolated test database. The form and API must share the configured origin.
5. Submit a **fictional** response through the deployed site; verify one private row, retry deduplication, no anonymous reads, and no app/worker changes. Delete the test row before collecting real responses.
6. Assign an organizer responsible for deletion requests and a short retention period before launch. There is no automatic deletion scheduler in this version. Participants can ask the team to delete a record using its receipt ID. No analytics or external font/CDN requests are included.

Only the Node function uses the Supabase service key. Browser clients cannot read or write these tables. It accepts bounded JSON requests from the exact configured origin, checks all fields/consent, and calls the dedicated RPC. The database serializes inserts to enforce retry idempotency, a 500-response pilot cap, and a 120-submission/hour per daily HMAC-IP limit. The generous limit accommodates shared event Wi-Fi; it is abuse friction, not proof of identity. Add managed bot protection before broad public promotion. Vercel/infrastructure logs may still contain request IPs; the application does not log bodies or persist raw IPs.

## Review and export

### Organizer dashboard

Open `/admin` on the intake site. Access uses existing SidebySide email/password
accounts, with a **server-only** `INTAKE_ADMIN_EMAILS` allowlist. Only confirmed
emails returned by Supabase Auth qualify; knowing the URL or changing client
state grants no access. Set the comma-separated approved organizer emails in
the intake project's production environment before publishing this feature.
An empty allowlist disables all dashboard access. No database migration is needed.

- Search names, interests, experiences, goals, and open topics; 12 responses per page.
- Read original answers, experience preferences, receipt IDs, and consent status.
- Select 2 to 20 consenting participants across pages and prepare a private JSON batch.
- Batch preparation reloads the selected records and rejects missing, withdrawn,
  or invalid-consent records. It preserves exact answer text and stable source IDs.
- **Run matching remains disabled**, including at the API. No scores, model calls,
  invitations, app accounts, or Newton jobs are created. A download is not inference.
- Responses and the access token live only in browser memory. Sign-out, leaving
  the page, or the 15-minute dashboard timer clears them. Supabase independently
  controls the actual access token expiration; no refresh token is sent to the browser.
- Every private API request revalidates the user with Supabase Auth and checks the
  organizer allowlist before reading the private table. Responses are not cached.

The public form, its consent language, and submission behavior are unchanged.
Current consent permits project-team evaluation, not sharing participant details
with one another. Obtain separate mutual permission before introductions.

The local `/admin` preview uses visibly labeled fictional records and has no real
login or database connection. Real passwords should not be entered into it.
All browser checks use fictional data:

```sh
PORT=8094 npm run dev --workspaces=false
INTAKE_TEST_URL=http://localhost:8094 npm run test:dashboard --workspaces=false
INTAKE_TEST_URL=http://localhost:8094 npm run test:browser --workspaces=false
```

The app's profile matcher does not directly consume intake answers. The pilot
uses a separate, versioned adapter that preserves the submitted answer IDs and
does not invent confirmed profile facts. Only the new RunPod-specific consent
version is eligible for inference. Existing `private-pilot-v1` responses remain
available for review/export but are never queued to RunPod.

Organizers can review `pilot_intake_responses` in Supabase. For a private JSONL export, place server credentials in an ignored `.env` file inside this package, then run:

```sh
node --env-file=.env scripts/export.mjs
```

Exports go to git-ignored `data/private/` with owner-only file permissions. They preserve original answer text, stable source references, preferences, and consent. No contact details are intentionally collected, but free text can still identify people. Keep exports private; delete copies when deleting the corresponding response.

## RunPod Matching Pilot

The private matching dashboard queues selected participants in
`pilot_intake_match_batches`. The RunPod worker polls Supabase outbound; it
opens no public model endpoint. Apply the forward-only migration
`202609261700_pilot_matching_worker.sql` before enabling the worker. Deploy the
updated worker code, then set `INTAKE_MATCHING_ENABLED=true` only in the
RunPod worker environment. The matching dashboard becomes available only while
the worker publishes a fresh ready heartbeat for the pinned model and pipeline.

The scorer runs the pinned Qwen3-Reranker-4B against both directions of every
selected pair. The displayed pair ranking uses the weaker directional raw
relevance score. These scores are uncalibrated for real people and are not
compatibility probabilities. Results are private organizer research; no
profiles, connections, introductions, invitations, or model training are
created. Pair candidates may overlap; organizers must not call them confirmed
mutual matches. The result stores source answer IDs per direction, not generated
explanations or a conversation starter.

Participants who submitted before this consent update must submit again to opt
into processing by the RunPod-hosted worker. The form now explicitly discloses
that processing. Use voluntary feedback to evaluate the ranking; the synthetic
benchmark alone does not establish real-user match quality. The worker does not
use Instagram data or social-media posts.

For withdrawal, delete by `receipt_id` through an authorized organizer session and remove that participant from local exports/results too. Turning off `INTAKE_OPEN` prevents new collection without affecting the main app.

## Boundaries

No automatic profile creation, fine-tuning, invitations, public participant directory, Bluetooth, GPS, Quest/Core2 pairing, or participant Supabase auth accounts. Intake matching is a separate, organizer-triggered evaluation path.

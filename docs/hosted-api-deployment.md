# Hosted API deployment

The website and native app use the same hosted API. Its production entrypoint
is `deploy/api/app.py`, which uses the regular remote matching worker registry.
It does not start inference inside Vercel or select the fictional demo worker.
The separately scoped demo worker remains available to its explicit demo setup.

Stage the current API into a new directory:

```sh
python scripts/stage_vercel_api.py /tmp/sidebyside-api-release
```

Link that directory to the existing `sidebyside-api` Vercel project, then deploy
it with `vercel deploy --prod`. Keep Supabase and provider credentials in the
project's environment settings. The staging script excludes local environment
files and copies current API modules plus the pinned matching policy.

Verify both `https://sidebyside-api.vercel.app/health` and the website's
`https://side-by-side-three.vercel.app/api/health`. When the configured worker is
running and its heartbeat is fresh, `matching.available` should be `true` and
`matching.reason` should be `null`. Authenticated profile and discovery responses
must report the same worker readiness. A healthy worker permits matching; an
individual recommendation still requires eligible, consenting accounts and
supporting evidence.

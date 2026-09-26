import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { makeAdmin, adminConfigured } from "../server/admin.mjs";
import { eligible, reviewRecord } from "../shared/pilot.mjs";
import { env as baseEnv, payload } from "./fixtures.mjs";

const env = {
  ...baseEnv,
  INTAKE_ADMIN_EMAILS: "organizer@example.com,second@example.com",
};
const token = "test-only-bearer-token-at-least-20-characters";
const user = {
  id: "organizer-id",
  email: "organizer@example.com",
  email_confirmed_at: "2026-09-26T00:00:00Z",
};
const row = (i) => ({
  receipt_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  created_at: "2026-09-26T00:00:00Z",
  payload: {
    ...payload(),
    data_origin: "real_opt_in",
    training_allowed: false,
    public_sharing_allowed: false,
  },
});
const rows = [row(1), row(2)];
const reply = (data, options) => new Response(JSON.stringify(data), options);

async function call({
  action = "responses",
  method = "GET",
  body,
  headers = {},
  settings = env,
  upstream,
} = {}) {
  const calls = [],
    responseHeaders = {};
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.url = `/api/admin?action=${action}`;
  req.method = method;
  req.headers = {
    authorization: `Bearer ${token}`,
    origin: env.INTAKE_ORIGIN,
    "content-type": "application/json",
    ...headers,
  };
  const res = {
    setHeader(key, value) {
      responseHeaders[key.toLowerCase()] = value;
    },
    end(value) {
      this.data = JSON.parse(value);
    },
  };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (upstream) return upstream(url, options);
    if (url.endsWith("/auth/v1/user")) return reply(user);
    if (url.includes("/auth/v1/token"))
      return reply({
        user,
        access_token: token,
        refresh_token: "must-not-be-returned",
        expires_in: 3600,
      });
    return reply(rows, { headers: { "content-range": "0-1/2" } });
  };
  await makeAdmin({ env: settings, fetcher })(req, res);
  return {
    status: res.statusCode,
    data: res.data,
    calls,
    headers: responseHeaders,
  };
}

test("dashboard configuration fails closed without explicit organizer allowlist", async () => {
  assert.equal(adminConfigured({}), false);
  assert.equal(adminConfigured(env), true);
  for (const settings of [
    { ...env, INTAKE_ADMIN_EMAILS: "" },
    { ...env, SUPABASE_URL: "https://attacker.test" },
    { ...env, INTAKE_ORIGIN: "http://example.com" },
  ]) {
    const r = await call({ settings });
    assert.equal(r.status, 503);
    assert.equal(r.calls.length, 0);
  }
});
test("anonymous, invalid and non-organizer sessions cannot read responses", async () => {
  const anonymous = await call({ headers: { authorization: undefined } });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.calls.length, 0);
  const expired = await call({ upstream: () => reply({}, { status: 401 }) });
  assert.equal(expired.status, 401);
  assert.equal(expired.calls.length, 1);
  for (const other of [
    { ...user, email: "participant@example.com" },
    { ...user, email_confirmed_at: null },
  ]) {
    const r = await call({ upstream: () => reply(other) });
    assert.equal(r.status, 403);
    assert.equal(r.calls.length, 1);
  }
});
test("login returns only short-lived access credentials for confirmed allowed users", async () => {
  const r = await call({
    action: "login",
    method: "POST",
    body: { email: user.email, password: "test-password" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.expires_in, 900);
  assert.equal(r.data.refresh_token, undefined);
  assert.equal(r.data.access_token, token);
  assert.equal(r.data.matching.available, false);
  assert.equal(r.calls[0].options.redirect, "error");
  assert.ok(!JSON.stringify(r.data).includes(env.SUPABASE_SERVICE_ROLE_KEY));
  const denied = await call({
    action: "login",
    method: "POST",
    body: { email: user.email, password: "test" },
    upstream: () =>
      reply({
        user: { ...user, email: "other@example.com" },
        access_token: token,
        expires_in: 3600,
      }),
  });
  assert.equal(denied.status, 401);
  assert.equal(denied.data.access_token, undefined);
});
test("POST actions reject foreign origins, wrong MIME and methods before contacting Supabase", async () => {
  for (const options of [
    {
      action: "batch",
      method: "POST",
      headers: { origin: "https://foreign.test" },
      expected: 403,
    },
    {
      action: "login",
      method: "POST",
      headers: { "content-type": "text/plain" },
      expected: 415,
    },
    { action: "login", method: "GET", expected: 405 },
    { action: "unknown", expected: 404 },
  ]) {
    const r = await call(options);
    assert.equal(r.status, options.expected);
    assert.equal(r.calls.length, 0);
  }
});
test("list authenticates first, uses private pagination and exposes no privileged key", async () => {
  const r = await call({ action: "responses&page=2&search=Italy" });
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 2);
  assert.equal(r.data.page_size, 12);
  assert.ok(r.calls[0].url.endsWith("/auth/v1/user"));
  const query = new URL(r.calls[1].url).searchParams;
  assert.equal(query.get("offset"), "12");
  assert.equal(query.get("limit"), "12");
  assert.match(query.get("or"), /display_name\.ilike/);
  assert.match(query.get("or"), /Italy/);
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal(r.headers.vary, "Authorization");
  assert.ok(!JSON.stringify(r.data).includes(env.SUPABASE_SERVICE_ROLE_KEY));
});
test("search injection and invalid pages never reach private table reads", async () => {
  for (const action of [
    "responses&page=-1",
    "responses&search=%22),receipt_id.neq.null",
    "responses&search=" + "x".repeat(81),
  ]) {
    const r = await call({ action });
    assert.equal(r.status, 400);
    assert.equal(r.calls.length, 1);
  }
});
test("batch re-reads selected records and preserves exact answers, provenance and restrictions", async () => {
  const r = await call({
    action: "batch",
    method: "POST",
    body: { ids: rows.map((r) => r.receipt_id) },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.inference_performed, false);
  assert.equal(r.data.training_allowed, false);
  assert.equal(r.data.public_sharing_allowed, false);
  const record = r.data.participants[0];
  assert.equal(
    record.answers.find((a) => a.question_key === "experience").answer_text,
    rows[0].payload.answers.experience,
  );
  assert.equal(record.answers[0].answer_id, `${rows[0].receipt_id}:interests`);
  assert.equal(record.consent.matching_evaluation, true);
  assert.equal(record.facts, undefined);
  assert.match(
    new URL(r.calls[1].url).searchParams.get("receipt_id"),
    /^in\.\(/,
  );
});
test("withdrawn, deleted, altered or unconsented selections cannot be exported", async () => {
  for (const records of [
    rows.slice(0, 1),
    [rows[0], rows[0]],
    [rows[0], row(3)],
    [rows[0], { ...rows[1], payload: { ...rows[1].payload, consent: false } }],
  ]) {
    const r = await call({
      action: "batch",
      method: "POST",
      body: { ids: rows.map((r) => r.receipt_id) },
      upstream: (url) => reply(url.endsWith("/auth/v1/user") ? user : records),
    });
    assert.equal(r.status, 409);
    assert.equal(r.data.participants, undefined);
  }
});
test("batch IDs are bounded, unique and cannot inject a query", async () => {
  for (const ids of [
    [],
    [rows[0].receipt_id],
    [rows[0].receipt_id, rows[0].receipt_id],
    ["*,or=(id.neq.null)", rows[1].receipt_id],
    Array.from({ length: 21 }, (_, i) => row(i).receipt_id),
  ]) {
    const r = await call({ action: "batch", method: "POST", body: { ids } });
    assert.equal(r.status, 422);
    assert.equal(r.calls.length, 1);
  }
});
test("matching stays disabled without a fresh private worker heartbeat", async () => {
  const r = await call({
    action: "match",
    method: "POST",
    body: { ids: rows.map((r) => r.receipt_id) },
  });
  assert.equal(r.status, 503);
  assert.equal(r.data.matching.available, false);
  assert.ok(r.calls.every((c) => c.url.startsWith(env.SUPABASE_URL)));
  assert.equal(r.calls.some((c) => c.url.includes("/pilot_intake_match_batches")), false);
});
test("organizer queues only selected, newly consented responses when RunPod heartbeat is fresh", async () => {
  const r = await call({
    action: "match",
    method: "POST",
    body: { ids: rows.map((r) => r.receipt_id) },
    upstream: async (url, options) => {
      if (url.endsWith("/auth/v1/user")) return reply(user);
      if (url.includes("pilot_intake_responses"))
        return reply(rows, { headers: { "content-range": "0-1/2" } });
      if (url.includes("pilot_intake_match_workers"))
        return reply([{
          worker_id: "worker",
          status: "ready",
          model_id: "Qwen/Qwen3-Reranker-4B",
          model_revision: "22e683669bc0f0bd69640a1354a6d0aebcfeede5",
          pipeline_version: "pilot-intake-directional-v1",
          expires_at: new Date(Date.now() + 60000).toISOString(),
        }]);
      if (url.includes("pilot_intake_match_batches")) {
        assert.equal(options.method, "POST");
        const body = JSON.parse(options.body);
        assert.deepEqual(body.participant_receipt_ids, rows.map((r) => r.receipt_id));
        assert.equal(body.requested_by, user.id);
        return reply([{ batch_id: "00000000-0000-4000-8000-000000000099" }]);
      }
      throw new Error(`unexpected upstream URL ${url}`);
    },
  });
  assert.equal(r.status, 202);
  assert.equal(r.data.status, "pending");
  assert.equal(r.data.matching.available, true);
});
test("batch status is organizer-authenticated and returns only the private batch record", async () => {
  const r = await call({
    action: "batch-status&id=00000000-0000-4000-8000-000000000099",
    upstream: async (url) => {
      if (url.endsWith("/auth/v1/user")) return reply(user);
      return reply([{ batch_id: "00000000-0000-4000-8000-000000000099", status: "running" }]);
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, "running");
  const unauthorized = await call({
    action: "batch-status&id=00000000-0000-4000-8000-000000000099",
    headers: { authorization: undefined },
  });
  assert.equal(unauthorized.status, 401);
});
test("raw answers with invalid consent or types are not approved model facts", () => {
  assert.equal(eligible(rows[0]), true);
  for (const payload of [
    { ...rows[0].payload, training_allowed: true },
    { ...rows[0].payload, consent_version: "unknown" },
    {
      ...rows[0].payload,
      answers: { ...rows[0].payload.answers, boundaries: {} },
    },
  ]) {
    assert.equal(eligible({ ...rows[0], payload }), false);
    assert.throws(() => reviewRecord({ ...rows[0], payload }));
  }
});
test("upstream errors are private and never look like an empty response list", async () => {
  const r = await call({
    upstream: (url) =>
      url.endsWith("/auth/v1/user")
        ? reply(user)
        : reply({ secret: "SQL failure" }, { status: 500 }),
  });
  assert.equal(r.status, 503);
  assert.equal(r.data.rows, undefined);
  assert.ok(!JSON.stringify(r.data).includes("SQL"));
});

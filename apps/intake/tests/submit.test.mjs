import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { makeSubmit, configured, validatePayload } from "../server/submit.mjs";
import { env, payload } from "./fixtures.mjs";

async function call({
  data = payload(),
  raw,
  headers = {},
  options = {},
  method = "POST",
  parsed = false,
} = {}) {
  const req = Readable.from([raw ?? JSON.stringify(data)]);
  req.method = method;
  req.headers = {
    origin: env.INTAKE_ORIGIN,
    "content-type": "application/json",
    "x-vercel-forwarded-for": "192.0.2.1",
    ...headers,
  };
  req.socket = { remoteAddress: "127.0.0.1" };
  if (parsed) req.body = data;
  let result;
  const res = {
    setHeader() {},
    end(body) {
      result = { status: this.statusCode, ...JSON.parse(body) };
    },
  };
  await makeSubmit({
    env,
    fetcher: async () => {
      throw new Error("Unexpected network call");
    },
    ...options,
  })(req, res);
  return result;
}

test("schema requires specific answers, explicit permission, exact versions, no unknown fields", () => {
  assert.equal(validatePayload(payload()), null);
  for (const edit of [
    (p) => {
      p.consent = false;
    },
    (p) => {
      p.consent = "true";
    },
    (p) => {
      p.answers.current_goal = "Italy";
    },
    (p) => {
      p.answers.interests = ["photography"];
    },
    (p) => {
      p.extra = "anything";
    },
    (p) => {
      p.answers.instagram = "no";
    },
    (p) => {
      p.website = "spam";
    },
    (p) => {
      p.version = "old";
    },
    (p) => {
      p.answers.experience_preference = "unknown";
    },
    (p) => {
      p.request_id = "not-an-id";
    },
    (p) => {
      p.answers.display_name = "x".repeat(51);
    },
  ]) {
    const p = payload();
    edit(p);
    assert.notEqual(validatePayload(p), null);
  }
});
test("production fails closed and never enables preview on Vercel", async () => {
  assert.equal(configured({}), false);
  assert.equal(configured(env), true);
  assert.equal(
    configured({ ...env, INTAKE_ORIGIN: "http://pilot.example.com" }),
    false,
  );
  assert.equal(
    (await call({ options: { env: {}, preview: false } })).status,
    503,
  );
  assert.equal(
    (await call({ options: { env: { VERCEL: "1" }, preview: true } })).status,
    503,
  );
});
test("local preview validates but does not persist", async () => {
  const result = await call({
    options: { env: {}, preview: true, previewOrigin: env.INTAKE_ORIGIN },
  });
  assert.deepEqual(result, { status: 200, mode: "preview", saved: false });
});
test("rejects wrong origin, method, MIME, malformed or oversized requests", async () => {
  assert.equal(
    (await call({ headers: { origin: "https://elsewhere.example" } })).status,
    403,
  );
  assert.equal((await call({ headers: { origin: undefined } })).status, 403);
  assert.equal((await call({ method: "GET" })).status, 405);
  assert.equal(
    (await call({ headers: { "content-type": "text/plain" } })).status,
    415,
  );
  assert.equal((await call({ raw: "{nope" })).status, 400);
  assert.equal((await call({ raw: "x".repeat(25000) })).status, 413);
  assert.equal(
    (await call({ data: { big: "x".repeat(25000) }, parsed: true })).status,
    413,
  );
});
test("maximum-length Unicode answers fit the request byte budget", async () => {
  const p = payload();
  for (const [key, length] of Object.entries({
    display_name: 50,
    interests: 1600,
    experience: 1600,
    current_goal: 1600,
    open_topics: 1000,
    boundaries: 600,
  })) {
    p.answers[key] = "\u6f22".repeat(length);
  }
  assert.equal(
    (
      await call({
        data: p,
        options: { env: {}, preview: true, previewOrigin: env.INTAKE_ORIGIN },
      })
    ).status,
    200,
  );
});
test("writes consent and provenance to only the isolated RPC; hashes IP; handles parsed Vercel body", async () => {
  const p = payload();
  let observed;
  const result = await call({
    data: p,
    parsed: true,
    options: {
      fetcher: async (url, config) => {
        observed = JSON.parse(config.body);
        assert.equal(
          url,
          `${env.SUPABASE_URL}/rest/v1/rpc/submit_pilot_intake`,
        );
        assert.equal(config.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
        return new Response(
          JSON.stringify({
            status: "saved",
            receipt_id: observed.p_receipt_id,
          }),
        );
      },
    },
  });
  assert.equal(result.saved, true);
  assert.equal(result.status, 200);
  assert.equal(observed.p_request_id, p.request_id);
  assert.equal(observed.p_payload.data_origin, "real_opt_in");
  assert.equal(observed.p_payload.training_allowed, false);
  assert.equal(observed.p_payload.public_sharing_allowed, false);
  assert.match(observed.p_rate_hash, /^[a-f0-9]{64}$/);
  assert(!JSON.stringify(observed).includes("192.0.2.1"));
});
test("stable retries, private storage failures, and DB limit responses", async () => {
  const p = payload();
  const records = [];
  const options = {
    fetcher: async (_, config) => {
      records.push(JSON.parse(config.body));
      return new Response("secret SQL error", { status: 500 });
    },
  };
  assert.equal((await call({ data: p, options })).status, 503);
  const result = await call({ data: p, options });
  assert(!JSON.stringify(result).includes("secret SQL"));
  assert.equal(records[0].p_request_id, records[1].p_request_id);
  assert.equal(records[0].p_payload_hash, records[1].p_payload_hash);
  for (const [status, expected] of [
    ["conflict", 409],
    ["rate_limited", 429],
    ["full", 503],
    ["unexpected", 503],
  ]) {
    assert.equal(
      (
        await call({
          options: {
            fetcher: async () => new Response(JSON.stringify({ status })),
          },
        })
      ).status,
      expected,
    );
  }
});
test("missing trusted Vercel IP fails closed", async () => {
  assert.equal(
    (
      await call({
        headers: {
          "x-vercel-forwarded-for": undefined,
          "x-forwarded-for": "spoofed",
        },
      })
    ).status,
    503,
  );
});

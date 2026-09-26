import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { payload } from "./fixtures.mjs";

test("migration: private access, real-data labeling, idempotency, limits, and no app writes", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon; create role authenticated; create role service_role bypassrls;",
    );
    await db.exec(
      await readFile(
        new URL(
          "../../../supabase/migrations/202609261600_private_pilot_intake.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../../../supabase/migrations/202609261700_pilot_matching_worker.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const submission = payload();
    const data = {
      version: submission.version,
      consent_version: submission.consent_version,
      consent: true,
      answers: submission.answers,
      data_origin: "real_opt_in",
      training_allowed: false,
      public_sharing_allowed: false,
    };
    const requestId = randomUUID(),
      receiptId = randomUUID();
    const save = async (
      request = requestId,
      receipt = receiptId,
      body = data,
      rate = "b".repeat(64),
    ) => {
      const result = await db.query(
        "select public.submit_pilot_intake($1,$2,$3,$4,$5) as result",
        [request, receipt, JSON.stringify(body), "a".repeat(64), rate],
      );
      return result.rows[0].result;
    };
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(
        db.query("select * from public.pilot_intake_responses"),
        /permission denied/,
      );
      await assert.rejects(save(), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    assert.deepEqual(await save(), { status: "saved", receipt_id: receiptId });
    assert.deepEqual(await save(requestId, randomUUID()), {
      status: "saved",
      receipt_id: receiptId,
    });
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n from public.pilot_intake_responses",
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await save(requestId, randomUUID(), {
          ...data,
          answers: { ...data.answers, display_name: "Other" },
        })
      ).status,
      "conflict",
    );
    await assert.rejects(
      save(randomUUID(), randomUUID(), { ...data, training_allowed: true }),
      /check constraint/,
    );
    await db.exec(
      "update public.pilot_intake_rate_limits set submissions = 120",
    );
    assert.equal((await save(randomUUID())).status, "rate_limited");
    assert.equal((await save()).status, "saved");
    await db.exec(
      "update public.pilot_intake_rate_limits set window_start = now() - interval '2 hours'",
    );
    assert.equal((await save(randomUUID(), randomUUID())).status, "saved");
    assert.equal(
      (
        await db.query(
          "select submissions from public.pilot_intake_rate_limits",
        )
      ).rows[0].submissions,
      1,
    );
    await db.query(
      `insert into public.pilot_intake_responses (request_id, receipt_id, payload_hash, payload)
      select gen_random_uuid(), gen_random_uuid(), $1, $2 from generate_series(1, 498)`,
      ["a".repeat(64), JSON.stringify(data)],
    );
    assert.equal((await save(randomUUID())).status, "full");
    await db.exec("reset role");
    const tables = (
      await db.query(
        "select tablename from pg_tables where schemaname = 'public' order by tablename",
      )
    ).rows.map((row) => row.tablename);
    assert.deepEqual(tables, [
      "pilot_intake_match_batches",
      "pilot_intake_match_workers",
      "pilot_intake_rate_limits",
      "pilot_intake_responses",
    ]);
    await db.exec("set role service_role");
    const eligibleIds = (
      await db.query(`select array_agg(receipt_id order by receipt_id) as ids from (
        select receipt_id from public.pilot_intake_responses
        where payload->>'consent_version' = 'private-pilot-runpod-v2' limit 2
      ) selected`)
    ).rows[0].ids;
    const queued = await db.query(
      `insert into public.pilot_intake_match_batches
        (requested_by,participant_receipt_ids,pipeline_version)
        values ($1,$2,'pilot-intake-directional-v1') returning batch_id`,
      [randomUUID(), eligibleIds],
    );
    const claimed = await db.query("select * from public.claim_pilot_intake_match_batches(1,300)");
    assert.equal(claimed.rows.length, 1);
    assert.equal(claimed.rows[0].status, "running");
    const result = {
      schema_version: "pilot-matching-results-v1",
      pairs: [],
      abstentions: [],
    };
    const provenance = {
      model_id: "Qwen/Qwen3-Reranker-4B",
      model_revision: "22e683669bc0f0bd69640a1354a6d0aebcfeede5",
      pipeline_version: "pilot-intake-directional-v1",
    };
    assert.equal((await db.query(
      "select public.complete_pilot_intake_match_batch($1,$2,$3,$4) as completed",
      [claimed.rows[0].batch_id, claimed.rows[0].lease_token, result, provenance],
    )).rows[0].completed, true);
    assert.equal((await db.query(
      "select status from public.pilot_intake_match_batches where batch_id=$1",
      [queued.rows[0].batch_id],
    )).rows[0].status, "succeeded");

    await db.query(
      `update public.pilot_intake_responses
       set payload=jsonb_set(payload,'{consent_version}',to_jsonb('private-pilot-v1'::text))
       where receipt_id=$1`,
      [eligibleIds[1]],
    );
    const oldBatch = await db.query(
      `insert into public.pilot_intake_match_batches
        (requested_by,participant_receipt_ids,pipeline_version)
        values ($1,$2,'pilot-intake-directional-v1') returning batch_id`,
      [randomUUID(), eligibleIds],
    );
    assert.equal((await db.query("select * from public.claim_pilot_intake_match_batches(1,300)")).rows.length, 0);
    assert.equal((await db.query(
      "select status from public.pilot_intake_match_batches where batch_id=$1",
      [oldBatch.rows[0].batch_id],
    )).rows[0].status, "cancelled");
    await db.exec("reset role");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from public.pilot_intake_match_batches"), /permission denied/);
      await assert.rejects(db.query("select * from public.pilot_intake_match_workers"), /permission denied/);
      await assert.rejects(db.query("select public.claim_pilot_intake_match_batches()"), /permission denied/);
      await db.exec("reset role");
    }
  } finally {
    await db.close();
  }
});

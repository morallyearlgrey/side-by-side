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
      "pilot_intake_rate_limits",
      "pilot_intake_responses",
    ]);
  } finally {
    await db.close();
  }
});

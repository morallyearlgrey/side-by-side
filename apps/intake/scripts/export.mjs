import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { FIELDS } from "../shared/form.mjs";

// Deliberately offline handoff: no model invocation, app user creation, or worker enqueue.
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
  throw new Error("Set the server-only Supabase environment variables first.");
const url = new URL("/rest/v1/pilot_intake_responses", SUPABASE_URL);
if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co"))
  throw new Error("Expected a hosted Supabase HTTPS endpoint.");
url.search = new URLSearchParams({
  select: "receipt_id,created_at,payload",
  order: "created_at.asc",
  limit: "500",
}).toString();
const response = await fetch(url, {
  headers: {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  },
  signal: AbortSignal.timeout(20000),
});
if (!response.ok)
  throw new Error(
    `Export failed (HTTP ${response.status}). No responses written.`,
  );
const rows = await response.json();
if (!Array.isArray(rows)) throw new Error("Unexpected export response.");
const records = rows.map((row) => ({
  schema_version: "pilot-review-v1",
  participant_id: row.receipt_id,
  data_origin: row.payload.data_origin,
  created_at: row.created_at,
  consent: {
    matching_evaluation: row.payload.consent,
    version: row.payload.consent_version,
    training_allowed: row.payload.training_allowed,
    public_sharing_allowed: row.payload.public_sharing_allowed,
  },
  display_name: row.payload.answers.display_name,
  experience_preference: row.payload.answers.experience_preference,
  answers: FIELDS.filter((field) => field.key !== "display_name").map(
    (field) => ({
      answer_id: `${row.receipt_id}:${field.key}`,
      source: "pilot_intake",
      question_key: field.key,
      question_text: field.label,
      answer_text: row.payload.answers[field.key],
    }),
  ),
}));
const directory = new URL("../../../data/private/", import.meta.url);
await mkdir(directory, { recursive: true, mode: 0o700 });
const file = new URL(
  `pilot-intake-${new Date().toISOString().replaceAll(":", "-")}.jsonl`,
  directory,
);
await writeFile(
  file,
  records.map((record) => JSON.stringify(record)).join("\n") +
    (records.length ? "\n" : ""),
  { flag: "wx", mode: 0o600 },
);
console.log(
  `Exported ${records.length} private responses to ${fileURLToPath(file)}. Do not upload them to Newton or commit them.`,
);

import { json } from "./submit.mjs";
import { CONSENT_VERSION, VERSION } from "../shared/form.mjs";
import {
  PAGE_SIZE,
  BATCH_LIMIT,
  matchingStatus,
  reviewRecord,
} from "../shared/pilot.mjs";

// Imported by the loopback dev server only; never by a deployed API function.
const rows = Array.from({ length: 15 }, (_, i) => ({
  receipt_id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  created_at: new Date(Date.UTC(2026, 8, 26, 10, i)).toISOString(),
  eligible: true,
  payload: {
    version: VERSION,
    consent_version: CONSENT_VERSION,
    consent: true,
    data_origin: "real_opt_in",
    training_allowed: false,
    public_sharing_allowed: false,
    answers: {
      display_name: `${["Alex", "Sam", "Jordan"][i % 3]} ${i + 1} (fictional)`,
      interests:
        "I photograph old train stations and love finding the small architectural details that most travelers walk past.",
      experience:
        "I planned a two-week train trip through northern Italy, booking regional trains and making a small photo journal.",
      current_goal:
        i % 2
          ? "I want to plan my first trip to Italy and learn from someone who has used regional trains there."
          : "I want to build a travel photo journal and exchange ideas about choosing memorable stops along the way.",
      open_topics:
        "Train travel, photography, travel journals, and learning to plan a first trip to Italy.",
      boundaries: "No recruiting or sales conversations, please.",
      experience_preference: i % 2 ? "firsthand" : "learn_together",
    },
  },
}));

export async function previewDashboard(req, res) {
  if (process.env.VERCEL)
    return json(res, 503, { error: "Preview is unavailable." });
  if (req.headers.authorization !== "Bearer fictional-preview-only")
    return json(res, 401, {
      error: "Use the fictional preview button. Do not enter real credentials.",
    });
  const url = new URL(req.url, "http://localhost");
  const action = url.searchParams.get("action");
  if (action === "session")
    return json(res, 200, {
      user: { email: "organizer@example.invalid" },
      matching: matchingStatus,
    });
  if (action === "responses") {
    const search = (url.searchParams.get("search") || "").toLowerCase(),
      page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const filtered = rows.filter((row) =>
      Object.values(row.payload.answers).some((value) =>
        value.toLowerCase().includes(search),
      ),
    );
    return json(res, 200, {
      rows: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      total: filtered.length,
      page,
      page_size: PAGE_SIZE,
    });
  }
  if (action === "batch" && req.method === "POST") {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 24000) return json(res, 413, { error: "Request too large." });
      chunks.push(chunk);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      return json(res, 400, { error: "Invalid request." });
    }
    const selected = rows.filter((row) => body.ids?.includes(row.receipt_id));
    if (selected.length < 2 || selected.length > BATCH_LIMIT)
      return json(res, 422, {
        error: "Select 2 to 20 fictional participants.",
      });
    return json(res, 200, {
      schema_version: "pilot-evaluation-batch-v1",
      preview: true,
      warning: "Fictional demonstration records only. No inference performed.",
      inference_performed: false,
      participants: selected.map((row) => ({
        ...reviewRecord(row),
        data_origin: "fictional_demo",
      })),
    });
  }
  return json(res, 503, { error: matchingStatus.reason });
}

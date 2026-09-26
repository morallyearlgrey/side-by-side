import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  CONSENT_VERSION,
  FIELDS,
  VERSION,
  normalizeAnswers,
  validateAnswers,
} from "../shared/form.mjs";

const LIMIT = 24 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const answerKeys = [...FIELDS.map(({ key }) => key), "experience_preference"];
const topKeys = [
  "version",
  "consent_version",
  "consent",
  "request_id",
  "answers",
  "website",
];
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) =>
  object(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

export function configured(env) {
  try {
    const url = new URL(env.SUPABASE_URL);
    const origin = new URL(env.INTAKE_ORIGIN);
    return (
      env.INTAKE_OPEN === "true" &&
      url.protocol === "https:" &&
      url.hostname.endsWith(".supabase.co") &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password &&
      origin.protocol === "https:" &&
      origin.origin === env.INTAKE_ORIGIN &&
      env.SUPABASE_SERVICE_ROLE_KEY?.length > 20 &&
      env.INTAKE_RATE_SECRET?.length >= 32
    );
  } catch {
    return false;
  }
}

export function validatePayload(body) {
  if (
    !exactKeys(body, topKeys) ||
    !exactKeys(body.answers, answerKeys) ||
    !answerKeys.every((key) => typeof body.answers[key] === "string")
  )
    return "Invalid submission.";
  if (body.version !== VERSION || body.consent_version !== CONSENT_VERSION)
    return "Refresh this page to use the current form.";
  if (body.consent !== true)
    return "Your permission is required before submitting.";
  if (!UUID.test(body.request_id))
    return "Invalid submission identifier. Refresh this page.";
  if (body.website !== "") return "Unable to submit this form.";
  if (Object.keys(validateAnswers(body.answers)).length)
    return "Check the required answers and their lengths.";
  return null;
}

export function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(data));
}

export async function readBody(req) {
  if (Number(req.headers["content-length"]) > LIMIT) throw new Error("large");
  // Vercel may have parsed the request before invoking the function.
  if (req.body !== undefined) {
    const serialized =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(serialized) > LIMIT) throw new Error("large");
    return JSON.parse(serialized);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > LIMIT) throw new Error("large");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function makeSubmit({
  env = process.env,
  fetcher = fetch,
  preview = false,
  previewOrigin,
  now = () => new Date(),
} = {}) {
  return async function submit(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return json(res, 405, { error: "Use POST." });
    }
    const localPreview = preview && !env.VERCEL;
    if (!localPreview && !configured(env))
      return json(res, 503, {
        error: "The pilot is not accepting responses yet.",
      });
    if (
      req.headers.origin !== (localPreview ? previewOrigin : env.INTAKE_ORIGIN)
    )
      return json(res, 403, {
        error: "Open the form on its original website.",
      });
    if (
      req.headers["content-type"]?.split(";")[0].trim() !== "application/json"
    )
      return json(res, 415, { error: "Use a JSON submission." });
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      return json(res, error.message === "large" ? 413 : 400, {
        error: "The submission could not be read. Check its size and format.",
      });
    }
    const error = validatePayload(body);
    if (error) return json(res, 422, { error });
    if (localPreview) return json(res, 200, { mode: "preview", saved: false });

    const payload = {
      version: VERSION,
      consent_version: CONSENT_VERSION,
      consent: true,
      answers: normalizeAnswers(body.answers),
      data_origin: "real_opt_in",
      training_allowed: false,
      public_sharing_allowed: false,
    };
    // Vercel overwrites this header. Never trust forwarded headers on another host.
    const ip =
      env.VERCEL === "1"
        ? req.headers["x-vercel-forwarded-for"]?.split(",")[0]?.trim()
        : req.socket?.remoteAddress;
    if (!ip)
      return json(res, 503, {
        error: "Submission verification is unavailable. Try again shortly.",
      });
    const rateHash = createHmac("sha256", env.INTAKE_RATE_SECRET)
      .update(`${now().toISOString().slice(0, 10)}:${ip}`)
      .digest("hex");
    try {
      const response = await fetcher(
        `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/submit_pilot_intake`,
        {
          method: "POST",
          signal: AbortSignal.timeout(10000),
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            p_request_id: body.request_id,
            p_receipt_id: randomUUID(),
            p_payload: payload,
            p_payload_hash: createHash("sha256")
              .update(JSON.stringify(payload))
              .digest("hex"),
            p_rate_hash: rateHash,
          }),
        },
      );
      if (!response.ok) throw new Error("storage");
      const result = await response.json();
      if (result.status === "rate_limited")
        return json(res, 429, {
          error: "Too many responses right now. Please try again in an hour.",
        });
      if (result.status === "full")
        return json(res, 503, {
          error: "This pilot has reached its response limit.",
        });
      if (result.status === "conflict")
        return json(res, 409, {
          error:
            "A previous submission was already saved. Keep its receipt, or reload to start a different response.",
        });
      if (result.status !== "saved" || !UUID.test(result.receipt_id))
        throw new Error("response");
      return json(res, 200, {
        mode: "live",
        saved: true,
        receipt_id: result.receipt_id,
      });
    } catch {
      return json(res, 503, {
        error:
          "We could not confirm your submission. Please retry; the same response will not be saved twice.",
      });
    }
  };
}

import { json, readBody } from "./submit.mjs";
import {
  BATCH_LIMIT,
  PAGE_SIZE,
  eligible,
  matchingStatus,
  reviewRecord,
} from "../shared/pilot.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHODS = {
  login: "POST",
  session: "GET",
  responses: "GET",
  batch: "POST",
  match: "POST",
};
const SESSION_SECONDS = 900;

export function adminConfigured(env) {
  try {
    const url = new URL(env.SUPABASE_URL),
      origin = new URL(env.INTAKE_ORIGIN);
    return (
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
      !!env.INTAKE_ADMIN_EMAILS?.split(",")
        .map((s) => s.trim())
        .filter(Boolean).length
    );
  } catch {
    return false;
  }
}

function allowed(user, env) {
  const emails = env.INTAKE_ADMIN_EMAILS.split(",").map((s) =>
    s.trim().toLowerCase(),
  );
  return !!(
    user?.id &&
    user.email_confirmed_at &&
    typeof user.email === "string" &&
    emails.includes(user.email.toLowerCase())
  );
}

export function makeAdmin({ env = process.env, fetcher = fetch } = {}) {
  const headers = () => ({
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  });
  async function request(path, options = {}) {
    const response = await fetcher(
      `${env.SUPABASE_URL.replace(/\/$/, "")}${path}`,
      {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new Error("upstream");
    return response;
  }
  return async function admin(req, res) {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Authorization");
    const url = new URL(req.url, "https://intake.invalid");
    const action = url.searchParams.get("action") || "session";
    if (!Object.hasOwn(METHODS, action))
      return json(res, 404, { error: "Not found." });
    if (req.method !== METHODS[action]) {
      res.setHeader("Allow", METHODS[action]);
      return json(res, 405, { error: "Method not allowed." });
    }
    if (!adminConfigured(env))
      return json(res, 503, {
        error: "Organizer access is not configured yet.",
      });
    if (req.method === "POST" && req.headers.origin !== env.INTAKE_ORIGIN)
      return json(res, 403, {
        error: "Open the dashboard on its original website.",
      });
    let body;
    if (req.method === "POST") {
      if (
        req.headers["content-type"]?.split(";")[0].trim() !== "application/json"
      )
        return json(res, 415, { error: "Use JSON." });
      try {
        body = await readBody(req);
      } catch {
        return json(res, 400, { error: "Invalid request." });
      }
    }
    if (action === "login") {
      if (
        !body ||
        typeof body.email !== "string" ||
        body.email.length > 254 ||
        typeof body.password !== "string" ||
        !body.password ||
        body.password.length > 1024
      )
        return json(res, 400, {
          error: "Enter your account email and password.",
        });
      try {
        const response = await request("/auth/v1/token?grant_type=password", {
          method: "POST",
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: body.email.trim(),
            password: body.password,
          }),
        });
        const data = await response.json();
        if (
          !allowed(data.user, env) ||
          typeof data.access_token !== "string" ||
          !Number.isFinite(data.expires_in) ||
          data.expires_in <= 0
        )
          throw new Error("denied");
        return json(res, 200, {
          access_token: data.access_token,
          expires_in: Math.min(SESSION_SECONDS, data.expires_in),
          user: { email: data.user.email },
          matching: matchingStatus,
        });
      } catch {
        return json(res, 401, {
          error:
            "Sign-in failed or this account does not have organizer access.",
        });
      }
    }
    const token = req.headers.authorization;
    if (typeof token !== "string" || !/^Bearer \S{20,8192}$/.test(token))
      return json(res, 401, { error: "Sign in to continue." });
    let user;
    try {
      user = await (
        await request("/auth/v1/user", {
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: token,
          },
        })
      ).json();
      if (!allowed(user, env))
        return json(res, 403, { error: "Organizer access is required." });
    } catch {
      return json(res, 401, { error: "Your session expired. Sign in again." });
    }
    if (action === "session")
      return json(res, 200, {
        user: { email: user.email },
        matching: matchingStatus,
      });
    try {
      if (action === "responses") {
        const pageText = url.searchParams.get("page") || "1",
          search = (url.searchParams.get("search") || "").trim();
        if (
          !/^[1-9]\d{0,2}$/.test(pageText) ||
          !/^[\p{L}\p{N}\s@.'_-]{0,80}$/u.test(search)
        )
          return json(res, 400, {
            error:
              "Use a valid page and a simple name or topic search (up to 80 characters).",
          });
        const page = Number(pageText);
        const query = new URLSearchParams({
          select: "receipt_id,created_at,payload",
          order: "created_at.desc,receipt_id.desc",
          limit: String(PAGE_SIZE),
          offset: String((page - 1) * PAGE_SIZE),
        });
        if (search) {
          const pattern = search.replaceAll("_", "\\_");
          query.set(
            "or",
            `(${[
              "display_name",
              "interests",
              "experience",
              "current_goal",
              "open_topics",
            ]
              .map((key) => `payload->answers->>${key}.ilike."*${pattern}*"`)
              .join(",")})`,
          );
        }
        const response = await request(
          `/rest/v1/pilot_intake_responses?${query}`,
          { headers: { ...headers(), Prefer: "count=exact" } },
        );
        const rows = await response.json();
        const total = Number(
          response.headers.get("content-range")?.split("/")[1],
        );
        if (!Array.isArray(rows) || !Number.isSafeInteger(total) || total < 0)
          throw new Error("format");
        return json(res, 200, {
          rows: rows.map((row) => ({ ...row, eligible: eligible(row) })),
          total,
          page,
          page_size: PAGE_SIZE,
        });
      }
      if (
        !body ||
        !Array.isArray(body.ids) ||
        body.ids.length < 2 ||
        body.ids.length > BATCH_LIMIT ||
        body.ids.some((id) => typeof id !== "string" || !UUID.test(id)) ||
        new Set(body.ids).size !== body.ids.length
      )
        return json(res, 422, {
          error: `Select 2 to ${BATCH_LIMIT} different participants.`,
        });
      const query = new URLSearchParams({
        select: "receipt_id,created_at,payload",
        receipt_id: `in.(${body.ids.join(",")})`,
        order: "receipt_id.asc",
      });
      const rows = await (
        await request(`/rest/v1/pilot_intake_responses?${query}`, {
          headers: headers(),
        })
      ).json();
      if (
        !Array.isArray(rows) ||
        rows.length !== body.ids.length ||
        new Set(rows.map((row) => row.receipt_id)).size !== body.ids.length ||
        rows.some((row) => !body.ids.includes(row.receipt_id) || !eligible(row))
      )
        return json(res, 409, {
          error:
            "A selected response is no longer available or eligible. Refresh and select again.",
        });
      // No worker enqueue or external model call until a real-data host is explicitly approved.
      if (action === "match")
        return json(res, 503, {
          error: matchingStatus.reason,
          matching: matchingStatus,
        });
      return json(res, 200, {
        schema_version: "pilot-evaluation-batch-v1",
        created_at: new Date().toISOString(),
        inference_performed: false,
        training_allowed: false,
        public_sharing_allowed: false,
        infrastructure_restriction:
          "Not authorized for the fictional-only Newton worker.",
        participants: rows.map(reviewRecord),
      });
    } catch {
      return json(res, 503, {
        error: "Responses could not be loaded. Try again shortly.",
      });
    }
  };
}

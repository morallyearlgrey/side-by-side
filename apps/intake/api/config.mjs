import { configured, json } from "../server/submit.mjs";
export default function config(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Use GET." });
  return json(res, 200, { mode: configured(process.env) ? "live" : "closed" });
}

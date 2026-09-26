import { randomUUID } from "node:crypto";
import { CONSENT_VERSION, VERSION } from "../shared/form.mjs";
export const answers = {
  display_name: "Alex (fictional)",
  interests:
    "I love photographing old railway stations, especially the way afternoon light reveals their architecture.",
  experience:
    "I spent two weeks traveling by train through Italy and planned the trip using regional routes and small towns.",
  current_goal:
    "I want to build a photo journal for my next train trip and learn how other people choose interesting stops.",
  open_topics:
    "Train travel, photography, journal design, and planning a first trip around Italy.",
  boundaries: "I would rather skip recruiting and sales pitches.",
  experience_preference: "learn_together",
};
export function payload() {
  return {
    request_id: randomUUID(),
    version: VERSION,
    consent_version: CONSENT_VERSION,
    consent: true,
    website: "",
    answers: { ...answers },
  };
}
export const env = {
  INTAKE_OPEN: "true",
  INTAKE_ORIGIN: "https://pilot.example.com",
  SUPABASE_URL: "https://fictional.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-service-role-not-a-real-key",
  INTAKE_RATE_SECRET: "test-only-rate-secret-at-least-32-chars",
  VERCEL: "1",
};

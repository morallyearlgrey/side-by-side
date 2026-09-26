import { CONSENT_VERSION, FIELDS, VERSION, validateAnswers } from "./form.mjs";

export const BATCH_LIMIT = 20;
export const PAGE_SIZE = 12;
export const MATCH_PIPELINE = "pilot-intake-directional-v1";
export const MATCH_MODEL = "Qwen/Qwen3-Reranker-4B";
export const MATCH_MODEL_REVISION =
  "22e683669bc0f0bd69640a1354a6d0aebcfeede5";

export function eligible(row) {
  const p = row?.payload;
  return !!(
    p &&
    p.version === VERSION &&
    p.consent_version === CONSENT_VERSION &&
    p.consent === true &&
    p.data_origin === "real_opt_in" &&
    p.training_allowed === false &&
    p.public_sharing_allowed === false &&
    FIELDS.every((f) => typeof p.answers?.[f.key] === "string") &&
    Object.keys(validateAnswers(p.answers)).length === 0
  );
}

export function reviewRecord(row) {
  if (!eligible(row))
    throw new Error("This response is not eligible for evaluation.");
  return {
    schema_version: "pilot-review-v1",
    participant_id: row.receipt_id,
    data_origin: row.payload.data_origin,
    created_at: row.created_at,
    consent: {
      matching_evaluation: true,
      version: row.payload.consent_version,
      training_allowed: false,
      public_sharing_allowed: false,
    },
    display_name: row.payload.answers.display_name,
    experience_preference: row.payload.answers.experience_preference,
    answers: [
      ...FIELDS.filter((f) => f.key !== "display_name").map((f) => ({
        answer_id: `${row.receipt_id}:${f.key}`,
        source: "pilot_intake",
        question_key: f.key,
        question_text: f.label,
        answer_text: row.payload.answers[f.key],
      })),
      {
        answer_id: `${row.receipt_id}:experience_preference`,
        source: "pilot_intake",
        question_key: "experience_preference",
        question_text: "What kind of experience would you prefer in a conversation?",
        answer_text: row.payload.answers.experience_preference,
      },
    ],
  };
}

export const matchingStatus = {
  available: false,
  reason: "The private RunPod matching worker is not connected.",
};

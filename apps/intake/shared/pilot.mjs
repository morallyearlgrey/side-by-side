import { CONSENT_VERSION, FIELDS, VERSION, validateAnswers } from "./form.mjs";

export const BATCH_LIMIT = 20;
export const PAGE_SIZE = 12;

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
    answers: FIELDS.filter((f) => f.key !== "display_name").map((f) => ({
      answer_id: `${row.receipt_id}:${f.key}`,
      source: "pilot_intake",
      question_key: f.key,
      question_text: f.label,
      answer_text: row.payload.answers[f.key],
    })),
  };
}

export const matchingStatus = {
  available: false,
  reason:
    "An approved model host has not been connected. Real responses are not sent to Newton.",
};

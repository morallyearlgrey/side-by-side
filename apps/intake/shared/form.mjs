export const VERSION = "hackgt-intake-v1";
export const CONSENT_VERSION = "private-pilot-runpod-v2";
export const EXPERIENCE_OPTIONS = [
  [
    "firsthand",
    "Someone who has done it",
    "I want firsthand experience with my goal.",
  ],
  [
    "learn_together",
    "Someone to explore with",
    "We can figure it out together.",
  ],
  ["either", "Either sounds good", "Experience is welcome, but not required."],
];
export const FIELDS = [
  {
    key: "display_name",
    step: 0,
    label: "What should we call you?",
    min: 1,
    max: 50,
    short: true,
  },
  {
    key: "interests",
    step: 0,
    label: "What could you talk about for hours?",
    min: 40,
    max: 1600,
    hint: "The specific part you love, why it matters, and something you recently explored.",
  },
  {
    key: "experience",
    step: 0,
    label: "What have you done that you would enjoy sharing?",
    min: 40,
    max: 1600,
    hint: "A project, trip, skill, or lived experience. Tell us what you actually did.",
  },
  {
    key: "current_goal",
    step: 1,
    label: "What would you love to learn or do next?",
    min: 40,
    max: 1600,
    hint: "A concrete goal and the kind of conversation that would help you get there.",
  },
  {
    key: "open_topics",
    step: 1,
    label: "What are you open to talking about today?",
    min: 20,
    max: 1000,
    hint: "Be specific about what you want to discuss, build, or explore with someone.",
  },
  {
    key: "boundaries",
    step: 1,
    label: "Anything you would rather not discuss?",
    min: 0,
    max: 600,
    hint: "Optional. Keep this general; there is no need to share sensitive personal information.",
  },
];
export const EMPTY = Object.fromEntries(FIELDS.map(({ key }) => [key, ""]));
export function validateAnswers(answers) {
  const errors = {};
  for (const field of FIELDS) {
    const value =
      typeof answers?.[field.key] === "string" ? answers[field.key].trim() : "";
    if (value.length < field.min)
      errors[field.key] = field.short
        ? "Enter a name or nickname."
        : `Add a little detail (at least ${field.min} characters).`;
    if (value.length > field.max)
      errors[field.key] = `Keep this under ${field.max} characters.`;
  }
  if (
    !EXPERIENCE_OPTIONS.some(([key]) => key === answers?.experience_preference)
  ) {
    errors.experience_preference =
      "Choose the kind of conversation you would prefer.";
  }
  return errors;
}
export function normalizeAnswers(answers) {
  return {
    ...Object.fromEntries(FIELDS.map(({ key }) => [key, answers[key].trim()])),
    experience_preference: answers.experience_preference,
  };
}
export const CONSENT_TEXT =
  "I agree that the SidebySide project team may store these answers and use them to evaluate AI conversation matches for this pilot. A private model worker hosted on RunPod will process my answers only for this evaluation. My answers and suggested pairings are private to the project team. This does not authorize model training or public sharing.";

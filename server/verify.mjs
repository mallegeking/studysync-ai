// Verification pass: a second model call that reviews already-generated
// notes/flashcards for likely misinformation. The original source material
// is not retained after generation, so this is a plausibility check against
// the model's general knowledge — the prompt and the client UI both say so.

// Same strict-schema conventions as prompt.mjs: every object carries
// additionalProperties:false + required (OpenAI strict mode and Anthropic
// structured outputs demand it; Gemini accepts it via responseJsonSchema).
export const verifyJsonSchema = {
  type: "object",
  properties: {
    noteFlags: {
      type: "array",
      description: "Claims in the study notes that are likely incorrect.",
      items: {
        type: "object",
        properties: {
          excerpt: {
            type: "string",
            description: "EXACT verbatim substring copied character-for-character from the notes, including any markdown symbols like ** or `. Under 200 characters. Must be findable by exact string search.",
          },
          claim: {
            type: "string",
            description: "The factual claim being challenged, restated plainly.",
          },
          reason: {
            type: "string",
            description: "Why this is likely incorrect or misleading.",
          },
          severity: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "high = definitely wrong and materially misleading; medium = likely wrong; low = questionable or imprecise.",
          },
        },
        required: ["excerpt", "claim", "reason", "severity"],
        additionalProperties: false,
      },
    },
    cardFlags: {
      type: "array",
      description: "Flashcards whose content is likely incorrect.",
      items: {
        type: "object",
        properties: {
          cardIndex: {
            type: "integer",
            description: "The 1-based number of the flashcard in the provided list.",
          },
          reason: {
            type: "string",
            description: "Why the card's question or answer is likely incorrect or misleading.",
          },
          severity: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "high = definitely wrong and materially misleading; medium = likely wrong; low = questionable or imprecise.",
          },
        },
        required: ["cardIndex", "reason", "severity"],
        additionalProperties: false,
      },
    },
  },
  required: ["noteFlags", "cardFlags"],
  additionalProperties: false,
};

export function buildVerifyPrompt({ markdownNotes = "", flashcards = [] }) {
  const cardList = flashcards
    .map((card, i) => `${i + 1}. Q: ${card.front} | A: ${card.back}`)
    .join("\n");

  return `
    You are a careful fact-checker reviewing AI-generated study material for a student.
    The ORIGINAL SOURCE MATERIAL IS NOT AVAILABLE. Check claims ONLY against your own
    general knowledge. This is a plausibility check, not source verification.

    Flag a statement only if you are reasonably confident it is factually incorrect,
    misleading, or a known misconception. Do NOT flag: study tips, mnemonics, opinions,
    claims too course-specific or niche to assess, or claims that are plausibly correct.
    Prefer precision over recall — a false alarm erodes the student's trust in the notes.

    For each flag in the notes, copy the suspect passage into 'excerpt' EXACTLY as it
    appears — verbatim, character-for-character, including markdown characters like **
    or backticks — and keep it under 200 characters. Prefer the shortest span that
    contains just the wrong claim.

    For flashcard flags, reference the card by its number in the list below.

    Severity: 'high' = definitely wrong and materially misleading; 'medium' = likely
    wrong; 'low' = questionable or imprecise.

    If nothing warrants a flag, return empty arrays.

    STUDY NOTES:
    ${markdownNotes || "(none)"}

    FLASHCARDS:
    ${cardList || "(none)"}
  `;
}

const SEVERITIES = new Set(["low", "medium", "high"]);
const clampSeverity = (s) => (SEVERITIES.has(s) ? s : "medium");

// The model output can be loose (especially via the local json_object
// fallback) — filter to valid shapes and map card indices back to stable
// ids; never let a malformed flag turn into a 500.
export function normalizeVerification(raw, flashcards) {
  const noteFlags = (Array.isArray(raw?.noteFlags) ? raw.noteFlags : [])
    .filter((f) => f && typeof f.excerpt === "string" && typeof f.reason === "string")
    .map((f) => ({
      excerpt: f.excerpt,
      claim: typeof f.claim === "string" && f.claim.trim() ? f.claim : f.excerpt,
      reason: f.reason,
      severity: clampSeverity(f.severity),
    }));

  const cardFlags = (Array.isArray(raw?.cardFlags) ? raw.cardFlags : [])
    .map((f) => {
      const card = flashcards[Number(f?.cardIndex) - 1];
      if (!card?.id || typeof f.reason !== "string") return null;
      return { cardId: card.id, reason: f.reason, severity: clampSeverity(f.severity) };
    })
    .filter(Boolean);

  return { noteFlags, cardFlags };
}

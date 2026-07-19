// Tutor mode: active recall on new material. Two AI steps around the
// normal generation pipeline:
//  1. /api/tutor/start  — pre-test questions from the source, attempted
//     cold before studying (pretesting effect)
//  2. /api/tutor/grade  — after studying, grade the learner's brain dump
//     + cold answers against the source into three buckets, and generate
//     flashcards weighted toward the gaps
// Same strict-schema conventions as prompt.mjs (additionalProperties:false
// + required everywhere).

export const prequestionsJsonSchema = {
  type: "object",
  properties: {
    prequestions: {
      type: "array",
      description: "3 to 5 short pre-test questions covering the most central concepts of the material.",
      items: { type: "string" },
    },
  },
  required: ["prequestions"],
  additionalProperties: false,
};

export function buildPrequestionsPrompt() {
  return `
    You are a study coach preparing a learner for a study session.
    The attached material is what they are ABOUT to study — they have not read it yet.

    Write 3 to 5 short pre-test questions covering the most central concepts of the
    material. The learner will attempt them cold, before studying, purely to prime
    their memory (the pretesting effect) — so:
    - Each question must be answerable in one or two sentences.
    - Target the core ideas, not fine details or trick distinctions.
    - Plain question text only: no numbering, no answers, no hints.
  `;
}

export const gradeJsonSchema = {
  type: "object",
  properties: {
    knewCorrectly: {
      type: "array",
      description: "Things the learner already knew correctly.",
      items: {
        type: "object",
        properties: {
          concept: { type: "string", description: "Short name of the concept." },
          note: { type: "string", description: "One sentence confirming what they got right." },
        },
        required: ["concept", "note"],
        additionalProperties: false,
      },
    },
    misconceptions: {
      type: "array",
      description: "Things the learner believed that the source contradicts.",
      items: {
        type: "object",
        properties: {
          concept: { type: "string", description: "Short name of the concept." },
          believed: { type: "string", description: "What the learner wrote or implied, condensed." },
          actual: { type: "string", description: "What is actually correct according to the source." },
        },
        required: ["concept", "believed", "actual"],
        additionalProperties: false,
      },
    },
    didntKnow: {
      type: "array",
      description: "Important concepts in the source that the learner's dump didn't mention.",
      items: {
        type: "object",
        properties: {
          concept: { type: "string", description: "Short name of the concept." },
          summary: { type: "string", description: "One or two sentences on what it is." },
        },
        required: ["concept", "summary"],
        additionalProperties: false,
      },
    },
    gapFlashcards: {
      type: "array",
      description: "New flashcards targeting the misconceptions and unknown concepts.",
      items: {
        type: "object",
        properties: {
          front: { type: "string" },
          back: { type: "string" },
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
        },
        required: ["front", "back", "difficulty"],
        additionalProperties: false,
      },
    },
  },
  required: ["knewCorrectly", "misconceptions", "didntKnow", "gapFlashcards"],
  additionalProperties: false,
};

export function buildGradePrompt({ dump = "", prequestions = [], existingFronts = [] }) {
  const answeredList = prequestions
    .map((q, i) => `${i + 1}. Q: ${q.question}\n   Their cold answer: ${q.answer?.trim() ? q.answer : "(left blank)"}`)
    .join("\n");

  return `
    You are a supportive but rigorous study coach. Before studying the attached
    source material, the learner wrote down everything they thought they knew about
    the topic (a "brain dump") and attempted a few pre-test questions cold. They
    have now studied the material. Your job is the confrontation step: compare what
    they believed BEFORE studying against what the source actually says.

    The SOURCE MATERIAL is the ground truth. Sort your findings into three buckets:
    1. knewCorrectly — claims in their dump/answers that the source confirms. Be
       specific; give them honest credit.
    2. misconceptions — claims they made that the source contradicts. Condense what
       they believed in 'believed' and state the correct version in 'actual'. Only
       genuine contradictions belong here, not awkward phrasing or missing detail.
    3. didntKnow — important concepts in the source that their dump never touched.
       Limit this to the concepts that matter most; do not enumerate everything.

    If the dump and answers are empty or nearly empty, that's fine: put the source's
    key concepts into didntKnow and leave the other buckets empty.

    Then generate gapFlashcards targeting the gaps — misconceptions are the highest
    priority (2-3 cards each, difficulty 'hard'; misconceptions resist correction and
    need repeated testing), didntKnow concepts next (1-2 cards each, difficulty per
    content). Do NOT create cards for things they already knew.
    ${existingFronts.length > 0 ? `\n    The deck already has flashcards for these questions — do not duplicate them:\n    ${existingFronts.join("; ")}\n` : ""}
    LEARNER'S BRAIN DUMP (written before studying):
    ${dump.trim() || "(empty)"}

    PRE-TEST QUESTIONS AND THEIR COLD ANSWERS:
    ${answeredList || "(none)"}
  `;
}

const SEVERITY_DIFFICULTIES = new Set(["easy", "medium", "hard"]);

const asString = (v) => (typeof v === "string" ? v : "");

// Defensive shape filtering — loose output (local json_object fallback)
// must degrade to empty buckets, never a 500.
export function normalizePrequestions(raw) {
  return (Array.isArray(raw?.prequestions) ? raw.prequestions : [])
    .filter((q) => typeof q === "string" && q.trim())
    .slice(0, 5);
}

export function normalizeGrade(raw) {
  const bucket = (arr, fields) =>
    (Array.isArray(arr) ? arr : [])
      .filter((item) => item && fields.every((f) => typeof item[f] === "string" && item[f].trim()))
      .map((item) => Object.fromEntries(fields.map((f) => [f, item[f]])));

  const gapFlashcards = (Array.isArray(raw?.gapFlashcards) ? raw.gapFlashcards : [])
    .filter((c) => c && asString(c.front).trim() && asString(c.back).trim())
    .map((c) => ({
      front: c.front,
      back: c.back,
      difficulty: SEVERITY_DIFFICULTIES.has(c.difficulty) ? c.difficulty : "medium",
    }));

  return {
    knewCorrectly: bucket(raw?.knewCorrectly, ["concept", "note"]),
    misconceptions: bucket(raw?.misconceptions, ["concept", "believed", "actual"]),
    didntKnow: bucket(raw?.didntKnow, ["concept", "summary"]),
    gapFlashcards,
  };
}

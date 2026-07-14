// Provider-agnostic pieces of the generation pipeline: the prompt text,
// the canonical JSON schema for the structured response, and the assembly
// of the final markdown from the sections the model returns.

// Canonical JSON Schema (draft-style). The Gemini adapter keeps its own
// Type-enum variant; OpenAI and Anthropic consume this one directly.
// Note: every object carries additionalProperties:false + required — both
// OpenAI strict mode and Anthropic structured outputs demand it.
export const responseJsonSchema = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      description: "The study notes as an ordered list of sections.",
      items: {
        type: "object",
        properties: {
          heading: {
            type: "string",
            description: "Plain-text section heading. No markdown # characters.",
          },
          level: {
            type: "integer",
            description: "2 for top-level sections, 3 for sub-sections (individual concepts).",
          },
          body: {
            type: "string",
            description: "The section's content in Markdown. Every paragraph and every bullet point MUST be separated by real newline characters.",
          },
        },
        required: ["heading", "level", "body"],
        additionalProperties: false,
      },
    },
    flashcards: {
      type: "array",
      description: "A list of flashcards generated from the key concepts.",
      items: {
        type: "object",
        properties: {
          front: {
            type: "string",
            description: "The question or concept on the front of the card.",
          },
          back: {
            type: "string",
            description: "The answer or definition on the back of the card.",
          },
          difficulty: {
            type: "string",
            enum: ["easy", "medium", "hard"],
            description: "The difficulty level: 'easy' for basic recall, 'medium' for applied understanding, 'hard' for synthesis or nuanced concepts.",
          },
        },
        required: ["front", "back", "difficulty"],
        additionalProperties: false,
      },
    },
  },
  required: ["sections", "flashcards"],
  additionalProperties: false,
};

// Builds the instruction text shared by all providers.
export function buildPromptText({ customInstructions = "", previousContent = null }) {
  let promptText = `
    You are an expert study companion.
    The user has provided course materials to study. This input may consist of screen captures, PDFs, diagrams, or text.
  `;

  // 1. Incorporate User Goals (High Priority)
  if (customInstructions.trim()) {
    promptText += `

    *** CRITICAL USER INSTRUCTION ***
    The user has specified a focus area: "${customInstructions}".
    Ensure the generated notes and flashcards specifically target this goal. Prioritize information related to this instruction.
    `;
  }

  // 2. Incorporate Previous Context (Consistency & De-duplication)
  if (previousContent) {
    const existingTopics = previousContent.markdownNotes.slice(0, 2000) + (previousContent.markdownNotes.length > 2000 ? "..." : "");
    const existingQuestions = previousContent.flashcards.map(f => f.front).join("; ");

    promptText += `

    *** CONTEXT - EXISTING KNOWLEDGE BASE ***
    This is a continuation of a study session.
    We already have notes covering: ${existingTopics}
    We already have flashcards for these questions: ${existingQuestions}

    YOUR TASK:
    1. Analyze the NEW input material provided below.
    2. Generate Notes: Write notes *only* for the new information found in the input, as an ordered list of sections. Do not repeat what is already covered.
       - One level-2 section per major new topic; one level-3 section per concept within it (its heading is the concept name).
       - Explain each concept plainly, bold (**) key terms when first introduced, and give a brief concrete example where one helps.
       - Where a mnemonic would genuinely aid memory, include it in italics as a "Memory tip:".
       - Include a "Key Definitions" (level 2) section when new technical terms are introduced.
       Formatting rules: headings go in the 'heading' field as plain text (never # characters, never inside the body); section bodies are Markdown with every paragraph and every bullet on its own line, separated by real newline characters.
    3. Generate Flashcards: Create flashcards *only* for NEW concepts. CHECK THE EXISTING QUESTIONS LIST ABOVE. DO NOT CREATE DUPLICATE CARDS.
       - COVERAGE RULE: scale the number of cards to the new material — one card per distinct testable point (fact, definition, relationship, procedure step, contrast). Exhaust the new material's distinct points; never stop at a round number like 10 if more remain.
       - Mix question types: direct recall ("What is X?"), application ("When/how would you use X?"), and reasoning ("Why does X lead to Y?").
       - One concept per card; make the front specific and unambiguous.
       - Assign difficulty: 'easy' for simple definitions, 'medium' for applied concepts, 'hard' for synthesis, comparisons, or nuanced distinctions.
    `;
  } else {
    promptText += `

    YOUR TASK:
    1. Analyze the provided content thoroughly. Identify core topics, definitions, key concepts, and any processes or systems described.
    2. Generate study notes that give the learner a solid foundation, as an ordered list of sections following EXACTLY this template:
       - "Overview" (level 2): 2-4 sentences framing what this topic is, why it matters, and how the pieces fit together.
       - "Core Concepts" (level 2): a one-sentence lead-in only — the substance goes in sub-sections.
       - One level-3 section PER CONCEPT (its heading is the concept name): explain it plainly, bold (**) key terms when first introduced, give a brief concrete example where one helps, and include an italic "Memory tip:" mnemonic only where it genuinely aids memory.
       - "Key Definitions" (level 2): a bulleted glossary of the technical terms introduced (term — definition), one bullet per line.
       - "Common Pitfalls & Misconceptions" (level 2): where learners typically go wrong with this material. Omit this section if it does not apply.
       - "Summary" (level 2): 3-5 bullet takeaways that capture the foundation the learner should walk away with.
       Formatting rules: headings go in the 'heading' field as plain text (never # characters, never inside the body); section bodies are Markdown with every paragraph and every bullet on its own line, separated by real newline characters.
    3. Generate flashcards:
       - COVERAGE RULE: scale the number of cards to the material — one card per distinct testable point (fact, definition, relationship, procedure step, contrast). A single short paragraph may warrant 4-6 cards; a full lecture, long document, or video should produce 25-40 or more. Never default to a round number like 10; exhaust the material's distinct testable points.
       - Mix question types: direct recall ("What is X?"), application ("When/how would you use X?"), and reasoning ("Why does X lead to Y?").
       - One concept per card; make the front specific and unambiguous.
       - Assign difficulty: 'easy' for simple definitions, 'medium' for applied concepts, 'hard' for synthesis, comparisons, or nuanced distinctions.
    `;
  }

  promptText += `
    Note for Screen Captures: If the images look like a video timeline, treat them chronologically and ignore duplicates.
    Note for Audio: If an audio file is included, it is the narration of the captured session — treat it as the primary lecture content; the screenshots illustrate it.
    Note for YouTube: If a YouTube video is attached, analyze both its visual content and its narration.
  `;

  return promptText;
}

// Last-resort repair for a section body that arrived without any newlines:
// re-break bullets and numbered items that follow sentence punctuation.
export const repairFlattenedBody = (body) => {
  if (typeof body !== 'string') return '';
  if (body.includes('\n')) return body; // has structure — leave untouched
  return body
    .replace(/([.!?:'")\]])\s*[*•] /g, '$1\n* ')
    .replace(/([.!?:'")\]])\s+(\d+)\. /g, '$1\n$2. ');
};

export const assembleMarkdown = (sections) =>
  (Array.isArray(sections) ? sections : [])
    .map((s) => {
      const marker = Number(s.level) === 3 ? '###' : '##';
      const heading = String(s.heading ?? '').replace(/^#+\s*/, '').trim();
      return `${marker} ${heading}\n\n${repairFlattenedBody(s.body ?? '').trim()}`;
    })
    .join('\n\n');

// Splits a data URL (or bare base64 string) into base64 payload.
export const stripDataUrl = (data) =>
  data.includes(',') ? data.split(',')[1] : data;

import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

// The Gemini key lives only here, server-side — never in the client bundle.
dotenv.config({ path: '.env.local' });

const app = express();
// Generous limit: requests carry base64-encoded screenshots/PDFs
app.use(express.json({ limit: '50mb' }));

let _ai = null;
const getAI = () => {
  if (_ai) return _ai;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY. Create a .env.local file with GEMINI_API_KEY=your_key and restart the server.");
  }
  _ai = new GoogleGenAI({ apiKey });
  return _ai;
};

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    markdownNotes: {
      type: Type.STRING,
      description: "Comprehensive study notes in Markdown format based on the input material. Use headings, bullet points, and bold text for clarity.",
    },
    flashcards: {
      type: Type.ARRAY,
      description: "A list of flashcards generated from the key concepts.",
      items: {
        type: Type.OBJECT,
        properties: {
          front: {
            type: Type.STRING,
            description: "The question or concept on the front of the card.",
          },
          back: {
            type: Type.STRING,
            description: "The answer or definition on the back of the card.",
          },
          difficulty: {
            type: Type.STRING,
            enum: ["easy", "medium", "hard"],
            description: "The difficulty level: 'easy' for basic recall, 'medium' for applied understanding, 'hard' for synthesis or nuanced concepts.",
          },
        },
        required: ["front", "back", "difficulty"],
      },
    },
  },
  required: ["markdownNotes", "flashcards"],
};

const YOUTUBE_URL_PATTERN = /^https:\/\/((www\.|m\.)?youtube\.com\/(watch\?|shorts\/|live\/)|youtu\.be\/)/;

app.post('/api/generate', async (req, res) => {
  try {
    const { text = '', files = [], customInstructions = '', previousContent = null, youtubeUrl = null } = req.body ?? {};

    if (youtubeUrl && !YOUTUBE_URL_PATTERN.test(youtubeUrl)) {
      return res.status(400).json({
        error: "That doesn't look like a YouTube link. Use a URL like https://www.youtube.com/watch?v=... or https://youtu.be/...",
      });
    }

    const parts = [];

    // Construct a context-aware prompt
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
      2. Generate Notes: Write notes *only* for the new information found in the input. Do not repeat what is already covered.
         - Structure the new material with ## headings per major topic and ### per concept.
         - Explain each concept plainly, bold (**) key terms when first introduced, and give a brief concrete example where one helps.
         - Where a mnemonic would genuinely aid memory, include it in italics as a "Memory tip:".
         - Include a "## Key Definitions" section when new technical terms are introduced.
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
      2. Generate study notes in Markdown that give the learner a solid foundation on the topic. Follow EXACTLY this structure:
         ## Overview — 2-4 sentences framing what this topic is, why it matters, and how the pieces fit together.
         ## Core Concepts — the main body. One ### sub-section per concept: explain it plainly, bold (**) key terms when first introduced, give a brief concrete example where one helps, and include an italic "Memory tip:" mnemonic only where it genuinely aids memory.
         ## Key Definitions — a bulleted glossary of the technical terms introduced (term — definition).
         ## Common Pitfalls & Misconceptions — where learners typically go wrong with this material. Omit this section if it does not apply.
         ## Summary — 3-5 bullet takeaways that capture the foundation the learner should walk away with.
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

    parts.push({ text: promptText });

    if (youtubeUrl) {
      parts.push({ fileData: { fileUri: youtubeUrl } });
    }

    if (text.trim()) {
      parts.push({ text: `User Provided Text/Context:\n${text}` });
    }

    // Add file parts (Images or PDFs)
    files.forEach((file) => {
      // Remove data url prefix if present (e.g., "data:image/png;base64,")
      const base64Data = file.data.includes(',') ? file.data.split(',')[1] : file.data;

      parts.push({
        inlineData: {
          mimeType: file.mimeType,
          data: base64Data,
        },
      });
    });

    const response = await getAI().models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        systemInstruction: "You are a helpful, accurate, and educational AI assistant.",
      },
    });

    if (!response.text) {
      throw new Error("No response generated from Gemini.");
    }

    res.json(JSON.parse(response.text));
  } catch (error) {
    console.error("Error generating study material:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to generate study materials. Please try again.",
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`StudySync API server listening on http://localhost:${PORT}`);
});

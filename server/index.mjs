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
         - Use ## headings for major topics and ### for sub-topics.
         - Use bullet points for lists of facts, steps, or properties.
         - Bold (**) key terms when first introduced.
         - Where a concept benefits from a concrete example, provide one briefly.
         - Where a mnemonic would aid memory, include it in italics as a "Memory tip:".
         - Include a "## Key Definitions" section when new technical terms are introduced.
      3. Generate Flashcards: Create flashcards *only* for NEW concepts. CHECK THE EXISTING QUESTIONS LIST ABOVE. DO NOT CREATE DUPLICATE CARDS.
         - Assign difficulty: 'easy' for simple definitions, 'medium' for applied concepts, 'hard' for synthesis, comparisons, or nuanced distinctions.
      `;
    } else {
      promptText += `

      YOUR TASK:
      1. Analyze the provided content thoroughly. Identify core topics, definitions, key concepts, and any processes or systems described.
      2. Generate comprehensive study notes in Markdown:
         - Use ## headings to organize major topics and ### for sub-topics.
         - Use bullet points for lists of facts, steps, or properties.
         - Bold (**) key terms when first introduced.
         - Where a concept benefits from a concrete example, provide one briefly.
         - Where a mnemonic would aid memory, include it in italics as a "Memory tip:".
         - Include a "## Key Definitions" section when new technical terms are introduced.
      3. Generate high-quality flashcards:
         - Test specific, discrete facts — one concept per card.
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

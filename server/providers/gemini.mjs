import { GoogleGenAI, Type } from '@google/genai';
import { buildPromptText, stripDataUrl } from '../prompt.mjs';

export const capabilities = { images: true, pdf: true, audio: true, youtube: true };

// Gemini wants its own Type-enum schema rather than plain JSON Schema.
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    sections: {
      type: Type.ARRAY,
      description: "The study notes as an ordered list of sections.",
      items: {
        type: Type.OBJECT,
        properties: {
          heading: {
            type: Type.STRING,
            description: "Plain-text section heading. No markdown # characters.",
          },
          level: {
            type: Type.INTEGER,
            description: "2 for top-level sections, 3 for sub-sections (individual concepts).",
          },
          body: {
            type: Type.STRING,
            description: "The section's content in Markdown. Every paragraph and every bullet point MUST be separated by real newline characters.",
          },
        },
        required: ["heading", "level", "body"],
      },
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
  required: ["sections", "flashcards"],
};

// Text-only structured call (used by /api/verify). Unlike generate() this
// consumes the canonical JSON Schema directly via responseJsonSchema.
export async function generateStructured({ promptText, schema, apiKey, model }) {
  if (!apiKey) {
    throw new Error("No Gemini API key configured. Add one in Settings (gear icon) or set GEMINI_API_KEY in .env.local.");
  }
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model,
    contents: promptText,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      systemInstruction: "You are a helpful, accurate, and educational AI assistant.",
    },
  });

  if (!response.text) {
    throw new Error("No response generated from Gemini.");
  }
  return JSON.parse(response.text);
}

export async function generate({ text, files, customInstructions, previousContent, youtubeUrl, apiKey, model }) {
  if (!apiKey) {
    throw new Error("No Gemini API key configured. Add one in Settings (gear icon) or set GEMINI_API_KEY in .env.local.");
  }
  const ai = new GoogleGenAI({ apiKey });

  const parts = [{ text: buildPromptText({ customInstructions, previousContent }) }];

  if (youtubeUrl) {
    parts.push({ fileData: { fileUri: youtubeUrl } });
  }

  if (text.trim()) {
    parts.push({ text: `User Provided Text/Context:\n${text}` });
  }

  files.forEach((file) => {
    parts.push({
      inlineData: {
        mimeType: file.mimeType,
        data: stripDataUrl(file.data),
      },
    });
  });

  const response = await ai.models.generateContent({
    model,
    contents: { parts },
    config: {
      responseMimeType: "application/json",
      responseSchema,
      systemInstruction: "You are a helpful, accurate, and educational AI assistant.",
    },
  });

  if (!response.text) {
    throw new Error("No response generated from Gemini.");
  }
  return JSON.parse(response.text);
}

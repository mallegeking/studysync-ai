import { GoogleGenAI } from '@google/genai';
import { buildPromptText, responseJsonSchema, stripDataUrl } from '../prompt.mjs';

export const capabilities = { images: true, pdf: true, audio: true, youtube: true };

// One structured-call core serves every endpoint: generation (canonical
// schema), verification, and tutor pre-questions/grading. The SDK accepts
// standard JSON Schema via responseJsonSchema, so the canonical schema is
// shared with the other adapters.
export async function generateStructured({ promptText, schema, text = '', files = [], youtubeUrl = null, apiKey, model }) {
  if (!apiKey) {
    throw new Error("No Gemini API key configured. Add one in Settings (gear icon) or set GEMINI_API_KEY in .env.local.");
  }
  const ai = new GoogleGenAI({ apiKey });

  const parts = [{ text: promptText }];

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
  return generateStructured({
    promptText: buildPromptText({ customInstructions, previousContent }),
    schema: responseJsonSchema,
    text,
    files,
    youtubeUrl,
    apiKey,
    model,
  });
}

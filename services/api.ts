import { AppSettings, GeneratedContent, UploadedFile } from "../types";

// Generation happens server-side (server/index.mjs) behind a provider
// adapter layer (Gemini / OpenAI / Anthropic / local) so API keys never
// ship in the client bundle. Vite proxies /api to the Express server.

export interface GenerationResult extends GeneratedContent {
  // Inputs the active provider couldn't process and dropped (e.g. audio
  // narration on a provider without audio support)
  warnings?: string[];
}

const throwResponseError = async (response: Response, fallback: string): Promise<never> => {
  let message = fallback;
  try {
    const body = await response.json();
    if (body?.error) message = body.error;
  } catch {
    // Non-JSON error body (e.g. proxy failure) — keep the generic message
  }
  throw new Error(message);
};

export const generateStudyMaterial = async (
  text: string,
  files: UploadedFile[],
  customInstructions: string = "",
  previousContent: GeneratedContent | null = null,
  youtubeUrl?: string
): Promise<GenerationResult> => {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, files, customInstructions, previousContent, youtubeUrl }),
  });

  if (!response.ok) {
    await throwResponseError(response, `Failed to generate study materials (server responded ${response.status}).`);
  }
  return response.json();
};

export const getSettings = async (): Promise<AppSettings> => {
  const response = await fetch("/api/settings");
  if (!response.ok) {
    await throwResponseError(response, `Failed to load settings (server responded ${response.status}).`);
  }
  return response.json();
};

export interface SettingsUpdate {
  activeProvider?: string;
  providers?: Record<string, { apiKey?: string; model?: string; baseUrl?: string }>;
}

export const updateSettings = async (update: SettingsUpdate): Promise<AppSettings> => {
  const response = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  if (!response.ok) {
    await throwResponseError(response, `Failed to save settings (server responded ${response.status}).`);
  }
  return response.json();
};

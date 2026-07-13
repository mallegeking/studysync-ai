import { GeneratedContent, UploadedFile } from "../types";

// Generation happens server-side (server/index.mjs) so the Gemini API key
// never ships in the client bundle. Vite proxies /api to the Express server.
export const generateStudyMaterial = async (
  text: string,
  files: UploadedFile[],
  customInstructions: string = "",
  previousContent: GeneratedContent | null = null,
  youtubeUrl?: string
): Promise<GeneratedContent> => {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, files, customInstructions, previousContent, youtubeUrl }),
  });

  if (!response.ok) {
    let message = `Failed to generate study materials (server responded ${response.status}).`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // Non-JSON error body (e.g. proxy failure) — keep the generic message
    }
    throw new Error(message);
  }

  return response.json();
};

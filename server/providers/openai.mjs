import { buildPromptText, responseJsonSchema } from '../prompt.mjs';

// One adapter serves both OpenAI and local OpenAI-compatible runtimes
// (Ollama, LM Studio, llama.cpp server) — same wire format, different
// baseUrl/model and a graceful fallback for runtimes without json_schema.

export const capabilities = { images: true, pdf: true, audio: false, youtube: false };
export const localCapabilities = { images: false, pdf: false, audio: false, youtube: false };

const callChatCompletions = async ({ baseUrl, apiKey, model, messages, responseFormat }) => {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, response_format: responseFormat }),
  });
  return response;
};

// Some responses (especially from local models) wrap JSON in markdown fences
const parseModelJson = (raw) => {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(trimmed);
};

// One structured-call core serves every endpoint: generation (canonical
// schema), verification, and tutor pre-questions/grading.
export async function generateStructured({ promptText, schema, schemaName = 'structured_output', text = '', files = [], apiKey, model, baseUrl, isLocal }) {
  if (!isLocal && !apiKey) {
    throw new Error("No OpenAI API key configured. Add one in Settings (gear icon).");
  }
  if (isLocal && !baseUrl) {
    throw new Error("No base URL configured for the local provider. Set one in Settings (gear icon), e.g. http://localhost:11434/v1 for Ollama.");
  }
  if (!model) {
    throw new Error(`No model configured for the ${isLocal ? 'local' : 'OpenAI'} provider. Set one in Settings (gear icon).`);
  }
  const effectiveBaseUrl = isLocal ? baseUrl : (baseUrl || 'https://api.openai.com/v1');

  const buildMessages = (includeSchemaInPrompt) => {
    let prompt = promptText;
    if (includeSchemaInPrompt) {
      prompt += `\n\nRespond with ONLY a JSON object matching this schema (no markdown fences, no commentary):\n${JSON.stringify(schema)}`;
    }
    if (text.trim()) {
      prompt += `\n\nUser Provided Text/Context:\n${text}`;
    }

    const content = [{ type: 'text', text: prompt }];
    for (const file of files) {
      if (file.mimeType.startsWith('image/')) {
        const url = file.data.startsWith('data:') ? file.data : `data:${file.mimeType};base64,${file.data}`;
        content.push({ type: 'image_url', image_url: { url } });
      } else if (file.mimeType === 'application/pdf') {
        const fileData = file.data.startsWith('data:') ? file.data : `data:application/pdf;base64,${file.data}`;
        content.push({ type: 'file', file: { filename: 'document.pdf', file_data: fileData } });
      }
    }

    return [
      { role: 'system', content: 'You are a helpful, accurate, and educational AI assistant.' },
      { role: 'user', content },
    ];
  };

  // First attempt: enforced JSON schema
  let response = await callChatCompletions({
    baseUrl: effectiveBaseUrl,
    apiKey,
    model,
    messages: buildMessages(false),
    responseFormat: {
      type: 'json_schema',
      json_schema: { name: schemaName, strict: true, schema },
    },
  });

  // Local runtimes often reject json_schema — retry with json_object + prompt-described schema
  if (!response.ok && isLocal && response.status === 400) {
    response = await callChatCompletions({
      baseUrl: effectiveBaseUrl,
      apiKey,
      model,
      messages: buildMessages(true),
      responseFormat: { type: 'json_object' },
    });
  }

  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      const body = await response.json();
      if (body?.error?.message) detail = body.error.message;
    } catch { /* non-JSON error body */ }
    throw new Error(`${isLocal ? 'Local model' : 'OpenAI'} request failed: ${detail}`);
  }

  const body = await response.json();
  const raw = body?.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error(`No response generated from the ${isLocal ? 'local model' : 'OpenAI'} provider.`);
  }
  return parseModelJson(raw);
}

export async function generate({ text, files, customInstructions, previousContent, apiKey, model, baseUrl, isLocal }) {
  return generateStructured({
    promptText: buildPromptText({ customInstructions, previousContent }),
    schema: responseJsonSchema,
    schemaName: 'study_material',
    text,
    files,
    apiKey,
    model,
    baseUrl,
    isLocal,
  });
}

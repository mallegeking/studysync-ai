import Anthropic from '@anthropic-ai/sdk';
import { buildPromptText, responseJsonSchema, stripDataUrl } from '../prompt.mjs';

// The Messages API takes images and PDFs but no audio and no YouTube URLs.
export const capabilities = { images: true, pdf: true, audio: false, youtube: false };

// One structured-call core serves every endpoint: generation (canonical
// schema), verification, and tutor pre-questions/grading.
export async function generateStructured({ promptText, schema, text = '', files = [], apiKey, model }) {
  if (!apiKey) {
    throw new Error("No Anthropic API key configured. Add one in Settings (gear icon).");
  }
  const client = new Anthropic({ apiKey });

  const content = [];

  // Documents and images go before the instruction text
  for (const file of files) {
    const data = stripDataUrl(file.data);
    if (file.mimeType === 'application/pdf') {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data },
      });
    } else if (file.mimeType.startsWith('image/')) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: file.mimeType, data },
      });
    }
    // Anything else (audio) should have been stripped by the caller
  }

  let prompt = promptText;
  if (text.trim()) {
    prompt += `\n\nUser Provided Text/Context:\n${text}`;
  }
  content.push({ type: 'text', text: prompt });

  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: 'You are a helpful, accurate, and educational AI assistant.',
    output_config: {
      format: { type: 'json_schema', schema },
    },
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined to process this material. Try rephrasing or a different source.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('The material produced more output than fits in one response — try a smaller chunk.');
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock?.text) {
    throw new Error('No response generated from Claude.');
  }
  return JSON.parse(textBlock.text);
}

export async function generate({ text, files, customInstructions, previousContent, apiKey, model }) {
  return generateStructured({
    promptText: buildPromptText({ customInstructions, previousContent }),
    schema: responseJsonSchema,
    text,
    files,
    apiKey,
    model,
  });
}

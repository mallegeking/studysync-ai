import express from 'express';
import dotenv from 'dotenv';
import { assembleMarkdown } from './prompt.mjs';
import { verifyJsonSchema, buildVerifyPrompt, normalizeVerification } from './verify.mjs';
import { loadSettings, saveSettings, resolveApiKey, sanitizeSettings, PROVIDER_NAMES } from './settings.mjs';
import * as gemini from './providers/gemini.mjs';
import * as anthropic from './providers/anthropic.mjs';
import * as openai from './providers/openai.mjs';

// API keys live only server-side — in server/config.json (via the settings
// UI) or .env.local — never in the client bundle.
dotenv.config({ path: '.env.local' });

const app = express();
// Generous limit: requests carry base64-encoded screenshots/PDFs/audio
app.use(express.json({ limit: '50mb' }));

const PROVIDERS = {
  gemini: { adapter: gemini, capabilities: gemini.capabilities },
  openai: { adapter: openai, capabilities: openai.capabilities },
  anthropic: { adapter: anthropic, capabilities: anthropic.capabilities },
  local: { adapter: openai, capabilities: openai.localCapabilities },
};

const capabilitiesByProvider = Object.fromEntries(
  Object.entries(PROVIDERS).map(([id, p]) => [id, p.capabilities])
);

const YOUTUBE_URL_PATTERN = /^https:\/\/((www\.|m\.)?youtube\.com\/(watch\?|shorts\/|live\/)|youtu\.be\/)/;

// Drop inputs the active provider can't process; report what was dropped
// instead of failing (auto-generate loops must keep working).
function stripUnsupportedInputs({ files, youtubeUrl }, caps, providerName) {
  const warnings = [];
  let keptFiles = files;
  let keptYoutubeUrl = youtubeUrl;

  const audioCount = files.filter((f) => f.mimeType.startsWith('audio/')).length;
  if (!caps.audio && audioCount > 0) {
    keptFiles = keptFiles.filter((f) => !f.mimeType.startsWith('audio/'));
    warnings.push(`${providerName} can't process audio — ${audioCount} narration segment${audioCount !== 1 ? 's were' : ' was'} ignored. Switch to Gemini in Settings to include narration.`);
  }
  if (!caps.images) {
    const imageCount = keptFiles.filter((f) => f.mimeType.startsWith('image/')).length;
    if (imageCount > 0) {
      keptFiles = keptFiles.filter((f) => !f.mimeType.startsWith('image/'));
      warnings.push(`${providerName} is configured as text-only — ${imageCount} image${imageCount !== 1 ? 's were' : ' was'} ignored.`);
    }
  }
  if (!caps.pdf) {
    const pdfCount = keptFiles.filter((f) => f.mimeType === 'application/pdf').length;
    if (pdfCount > 0) {
      keptFiles = keptFiles.filter((f) => f.mimeType !== 'application/pdf');
      warnings.push(`${providerName} is configured as text-only — ${pdfCount} PDF${pdfCount !== 1 ? 's were' : ' was'} ignored.`);
    }
  }
  if (!caps.youtube && youtubeUrl) {
    keptYoutubeUrl = null;
    warnings.push(`${providerName} can't ingest YouTube links — the video was ignored. Switch to Gemini in Settings for YouTube.`);
  }

  return { files: keptFiles, youtubeUrl: keptYoutubeUrl, warnings };
}

app.get('/api/settings', (req, res) => {
  res.json(sanitizeSettings(loadSettings(), capabilitiesByProvider));
});

app.put('/api/settings', (req, res) => {
  try {
    const { activeProvider, providers } = req.body ?? {};
    if (activeProvider && !PROVIDERS[activeProvider]) {
      return res.status(400).json({ error: `Unknown provider: ${activeProvider}` });
    }
    const saved = saveSettings({ activeProvider, providers });
    res.json(sanitizeSettings(saved, capabilitiesByProvider));
  } catch (error) {
    console.error('Failed to save settings:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save settings.' });
  }
});

app.post('/api/generate', async (req, res) => {
  try {
    const { text = '', files = [], customInstructions = '', previousContent = null, youtubeUrl = null } = req.body ?? {};

    if (youtubeUrl && !YOUTUBE_URL_PATTERN.test(youtubeUrl)) {
      return res.status(400).json({
        error: "That doesn't look like a YouTube link. Use a URL like https://www.youtube.com/watch?v=... or https://youtu.be/...",
      });
    }

    const settings = loadSettings();
    const providerId = settings.activeProvider;
    const { adapter, capabilities } = PROVIDERS[providerId];
    const providerName = PROVIDER_NAMES[providerId];
    const providerConfig = settings.providers[providerId];

    const stripped = stripUnsupportedInputs({ files, youtubeUrl }, capabilities, providerName);

    if (!text.trim() && stripped.files.length === 0 && !stripped.youtubeUrl && !previousContent) {
      return res.status(400).json({
        error: `Nothing ${providerName} can process was left after removing unsupported inputs. ${stripped.warnings.join(' ')}`,
      });
    }

    const data = await adapter.generate({
      text,
      files: stripped.files,
      customInstructions,
      previousContent,
      youtubeUrl: stripped.youtubeUrl,
      apiKey: resolveApiKey(settings, providerId),
      model: providerConfig.model,
      baseUrl: providerConfig.baseUrl,
      isLocal: providerId === 'local',
    });

    // Client contract stays { markdownNotes, flashcards } (+ warnings) —
    // the sections format is internal to the adapters.
    res.json({
      markdownNotes: assembleMarkdown(data.sections),
      flashcards: data.flashcards ?? [],
      warnings: stripped.warnings,
    });
  } catch (error) {
    console.error('Error generating study material:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate study materials. Please try again.',
    });
  }
});

// On-demand fact check of already-generated content. Content-only: the
// original sources are gone by now, so flags come from the model's general
// knowledge (the client UI discloses this).
app.post('/api/verify', async (req, res) => {
  try {
    const { markdownNotes = '', flashcards = [] } = req.body ?? {};
    const cards = Array.isArray(flashcards) ? flashcards : [];

    if (!markdownNotes.trim() && cards.length === 0) {
      return res.status(400).json({ error: 'Nothing to verify.' });
    }

    const settings = loadSettings();
    const providerId = settings.activeProvider;
    const { adapter } = PROVIDERS[providerId];
    const providerConfig = settings.providers[providerId];

    const raw = await adapter.generateStructured({
      promptText: buildVerifyPrompt({ markdownNotes, flashcards: cards }),
      schema: verifyJsonSchema,
      schemaName: 'verification_result',
      apiKey: resolveApiKey(settings, providerId),
      model: providerConfig.model,
      baseUrl: providerConfig.baseUrl,
      isLocal: providerId === 'local',
    });

    res.json({
      ...normalizeVerification(raw, cards),
      verifiedAt: new Date().toISOString(),
      provider: PROVIDER_NAMES[providerId],
      model: providerConfig.model,
    });
  } catch (error) {
    console.error('Error verifying study material:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Verification failed. Please try again.',
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`StudySync API server listening on http://localhost:${PORT}`);
});

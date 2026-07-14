import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Provider settings live in server/config.json (gitignored — it holds API
// keys). Env vars act as a fallback so an existing .env.local keeps working.
const CONFIG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.json');

const ENV_KEYS = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  local: null,
};

const DEFAULTS = {
  activeProvider: 'gemini',
  providers: {
    gemini: { apiKey: '', model: 'gemini-2.5-flash' },
    openai: { apiKey: '', model: 'gpt-5-mini' },
    anthropic: { apiKey: '', model: 'claude-opus-4-8' },
    local: { apiKey: '', model: '', baseUrl: 'http://localhost:11434/v1' },
  },
};

export const PROVIDER_NAMES = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  local: 'Local (OpenAI-compatible)',
};

export function loadSettings() {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    // No config yet (or unreadable) — run on defaults + env
  }
  const merged = {
    activeProvider: stored.activeProvider ?? DEFAULTS.activeProvider,
    providers: {},
  };
  for (const id of Object.keys(DEFAULTS.providers)) {
    merged.providers[id] = { ...DEFAULTS.providers[id], ...(stored.providers?.[id] ?? {}) };
  }
  if (!merged.providers[merged.activeProvider]) {
    merged.activeProvider = DEFAULTS.activeProvider;
  }
  return merged;
}

export function saveSettings(update) {
  const current = loadSettings();
  const next = {
    activeProvider: update.activeProvider ?? current.activeProvider,
    providers: { ...current.providers },
  };
  if (!next.providers[next.activeProvider]) {
    throw new Error(`Unknown provider: ${next.activeProvider}`);
  }
  for (const [id, patch] of Object.entries(update.providers ?? {})) {
    if (!next.providers[id] || typeof patch !== 'object' || patch === null) continue;
    const merged = { ...next.providers[id] };
    for (const field of ['apiKey', 'model', 'baseUrl']) {
      if (typeof patch[field] === 'string') merged[field] = patch[field].trim();
    }
    next.providers[id] = merged;
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

// The key actually used for a provider: config value first, env fallback.
export function resolveApiKey(settings, providerId) {
  const configured = settings.providers[providerId]?.apiKey;
  if (configured) return configured;
  const envVar = ENV_KEYS[providerId];
  return envVar ? (process.env[envVar] ?? '') : '';
}

// Shape returned to the client — never includes raw keys.
export function sanitizeSettings(settings, capabilitiesByProvider) {
  const providers = {};
  for (const [id, cfg] of Object.entries(settings.providers)) {
    providers[id] = {
      name: PROVIDER_NAMES[id],
      model: cfg.model,
      ...(id === 'local' ? { baseUrl: cfg.baseUrl } : {}),
      keySet: Boolean(resolveApiKey(settings, id)) || id === 'local',
      capabilities: capabilitiesByProvider[id],
    };
  }
  return { activeProvider: settings.activeProvider, providers };
}

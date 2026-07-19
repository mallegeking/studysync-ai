# StudySync AI

Personal study companion: generates structured study notes and SM-2 spaced-repetition flashcards from screen captures (with narration audio), uploaded PDFs/images, pasted text, and YouTube links.

## Architecture

- **Client**: Vite + React 19 + TypeScript + Tailwind v4 (`@tailwindcss/vite`, typography plugin). Entry `index.tsx` → `App.tsx` (view routing, session state, localStorage persistence) → `components/` (InputSection = capture/upload UI, NotesView, FlashcardDeck) and `services/` (gemini.ts = thin fetch client, srs.ts = SM-2 scheduling in local time).
- **Server**: `server/index.mjs` — Express proxy on port 3001: routing, capability stripping, settings endpoints, plus `POST /api/verify` (on-demand fact check; `server/verify.mjs`) and `POST /api/tutor/{start,grade}` (tutor mode; `server/tutor.mjs`). Every adapter exposes a single multimodal `generateStructured({ promptText, schema, text, files, youtubeUrl?, ... })` core (`generate()` delegates to it with the canonical schema); the verify/tutor routes call it with their own schemas. Verification uses `settings.verificationProvider || activeProvider` — a "Verify with" dropdown lets a different (independently-trained) model run the check. Provider adapters live in `server/providers/{gemini,anthropic,openai}.mjs` (the openai adapter also serves local OpenAI-compatible runtimes via baseUrl); shared prompt text + canonical JSON schema + markdown assembly in `server/prompt.mjs`; provider/key settings in `server/settings.mjs` backed by gitignored `server/config.json` with env-var fallback (`GEMINI_API_KEY` etc. from `.env.local`). Keys never ship to the client — `GET /api/settings` returns `keySet` booleans only. Vite dev server proxies `/api` → 3001.
- **Data flow**: client POSTs `{ text, files[], customInstructions, previousContent, youtubeUrl }` to `/api/generate`; `files` is mimeType-generic (JPEG frames, PDFs, webm/opus audio segments all ride the same array). Inputs the active provider can't process (audio/YouTube on non-Gemini, images on local) are stripped server-side and reported back via `warnings[]`, shown as an amber banner — never hard-fail on unsupported inputs (auto-generate loops must keep running).

## Commands

- `npm run dev` — starts Express server + Vite client together (concurrently). App at http://localhost:3000.
- `npm run lint` — `tsc --noEmit`.
- `npm run build` / `npm run preview`.
- Requires `.env.local` with `GEMINI_API_KEY=...` (gitignored).

## Conventions & gotchas

- The capture loop in `InputSection.tsx` runs in a `setInterval` registered once per recording: any state it reads **must** go through the ref-mirror pattern (see the block of `useRef` + sync `useEffect` around lines 60–90), or it silently goes stale.
- Flashcards carry stable `id`s (`crypto.randomUUID()`); reviews match by id, never by front/back text.
- SRS dates are local-time `YYYY-MM-DD` strings (`services/srs.ts`); never use `toISOString()` for dates.
- Failed reviews (quality < 3) keep the card due today for same-session relearning; `FlashcardDeck.handleRate` relies on this (failed card stays in the list, passed card is removed by the parent).
- Recorded narration is banked into pending audio segments on stop and drained into the next generation — don't discard `pendingAudioRef` outside "Clear all".
- Verification flags live on `GeneratedContent.verification` (persisted with the session). Note flags carry verbatim `excerpt` quotes; `services/highlight.ts` best-effort-matches them into `<mark>`s per block element (handles `**bold**` splits), and unmatched excerpts degrade to list-only with a "not located" tag — never error on a failed match. Card flags are mapped server-side from 1-based indices to card ids (models mangle UUIDs); editing/deleting a card clears its flag.
- Dev environment is WSL2 but `npm`/`node` resolve to the **Windows** installation: dev servers listen on the Windows side (from WSL, reach them via the gateway IP from `ip route show default`), and stopping npm from WSL can orphan `node.exe` processes that keep holding ports 3000/3001 — kill them by port via PowerShell.

## Roadmap / TODO

1. ~~**Multi-provider support**~~ — done (2026-07-14): adapter layer under `server/providers/`, settings UI (gear icon → `components/SettingsModal.tsx`), per-provider capability flags with strip-and-warn degradation. Live calls to OpenAI/Anthropic/local still unvalidated (no keys available during development) — first real use will tell.
2. ~~**Tutor mode**~~ — done (2026-07-19): `components/TutorView.tsx` runs a four-stage machine (source → pretest → study → confrontation). Source (text/files/YouTube; not screen capture) kept in memory and re-sent to both `/api/tutor/start` (pre-questions) and `/api/tutor/grade` (buckets grade dump+cold-answers against the source, generate gap cards). Study stage generates real notes/cards into the session via `mergeStudyMaterial`. Gap cards merge into the main deck (misconceptions weighted `hard`, 2-3 cards each) via `addGapCards`; `existingFronts` dedups against the deck. Tutor stage state is in-memory only — a mid-session reload keeps the notes/cards it already produced but drops the flow.
3. **UI overhaul**: general design pass (not urgent, do after content quality and providers).

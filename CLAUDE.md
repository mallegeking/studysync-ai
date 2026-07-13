# StudySync AI

Personal study companion: generates structured study notes and SM-2 spaced-repetition flashcards from screen captures (with narration audio), uploaded PDFs/images, pasted text, and YouTube links.

## Architecture

- **Client**: Vite + React 19 + TypeScript + Tailwind v4 (`@tailwindcss/vite`, typography plugin). Entry `index.tsx` → `App.tsx` (view routing, session state, localStorage persistence) → `components/` (InputSection = capture/upload UI, NotesView, FlashcardDeck) and `services/` (gemini.ts = thin fetch client, srs.ts = SM-2 scheduling in local time).
- **Server**: `server/index.mjs` — Express proxy on port 3001. Holds the API key (from `.env.local`, never shipped to the client), builds the generation prompt, calls Gemini (`@google/genai`), validates YouTube URLs. Vite dev server proxies `/api` → 3001.
- **Data flow**: client POSTs `{ text, files[], customInstructions, previousContent, youtubeUrl }` to `/api/generate`; `files` is mimeType-generic (JPEG frames, PDFs, webm/opus audio segments all ride the same array).

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
- Dev environment is WSL2 but `npm`/`node` resolve to the **Windows** installation: dev servers listen on the Windows side (from WSL, reach them via the gateway IP from `ip route show default`), and stopping npm from WSL can orphan `node.exe` processes that keep holding ports 3000/3001 — kill them by port via PowerShell.

## Roadmap / TODO

1. **Multi-provider support** (next up, agreed): provider adapter layer in `server/index.mjs` — Gemini, OpenAI, Anthropic, plus one OpenAI-compatible adapter covering local runtimes (Ollama, LM Studio, llama.cpp server). Settings UI for provider/model/base-URL/API key; keys stored server-side. Needs per-provider capability flags with graceful degradation (YouTube ingestion and inline audio are Gemini-specific; most local models are text/image only).
2. **Tutor mode (active recall on new material)**: before studying a source, the user brain-dumps what they already know (plus 3–5 AI-generated pre-questions attempted cold — pretesting effect). After studying, the AI grades the dump against the source into three buckets: knew correctly / believed wrongly (misconceptions) / didn't know. Gap buckets feed weighted flashcard generation into the SRS deck. Keep friction low: short, skippable. New Tutor view + session state machine (dump → study → confrontation) + one server endpoint for the compare/grade step.
3. **UI overhaul**: general design pass (not urgent, do after content quality and providers).

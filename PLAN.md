# StudySync AI — Development Plan

## Vision
StudySync AI's unique edge is the **live screen capture loop**: open a Cisco course, hit record, and cards appear automatically as you learn. Every planned feature below reinforces that core loop. No other study tool does this.

---

## Phase 1 — Foundation: Persistence & UI Polish

### 1.1 Session Persistence (localStorage)

**Files:** `App.tsx`

- Lazy-initialize `generatedContent` directly from `localStorage` on mount (no flicker, no double render):
  ```ts
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent | null>(() => {
    try {
      const saved = localStorage.getItem('studysync-ai-session');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  ```
- Add `useEffect` to sync `generatedContent` → `localStorage` on every change. If `null`, remove the key.
- Add `sessionRestored` boolean state (lazy init: check if key exists). Show a dismissable "Session restored" banner using the `X` icon from lucide-react.
- `clearSession` handler: add `setSessionRestored(false)` (localStorage cleared automatically by the effect).
- Import `useEffect` alongside the existing `useState` import.

**Key gotcha:** Only `generatedContent` is persisted. Captured frames live in `InputSection` local state — they are inputs to generation, not outputs, so they don't need to be saved.

---

### 1.2 UI Polish

#### Copy button — `NotesView.tsx`
- Add `useState` (for `copied` toggle) + import `Copy`, `Check`, `FileText` from lucide-react.
- `handleCopy`: `navigator.clipboard.writeText(markdown)` → set `copied=true` → reset after 2s.
- Position button `absolute top-4 right-4` over the prose container. Show `Check` icon + "Copied!" for 2s, then revert.
- Improved empty state: `FileText` icon (large, muted) + two lines of helper text.

#### Progress bar — `FlashcardDeck.tsx`
- Insert above the card container:
  ```tsx
  <div className="w-full bg-slate-100 rounded-full h-1.5 mb-6">
    <div className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
         style={{ width: `${((currentIndex + 1) / cards.length) * 100}%` }} />
  </div>
  ```

#### Loading skeleton — `App.tsx`
- In `handleGenerate`: if `!generatedContent`, call `setViewMode(ViewMode.NOTES)` before the `await` so the skeleton is visible immediately.
- Render an `animate-pulse` skeleton block when `isGenerating && !generatedContent` (mutually exclusive with the real `NotesView`).

---

## Phase 2 — Better AI Output

### 2.1 Flashcard Quality

**Files:** `types.ts` → `services/gemini.ts` → `FlashcardDeck.tsx` (in this order)

#### `types.ts`
Add `difficulty` to `FlashcardData`:
```ts
export interface FlashcardData {
  front: string;
  back: string;
  difficulty: 'easy' | 'medium' | 'hard';
}
```

#### `services/gemini.ts`
- **Context size:** expand existing-notes reference from 500 → 2000 characters in the continuation prompt.
- **JSON schema:** add `difficulty` property with `enum: ["easy","medium","hard"]` and include it in `required`.
- **Prompt improvements** (both fresh + continuation branches):
  - Structure notes with `##` major topics and `###` sub-topics
  - Bold (`**`) key terms on first use
  - Concrete example per concept where helpful
  - Mnemonics in italics labeled "Memory tip:"
  - "## Key Definitions" section when technical terms are introduced
  - Difficulty guidance: `easy` = simple recall, `medium` = applied understanding, `hard` = synthesis or nuanced distinctions

#### `FlashcardDeck.tsx`
- Color-coded difficulty badge on card front, `absolute top-4 right-4`:
  - `easy` → `bg-green-100 text-green-700 border-green-200`
  - `medium` → `bg-yellow-100 text-yellow-700 border-yellow-200`
  - `hard` → `bg-red-100 text-red-700 border-red-200`
- Use optional chaining (`?.`) as backwards compatibility guard for cards saved before this field existed.
- CSV export: add `difficulty` as a third column (Anki supports extra fields).

---

## Phase 3 — Screen Capture: Lean In (The Differentiator)

This is what no competitor does. The goal is to make the capture→cards loop feel **automatic and invisible**.

### 3.1 Auto-Generate Mode

**Files:** `InputSection.tsx`, `App.tsx`

Currently: frames accumulate → user clicks "Generate". 
New: add an **Auto-Generate toggle** in the capture toolbar. When on, every time N new frames are captured (configurable, default = 3), automatically trigger generation in the background without user intervention.

Implementation:
- Add `autoGenerate: boolean` state to `InputSection` with a toggle button in the toolbar.
- Add `autoGenerateThreshold: number` state (default 3, configurable via a small dropdown: 3 / 5 / 10 frames).
- In `checkForChanges()`, after `captureFrame()`, check: `if (autoGenerate && capturedImages.length % autoGenerateThreshold === 0)` → call `onGenerate(...)`.
- The `isGenerating` flag from `App.tsx` must be passed down to `InputSection` to prevent overlapping requests. Skip the auto-trigger if `isGenerating` is already `true`.
- Show a subtle `⚡ Auto` pill badge in the toolbar when active. During auto-generation, show a small spinner next to it instead of blocking the full UI.

### 3.2 Smarter Change Detection

**Files:** `InputSection.tsx`

Current: 64×64 pixel canvas comparison, triggers on any pixel difference.  
Issues: minor cursor movements or video playback can create excessive captures.

Improvements:
- **Sensitivity control:** add a slider or dropdown (Low / Medium / High) that adjusts the comparison canvas size:
  - Low = 32×32 (only major layout changes)
  - Medium = 64×64 (current)
  - High = 128×128 (catches subtle text changes)
- **Debounce threshold:** instead of triggering on any difference, compute a simple pixel-change ratio between frames. Only capture if > X% of pixels changed. Use `getImageData()` on the comparison canvas and count differing pixels. Default threshold: 5%.
- This reduces noise from video playback artifacts or cursor flickers.

### 3.3 Frame Timeline Improvements

**Files:** `InputSection.tsx`

- **Larger thumbnails:** increase from `w-48` to a slightly taller card that shows a preview label (frame timestamp).
- **Batch select:** add checkboxes on hover to select specific frames for targeted generation ("Generate from selected frames only").
- **Frame limit warning:** if `capturedImages.length > 20`, show a warning banner. Gemini has a token limit; too many images will degrade output quality. Suggest auto-clearing older frames.
- **Auto-clear old frames** option: after generation, optionally clear all captured frames (keep a toggle, default on in Auto-Generate mode so the buffer stays manageable).

---

## Phase 4 — Spaced Repetition (SM-2 Algorithm)

This transforms the app from a flashcard generator into an actual study system.

### 4.1 Data Model

**Files:** `types.ts`

Extend `FlashcardData` with SRS fields:
```ts
export interface FlashcardData {
  front: string;
  back: string;
  difficulty: 'easy' | 'medium' | 'hard';
  // SRS fields (undefined on newly generated cards)
  srs?: {
    interval: number;      // days until next review
    repetitions: number;   // times reviewed successfully
    easeFactor: number;    // default 2.5, adjusted per review
    nextReview: string;    // ISO date string (YYYY-MM-DD)
  };
}
```

Using optional `srs` field means existing cards (from localStorage or before this feature) remain valid — they simply show up as "new" cards with no review history.

### 4.2 SM-2 Algorithm

**Files:** new `services/srs.ts`

Implement the SM-2 algorithm as pure functions (no side effects, easy to test):

```ts
// quality: 0 (complete blackout) → 5 (perfect recall)
export function reviewCard(card: FlashcardData, quality: 0|1|2|3|4|5): FlashcardData

export function isDueToday(card: FlashcardData): boolean

export function getCardsForReview(cards: FlashcardData[]): FlashcardData[]
```

SM-2 rules:
- If `quality < 3`: reset — `interval=1`, `repetitions=0`, `easeFactor` unchanged
- If `quality >= 3`:
  - `repetitions=0` → `interval=1`
  - `repetitions=1` → `interval=6`
  - Else → `interval = round(interval × easeFactor)`
  - `easeFactor = max(1.3, easeFactor + 0.1 - (5-quality)×(0.08 + (5-quality)×0.02))`
  - `repetitions++`
- `nextReview = today + interval days`

### 4.3 Review UI

**Files:** `FlashcardDeck.tsx`, `App.tsx`, `types.ts`

Add a **"Review" view mode** (`ViewMode.REVIEW`) alongside INPUT, NOTES, FLASHCARDS.

`FlashcardDeck.tsx` changes for review mode:
- When `mode === 'review'`, after flipping a card, show four rating buttons instead of navigation:
  - **Again** (quality=1) — red
  - **Hard** (quality=2) — orange  
  - **Good** (quality=4) — green
  - **Easy** (quality=5) — blue
- Rating a card calls `reviewCard(card, quality)` → updates the card in `generatedContent` → persists via localStorage automatically.
- After rating, advance to the next due card automatically.
- Show "X cards remaining" counter at the top.
- End screen: "All done for today! Come back tomorrow." with next-review date.

Header tab: add **"Review (N)"** tab showing count of cards due today. The number updates reactively from `getCardsForReview(generatedContent.flashcards).length`.

### 4.4 Study Stats (nice-to-have, add last)

A small stats block below the flashcard in review mode:
- Current streak (days reviewed)
- Cards mastered (interval > 21 days)
- Due today vs total

---

## File Change Summary

| File | Changes |
|---|---|
| `types.ts` | Add `difficulty` to `FlashcardData`; add `srs` field; add `ViewMode.REVIEW` |
| `App.tsx` | localStorage persistence + session banner + skeleton + pass `isGenerating` to `InputSection` |
| `services/gemini.ts` | 2000-char context; difficulty in schema; better prompt structure |
| `services/srs.ts` | **New file** — pure SM-2 functions |
| `components/InputSection.tsx` | Auto-generate toggle; sensitivity control; frame timeline improvements |
| `components/NotesView.tsx` | Copy button; improved empty state |
| `components/FlashcardDeck.tsx` | Progress bar; difficulty badge; review mode rating buttons; improved empty state |

---

## Implementation Order

```
Phase 1  →  Phase 2  →  Phase 3  →  Phase 4
  (fast wins)   (quality)   (differentiator)   (retention)
```

Within each phase, always update `types.ts` first since it cascades into all other files.

---

## Verification Checklist

- [ ] Generate notes → refresh page → session restored banner appears, content is intact
- [ ] Dismiss banner → clear session → refresh → no restore
- [ ] Copy button in Notes copies markdown to clipboard, icon toggles for 2s
- [ ] Progress bar advances smoothly through flashcard deck
- [ ] Generating for first time shows skeleton before notes appear
- [ ] Flashcards show difficulty badge (green/yellow/red)
- [ ] `npm run lint` passes with no TypeScript errors
- [ ] Enable Auto-Generate → watch a video → cards accumulate without clicking anything
- [ ] Change sensitivity to Low → cursor movement no longer triggers captures
- [ ] Rate a flashcard in Review mode → it disappears from today's queue, SM-2 data visible in localStorage
- [ ] Next day (or set device clock forward 1 day) → reviewed cards reappear if due

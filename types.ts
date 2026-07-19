export interface SrsData {
  interval: number;       // days until next review
  repetitions: number;    // times reviewed successfully
  easeFactor: number;     // default 2.5, adjusted per review
  nextReview: string;     // ISO date string (YYYY-MM-DD)
}

export interface FlashcardData {
  id: string;
  front: string;
  back: string;
  difficulty: 'easy' | 'medium' | 'hard';
  srs?: SrsData;
}

// A claim in the notes the verification pass considers likely wrong.
// `excerpt` is the model's verbatim quote from markdownNotes — used to
// locate and highlight the passage; if it no longer matches (e.g. after
// an edit), the flag degrades to list-only display.
export interface NoteFlag {
  excerpt: string;
  claim: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
}

export interface CardFlag {
  cardId: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
}

export interface VerificationResult {
  noteFlags: NoteFlag[];
  cardFlags: CardFlag[];
  verifiedAt: string; // ISO timestamp
  provider: string;
  model: string;
}

export interface GeneratedContent {
  markdownNotes: string;
  flashcards: FlashcardData[];
  verification?: VerificationResult;
}

export interface UploadedFile {
  id: string;
  data: string; // Base64
  mimeType: string;
}

export interface ProviderCapabilities {
  images: boolean;
  pdf: boolean;
  audio: boolean;
  youtube: boolean;
}

export interface ProviderInfo {
  name: string;
  model: string;
  baseUrl?: string;
  keySet: boolean;
  capabilities: ProviderCapabilities;
}

export interface AppSettings {
  activeProvider: string;
  // '' = verify with the active provider
  verificationProvider: string;
  providers: Record<string, ProviderInfo>;
}

// --- Tutor mode ---

// A pre-test question and the learner's cold answer (attempted before studying)
export interface TutorPreQuestion {
  question: string;
  answer: string;
}

export interface KnewCorrectlyItem { concept: string; note: string; }
export interface MisconceptionItem { concept: string; believed: string; actual: string; }
export interface DidntKnowItem { concept: string; summary: string; }

export interface TutorGradeResult {
  knewCorrectly: KnewCorrectlyItem[];
  misconceptions: MisconceptionItem[];
  didntKnow: DidntKnowItem[];
  // Gap-targeted cards, id assigned when merged into the deck
  gapFlashcards: Omit<FlashcardData, 'id' | 'srs'>[];
  warnings?: string[];
}

export enum ViewMode {
  INPUT = 'INPUT',
  NOTES = 'NOTES',
  FLASHCARDS = 'FLASHCARDS',
  REVIEW = 'REVIEW',
  TUTOR = 'TUTOR'
}
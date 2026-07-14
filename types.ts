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

export interface GeneratedContent {
  markdownNotes: string;
  flashcards: FlashcardData[];
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
  providers: Record<string, ProviderInfo>;
}

export enum ViewMode {
  INPUT = 'INPUT',
  NOTES = 'NOTES',
  FLASHCARDS = 'FLASHCARDS',
  REVIEW = 'REVIEW'
}
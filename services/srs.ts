import { FlashcardData, SrsData } from '../types';

// Dates are computed in local time: toISOString() is UTC, which would make
// cards flip due at UTC midnight instead of the user's midnight.
function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTodayString(): string {
  return formatLocalDate(new Date());
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return formatLocalDate(new Date(y, m - 1, d + days));
}

const DEFAULT_SRS: SrsData = {
  interval: 0,
  repetitions: 0,
  easeFactor: 2.5,
  nextReview: getTodayString(),
};

/**
 * SM-2 algorithm: update a card's SRS data after a review.
 * quality: 0 (complete blackout) to 5 (perfect recall)
 */
export function reviewCard(card: FlashcardData, quality: 0 | 1 | 2 | 3 | 4 | 5): FlashcardData {
  const srs = card.srs ?? { ...DEFAULT_SRS };
  const today = getTodayString();

  let { interval, repetitions, easeFactor } = srs;

  if (quality < 3) {
    // Failed — reset, and keep the card due today so it can be
    // relearned in the same session ("Again" semantics)
    interval = 0;
    repetitions = 0;
  } else {
    // Passed
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions++;
  }

  // Adjust ease factor
  easeFactor = easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  easeFactor = Math.max(1.3, easeFactor);

  return {
    ...card,
    srs: {
      interval,
      repetitions,
      easeFactor,
      nextReview: addDays(today, interval),
    },
  };
}

export function isDueToday(card: FlashcardData): boolean {
  if (!card.srs) return true; // New cards are always due
  const today = getTodayString();
  return card.srs.nextReview <= today;
}

export function getCardsForReview(cards: FlashcardData[]): FlashcardData[] {
  return cards.filter(isDueToday);
}

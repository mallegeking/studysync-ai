import React, { useState, useEffect } from 'react';
import { CardFlag, FlashcardData } from '../types';
import { ChevronLeft, ChevronRight, RefreshCw, Layers, Download, CheckCircle2, Pencil, Trash2, Plus, AlertTriangle, X, Check } from 'lucide-react';

interface FlashcardDeckProps {
  cards: FlashcardData[];
  mode?: 'browse' | 'review';
  onReviewCard?: (cardIndex: number, quality: 0 | 1 | 2 | 3 | 4 | 5) => void;
  cardFlags?: Record<string, CardFlag>;
  onUpdateCard?: (card: FlashcardData) => void;
  onDeleteCard?: (id: string) => void;
  onAddCard?: (card: Omit<FlashcardData, 'id'>) => void;
}

const difficultyConfig: Record<string, { label: string; classes: string }> = {
  easy:   { label: 'Easy',   classes: 'bg-green-100 text-green-700 border-green-200' },
  medium: { label: 'Medium', classes: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  hard:   { label: 'Hard',   classes: 'bg-red-100 text-red-700 border-red-200' },
};

type EditorMode = { kind: 'edit'; card: FlashcardData } | { kind: 'add' } | null;

const FlashcardDeck: React.FC<FlashcardDeckProps> = ({ cards, mode = 'browse', onReviewCard, cardFlags, onUpdateCard, onDeleteCard, onAddCard }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [formFront, setFormFront] = useState('');
  const [formBack, setFormBack] = useState('');
  const [formDifficulty, setFormDifficulty] = useState<FlashcardData['difficulty']>('medium');

  // Deleting a card can leave the index past the end of the deck
  useEffect(() => {
    if (currentIndex >= cards.length) {
      setCurrentIndex(Math.max(0, cards.length - 1));
    }
  }, [cards.length, currentIndex]);

  const openEditor = (target: EditorMode) => {
    if (target?.kind === 'edit') {
      setFormFront(target.card.front);
      setFormBack(target.card.back);
      setFormDifficulty(target.card.difficulty ?? 'medium');
    } else {
      setFormFront('');
      setFormBack('');
      setFormDifficulty('medium');
    }
    setEditorMode(target);
  };

  const saveEditor = () => {
    if (!editorMode || !formFront.trim() || !formBack.trim()) return;
    if (editorMode.kind === 'edit') {
      onUpdateCard?.({ ...editorMode.card, front: formFront.trim(), back: formBack.trim(), difficulty: formDifficulty });
    } else {
      onAddCard?.({ front: formFront.trim(), back: formBack.trim(), difficulty: formDifficulty });
    }
    setEditorMode(null);
  };

  if (editorMode && mode === 'browse') {
    return (
      <div className="flex flex-col w-full max-w-2xl mx-auto p-4">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">
          {editorMode.kind === 'edit' ? 'Edit card' : 'New card'}
        </h3>
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Question (front)</label>
            <textarea
              value={formFront}
              onChange={(e) => setFormFront(e.target.value)}
              className="w-full min-h-24 p-3 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Answer (back)</label>
            <textarea
              value={formBack}
              onChange={(e) => setFormBack(e.target.value)}
              className="w-full min-h-24 p-3 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Difficulty</label>
            <select
              value={formDifficulty}
              onChange={(e) => setFormDifficulty(e.target.value as FlashcardData['difficulty'])}
              className="p-2 border border-slate-200 rounded-lg text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={saveEditor}
              disabled={!formFront.trim() || !formBack.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              <Check size={16} /> Save
            </button>
            <button
              onClick={() => setEditorMode(null)}
              className="flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg font-medium hover:bg-slate-50 transition-colors"
            >
              <X size={16} /> Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!cards || cards.length === 0) {
    if (mode === 'review') {
      return (
        <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
          <CheckCircle2 className="w-12 h-12 text-green-400" />
          <p className="font-medium text-green-600">All caught up!</p>
          <p className="text-sm text-slate-400">No cards are due for review right now. Come back later.</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
        <Layers className="w-12 h-12 text-slate-300" />
        <p className="font-medium text-slate-500">No flashcards yet</p>
        <p className="text-sm text-slate-400">Generate study material to create your deck.</p>
        {onAddCard && (
          <button
            onClick={() => openEditor({ kind: 'add' })}
            className="mt-2 flex items-center gap-1.5 px-4 py-2 text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
          >
            <Plus size={16} /> Add a card manually
          </button>
        )}
      </div>
    );
  }

  if (isFinished && mode === 'review') {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <CheckCircle2 className="w-16 h-16 text-green-400" />
        <p className="text-xl font-bold text-slate-800">Review complete!</p>
        <p className="text-slate-500">You reviewed {reviewedCount} card{reviewedCount !== 1 ? 's' : ''} this session.</p>
        <button
          onClick={() => { setCurrentIndex(0); setIsFinished(false); setReviewedCount(0); setIsFlipped(false); }}
          className="mt-2 px-4 py-2 text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1 transition-colors"
        >
          <RefreshCw size={16} /> Review again
        </button>
      </div>
    );
  }

  const handleNext = () => {
    setIsFlipped(false);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % cards.length);
    }, 200);
  };

  const handlePrev = () => {
    setIsFlipped(false);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev - 1 + cards.length) % cards.length);
    }, 200);
  };

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
  };

  const handleRate = (quality: 0 | 1 | 2 | 3 | 4 | 5) => {
    if (onReviewCard) {
      onReviewCard(currentIndex, quality);
    }
    setReviewedCount(prev => prev + 1);
    setIsFlipped(false);

    setTimeout(() => {
      if (quality < 3) {
        // Failed cards stay due for same-session relearning, so the parent
        // keeps this card in the list — advance and cycle back to it later.
        setCurrentIndex((prev) => (prev + 1) % cards.length);
      } else if (cards.length <= 1) {
        setIsFinished(true);
      } else {
        // The card will be removed from the due list by the parent,
        // so currentIndex stays the same (next card slides in).
        // If we're at the end, wrap around.
        if (currentIndex >= cards.length - 1) {
          setCurrentIndex(0);
        }
      }
    }, 200);
  };

  const exportToAnki = () => {
    const csvContent = cards.map(card => {
        const front = `"${card.front.replace(/"/g, '""')}"`;
        const back = `"${card.back.replace(/"/g, '""')}"`;
        const diff = card.difficulty ?? 'medium';
        return `${front},${back},${diff}`;
    }).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'study_flashcards.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDelete = () => {
    if (!onDeleteCard) return;
    if (confirm('Delete this card? This cannot be undone.')) {
      setIsFlipped(false);
      onDeleteCard(currentCard.id);
    }
  };

  const currentCard = cards[Math.min(currentIndex, cards.length - 1)];
  const currentFlag = cardFlags?.[currentCard.id];

  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto p-4">
      <div className="w-full flex justify-between items-center mb-4">
        <span className="text-slate-600 font-medium">
          {mode === 'review'
            ? `${cards.length} card${cards.length !== 1 ? 's' : ''} remaining`
            : `Card ${currentIndex + 1} of ${cards.length}`
          }
        </span>

        <div className="flex gap-4">
            {mode === 'browse' && (
              <>
                {onAddCard && (
                  <button
                      onClick={() => openEditor({ kind: 'add' })}
                      className="text-slate-600 hover:text-indigo-600 text-sm flex items-center gap-1 transition-colors"
                      title="Add a card manually"
                  >
                      <Plus size={14} /> Add card
                  </button>
                )}
                <button
                    onClick={exportToAnki}
                    className="text-slate-600 hover:text-indigo-600 text-sm flex items-center gap-1 transition-colors"
                    title="Download CSV for Anki"
                >
                    <Download size={14} /> Export CSV
                </button>
                <button
                    onClick={() => { setIsFlipped(false); setCurrentIndex(0); }}
                    className="text-slate-600 hover:text-indigo-600 text-sm flex items-center gap-1 transition-colors"
                >
                    <RefreshCw size={14} /> Restart
                </button>
              </>
            )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-slate-100 rounded-full h-1.5 mb-6">
        <div
          className={`h-1.5 rounded-full transition-all duration-300 ${mode === 'review' ? 'bg-green-500' : 'bg-indigo-500'}`}
          style={{ width: mode === 'review'
            ? `${(reviewedCount / (reviewedCount + cards.length)) * 100}%`
            : `${((currentIndex + 1) / cards.length) * 100}%`
          }}
        />
      </div>

      <div
        className="relative w-full h-80 sm:h-96 perspective-1000 cursor-pointer group"
        onClick={handleFlip}
      >
        <div
          className={`absolute w-full h-full transition-all duration-500 transform-style-3d shadow-xl rounded-2xl ${isFlipped ? 'rotate-y-180' : ''}`}
        >
          {/* Front */}
          <div className="absolute w-full h-full bg-white border border-slate-200 rounded-2xl p-8 flex flex-col items-center justify-center text-center backface-hidden">
            {currentFlag && (
              <span className="absolute top-4 left-4 flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border bg-amber-100 text-amber-700 border-amber-200" title={currentFlag.reason}>
                <AlertTriangle size={12} /> Check accuracy
              </span>
            )}
            {currentCard.difficulty && difficultyConfig[currentCard.difficulty] && (
              <span className={`absolute top-4 right-4 text-xs font-semibold px-2 py-0.5 rounded-full border ${difficultyConfig[currentCard.difficulty].classes}`}>
                {difficultyConfig[currentCard.difficulty].label}
              </span>
            )}
            <h3 className="text-sm uppercase tracking-wider text-indigo-500 font-bold mb-4">Question</h3>
            <p className="text-xl sm:text-2xl font-medium text-slate-800 overflow-y-auto max-h-full">
              {currentCard.front}
            </p>
            <p className="absolute bottom-4 text-xs text-slate-400">Click to flip</p>
          </div>

          {/* Back */}
          <div className="absolute w-full h-full bg-indigo-50 border border-indigo-100 rounded-2xl p-8 flex flex-col items-center justify-center text-center backface-hidden rotate-y-180">
            <h3 className="text-sm uppercase tracking-wider text-indigo-500 font-bold mb-4">Answer</h3>
            <p className="text-lg sm:text-xl text-slate-700 overflow-y-auto max-h-full">
              {currentCard.back}
            </p>
            {currentFlag && (
              <div className="mt-4 max-w-full bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 flex items-start gap-1.5 text-left">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{currentFlag.reason}</span>
              </div>
            )}
            {mode === 'browse' && (
              <p className="absolute bottom-4 text-xs text-indigo-300">Click to flip back</p>
            )}
            {mode === 'review' && (
              <p className="absolute bottom-4 text-xs text-indigo-300">Rate your recall below</p>
            )}
          </div>
        </div>
      </div>

      {/* Controls */}
      {mode === 'browse' && (
        <div className="flex items-center gap-4 mt-8">
          <button
            onClick={handlePrev}
            className="p-3 rounded-full bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm disabled:opacity-50"
            disabled={cards.length <= 1}
          >
            <ChevronLeft size={24} />
          </button>
          <button
            onClick={handleFlip}
            className="px-6 py-2 bg-indigo-600 text-white rounded-full font-medium shadow-md hover:bg-indigo-700 transition-colors"
          >
              {isFlipped ? 'Show Question' : 'Show Answer'}
          </button>
          <button
            onClick={handleNext}
            className="p-3 rounded-full bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm disabled:opacity-50"
            disabled={cards.length <= 1}
          >
            <ChevronRight size={24} />
          </button>
          {(onUpdateCard || onDeleteCard) && (
            <div className="flex gap-2 ml-2 pl-4 border-l border-slate-200">
              {onUpdateCard && (
                <button
                  onClick={() => openEditor({ kind: 'edit', card: currentCard })}
                  className="p-2.5 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors shadow-sm"
                  title="Edit this card"
                >
                  <Pencil size={18} />
                </button>
              )}
              {onDeleteCard && (
                <button
                  onClick={handleDelete}
                  className="p-2.5 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-300 transition-colors shadow-sm"
                  title="Delete this card"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Review Rating Buttons */}
      {mode === 'review' && (
        <div className="mt-8 w-full">
          {!isFlipped ? (
            <div className="flex justify-center">
              <button
                onClick={handleFlip}
                className="px-8 py-3 bg-indigo-600 text-white rounded-full font-medium shadow-md hover:bg-indigo-700 transition-colors"
              >
                Show Answer
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-center text-sm text-slate-500 font-medium">How well did you recall this?</p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={() => handleRate(1)}
                  className="px-4 py-2.5 rounded-xl font-medium text-sm border-2 transition-all hover:scale-105 bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                >
                  Again
                </button>
                <button
                  onClick={() => handleRate(2)}
                  className="px-4 py-2.5 rounded-xl font-medium text-sm border-2 transition-all hover:scale-105 bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100"
                >
                  Hard
                </button>
                <button
                  onClick={() => handleRate(4)}
                  className="px-4 py-2.5 rounded-xl font-medium text-sm border-2 transition-all hover:scale-105 bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                >
                  Good
                </button>
                <button
                  onClick={() => handleRate(5)}
                  className="px-4 py-2.5 rounded-xl font-medium text-sm border-2 transition-all hover:scale-105 bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                >
                  Easy
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FlashcardDeck;

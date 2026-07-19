import React, { useState, useEffect, useMemo } from 'react';
import { Brain, FileText, Layers, AlertCircle, Sparkles, MonitorPlay, ArrowRight, Trash2, X, GraduationCap, Settings } from 'lucide-react';
import { AppSettings, CardFlag, FlashcardData, GeneratedContent, UploadedFile, ViewMode } from './types';
import { generateStudyMaterial, getSettings, verifyContent } from './services/api';
import { reviewCard, getCardsForReview } from './services/srs';
import InputSection from './components/InputSection';
import NotesView from './components/NotesView';
import FlashcardDeck from './components/FlashcardDeck';
import SettingsModal from './components/SettingsModal';

// Cards need stable ids so reviews can't credit a duplicate-text card;
// also migrates sessions persisted before ids existed.
const withIds = (cards: FlashcardData[]): FlashcardData[] =>
  cards.map(card => (card.id ? card : { ...card, id: crypto.randomUUID() }));

const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.INPUT);
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent | null>(() => {
    try {
      const saved = localStorage.getItem('studysync-ai-session');
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      // Anything that is valid JSON but not a GeneratedContent shape would
      // crash every render, and reloading can't clear it — drop it instead.
      if (!parsed || typeof parsed !== 'object'
          || typeof parsed.markdownNotes !== 'string'
          || !Array.isArray(parsed.flashcards)) {
        localStorage.removeItem('studysync-ai-session');
        return null;
      }
      return { ...parsed, flashcards: withIds(parsed.flashcards) };
    } catch {
      return null;
    }
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionRestored, setSessionRestored] = useState<boolean>(() => {
    try {
      return !!localStorage.getItem('studysync-ai-session');
    } catch {
      return false;
    }
  });

  // Load provider settings (for capability hints and the settings modal)
  useEffect(() => {
    getSettings().then(setSettings).catch((err) => {
      console.warn('Failed to load provider settings:', err);
    });
  }, []);

  // Persist generatedContent to localStorage
  useEffect(() => {
    try {
      if (generatedContent) {
        localStorage.setItem('studysync-ai-session', JSON.stringify(generatedContent));
      } else {
        localStorage.removeItem('studysync-ai-session');
      }
    } catch (err) {
      console.warn("Failed to persist session (storage quota exceeded or unavailable):", err);
    }
  }, [generatedContent]);

  const handleGenerate = async (text: string, files: UploadedFile[], customInstructions: string, opts?: { auto?: boolean; youtubeUrl?: string }) => {
    setIsGenerating(true);
    setError(null);
    // Show skeleton immediately for first-time generation, but never yank the
    // user off the input view for auto-generations — switching views unmounts
    // InputSection and ends an active screen-capture session.
    if (!generatedContent && !opts?.auto) {
      setViewMode(ViewMode.NOTES);
    }
    try {
      // Pass the existing content (if any) to the service to ensure consistency/deduplication
      const result = await generateStudyMaterial(text, files, customInstructions, generatedContent, opts?.youtubeUrl);
      const newCards = withIds(result.flashcards);
      setWarnings(result.warnings ?? []);

      // Functional update: state may have changed during the await (reviews
      // rated mid-flight, an earlier auto-generation), so never merge against
      // the closure snapshot. Existing verification is kept: prior markdown
      // survives verbatim above the separator, so its flags still apply, and
      // verifiedAt shows the new material hasn't been checked yet.
      setGeneratedContent(prev => prev
        ? {
            ...prev,
            markdownNotes: prev.markdownNotes + "\n\n---\n\n" + result.markdownNotes,
            flashcards: [...prev.flashcards, ...newCards]
          }
        : { markdownNotes: result.markdownNotes, flashcards: newCards });

      if (!opts?.auto) {
        setViewMode(ViewMode.NOTES);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate study materials. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleVerify = async () => {
    if (!generatedContent || isVerifying) return;
    setIsVerifying(true);
    setError(null);
    try {
      const result = await verifyContent(generatedContent);
      setGeneratedContent(prev => prev ? { ...prev, verification: result } : prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleUpdateNotes = (markdown: string) => {
    // Verification is kept: excerpts that no longer match degrade to
    // list-only display in the flags panel.
    setGeneratedContent(prev => prev ? { ...prev, markdownNotes: markdown } : prev);
  };

  const handleClearVerification = () => {
    setGeneratedContent(prev => prev ? { ...prev, verification: undefined } : prev);
  };

  const handleUpdateCard = (updated: FlashcardData) => {
    // The card's content changed, so any accuracy flag on it is void
    setGeneratedContent(prev => prev
      ? {
          ...prev,
          flashcards: prev.flashcards.map(card => card.id === updated.id ? updated : card),
          verification: prev.verification
            ? { ...prev.verification, cardFlags: prev.verification.cardFlags.filter(f => f.cardId !== updated.id) }
            : undefined,
        }
      : prev);
  };

  const handleDeleteCard = (id: string) => {
    setGeneratedContent(prev => prev
      ? {
          ...prev,
          flashcards: prev.flashcards.filter(card => card.id !== id),
          verification: prev.verification
            ? { ...prev.verification, cardFlags: prev.verification.cardFlags.filter(f => f.cardId !== id) }
            : undefined,
        }
      : prev);
  };

  const handleAddCard = (card: Omit<FlashcardData, 'id'>) => {
    // No srs data yet, so the card is due immediately — same as generated ones
    setGeneratedContent(prev => prev
      ? { ...prev, flashcards: [...prev.flashcards, { ...card, id: crypto.randomUUID() }] }
      : prev);
  };

  const cardFlagsById = useMemo(() => {
    const map: Record<string, CardFlag> = {};
    for (const flag of generatedContent?.verification?.cardFlags ?? []) {
      map[flag.cardId] = flag;
    }
    return map;
  }, [generatedContent]);

  const clearSession = () => {
      if(confirm("Are you sure you want to clear your current session? All notes and flashcards will be lost.")) {
          setGeneratedContent(null);
          setSessionRestored(false);
          setViewMode(ViewMode.INPUT);
      }
  };

  const cardsForReview = useMemo(() => {
    if (!generatedContent) return [];
    return getCardsForReview(generatedContent.flashcards);
  }, [generatedContent]);

  const handleReviewCard = (cardIndex: number, quality: 0 | 1 | 2 | 3 | 4 | 5) => {
    if (!generatedContent) return;
    const dueCards = getCardsForReview(generatedContent.flashcards);
    const reviewedCard = dueCards[cardIndex];
    if (!reviewedCard) return;

    // Find the card in the full flashcards array and update it
    const updatedFlashcards = generatedContent.flashcards.map(card => {
      if (card.id === reviewedCard.id) {
        return reviewCard(card, quality);
      }
      return card;
    });

    setGeneratedContent({
      ...generatedContent,
      flashcards: updatedFlashcards,
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div 
            className="flex items-center gap-2 cursor-pointer" 
            onClick={() => setViewMode(ViewMode.INPUT)}
          >
            <div className="bg-indigo-600 p-2 rounded-lg">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              StudySync
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
          {generatedContent && (
            <div className="flex items-center gap-4">
                <nav className="flex items-center gap-1 sm:gap-2 bg-slate-100 p-1 rounded-lg">
                <button
                    onClick={() => setViewMode(ViewMode.INPUT)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    viewMode === ViewMode.INPUT
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                    }`}
                >
                    Add More
                </button>
                <button
                    onClick={() => setViewMode(ViewMode.NOTES)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    viewMode === ViewMode.NOTES
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                    }`}
                >
                    <FileText size={14} />
                    <span className="hidden sm:inline">Notes</span>
                </button>
                <button
                    onClick={() => setViewMode(ViewMode.FLASHCARDS)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    viewMode === ViewMode.FLASHCARDS
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                    }`}
                >
                    <Layers size={14} />
                    <span className="hidden sm:inline">Flashcards</span>
                    <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full text-xs">
                    {generatedContent.flashcards.length}
                    </span>
                </button>
                <button
                    onClick={() => setViewMode(ViewMode.REVIEW)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    viewMode === ViewMode.REVIEW
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                    }`}
                >
                    <GraduationCap size={14} />
                    <span className="hidden sm:inline">Review</span>
                    {cardsForReview.length > 0 && (
                      <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full text-xs">
                        {cardsForReview.length}
                      </span>
                    )}
                </button>
                </nav>
                <button
                    onClick={clearSession}
                    className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                    title="Clear Session"
                >
                    <Trash2 size={18} />
                </button>
            </div>
          )}
          <button
              onClick={() => setShowSettings(true)}
              className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
              title={settings ? `AI provider: ${settings.providers[settings.activeProvider]?.name}` : 'AI provider settings'}
          >
              <Settings size={18} />
          </button>
          </div>
        </div>
      </header>

      {showSettings && settings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={setSettings}
        />
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">
        
        {sessionRestored && generatedContent && (
          <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 flex items-center justify-between text-indigo-700 text-sm animate-in fade-in slide-in-from-top-2">
            <span>Session restored from your last visit.</span>
            <button onClick={() => setSessionRestored(false)} className="text-indigo-400 hover:text-indigo-600 ml-4">
              <X size={16} />
            </button>
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 text-red-700 animate-in fade-in slide-in-from-top-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3 text-amber-700 animate-in fade-in slide-in-from-top-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              {warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
            <button onClick={() => setWarnings([])} className="text-amber-400 hover:text-amber-600">
              <X size={16} />
            </button>
          </div>
        )}

        {viewMode === ViewMode.INPUT && (
          <div className="space-y-8">
            <div className="text-center max-w-2xl mx-auto mb-10">
              <h2 className="text-3xl font-bold text-slate-900 mb-4">
                Watch, Read, Learn
              </h2>
              <p className="text-lg text-slate-600">
                Share your screen, upload a PDF, or paste your notes. We'll automatically generate your study set.
              </p>
              {generatedContent && (
                  <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-full text-sm font-medium">
                      <Layers size={14} />
                      Adding to existing session ({generatedContent.flashcards.length} cards)
                  </div>
              )}
            </div>
            <InputSection
              onGenerate={handleGenerate}
              isGenerating={isGenerating}
              providerName={settings ? settings.providers[settings.activeProvider]?.name : undefined}
              capabilities={settings ? settings.providers[settings.activeProvider]?.capabilities : undefined}
            />
            
            {!generatedContent && !isGenerating && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16 text-center opacity-70">
                    <div className="p-4">
                        <div className="bg-indigo-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 text-indigo-600">
                            <MonitorPlay />
                        </div>
                        <h3 className="font-semibold text-slate-900 mb-1">Live Capture</h3>
                        <p className="text-sm text-slate-600">Automatically detects page turns and new content on your screen.</p>
                    </div>
                     <div className="p-4">
                        <div className="bg-indigo-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 text-indigo-600">
                            <Layers />
                        </div>
                        <h3 className="font-semibold text-slate-900 mb-1">Active Recall</h3>
                        <p className="text-sm text-slate-600">Test yourself with automatically generated flashcards.</p>
                    </div>
                     <div className="p-4">
                        <div className="bg-indigo-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 text-indigo-600">
                            <Sparkles />
                        </div>
                        <h3 className="font-semibold text-slate-900 mb-1">Smart Synthesis</h3>
                        <p className="text-sm text-slate-600">Combines information across multiple slides or docs into cohesive notes.</p>
                    </div>
                </div>
            )}
          </div>
        )}

        {/* Loading skeleton during first-time generation */}
        {viewMode === ViewMode.NOTES && isGenerating && !generatedContent && (
          <div className="animate-in fade-in zoom-in-95 duration-300">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-800">Study Notes</h2>
            </div>
            <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-100 min-h-[50vh] space-y-4 animate-pulse">
              <div className="h-6 bg-slate-200 rounded w-2/5" />
              <div className="h-4 bg-slate-100 rounded w-full" />
              <div className="h-4 bg-slate-100 rounded w-5/6" />
              <div className="h-4 bg-slate-100 rounded w-4/6" />
              <div className="mt-8 h-5 bg-slate-200 rounded w-1/3" />
              <div className="h-4 bg-slate-100 rounded w-full" />
              <div className="h-4 bg-slate-100 rounded w-3/4" />
              <div className="mt-8 h-5 bg-slate-200 rounded w-2/5" />
              <div className="h-4 bg-slate-100 rounded w-full" />
              <div className="h-4 bg-slate-100 rounded w-4/5" />
            </div>
          </div>
        )}

        {viewMode === ViewMode.NOTES && generatedContent && (
          <div className="animate-in fade-in zoom-in-95 duration-300">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-800">Study Notes</h2>
              <button 
                onClick={() => setViewMode(ViewMode.FLASHCARDS)}
                className="text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1 transition-colors"
              >
                Practice Flashcards <ArrowRight size={18} />
              </button>
            </div>
            <NotesView
              markdown={generatedContent.markdownNotes}
              verification={generatedContent.verification}
              isVerifying={isVerifying}
              onVerify={handleVerify}
              onSave={handleUpdateNotes}
              onClearVerification={handleClearVerification}
            />
          </div>
        )}

        {viewMode === ViewMode.FLASHCARDS && generatedContent && (
          <div className="animate-in fade-in zoom-in-95 duration-300">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-800">Flashcards</h2>
              <button
                onClick={() => setViewMode(ViewMode.NOTES)}
                className="text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1 transition-colors"
              >
                Review Notes <ArrowRight size={18} />
              </button>
            </div>
            <FlashcardDeck
              cards={generatedContent.flashcards}
              mode="browse"
              cardFlags={cardFlagsById}
              onUpdateCard={handleUpdateCard}
              onDeleteCard={handleDeleteCard}
              onAddCard={handleAddCard}
            />
          </div>
        )}

        {viewMode === ViewMode.REVIEW && generatedContent && (
          <div className="animate-in fade-in zoom-in-95 duration-300">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-800">Spaced Review</h2>
              <button
                onClick={() => setViewMode(ViewMode.FLASHCARDS)}
                className="text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1 transition-colors"
              >
                Browse All Cards <ArrowRight size={18} />
              </button>
            </div>
            <FlashcardDeck
              cards={cardsForReview}
              mode="review"
              onReviewCard={handleReviewCard}
            />
          </div>
        )}

      </main>
    </div>
  );
};

export default App;
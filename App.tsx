import React, { useState, useEffect, useMemo } from 'react';
import { Brain, FileText, Layers, AlertCircle, Sparkles, MonitorPlay, ArrowRight, Trash2, X, GraduationCap, Settings, Lightbulb, ChevronRight, Pencil } from 'lucide-react';
import { AppSettings, CardFlag, FlashcardData, GeneratedContent, StudyStore, Subject, UploadedFile, ViewMode } from './types';
import { generateStudyMaterial, getSettings, verifyContent } from './services/api';
import { reviewCard, getCardsForReview } from './services/srs';
import {
  emptyStore, findActive, updateSessionContent,
  createSubject, renameSubject, deleteSubject,
  createSession, renameSession, deleteSession,
} from './services/library';
import InputSection from './components/InputSection';
import NotesView from './components/NotesView';
import FlashcardDeck from './components/FlashcardDeck';
import SettingsModal from './components/SettingsModal';
import TutorView from './components/TutorView';
import Library from './components/Library';
import NameDialog from './components/NameDialog';

// Cards need stable ids so reviews can't credit a duplicate-text card;
// also migrates cards persisted before ids existed.
const withIds = (cards: FlashcardData[]): FlashcardData[] =>
  cards.map(card => (card.id ? card : { ...card, id: crypto.randomUUID() }));

const isValidContent = (c: unknown): c is GeneratedContent =>
  !!c && typeof c === 'object'
  && typeof (c as GeneratedContent).markdownNotes === 'string'
  && Array.isArray((c as GeneratedContent).flashcards);

// Backfill card ids across a persisted subject's sessions.
const sanitizeSubject = (subj: Subject): Subject => ({
  ...subj,
  sessions: (subj.sessions ?? []).map(sess => ({
    ...sess,
    content: { ...sess.content, flashcards: withIds(sess.content?.flashcards ?? []) },
  })),
});

// Load the library, migrating the old single-session key on first run.
const loadStore = (): StudyStore => {
  try {
    const savedStore = localStorage.getItem('studysync-ai-store');
    if (savedStore) {
      const parsed = JSON.parse(savedStore);
      if (parsed && Array.isArray(parsed.subjects)) {
        return {
          subjects: parsed.subjects.map(sanitizeSubject),
          activeSubjectId: parsed.activeSubjectId ?? null,
          activeSessionId: parsed.activeSessionId ?? null,
        };
      }
      localStorage.removeItem('studysync-ai-store');
    }

    // Migration: wrap a pre-existing single session into a subject
    const old = localStorage.getItem('studysync-ai-session');
    if (old) {
      const parsed = JSON.parse(old);
      if (isValidContent(parsed)) {
        const iso = new Date().toISOString();
        const session = {
          id: crypto.randomUUID(), name: 'Imported notes', createdAt: iso, updatedAt: iso,
          content: { ...parsed, flashcards: withIds(parsed.flashcards) },
        };
        const subject: Subject = { id: crypto.randomUUID(), name: 'Imported', createdAt: iso, sessions: [session] };
        localStorage.removeItem('studysync-ai-session');
        return { subjects: [subject], activeSubjectId: subject.id, activeSessionId: session.id };
      }
      localStorage.removeItem('studysync-ai-session');
    }
  } catch {
    // Corrupt storage — start fresh rather than crash every render
  }
  return emptyStore();
};

type NameDialogState =
  | { kind: 'new-subject' }
  | { kind: 'new-session' }
  | { kind: 'rename-subject'; id: string; current: string }
  | { kind: 'rename-session'; id: string; current: string };

const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.INPUT);
  const [store, setStore] = useState<StudyStore>(loadStore);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);

  const { subject: activeSubject, session: activeSession } = findActive(store);
  const generatedContent = activeSession?.content ?? null;

  // Load provider settings (for capability hints and the settings modal)
  useEffect(() => {
    getSettings().then(setSettings).catch((err) => {
      console.warn('Failed to load provider settings:', err);
    });
  }, []);

  // Persist the whole library to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('studysync-ai-store', JSON.stringify(store));
    } catch (err) {
      console.warn("Failed to persist library (storage quota exceeded or unavailable):", err);
    }
  }, [store]);

  // Apply a content change to the active session (bumps its updatedAt).
  const mutateActive = (updater: (content: GeneratedContent) => GeneratedContent) =>
    setStore(prev => prev.activeSubjectId && prev.activeSessionId
      ? updateSessionContent(prev, prev.activeSubjectId, prev.activeSessionId, updater)
      : prev);

  // --- Navigation ---
  const goToSubjects = () => setStore(prev => ({ ...prev, activeSubjectId: null, activeSessionId: null }));
  const goToSessions = () => setStore(prev => ({ ...prev, activeSessionId: null }));
  const openSubject = (id: string) => setStore(prev => ({ ...prev, activeSubjectId: id, activeSessionId: null }));
  const openSession = (id: string) => {
    setStore(prev => ({ ...prev, activeSessionId: id }));
    const sess = activeSubject?.sessions.find(s => s.id === id);
    setViewMode(sess?.content.markdownNotes ? ViewMode.NOTES : ViewMode.INPUT);
  };

  // --- Subject / session management ---
  const handleCreateSubject = (name: string) => setStore(prev => {
    const { store: next, id } = createSubject(prev, name);
    return { ...next, activeSubjectId: id, activeSessionId: null };
  });
  const handleRenameSubject = (id: string, name: string) => setStore(prev => renameSubject(prev, id, name));
  const handleDeleteSubject = (id: string) => {
    if (confirm('Delete this subject and all its sessions? This cannot be undone.')) {
      setStore(prev => deleteSubject(prev, id));
    }
  };
  const handleCreateSession = (name: string) => {
    setStore(prev => {
      if (!prev.activeSubjectId) return prev;
      const { store: next, id } = createSession(prev, prev.activeSubjectId, name);
      return { ...next, activeSessionId: id };
    });
    setViewMode(ViewMode.INPUT);
  };
  const handleRenameSession = (id: string, name: string) =>
    setStore(prev => prev.activeSubjectId ? renameSession(prev, prev.activeSubjectId, id, name) : prev);
  const handleDeleteSession = (id: string) => {
    if (confirm('Delete this session? Its notes and flashcards will be lost.')) {
      setStore(prev => prev.activeSubjectId ? deleteSession(prev, prev.activeSubjectId, id) : prev);
    }
  };

  const submitNameDialog = (name: string) => {
    if (!nameDialog) return;
    switch (nameDialog.kind) {
      case 'new-subject': handleCreateSubject(name); break;
      case 'new-session': handleCreateSession(name); break;
      case 'rename-subject': handleRenameSubject(nameDialog.id, name); break;
      case 'rename-session': handleRenameSession(nameDialog.id, name); break;
    }
    setNameDialog(null);
  };

  const handleGenerate = async (text: string, files: UploadedFile[], customInstructions: string, opts?: { auto?: boolean; youtubeUrl?: string }) => {
    setIsGenerating(true);
    setError(null);
    const hadNotes = !!generatedContent?.markdownNotes;
    // Show skeleton immediately for first generation in this session, but never
    // yank the user off the input view for auto-generations — switching views
    // unmounts InputSection and ends an active screen-capture session.
    if (!hadNotes && !opts?.auto) {
      setViewMode(ViewMode.NOTES);
    }
    try {
      // Pass the existing content (if any) to the service for dedup/consistency
      const result = await generateStudyMaterial(text, files, customInstructions, generatedContent, opts?.youtubeUrl);
      const newCards = withIds(result.flashcards);
      setWarnings(result.warnings ?? []);

      // Functional update through mutateActive: state may have changed during
      // the await. Existing verification is kept — prior markdown survives above
      // the separator, so its flags still apply; verifiedAt shows staleness.
      mutateActive(c => ({
        ...c,
        markdownNotes: c.markdownNotes ? c.markdownNotes + "\n\n---\n\n" + result.markdownNotes : result.markdownNotes,
        flashcards: [...c.flashcards, ...newCards],
      }));

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
      mutateActive(c => ({ ...c, verification: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleUpdateNotes = (markdown: string) => {
    // Verification is kept: excerpts that no longer match degrade to
    // list-only display in the flags panel.
    mutateActive(c => ({ ...c, markdownNotes: markdown }));
  };

  const handleClearVerification = () => {
    mutateActive(c => ({ ...c, verification: undefined }));
  };

  const handleUpdateCard = (updated: FlashcardData) => {
    // The card's content changed, so any accuracy flag on it is void
    mutateActive(c => ({
      ...c,
      flashcards: c.flashcards.map(card => card.id === updated.id ? updated : card),
      verification: c.verification
        ? { ...c.verification, cardFlags: c.verification.cardFlags.filter(f => f.cardId !== updated.id) }
        : undefined,
    }));
  };

  const handleDeleteCard = (id: string) => {
    mutateActive(c => ({
      ...c,
      flashcards: c.flashcards.filter(card => card.id !== id),
      verification: c.verification
        ? { ...c.verification, cardFlags: c.verification.cardFlags.filter(f => f.cardId !== id) }
        : undefined,
    }));
  };

  const handleAddCard = (card: Omit<FlashcardData, 'id'>) => {
    // No srs data yet, so the card is due immediately — same as generated ones
    mutateActive(c => ({ ...c, flashcards: [...c.flashcards, { ...card, id: crypto.randomUUID() }] }));
  };

  const cardFlagsById = useMemo(() => {
    const map: Record<string, CardFlag> = {};
    for (const flag of generatedContent?.verification?.cardFlags ?? []) {
      map[flag.cardId] = flag;
    }
    return map;
  }, [generatedContent]);

  // Merge tutor-generated study material into the active session
  const mergeStudyMaterial = (markdownNotes: string, flashcards: FlashcardData[]) => {
    const newCards = withIds(flashcards);
    mutateActive(c => ({
      ...c,
      markdownNotes: c.markdownNotes ? c.markdownNotes + "\n\n---\n\n" + markdownNotes : markdownNotes,
      flashcards: [...c.flashcards, ...newCards],
    }));
  };

  const addGapCards = (cards: Omit<FlashcardData, 'id'>[]) => {
    const newCards = cards.map(c => ({ ...c, id: crypto.randomUUID() }));
    mutateActive(c => ({ ...c, flashcards: [...c.flashcards, ...newCards] }));
  };

  const cardsForReview = useMemo(() => {
    if (!generatedContent) return [];
    return getCardsForReview(generatedContent.flashcards);
  }, [generatedContent]);

  const handleReviewCard = (cardIndex: number, quality: 0 | 1 | 2 | 3 | 4 | 5) => {
    const dueCards = generatedContent ? getCardsForReview(generatedContent.flashcards) : [];
    const reviewedCard = dueCards[cardIndex];
    if (!reviewedCard) return;
    mutateActive(c => ({
      ...c,
      flashcards: c.flashcards.map(card => card.id === reviewedCard.id ? reviewCard(card, quality) : card),
    }));
  };

  const inWorkspace = !!(activeSubject && activeSession);
  const sessionEmpty = !generatedContent?.markdownNotes && !generatedContent?.flashcards.length;

  const navButton = (mode: ViewMode, label: string, icon: React.ReactNode, badge?: React.ReactNode) => (
    <button
      onClick={() => setViewMode(mode)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
        viewMode === mode ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      {badge}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="flex items-center gap-2 cursor-pointer flex-shrink-0" onClick={goToSubjects}>
              <div className="bg-indigo-600 p-2 rounded-lg">
                <Brain className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent hidden sm:block">
                StudySync
              </h1>
            </div>
            {activeSubject && (
              <>
                <ChevronRight size={16} className="text-slate-300 flex-shrink-0" />
                <button onClick={goToSessions} className="text-sm font-medium text-slate-600 hover:text-indigo-600 truncate max-w-[8rem]">
                  {activeSubject.name}
                </button>
              </>
            )}
            {activeSession && (
              <>
                <ChevronRight size={16} className="text-slate-300 flex-shrink-0" />
                <span className="text-sm font-semibold text-slate-800 truncate max-w-[8rem]">{activeSession.name}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            {inWorkspace && (
              <>
                <nav className="flex items-center gap-1 sm:gap-2 bg-slate-100 p-1 rounded-lg">
                  {navButton(ViewMode.INPUT, 'Add More', <></>)}
                  {navButton(ViewMode.NOTES, 'Notes', <FileText size={14} />)}
                  {navButton(ViewMode.FLASHCARDS, 'Flashcards', <Layers size={14} />, (
                    <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full text-xs">{generatedContent?.flashcards.length ?? 0}</span>
                  ))}
                  {navButton(ViewMode.REVIEW, 'Review', <GraduationCap size={14} />, cardsForReview.length > 0 ? (
                    <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full text-xs">{cardsForReview.length}</span>
                  ) : undefined)}
                  {navButton(ViewMode.TUTOR, 'Tutor', <Lightbulb size={14} />)}
                </nav>
                <button
                  onClick={() => setNameDialog({ kind: 'rename-session', id: activeSession.id, current: activeSession.name })}
                  className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
                  title="Rename session"
                >
                  <Pencil size={17} />
                </button>
                <button
                  onClick={() => handleDeleteSession(activeSession.id)}
                  className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                  title="Delete session"
                >
                  <Trash2 size={18} />
                </button>
              </>
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

      {nameDialog && (
        <NameDialog
          title={nameDialog.kind.startsWith('new') ? (nameDialog.kind === 'new-subject' ? 'New subject' : 'New session') : 'Rename'}
          label={nameDialog.kind.includes('subject') ? 'Subject name' : 'Session name'}
          initial={'current' in nameDialog ? nameDialog.current : ''}
          confirmLabel={nameDialog.kind.startsWith('new') ? 'Create' : 'Rename'}
          onSubmit={submitNameDialog}
          onClose={() => setNameDialog(null)}
        />
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">

        {/* Level 1: subjects home */}
        {!activeSubject && (
          <Library
            level="subjects"
            subjects={store.subjects}
            subject={null}
            onOpen={openSubject}
            onNew={() => setNameDialog({ kind: 'new-subject' })}
            onRename={(id, current) => setNameDialog({ kind: 'rename-subject', id, current })}
            onDelete={handleDeleteSubject}
          />
        )}

        {/* Level 2: sessions within a subject */}
        {activeSubject && !activeSession && (
          <Library
            level="sessions"
            subjects={store.subjects}
            subject={activeSubject}
            onOpen={openSession}
            onNew={() => setNameDialog({ kind: 'new-session' })}
            onRename={(id, current) => setNameDialog({ kind: 'rename-session', id, current })}
            onDelete={handleDeleteSession}
          />
        )}

        {/* Level 3: the session workspace */}
        {inWorkspace && (
          <>
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
                  <h2 className="text-3xl font-bold text-slate-900 mb-4">Watch, Read, Learn</h2>
                  <p className="text-lg text-slate-600">
                    Share your screen, upload a PDF, or paste your notes. We'll generate study material for <span className="font-semibold text-indigo-600">{activeSession.name}</span>.
                  </p>
                  {generatedContent && generatedContent.flashcards.length > 0 && (
                    <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-full text-sm font-medium">
                      <Layers size={14} />
                      Adding to this session ({generatedContent.flashcards.length} cards)
                    </div>
                  )}
                </div>
                <InputSection
                  onGenerate={handleGenerate}
                  isGenerating={isGenerating}
                  providerName={settings ? settings.providers[settings.activeProvider]?.name : undefined}
                  capabilities={settings ? settings.providers[settings.activeProvider]?.capabilities : undefined}
                />

                {sessionEmpty && !isGenerating && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16 text-center opacity-70">
                    <div className="p-4">
                      <div className="bg-indigo-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 text-indigo-600"><MonitorPlay /></div>
                      <h3 className="font-semibold text-slate-900 mb-1">Live Capture</h3>
                      <p className="text-sm text-slate-600">Automatically detects page turns and new content on your screen.</p>
                    </div>
                    <div className="p-4">
                      <div className="bg-indigo-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 text-indigo-600"><Layers /></div>
                      <h3 className="font-semibold text-slate-900 mb-1">Active Recall</h3>
                      <p className="text-sm text-slate-600">Test yourself with automatically generated flashcards.</p>
                    </div>
                    <div className="p-4">
                      <div className="bg-indigo-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 text-indigo-600"><Sparkles /></div>
                      <h3 className="font-semibold text-slate-900 mb-1">Smart Synthesis</h3>
                      <p className="text-sm text-slate-600">Combines information across multiple slides or docs into cohesive notes.</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Loading skeleton during first-time generation in this session */}
            {viewMode === ViewMode.NOTES && isGenerating && !generatedContent?.markdownNotes && (
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

            {viewMode === ViewMode.NOTES && generatedContent && !(isGenerating && !generatedContent.markdownNotes) && (
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

            {viewMode === ViewMode.TUTOR && (
              <TutorView
                existingFronts={generatedContent?.flashcards.map(f => f.front) ?? []}
                onStudyMaterial={mergeStudyMaterial}
                onAddGapCards={addGapCards}
                onExit={() => setViewMode(generatedContent?.markdownNotes ? ViewMode.NOTES : ViewMode.INPUT)}
              />
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
          </>
        )}
      </main>
    </div>
  );
};

export default App;

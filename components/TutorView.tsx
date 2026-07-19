import React, { useState } from 'react';
import { FlashcardData, TutorGradeResult, TutorPreQuestion, UploadedFile } from '../types';
import { startTutor, gradeTutor, generateStudyMaterial, TutorSource } from '../services/api';
import NotesView from './NotesView';
import {
  GraduationCap, Youtube, Upload, X, AlertCircle, Loader2, ArrowRight, ArrowLeft,
  Brain, CheckCircle2, XCircle, HelpCircle, Sparkles, Plus, Minus, SkipForward,
} from 'lucide-react';

interface TutorViewProps {
  existingFronts: string[];
  onStudyMaterial: (markdownNotes: string, flashcards: FlashcardData[]) => void;
  onAddGapCards: (cards: Omit<FlashcardData, 'id'>[]) => void;
  onExit: () => void;
}

type Stage = 'source' | 'pretest' | 'study' | 'confrontation';

const TutorView: React.FC<TutorViewProps> = ({ existingFronts, onStudyMaterial, onAddGapCards, onExit }) => {
  const [stage, setStage] = useState<Stage>('source');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Source material — kept in memory for the whole session so both the
  // pre-question and grading calls can see the ground truth.
  const [text, setText] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [youtubeUrl, setYoutubeUrl] = useState('');

  const [dump, setDump] = useState('');
  const [prequestions, setPrequestions] = useState<TutorPreQuestion[]>([]);
  const [studyMarkdown, setStudyMarkdown] = useState('');
  const [grade, setGrade] = useState<TutorGradeResult | null>(null);
  const [gapCardsAdded, setGapCardsAdded] = useState(false);
  const [recallSkipped, setRecallSkipped] = useState(false);

  const source = (): TutorSource => ({ text, files, youtubeUrl: youtubeUrl.trim() || undefined });
  const sourceEmpty = !text.trim() && files.length === 0 && !youtubeUrl.trim();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    Array.from(e.target.files).forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFiles(prev => [...prev, { id: Date.now().toString() + Math.random(), data: reader.result as string, mimeType: file.type }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));

  const begin = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await startTutor(source());
      setPrequestions(result.prequestions.map(q => ({ question: q, answer: '' })));
      setWarnings(result.warnings ?? []);
      setStage('pretest');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start the session.');
    } finally {
      setBusy(false);
    }
  };

  const startStudying = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await generateStudyMaterial(text, files, '', null, youtubeUrl.trim() || undefined);
      setStudyMarkdown(result.markdownNotes);
      setWarnings(result.warnings ?? []);
      onStudyMaterial(result.markdownNotes, result.flashcards);
      setStage('study');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate study material.');
    } finally {
      setBusy(false);
    }
  };

  const gradeRecall = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await gradeTutor(source(), dump, prequestions, existingFronts);
      setGrade(result);
      setWarnings(result.warnings ?? []);
      setStage('confrontation');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to grade your recall.');
    } finally {
      setBusy(false);
    }
  };

  const addGapCards = () => {
    if (!grade) return;
    onAddGapCards(grade.gapFlashcards);
    setGapCardsAdded(true);
  };

  // Bypass the recall step and go straight to studying (from source or pretest).
  // Skipping from source also avoids the pre-question generation call.
  const skipRecall = () => {
    setRecallSkipped(true);
    startStudying();
  };

  const setAnswer = (i: number, answer: string) =>
    setPrequestions(prev => prev.map((q, idx) => idx === i ? { ...q, answer } : q));

  const stageMeta: Record<Stage, { n: number; label: string }> = {
    source: { n: 1, label: 'Material' },
    pretest: { n: 2, label: 'Recall' },
    study: { n: 3, label: 'Study' },
    confrontation: { n: 4, label: 'Confront' },
  };

  return (
    <div className="max-w-3xl mx-auto animate-in fade-in zoom-in-95 duration-300">
      {/* Stepper */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {(['source', 'pretest', 'study', 'confrontation'] as Stage[]).map((s, i) => {
          const active = stage === s;
          // When recall is skipped, the pretest and confrontation steps are bypassed
          const skipped = recallSkipped && (s === 'pretest' || s === 'confrontation');
          const done = !skipped && stageMeta[s].n < stageMeta[stage].n;
          return (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                active ? 'bg-indigo-600 text-white' : done ? 'bg-indigo-100 text-indigo-600' : skipped ? 'bg-slate-50 text-slate-300' : 'bg-slate-100 text-slate-400'
              }`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${active ? 'bg-white/20' : done ? 'bg-indigo-200' : skipped ? 'bg-slate-100' : 'bg-slate-200'}`}>
                  {done ? <CheckCircle2 size={13} /> : skipped ? <Minus size={13} /> : stageMeta[s].n}
                </span>
                <span className={`hidden sm:inline ${skipped ? 'line-through' : ''}`}>{stageMeta[s].label}</span>
              </div>
              {i < 3 && <div className="w-4 h-px bg-slate-200" />}
            </React.Fragment>
          );
        })}
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 text-red-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3 text-amber-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">{warnings.map((w, i) => <p key={i}>{w}</p>)}</div>
          <button onClick={() => setWarnings([])} className="text-amber-400 hover:text-amber-600"><X size={16} /></button>
        </div>
      )}

      {/* STAGE 1: SOURCE */}
      {stage === 'source' && (
        <div className="space-y-6">
          <div className="text-center max-w-xl mx-auto">
            <div className="inline-flex bg-indigo-100 text-indigo-600 p-3 rounded-2xl mb-3"><GraduationCap size={28} /></div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Tutor session</h2>
            <p className="text-slate-600">Add the material you're about to study. You'll try to recall what you already know <em>before</em> studying it — testing yourself cold makes the material stick better.</p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">Paste text</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste the lecture notes, article, or chapter you want to study…"
                className="w-full min-h-32 p-3 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5 flex items-center gap-1.5"><Youtube size={14} /> YouTube link <span className="text-slate-400 font-normal">(optional)</span></label>
              <input
                type="url"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                className="w-full p-3 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5 flex items-center gap-1.5"><Upload size={14} /> Upload PDFs or images <span className="text-slate-400 font-normal">(optional)</span></label>
              <input type="file" multiple accept="application/pdf,image/*" onChange={handleFileUpload} className="block w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" />
              {files.length > 0 && (
                <div className="mt-2 space-y-1">
                  {files.map(f => (
                    <div key={f.id} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-1.5">
                      <span className="text-slate-600 truncate">{f.mimeType}</span>
                      <button onClick={() => removeFile(f.id)} className="text-slate-400 hover:text-red-500"><X size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button onClick={onExit} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancel</button>
            <div className="flex items-center gap-2">
              <button onClick={skipRecall} disabled={sourceEmpty || busy} className="flex items-center gap-1.5 px-4 py-2.5 text-slate-500 hover:text-indigo-600 font-medium disabled:opacity-40 disabled:pointer-events-none transition-colors" title="Go straight to studying without the recall step">
                <SkipForward size={16} /> Skip recall
              </button>
              <button onClick={begin} disabled={sourceEmpty || busy} className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:bg-slate-300 transition-colors">
                {busy ? <><Loader2 size={18} className="animate-spin" /> Preparing…</> : <>Begin <ArrowRight size={18} /></>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STAGE 2: PRETEST */}
      {stage === 'pretest' && (
        <div className="space-y-6">
          <div className="text-center max-w-xl mx-auto">
            <div className="inline-flex bg-indigo-100 text-indigo-600 p-3 rounded-2xl mb-3"><Brain size={28} /></div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Before you study</h2>
            <p className="text-slate-600">Answer from memory — guessing is fine, and blanks are fine too. The point is to prime your brain, not to score well.</p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Brain dump</label>
            <p className="text-xs text-slate-400 mb-2">Everything you already think you know about this topic.</p>
            <textarea
              value={dump}
              onChange={(e) => setDump(e.target.value)}
              placeholder="Write whatever comes to mind…"
              className="w-full min-h-28 p-3 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
            />
          </div>

          {prequestions.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
              <p className="text-sm font-medium text-slate-700">Pre-test questions</p>
              {prequestions.map((q, i) => (
                <div key={i}>
                  <p className="text-slate-800 mb-1.5"><span className="text-indigo-500 font-semibold mr-1">{i + 1}.</span>{q.question}</p>
                  <textarea
                    value={q.answer}
                    onChange={(e) => setAnswer(i, e.target.value)}
                    placeholder="Your best guess…"
                    className="w-full min-h-16 p-2.5 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <button onClick={() => setStage('source')} className="flex items-center gap-1.5 px-4 py-2 text-slate-500 hover:text-slate-700 font-medium"><ArrowLeft size={16} /> Back</button>
            <div className="flex items-center gap-2">
              <button onClick={skipRecall} disabled={busy} className="flex items-center gap-1.5 px-4 py-2.5 text-slate-500 hover:text-indigo-600 font-medium disabled:opacity-40 disabled:pointer-events-none transition-colors" title="Skip grading and go straight to studying">
                <SkipForward size={16} /> Skip
              </button>
              <button onClick={startStudying} disabled={busy} className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:bg-slate-300 transition-colors">
                {busy ? <><Loader2 size={18} className="animate-spin" /> Building notes…</> : <>Start studying <ArrowRight size={18} /></>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STAGE 3: STUDY */}
      {stage === 'study' && (
        <div className="space-y-6">
          <div className="text-center max-w-xl mx-auto">
            <div className="inline-flex bg-indigo-100 text-indigo-600 p-3 rounded-2xl mb-3"><Sparkles size={28} /></div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Study the material</h2>
            <p className="text-slate-600">
              {recallSkipped
                ? 'Here are your generated notes, saved to your session. You skipped the recall step, so there’s nothing to grade.'
                : 'Here are your generated notes (also saved to your session). Read through them, then grade your earlier recall against what you just learned.'}
            </p>
          </div>

          <NotesView markdown={studyMarkdown} />

          <div className="flex justify-end">
            {recallSkipped ? (
              <button onClick={onExit} className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors">
                Done <ArrowRight size={18} />
              </button>
            ) : (
              <button onClick={gradeRecall} disabled={busy} className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:bg-slate-300 transition-colors">
                {busy ? <><Loader2 size={18} className="animate-spin" /> Grading…</> : <>I've studied — grade my recall <ArrowRight size={18} /></>}
              </button>
            )}
          </div>
        </div>
      )}

      {/* STAGE 4: CONFRONTATION */}
      {stage === 'confrontation' && grade && (
        <div className="space-y-6">
          <div className="text-center max-w-xl mx-auto">
            <div className="inline-flex bg-indigo-100 text-indigo-600 p-3 rounded-2xl mb-3"><GraduationCap size={28} /></div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">How you did</h2>
            <p className="text-slate-600">Your recall before studying, checked against the source.</p>
          </div>

          {/* Knew correctly */}
          <div className="bg-white rounded-2xl shadow-sm border border-green-100 p-6">
            <div className="flex items-center gap-2 mb-3 text-green-700"><CheckCircle2 size={18} /><h3 className="font-semibold">Knew correctly ({grade.knewCorrectly.length})</h3></div>
            {grade.knewCorrectly.length === 0 ? <p className="text-sm text-slate-400">Nothing flagged as already known.</p> : (
              <ul className="space-y-2">
                {grade.knewCorrectly.map((it, i) => (
                  <li key={i} className="text-sm"><span className="font-medium text-slate-800">{it.concept}</span> — <span className="text-slate-600">{it.note}</span></li>
                ))}
              </ul>
            )}
          </div>

          {/* Misconceptions */}
          <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-6">
            <div className="flex items-center gap-2 mb-3 text-red-700"><XCircle size={18} /><h3 className="font-semibold">Believed wrongly ({grade.misconceptions.length})</h3></div>
            {grade.misconceptions.length === 0 ? <p className="text-sm text-slate-400">No misconceptions found — nice.</p> : (
              <ul className="space-y-3">
                {grade.misconceptions.map((it, i) => (
                  <li key={i} className="text-sm">
                    <p className="font-medium text-slate-800">{it.concept}</p>
                    <p className="text-red-600 line-through decoration-red-300">{it.believed}</p>
                    <p className="text-green-700">{it.actual}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Didn't know */}
          <div className="bg-white rounded-2xl shadow-sm border border-amber-100 p-6">
            <div className="flex items-center gap-2 mb-3 text-amber-700"><HelpCircle size={18} /><h3 className="font-semibold">Didn't know ({grade.didntKnow.length})</h3></div>
            {grade.didntKnow.length === 0 ? <p className="text-sm text-slate-400">Your dump covered the key concepts.</p> : (
              <ul className="space-y-2">
                {grade.didntKnow.map((it, i) => (
                  <li key={i} className="text-sm"><span className="font-medium text-slate-800">{it.concept}</span> — <span className="text-slate-600">{it.summary}</span></li>
                ))}
              </ul>
            )}
          </div>

          {/* Gap cards */}
          <div className="bg-indigo-50 rounded-2xl border border-indigo-100 p-6 text-center">
            {grade.gapFlashcards.length === 0 ? (
              <p className="text-slate-600">No gap flashcards were generated.</p>
            ) : gapCardsAdded ? (
              <div className="flex items-center justify-center gap-2 text-green-700 font-medium"><CheckCircle2 size={18} /> Added {grade.gapFlashcards.length} card{grade.gapFlashcards.length !== 1 ? 's' : ''} to your deck</div>
            ) : (
              <>
                <p className="text-slate-700 mb-3">{grade.gapFlashcards.length} flashcard{grade.gapFlashcards.length !== 1 ? 's' : ''} targeting your gaps (misconceptions weighted hardest for repeated testing).</p>
                <button onClick={addGapCards} className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors">
                  <Plus size={18} /> Add to my deck
                </button>
              </>
            )}
          </div>

          <div className="flex justify-end">
            <button onClick={onExit} className="px-6 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-semibold hover:bg-slate-50 transition-colors">Done</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TutorView;

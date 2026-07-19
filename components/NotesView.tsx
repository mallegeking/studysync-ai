import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Copy, Check, FileText, Download, Pencil, ShieldCheck, Loader2, ChevronDown, ChevronRight, AlertTriangle, X } from 'lucide-react';
import { VerificationResult } from '../types';
import { rehypeHighlightFlags, isExcerptLocated } from '../services/highlight';

interface NotesViewProps {
  markdown: string;
  verification?: VerificationResult;
  isVerifying?: boolean;
  onVerify?: () => void;
  onSave?: (markdown: string) => void;
  onClearVerification?: () => void;
}

const severityConfig: Record<string, { label: string; classes: string }> = {
  high:   { label: 'High',   classes: 'bg-red-100 text-red-700 border-red-200' },
  medium: { label: 'Medium', classes: 'bg-amber-100 text-amber-700 border-amber-200' },
  low:    { label: 'Low',    classes: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
};

const toolbarButtonClasses = 'flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-500 hover:text-indigo-600 hover:border-indigo-300 text-xs font-medium transition-all shadow-sm disabled:opacity-50 disabled:pointer-events-none';

const NotesView: React.FC<NotesViewProps> = ({ markdown, verification, isVerifying, onVerify, onSave, onClearVerification }) => {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [flagsOpen, setFlagsOpen] = useState(true);

  const handleCopy = () => {
    navigator.clipboard.writeText(markdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const exportNotes = (ext: 'md' | 'txt') => {
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([markdown], { type: ext === 'md' ? 'text/markdown;charset=utf-8;' : 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `studysync-notes-${date}.${ext}`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const startEditing = () => {
    setDraft(markdown);
    setIsEditing(true);
  };

  const saveEdit = () => {
    onSave?.(draft);
    setIsEditing(false);
  };

  // Only highlight excerpts that are actually locatable; the rest appear
  // list-only in the flags panel.
  const locatedFlags = useMemo(
    () => (verification?.noteFlags ?? []).map(flag => ({ flag, located: isExcerptLocated(markdown, flag.excerpt) })),
    [markdown, verification]
  );
  const rehypePlugins = useMemo(() => {
    const excerpts = locatedFlags.filter(({ located }) => located).map(({ flag }) => flag.excerpt);
    return excerpts.length > 0 ? [[rehypeHighlightFlags, { excerpts }] as const] : [];
  }, [locatedFlags]);

  if (!markdown) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
        <FileText className="w-12 h-12 text-slate-300" />
        <p className="font-medium text-slate-500">No notes yet</p>
        <p className="text-sm text-slate-400">Generate study material to see your notes here.</p>
      </div>
    );
  }

  const totalFlags = verification ? verification.noteFlags.length + verification.cardFlags.length : 0;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap justify-end gap-2 mb-3">
        {isEditing ? (
          <>
            <button onClick={saveEdit} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 border border-indigo-600 rounded-lg text-white hover:bg-indigo-700 text-xs font-medium transition-all shadow-sm">
              <Check size={14} /> Save
            </button>
            <button onClick={() => setIsEditing(false)} className={toolbarButtonClasses}>
              <X size={14} /> Cancel
            </button>
          </>
        ) : (
          <>
            {onVerify && (
              <button onClick={onVerify} disabled={isVerifying} className={toolbarButtonClasses} title="Check notes and flashcards for likely misinformation">
                {isVerifying ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                {isVerifying ? 'Verifying…' : 'Verify'}
              </button>
            )}
            {onSave && (
              <button onClick={startEditing} className={toolbarButtonClasses} title="Edit notes as markdown">
                <Pencil size={14} /> Edit
              </button>
            )}
            <button onClick={handleCopy} className={toolbarButtonClasses} title="Copy notes to clipboard">
              {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button onClick={() => exportNotes('md')} className={toolbarButtonClasses} title="Download as Markdown (Obsidian-ready)">
              <Download size={14} /> .md
            </button>
            <button onClick={() => exportNotes('txt')} className={toolbarButtonClasses} title="Download as plain text">
              <Download size={14} /> .txt
            </button>
          </>
        )}
      </div>

      {/* Verification flags panel */}
      {verification && !isEditing && (
        <div className={`mb-4 border rounded-lg text-sm animate-in fade-in slide-in-from-top-2 ${totalFlags > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
          <div className="flex items-center gap-2 px-4 py-3">
            <button
              onClick={() => setFlagsOpen(open => !open)}
              className={`flex flex-1 items-center gap-2 text-left font-medium ${totalFlags > 0 ? 'text-amber-800' : 'text-green-700'}`}
            >
              {totalFlags > 0
                ? <>{flagsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<AlertTriangle size={16} /></>
                : <ShieldCheck size={16} />}
              <span>
                {totalFlags > 0
                  ? `${totalFlags} potential issue${totalFlags !== 1 ? 's' : ''} found`
                  : 'No issues flagged'}
                <span className="font-normal opacity-75"> · checked {new Date(verification.verifiedAt).toLocaleString()} by {verification.provider}</span>
              </span>
            </button>
            {onClearVerification && (
              <button onClick={onClearVerification} className={`${totalFlags > 0 ? 'text-amber-400 hover:text-amber-600' : 'text-green-400 hover:text-green-600'}`} title="Dismiss verification results">
                <X size={16} />
              </button>
            )}
          </div>

          {flagsOpen && totalFlags > 0 && (
            <div className="px-4 pb-3 space-y-3">
              {locatedFlags.map(({ flag, located }, i) => (
                <div key={i} className="bg-white/60 border border-amber-200 rounded-md p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${(severityConfig[flag.severity] ?? severityConfig.medium).classes}`}>
                      {(severityConfig[flag.severity] ?? severityConfig.medium).label}
                    </span>
                    <span className="font-semibold text-slate-800">{flag.claim}</span>
                    {!located && (
                      <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">not located in current text</span>
                    )}
                  </div>
                  <p className="text-slate-600">{flag.reason}</p>
                </div>
              ))}
              {verification.cardFlags.length > 0 && (
                <p className="text-amber-700">
                  Also flagged {verification.cardFlags.length} flashcard{verification.cardFlags.length !== 1 ? 's' : ''} — look for the "Check accuracy" badge in the Flashcards view.
                </p>
              )}
            </div>
          )}

          <p className={`px-4 pb-3 text-xs ${totalFlags > 0 ? 'text-amber-600/80' : 'text-green-600/80'}`}>
            Checked against the AI model's general knowledge — your source material is not retained, so this can't confirm the notes match your source.
          </p>
        </div>
      )}

      {isEditing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full min-h-[60vh] font-mono text-sm bg-white p-6 rounded-xl shadow-sm border border-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-300 text-slate-800 resize-y"
          spellCheck={false}
        />
      ) : (
        <div className="prose prose-slate max-w-none prose-headings:text-indigo-900 prose-a:text-indigo-600 prose-strong:text-indigo-700 bg-white p-8 rounded-xl shadow-sm border border-slate-100 min-h-[50vh]">
          <ReactMarkdown rehypePlugins={rehypePlugins as never}>{markdown}</ReactMarkdown>
        </div>
      )}
    </div>
  );
};

export default NotesView;

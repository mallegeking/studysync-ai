import React from 'react';
import { Subject } from '../types';
import { subjectStats, sessionStats } from '../services/library';
import { Plus, Pencil, Trash2, FolderOpen, Layers, GraduationCap, BookOpen } from 'lucide-react';

interface LibraryProps {
  level: 'subjects' | 'sessions';
  subjects: Subject[];       // used when level === 'subjects'
  subject: Subject | null;   // the open subject when level === 'sessions'
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, current: string) => void;
  onDelete: (id: string) => void;
}

const relativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const day = 86_400_000;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < day) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(iso).toLocaleDateString();
};

const Library: React.FC<LibraryProps> = ({ level, subjects, subject, onOpen, onNew, onRename, onDelete }) => {
  const isSubjects = level === 'subjects';
  const items = isSubjects ? subjects : (subject?.sessions ?? []);

  const heading = isSubjects ? 'Your subjects' : subject?.name ?? 'Sessions';
  const subheading = isSubjects
    ? 'Create a subject for each topic you study, then add sessions inside it.'
    : 'Each session is its own set of notes and flashcards.';

  return (
    <div className="animate-in fade-in zoom-in-95 duration-300">
      <div className="mb-8 text-center max-w-xl mx-auto">
        <div className="inline-flex bg-indigo-100 text-indigo-600 p-3 rounded-2xl mb-3">
          {isSubjects ? <BookOpen size={28} /> : <FolderOpen size={28} />}
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-1">{heading}</h2>
        <p className="text-slate-600">{subheading}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item) => {
          const stats = isSubjects
            ? subjectStats(item as Subject)
            : sessionStats(item as Subject['sessions'][number]);
          return (
            <div
              key={item.id}
              onClick={() => onOpen(item.id)}
              className="group relative bg-white rounded-xl shadow-sm border border-slate-100 p-5 cursor-pointer hover:border-indigo-300 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-slate-900 text-lg truncate pr-1">{item.name}</h3>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); onRename(item.id, item.name); }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                    title="Rename"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                {isSubjects && (
                  <span className="flex items-center gap-1.5"><FolderOpen size={14} /> {(stats as ReturnType<typeof subjectStats>).sessions} session{(stats as ReturnType<typeof subjectStats>).sessions !== 1 ? 's' : ''}</span>
                )}
                <span className="flex items-center gap-1.5"><Layers size={14} /> {stats.cards} card{stats.cards !== 1 ? 's' : ''}</span>
                {stats.due > 0 && (
                  <span className="flex items-center gap-1.5 text-green-600 font-medium"><GraduationCap size={14} /> {stats.due} due</span>
                )}
              </div>

              {!isSubjects && (
                <p className="mt-2 text-xs text-slate-400">updated {relativeTime((item as Subject['sessions'][number]).updatedAt)}</p>
              )}
            </div>
          );
        })}

        {/* New card */}
        <button
          onClick={onNew}
          className="flex flex-col items-center justify-center gap-2 min-h-[7rem] bg-slate-50 rounded-xl border-2 border-dashed border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50/50 transition-all p-5"
        >
          <Plus size={22} />
          <span className="font-medium text-sm">{isSubjects ? 'New subject' : 'New session'}</span>
        </button>
      </div>

      {items.length === 0 && (
        <p className="text-center text-slate-400 text-sm mt-6">
          {isSubjects ? 'No subjects yet — create your first one to get started.' : 'No sessions yet — create one to add study material.'}
        </p>
      )}
    </div>
  );
};

export default Library;

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Copy, Check, FileText } from 'lucide-react';

interface NotesViewProps {
  markdown: string;
}

const NotesView: React.FC<NotesViewProps> = ({ markdown }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(markdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!markdown) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
        <FileText className="w-12 h-12 text-slate-300" />
        <p className="font-medium text-slate-500">No notes yet</p>
        <p className="text-sm text-slate-400">Generate study material to see your notes here.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={handleCopy}
        className="absolute top-4 right-4 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-500 hover:text-indigo-600 hover:border-indigo-300 text-xs font-medium transition-all shadow-sm"
        title="Copy notes to clipboard"
      >
        {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <div className="prose prose-slate max-w-none prose-headings:text-indigo-900 prose-a:text-indigo-600 prose-strong:text-indigo-700 bg-white p-8 rounded-xl shadow-sm border border-slate-100 min-h-[50vh]">
        <ReactMarkdown>{markdown}</ReactMarkdown>
      </div>
    </div>
  );
};

export default NotesView;

import React, { useState } from 'react';
import { X, Check } from 'lucide-react';

interface NameDialogProps {
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

// Small modal for naming a subject or session (create + rename), mirroring
// SettingsModal's overlay pattern.
const NameDialog: React.FC<NameDialogProps> = ({ title, label, initial = '', confirmLabel = 'Save', onSubmit, onClose }) => {
  const [name, setName] = useState(initial);

  const submit = () => {
    if (!name.trim()) return;
    onSubmit(name.trim());
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-800">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1"><X size={18} /></button>
        </div>
        <label className="block text-sm font-medium text-slate-600 mb-1.5">{label}</label>
        <input
          type="text"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
        />
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 transition-colors"
          >
            <Check size={15} /> {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NameDialog;

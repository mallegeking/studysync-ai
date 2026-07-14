import React, { useState } from 'react';
import { AppSettings } from '../types';
import { updateSettings } from '../services/api';
import { X, Check, Minus, Image as ImageIcon, FileText, Volume2, Youtube, KeyRound, AlertCircle } from 'lucide-react';

interface SettingsModalProps {
  settings: AppSettings;
  onClose: () => void;
  onSaved: (settings: AppSettings) => void;
}

const PROVIDER_ORDER = ['gemini', 'openai', 'anthropic', 'local'];

const CAPABILITY_LABELS: { key: 'images' | 'pdf' | 'audio' | 'youtube'; label: string; icon: React.ReactNode }[] = [
  { key: 'images', label: 'Images', icon: <ImageIcon size={12} /> },
  { key: 'pdf', label: 'PDF', icon: <FileText size={12} /> },
  { key: 'audio', label: 'Audio', icon: <Volume2 size={12} /> },
  { key: 'youtube', label: 'YouTube', icon: <Youtube size={12} /> },
];

const SettingsModal: React.FC<SettingsModalProps> = ({ settings, onClose, onSaved }) => {
  const [selected, setSelected] = useState(settings.activeProvider);
  const [drafts, setDrafts] = useState<Record<string, { apiKey: string; model: string; baseUrl: string }>>(() => {
    const initial: Record<string, { apiKey: string; model: string; baseUrl: string }> = {};
    for (const id of Object.keys(settings.providers)) {
      initial[id] = { apiKey: '', model: settings.providers[id].model, baseUrl: settings.providers[id].baseUrl ?? '' };
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setDraft = (id: string, field: 'apiKey' | 'model' | 'baseUrl', value: string) => {
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const providers: Record<string, { apiKey?: string; model?: string; baseUrl?: string }> = {};
      for (const [id, draft] of Object.entries(drafts)) {
        providers[id] = {
          model: draft.model,
          ...(id === 'local' ? { baseUrl: draft.baseUrl } : {}),
          // Only send a key when the user typed one — empty means "keep current"
          ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
        };
      }
      const saved = await updateSettings({ activeProvider: selected, providers });
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const info = settings.providers[selected];
  const draft = drafts[selected];

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-slate-800">AI Provider Settings</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X size={18} />
          </button>
        </div>

        {/* Provider select */}
        <div className="grid grid-cols-2 gap-2 mb-5">
          {PROVIDER_ORDER.filter(id => settings.providers[id]).map((id) => (
            <button
              key={id}
              onClick={() => setSelected(id)}
              className={`px-3 py-2.5 rounded-xl border text-sm font-medium text-left transition-all ${
                selected === id
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-500/30'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              {settings.providers[id].name}
              {settings.activeProvider === id && (
                <span className="block text-[10px] uppercase tracking-wide text-indigo-400 mt-0.5">Currently active</span>
              )}
            </button>
          ))}
        </div>

        {/* Capabilities of selected provider */}
        <div className="flex items-center gap-3 mb-5 px-3 py-2 bg-slate-50 rounded-lg border border-slate-100">
          {CAPABILITY_LABELS.map(({ key, label, icon }) => (
            <span
              key={key}
              className={`flex items-center gap-1 text-xs font-medium ${
                info.capabilities[key] ? 'text-green-700' : 'text-slate-400 line-through'
              }`}
              title={info.capabilities[key] ? `${label} supported` : `${label} not supported — this input will be ignored`}
            >
              {icon} {label} {info.capabilities[key] ? <Check size={11} /> : <Minus size={11} />}
            </span>
          ))}
        </div>

        {/* Per-provider fields */}
        <div className="space-y-4 mb-6">
          {selected === 'local' && (
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">Base URL</label>
              <input
                type="url"
                value={draft.baseUrl}
                onChange={(e) => setDraft(selected, 'baseUrl', e.target.value)}
                placeholder="http://localhost:11434/v1"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
              <p className="text-xs text-slate-400 mt-1">OpenAI-compatible endpoint — Ollama: http://localhost:11434/v1, LM Studio: http://localhost:1234/v1</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">Model</label>
            <input
              type="text"
              value={draft.model}
              onChange={(e) => setDraft(selected, 'model', e.target.value)}
              placeholder={selected === 'local' ? 'e.g. llama3.2' : 'model id'}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5 flex items-center gap-1.5">
              <KeyRound size={13} /> API key {selected === 'local' && <span className="text-slate-400 font-normal">(optional)</span>}
            </label>
            <input
              type="password"
              value={draft.apiKey}
              onChange={(e) => setDraft(selected, 'apiKey', e.target.value)}
              placeholder={info.keySet ? 'saved — enter a new key to replace' : 'paste your API key'}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
            <p className="text-xs text-slate-400 mt-1">
              Stored on your machine in server/config.json — never sent to the browser.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 transition-colors"
          >
            {saving ? 'Saving…' : 'Save & use'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;

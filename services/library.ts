import { GeneratedContent, Session, StudyStore, Subject } from '../types';
import { getCardsForReview } from './srs';

// Pure helpers for the subjects → sessions library. Every mutator returns a
// new StudyStore (immutable, so React functional setState works cleanly).

const now = () => new Date().toISOString();

const emptyContent = (): GeneratedContent => ({ markdownNotes: '', flashcards: [] });

export const emptyStore = (): StudyStore => ({ subjects: [], activeSubjectId: null, activeSessionId: null });

// --- Subject CRUD ---

export function createSubject(store: StudyStore, name: string): { store: StudyStore; id: string } {
  const subject: Subject = { id: crypto.randomUUID(), name: name.trim() || 'Untitled', createdAt: now(), sessions: [] };
  return { store: { ...store, subjects: [...store.subjects, subject] }, id: subject.id };
}

export function renameSubject(store: StudyStore, subjectId: string, name: string): StudyStore {
  return {
    ...store,
    subjects: store.subjects.map(s => s.id === subjectId ? { ...s, name: name.trim() || s.name } : s),
  };
}

export function deleteSubject(store: StudyStore, subjectId: string): StudyStore {
  const subjects = store.subjects.filter(s => s.id !== subjectId);
  const wasActive = store.activeSubjectId === subjectId;
  return {
    subjects,
    activeSubjectId: wasActive ? null : store.activeSubjectId,
    activeSessionId: wasActive ? null : store.activeSessionId,
  };
}

// --- Session CRUD ---

export function createSession(store: StudyStore, subjectId: string, name: string): { store: StudyStore; id: string } {
  const session: Session = {
    id: crypto.randomUUID(),
    name: name.trim() || 'Untitled',
    createdAt: now(),
    updatedAt: now(),
    content: emptyContent(),
  };
  return {
    store: {
      ...store,
      subjects: store.subjects.map(s => s.id === subjectId ? { ...s, sessions: [...s.sessions, session] } : s),
    },
    id: session.id,
  };
}

export function renameSession(store: StudyStore, subjectId: string, sessionId: string, name: string): StudyStore {
  return {
    ...store,
    subjects: store.subjects.map(s => s.id !== subjectId ? s : {
      ...s,
      sessions: s.sessions.map(sess => sess.id === sessionId ? { ...sess, name: name.trim() || sess.name } : sess),
    }),
  };
}

export function deleteSession(store: StudyStore, subjectId: string, sessionId: string): StudyStore {
  const wasActive = store.activeSessionId === sessionId;
  return {
    ...store,
    activeSessionId: wasActive ? null : store.activeSessionId,
    subjects: store.subjects.map(s => s.id !== subjectId ? s : {
      ...s,
      sessions: s.sessions.filter(sess => sess.id !== sessionId),
    }),
  };
}

// Apply an updater to the given session's content and bump its updatedAt.
export function updateSessionContent(
  store: StudyStore,
  subjectId: string,
  sessionId: string,
  updater: (content: GeneratedContent) => GeneratedContent
): StudyStore {
  return {
    ...store,
    subjects: store.subjects.map(s => s.id !== subjectId ? s : {
      ...s,
      sessions: s.sessions.map(sess => sess.id !== sessionId ? sess : {
        ...sess,
        content: updater(sess.content),
        updatedAt: now(),
      }),
    }),
  };
}

// --- Lookup ---

export function findActive(store: StudyStore): { subject: Subject | null; session: Session | null } {
  const subject = store.subjects.find(s => s.id === store.activeSubjectId) ?? null;
  const session = subject?.sessions.find(sess => sess.id === store.activeSessionId) ?? null;
  return { subject, session };
}

// --- Stats (due counts reuse the SRS scheduler) ---

export function sessionStats(session: Session): { cards: number; due: number } {
  const cards = session.content.flashcards;
  return { cards: cards.length, due: getCardsForReview(cards).length };
}

export function subjectStats(subject: Subject): { sessions: number; cards: number; due: number } {
  return subject.sessions.reduce(
    (acc, sess) => {
      const s = sessionStats(sess);
      return { sessions: acc.sessions, cards: acc.cards + s.cards, due: acc.due + s.due };
    },
    { sessions: subject.sessions.length, cards: 0, due: 0 }
  );
}

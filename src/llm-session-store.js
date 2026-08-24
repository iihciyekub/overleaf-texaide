'use strict';

const CHAT_STATE_KEY = 'wosAideLlmChatStateV2';
const CHAT_STATE_VERSION = 2;
const MAX_UNPINNED_SESSIONS = 50;

function sessionId() {
  const randomUUID = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `llm-session-${randomUUID}`;
}

function sessionTitle(items, fallback = 'New conversation') {
  const prompt = String((items || []).find(item => item?.prompt)?.prompt || '').trim();
  return prompt ? prompt.slice(0, 48) : fallback;
}

function createSession(options = {}) {
  const now = new Date().toISOString();
  const id = String(options.id || '').trim() || sessionId();
  const messages = Array.isArray(options.messages)
    ? options.messages.map(item => ({ ...item, sessionId: id }))
    : [];
  return {
    id,
    title: options.title || sessionTitle(messages, options.fallbackTitle),
    pinned: Boolean(options.pinned),
    createdAt: options.createdAt || now,
    updatedAt: options.updatedAt || now,
    lastModel: options.lastModel || null,
    messages,
    memory: options.memory && typeof options.memory === 'object' ? { ...options.memory } : {}
  };
}

function normalizeSessions(items, fallbackTitle) {
  const byId = new Map();
  (Array.isArray(items) ? items : []).forEach(item => {
    const session = createSession({ ...item, fallbackTitle });
    const existing = byId.get(session.id);
    if (!existing || Date.parse(session.updatedAt || 0) >= Date.parse(existing.updatedAt || 0)) {
      byId.set(session.id, session);
    }
  });
  return Array.from(byId.values());
}

function sessionHasContent(session) {
  return Boolean(Array.isArray(session?.messages) && session.messages.some(item => (
    String(item?.prompt || '').trim()
    || String(item?.rowText || '').trim()
    || (Array.isArray(item?.candidates) && item.candidates.some(candidate => String(candidate?.query || '').trim()))
  )));
}

function pruneSessions(sessions) {
  const withContent = sessions.filter(sessionHasContent);
  const pinned = withContent.filter(session => session.pinned);
  const unpinned = withContent.filter(session => !session.pinned)
    .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0))
    .slice(0, MAX_UNPINNED_SESSIONS);
  return [...pinned, ...unpinned];
}

function migrateChatState(storedState, legacyHistory, legacySessions, fallbackTitle) {
  if (storedState?.version === CHAT_STATE_VERSION && Array.isArray(storedState.sessions)) {
    const sessions = pruneSessions(normalizeSessions(storedState.sessions, fallbackTitle));
    const storedActive = normalizeSessions(storedState.sessions, fallbackTitle)
      .find(item => item.id === storedState.activeSessionId);
    const activeSessionId = sessions.some(item => item.id === storedState.activeSessionId)
      ? storedState.activeSessionId
      : storedState.activeSessionId === '' || (storedActive && !sessionHasContent(storedActive))
        ? ''
        : sessions[0]?.id || '';
    return { version: CHAT_STATE_VERSION, activeSessionId, sessions };
  }

  const archived = normalizeSessions(legacySessions, fallbackTitle);
  const active = createSession({ messages: Array.isArray(legacyHistory) ? legacyHistory : [], fallbackTitle });
  const sessions = pruneSessions([...archived, active]);
  return {
    version: CHAT_STATE_VERSION,
    activeSessionId: sessionHasContent(active) ? active.id : '',
    sessions
  };
}

module.exports = {
  CHAT_STATE_KEY,
  CHAT_STATE_VERSION,
  MAX_UNPINNED_SESSIONS,
  sessionId,
  sessionTitle,
  createSession,
  normalizeSessions,
  sessionHasContent,
  pruneSessions,
  migrateChatState
};

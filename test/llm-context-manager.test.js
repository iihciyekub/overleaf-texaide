'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PROVIDER_CONTEXT_DEFAULTS,
  contextWindowFor,
  estimateTextTokens,
  buildConversationContext,
  conversationContextText,
  measureContext,
  deterministicSummary
} = require('../src/llm-context-manager');
const {
  CHAT_STATE_VERSION,
  sessionId,
  createSession,
  normalizeSessions,
  sessionHasContent,
  pruneSessions,
  migrateChatState
} = require('../src/llm-session-store');
const { completionRequest, normalizeUsage } = require('../src/ai-provider-client');
const { normalizedSummary } = require('../src/wos-conversation-context');

const completed = (id, prompt) => ({
  requestId: id,
  prompt,
  state: 'completed',
  intent: {
    normalizedQuestion: prompt,
    concepts: [{ id: `${id}-concept`, label: 'Platform governance', englishTerms: ['platform governance'], required: true, suggestedField: 'TS' }],
    constraints: ['Published since 2022'],
    exclusions: ['conference papers'],
    assumptions: []
  },
  candidates: [{ id: 'balanced', label: 'Balanced', query: `TS=("${prompt}")` }]
});

test('context windows prefer explicit model settings and mark defaults as estimates', () => {
  assert.ok(Object.values(PROVIDER_CONTEXT_DEFAULTS).every(tokens => tokens === 32768));
  assert.deepEqual(contextWindowFor('openai', 196000), { tokens: 128000, estimated: false });
  assert.deepEqual(contextWindowFor('gemini', 0), { tokens: 32768, estimated: true });
  assert.deepEqual(contextWindowFor('ollama', 0), { tokens: 32768, estimated: true });
});

test('conversation context keeps recent turns and excludes covered turns', () => {
  const items = [completed('a', 'first'), completed('b', 'second'), completed('c', 'third'), completed('d', 'fourth')];
  const context = buildConversationContext(items, {
    summary: { researchGoal: 'first' },
    coveredRequestIds: ['a']
  });
  assert.deepEqual(context.olderTurns.map(turn => turn.requestId), ['b']);
  assert.deepEqual(context.recentTurns.map(turn => turn.requestId), ['c', 'd']);
  assert.match(conversationContextText(context), /compactedSummary/);
  assert.doesNotMatch(conversationContextText(context), /"requestId": "a"/);
});

test('token measurement is monotonic and reaches warning thresholds', () => {
  const short = measureContext({ contextWindow: 8192, fixedPrompt: 'rules', currentPrompt: 'short' });
  const long = measureContext({ contextWindow: 8192, fixedPrompt: 'rules', currentPrompt: 'x'.repeat(18000) });
  assert.ok(estimateTextTokens('平台治理') > 0);
  assert.ok(long.inputTokens > short.inputTokens);
  assert.ok(['decision', 'hard'].includes(long.level));
});

test('deterministic summary preserves constraints and prior WOS queries', () => {
  const summary = deterministicSummary({ olderTurns: [buildConversationContext([completed('a', 'platform governance')]).recentTurns[0]] });
  assert.equal(summary.researchGoal, 'platform governance');
  assert.match(summary.timeRange, /2022/);
  assert.deepEqual(summary.exclusions, ['conference papers']);
  assert.match(summary.priorQueries[0], /TS=/);
});

test('deterministic summary carries previous memory through repeated compaction', () => {
  const summary = deterministicSummary({
    summary: {
      researchGoal: 'Earlier goal',
      requiredConcepts: ['legacy concept'],
      exclusions: ['reviews'],
      timeRange: 'Published before 2020',
      fieldDecisions: ['legacy concept: TS'],
      organizationNames: ['Legacy University'],
      priorQueries: ['TS=(legacy)'],
      userPreferences: ['English only'],
      openQuestions: ['Confirm document types']
    },
    olderTurns: [buildConversationContext([completed('b', 'new goal')]).recentTurns[0]]
  });
  assert.equal(summary.researchGoal, 'new goal');
  assert.ok(summary.requiredConcepts.includes('legacy concept'));
  assert.ok(summary.exclusions.includes('reviews'));
  assert.match(summary.timeRange, /before 2020/);
  assert.ok(summary.priorQueries.includes('TS=(legacy)'));
  assert.ok(summary.userPreferences.includes('English only'));
});

test('legacy conversations migrate to one active versioned session', () => {
  const legacyCurrent = [completed('active', 'active prompt')];
  const legacyArchived = [{ id: 'old', title: 'Old', messages: [completed('old-turn', 'old prompt')] }];
  const state = migrateChatState(null, legacyCurrent, legacyArchived, 'New conversation');
  assert.equal(state.version, CHAT_STATE_VERSION);
  assert.equal(state.sessions.length, 2);
  assert.equal(state.sessions.find(session => session.id === state.activeSessionId).messages[0].requestId, 'active');

  const existing = createSession({ id: 'existing', title: 'Existing' });
  const stable = migrateChatState({ version: CHAT_STATE_VERSION, activeSessionId: existing.id, sessions: [existing] }, [], [], 'New');
  assert.equal(stable.activeSessionId, '');
  assert.deepEqual(stable.sessions, []);
});

test('sessions have unique ids and bind every message to the owning session', () => {
  const first = createSession({ messages: [{ requestId: 'one', prompt: 'first' }] });
  const second = createSession({ messages: [{ requestId: 'two', prompt: 'second' }] });
  assert.notEqual(sessionId(), sessionId());
  assert.notEqual(first.id, second.id);
  assert.match(first.id, /^llm-session-/);
  assert.equal(first.messages[0].sessionId, first.id);
  assert.equal(second.messages[0].sessionId, second.id);
});

test('restoring state removes duplicate session ids and keeps the newest copy', () => {
  const sessions = normalizeSessions([
    { id: 'same', title: 'Old', updatedAt: '2026-01-01T00:00:00.000Z', messages: [{ requestId: 'old' }] },
    { id: 'same', title: 'Newest', updatedAt: '2026-01-02T00:00:00.000Z', messages: [{ requestId: 'new' }] }
  ], 'New');
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].title, 'Newest');
  assert.equal(sessions[0].messages[0].sessionId, 'same');
});

test('blank sessions are excluded from persisted conversation history', () => {
  const blank = createSession({ id: 'blank', pinned: true });
  const populated = createSession({ id: 'populated', messages: [{ requestId: 'one', prompt: 'platform governance' }] });
  assert.equal(sessionHasContent(blank), false);
  assert.equal(sessionHasContent(populated), true);
  assert.deepEqual(pruneSessions([blank, populated]).map(session => session.id), ['populated']);

  const restored = migrateChatState({
    version: CHAT_STATE_VERSION,
    activeSessionId: blank.id,
    sessions: [blank, populated]
  }, [], [], 'New');
  assert.equal(restored.activeSessionId, '');
  assert.deepEqual(restored.sessions.map(session => session.id), ['populated']);
});

test('provider requests honor transport mode, output limits, and snake-case usage', () => {
  const base = {
    kind: 'openai',
    transport: 'responses',
    structuredOutput: 'promptOnly',
    baseURL: 'https://api.openai.com/v1',
    model: 'test-model',
    apiKey: 'test-key',
    requiresApiKey: true
  };
  const request = { instructions: 'Return text.', input: 'Hello', schema: {}, schemaName: 'test', maxOutputTokens: 77 };
  const responses = completionRequest(base, request);
  assert.match(responses.url, /\/responses$/);
  assert.equal(JSON.parse(responses.options.body).max_output_tokens, 77);

  const chat = completionRequest({ ...base, transport: 'chatCompletions' }, request);
  assert.match(chat.url, /\/chat\/completions$/);
  assert.equal(JSON.parse(chat.options.body).max_tokens, 77);
  assert.deepEqual(normalizeUsage({ input_tokens: 10, output_tokens: 4 }), {
    inputTokens: 10,
    cachedInputTokens: 0,
    outputTokens: 4
  });
});

test('summary normalization rejects non-array fields without losing valid content', () => {
  const summary = normalizedSummary(
    { researchGoal: 'Goal', requiredConcepts: 'wrong', priorQueries: ['TS=(x)'] },
    { requiredConcepts: ['fallback concept'], timeRange: 'Since 2020' }
  );
  assert.equal(summary.researchGoal, 'Goal');
  assert.deepEqual(summary.requiredConcepts, ['fallback concept']);
  assert.deepEqual(summary.priorQueries, ['TS=(x)']);
  assert.equal(summary.timeRange, 'Since 2020');
});

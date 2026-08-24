'use strict';

const CONTEXT_DECISION_THRESHOLD = 0.8;
const CONTEXT_HARD_THRESHOLD = 0.95;
const CONTEXT_WARNING_THRESHOLD = 0.7;
const RECENT_TURNS_TO_KEEP = 2;
const MAX_CONTEXT_WINDOW_TOKENS = 128000;
const DEFAULT_CONTEXT_WINDOW_TOKENS = 32768;

const PROVIDER_CONTEXT_DEFAULTS = Object.freeze({
  openai: DEFAULT_CONTEXT_WINDOW_TOKENS,
  anthropic: DEFAULT_CONTEXT_WINDOW_TOKENS,
  gemini: DEFAULT_CONTEXT_WINDOW_TOKENS,
  openrouter: DEFAULT_CONTEXT_WINDOW_TOKENS,
  deepseek: DEFAULT_CONTEXT_WINDOW_TOKENS,
  siliconflow: DEFAULT_CONTEXT_WINDOW_TOKENS,
  groq: DEFAULT_CONTEXT_WINDOW_TOKENS,
  mistral: DEFAULT_CONTEXT_WINDOW_TOKENS,
  azureOpenAI: DEFAULT_CONTEXT_WINDOW_TOKENS,
  compatible: DEFAULT_CONTEXT_WINDOW_TOKENS,
  ollama: DEFAULT_CONTEXT_WINDOW_TOKENS,
  lmstudio: DEFAULT_CONTEXT_WINDOW_TOKENS
});

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function contextWindowFor(provider, manualValue) {
  const manual = positiveInteger(manualValue);
  if (manual) return { tokens: Math.min(manual, MAX_CONTEXT_WINDOW_TOKENS), estimated: false };
  return {
    tokens: PROVIDER_CONTEXT_DEFAULTS[provider] || PROVIDER_CONTEXT_DEFAULTS.compatible,
    estimated: true
  };
}

function estimateTextTokens(value) {
  const text = String(value || '');
  if (!text) return 0;
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const remaining = Math.max(0, text.length - cjk);
  return Math.max(1, Math.ceil(cjk * 1.15 + remaining / 3.6));
}

function completedTurns(items) {
  return (Array.isArray(items) ? items : []).filter(item => (
    item?.state === 'completed' && String(item?.prompt || '').trim()
  ));
}

function turnForContext(item) {
  return {
    requestId: String(item?.requestId || ''),
    userRequest: String(item?.prompt || '').trim(),
    intent: item?.intent || null,
    selectedCandidateId: String(item?.selectedCandidateId || ''),
    candidates: (Array.isArray(item?.candidates) ? item.candidates : [])
      .map(candidate => ({
        id: String(candidate?.id || ''),
        label: String(candidate?.label || ''),
        query: String(candidate?.query || '').trim()
      }))
      .filter(candidate => candidate.query)
  };
}

function buildConversationContext(items, memory = {}, options = {}) {
  const turns = completedTurns(items);
  const keepRecent = positiveInteger(options.keepRecent) || RECENT_TURNS_TO_KEEP;
  const covered = new Set(Array.isArray(memory?.coveredRequestIds) ? memory.coveredRequestIds : []);
  const uncovered = turns.filter(item => !covered.has(item.requestId));
  const recent = uncovered.slice(-keepRecent).map(turnForContext);
  const older = uncovered.slice(0, Math.max(0, uncovered.length - keepRecent)).map(turnForContext);
  return {
    summary: memory?.summary || null,
    olderTurns: older,
    recentTurns: recent
  };
}

function conversationContextText(context) {
  const normalized = context || {};
  if (!normalized.summary && !normalized.recentTurns?.length && !normalized.olderTurns?.length) return '';
  return JSON.stringify({
    compactedSummary: normalized.summary || null,
    olderTurns: normalized.olderTurns || [],
    recentTurns: normalized.recentTurns || []
  }, null, 2);
}

function usableContextTokens(contextWindow, maximumOutputTokens = 3000) {
  const windowTokens = Math.max(4096, positiveInteger(contextWindow) || PROVIDER_CONTEXT_DEFAULTS.compatible);
  const outputReserve = Math.min(Math.floor(windowTokens * 0.25), positiveInteger(maximumOutputTokens) || 3000);
  const safetyReserve = Math.max(1024, Math.ceil(windowTokens * 0.05));
  return Math.max(1024, windowTokens - outputReserve - safetyReserve);
}

function measureContext(options = {}) {
  const contextText = conversationContextText(options.context);
  const inputTokens = estimateTextTokens([
    options.fixedPrompt || '',
    contextText,
    options.currentPrompt || ''
  ].join('\n'));
  const usableTokens = usableContextTokens(options.contextWindow, options.maximumOutputTokens);
  const ratio = usableTokens ? inputTokens / usableTokens : 0;
  const level = ratio >= CONTEXT_HARD_THRESHOLD
    ? 'hard'
    : ratio >= CONTEXT_DECISION_THRESHOLD
      ? 'decision'
      : ratio >= CONTEXT_WARNING_THRESHOLD
        ? 'warning'
        : 'normal';
  return { inputTokens, usableTokens, ratio, level };
}

function deterministicSummary(context = {}) {
  const turns = [...(context.olderTurns || []), ...(context.recentTurns || [])];
  const intents = turns.map(turn => turn.intent).filter(Boolean);
  const constraints = intents.flatMap(intent => Array.isArray(intent.constraints) ? intent.constraints : []);
  const previous = context.summary && typeof context.summary === 'object' ? context.summary : {};
  const previousList = key => Array.isArray(previous[key]) ? previous[key] : [];
  const unique = (values, limit) => Array.from(new Set(values.map(String).filter(Boolean))).slice(0, limit);
  const timeRanges = [previous.timeRange, ...constraints.filter(value => /\b(?:19|20)\d{2}\b|\bPY\b|year/i.test(String(value)))]
    .map(String)
    .filter(Boolean);
  return {
    researchGoal: String(intents.at(-1)?.normalizedQuestion || turns.at(-1)?.userRequest || previous.researchGoal || ''),
    requiredConcepts: unique([...previousList('requiredConcepts'), ...turns.flatMap(turn => (
      Array.isArray(turn.intent?.concepts)
        ? turn.intent.concepts.filter(concept => concept?.required).map(concept => concept.label || concept.id)
        : []
    ))], 24),
    exclusions: unique([...previousList('exclusions'), ...intents.flatMap(intent => Array.isArray(intent.exclusions) ? intent.exclusions : [])], 24),
    timeRange: unique(timeRanges, 8).join('; '),
    fieldDecisions: unique([...previousList('fieldDecisions'), ...intents.flatMap(intent => (
      Array.isArray(intent.concepts)
        ? intent.concepts.map(concept => `${concept.label || concept.id}: ${concept.suggestedField || 'TS'}`)
        : []
    ))], 32),
    organizationNames: unique([...previousList('organizationNames'), ...intents.flatMap(intent => (
      Array.isArray(intent.concepts)
        ? intent.concepts.filter(concept => concept.suggestedField === 'OG').flatMap(concept => concept.englishTerms || [])
        : []
    ))], 24),
    priorQueries: unique([...previousList('priorQueries'), ...turns.flatMap(turn => turn.candidates || []).map(candidate => candidate.query)], 32).slice(-8),
    userPreferences: unique([...previousList('userPreferences'), ...constraints], 24),
    openQuestions: unique([...previousList('openQuestions'), ...intents.flatMap(intent => Array.isArray(intent.assumptions) ? intent.assumptions : [])], 16)
  };
}

function formatTokenAmount(value) {
  const tokens = Math.max(0, Number(value) || 0);
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(tokens >= 10000000 ? 0 : 1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens >= 100000 ? 0 : 1)}K`;
  return String(Math.round(tokens));
}

module.exports = {
  CONTEXT_DECISION_THRESHOLD,
  CONTEXT_HARD_THRESHOLD,
  CONTEXT_WARNING_THRESHOLD,
  RECENT_TURNS_TO_KEEP,
  MAX_CONTEXT_WINDOW_TOKENS,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  PROVIDER_CONTEXT_DEFAULTS,
  contextWindowFor,
  estimateTextTokens,
  completedTurns,
  turnForContext,
  buildConversationContext,
  conversationContextText,
  usableContextTokens,
  measureContext,
  deterministicSummary,
  formatTokenAmount
};

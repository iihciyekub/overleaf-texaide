'use strict';

const { requestCompletion } = require('./ai-provider-client');
const { deterministicSummary } = require('./llm-context-manager');

const CONTEXT_SUMMARY_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    researchGoal: { type: 'string' },
    requiredConcepts: { type: 'array', items: { type: 'string' } },
    exclusions: { type: 'array', items: { type: 'string' } },
    timeRange: { type: 'string' },
    fieldDecisions: { type: 'array', items: { type: 'string' } },
    organizationNames: { type: 'array', items: { type: 'string' } },
    priorQueries: { type: 'array', items: { type: 'string' } },
    userPreferences: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } }
  },
  required: [
    'researchGoal',
    'requiredConcepts',
    'exclusions',
    'timeRange',
    'fieldDecisions',
    'organizationNames',
    'priorQueries',
    'userPreferences',
    'openQuestions'
  ],
  additionalProperties: false
});

const SUMMARY_INSTRUCTIONS = `Compress an older Web of Science query conversation into durable structured memory.
Preserve the research goal, required and excluded concepts, time limits, WOS field choices,
canonical organization names, user preferences, important prior queries, and unresolved questions.
Do not invent constraints. The summary will replace the older turns, so make every retained decision explicit.`;

function parseJSONObject(value) {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(text);
  } catch (_error) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw _error;
  }
}

function normalizedSummary(value, fallback) {
  const source = value && typeof value === 'object' ? value : fallback;
  const strings = key => {
    const values = Array.isArray(source?.[key]) ? source[key] : fallback?.[key];
    return (Array.isArray(values) ? values : []).map(String).filter(Boolean);
  };
  return {
    researchGoal: String(source?.researchGoal || fallback?.researchGoal || ''),
    requiredConcepts: strings('requiredConcepts').slice(0, 32),
    exclusions: strings('exclusions').slice(0, 24),
    timeRange: String(source?.timeRange || fallback?.timeRange || ''),
    fieldDecisions: strings('fieldDecisions').slice(0, 32),
    organizationNames: strings('organizationNames').slice(0, 24),
    priorQueries: strings('priorQueries').slice(-8),
    userPreferences: strings('userPreferences').slice(0, 24),
    openQuestions: strings('openQuestions').slice(0, 16)
  };
}

async function compactConversationContext(context, config, options = {}) {
  const olderTurns = Array.isArray(context?.olderTurns) ? context.olderTurns : [];
  const previousCovered = Array.isArray(options.coveredRequestIds) ? options.coveredRequestIds : [];
  const coveredRequestIds = Array.from(new Set([
    ...previousCovered,
    ...olderTurns.map(turn => turn.requestId).filter(Boolean)
  ]));
  const fallback = deterministicSummary({
    olderTurns,
    recentTurns: [],
    summary: context?.summary || null
  });
  if (!olderTurns.length) {
    return {
      summary: context?.summary || normalizedSummary(fallback, fallback),
      coveredRequestIds,
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      usedFallback: true
    };
  }

  try {
    const result = await requestCompletion(config, {
      schemaName: 'wos_conversation_memory',
      instructions: SUMMARY_INSTRUCTIONS,
      input: JSON.stringify({ previousSummary: context?.summary || null, olderTurns }, null, 2),
      schema: CONTEXT_SUMMARY_SCHEMA,
      maxOutputTokens: 1500
    }, { signal: options.signal });
    return {
      summary: normalizedSummary(parseJSONObject(result.text), fallback),
      coveredRequestIds,
      usage: result.usage,
      usedFallback: false
    };
  } catch (error) {
    if (error?.name === 'AbortError' || options.signal?.aborted) throw error;
    options.onFallback?.(error);
    return {
      summary: normalizedSummary(fallback, fallback),
      coveredRequestIds,
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      usedFallback: true
    };
  }
}

module.exports = {
  CONTEXT_SUMMARY_SCHEMA,
  SUMMARY_INSTRUCTIONS,
  parseJSONObject,
  normalizedSummary,
  compactConversationContext
};

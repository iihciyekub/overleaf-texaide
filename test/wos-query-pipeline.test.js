'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WOS_FIELD_REFERENCES,
  translationInstructions,
  COMPOSITION_INSTRUCTIONS,
  REVIEW_INSTRUCTIONS
} = require('../src/wos-query-prompts');
const {
  decodeJSON,
  protectProperNames,
  protectedProperNameLiterals
} = require('../src/wos-query-pipeline');
const {
  loadProviderConfig
} = require('../src/wos-query-provider-settings');
const { requestCompletion } = require('../src/ai-provider-client');

test('built-in prompts match the three-stage Apple implementation', () => {
  const stage1 = translationInstructions('English');
  assert.match(stage1, /Stage 1 of 3: translate and normalize the research intent/);
  assert.match(stage1, /Supported field tags:/);
  assert.match(stage1, /OG=\(/);
  assert.match(COMPOSITION_INSTRUCTIONS, /Stage 2 of 3: construct up to three meaningfully distinct candidates/);
  assert.match(REVIEW_INSTRUCTIONS, /Stage 3 of 3: review each candidate/);
  assert.ok(WOS_FIELD_REFERENCES.some(field => field.code === 'OG'));
});

test('provider presets load new and legacy settings', () => {
  const deepseek = loadProviderConfig({}, 'deepseek');
  assert.equal(deepseek.kind, 'compatible');
  assert.equal(deepseek.transport, 'chatCompletions');
  assert.equal(deepseek.structuredOutput, 'jsonObject');
  assert.equal(deepseek.baseURL, 'https://api.deepseek.com/v1');

  const legacyOpenAI = loadProviderConfig({
    wosOpenaiApiKey: 'sk-test',
    wosOpenaiChatModel: 'gpt-4.1-mini'
  }, 'openai');
  assert.equal(legacyOpenAI.apiKey, 'sk-test');
  assert.equal(legacyOpenAI.model, 'gpt-4.1-mini');
});

test('structured responses are decoded from fences and proper names are protected', () => {
  const decoded = decodeJSON('```json\n{"candidates":[{"id":"a","query":"TS=(x)","explanation":"ok"}]}\n```', 'review');
  assert.equal(decoded.candidates[0].query, 'TS=(x)');

  const literals = protectedProperNameLiterals({
    concepts: [{
      id: 'c1',
      label: 'Org',
      englishTerms: ['Macau University of Science and Technology'],
      required: true,
      suggestedField: 'OG'
    }]
  }, []);
  const protectedQuery = protectProperNames(
    'OG=(Macau University of Science and Technology) AND TS=(platform governance)',
    literals
  );
  assert.equal(
    protectedQuery,
    'OG=("Macau University of Science & Technology") AND TS=(platform governance)'
  );
});

test('provider requests forward AbortSignal to the active fetch', async () => {
  const originalFetch = global.fetch;
  global.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  const controller = new AbortController();
  try {
    const pending = requestCompletion({
      name: 'Test provider',
      kind: 'compatible',
      transport: 'chatCompletions',
      structuredOutput: 'promptOnly',
      baseURL: 'https://example.com/v1',
      model: 'test-model',
      apiKey: 'test-key',
      requiresApiKey: true
    }, {
      schemaName: 'test',
      instructions: 'Return text.',
      input: 'Hello',
      schema: {},
      maxOutputTokens: 32
    }, { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, error => error?.name === 'AbortError');
  } finally {
    global.fetch = originalFetch;
  }
});

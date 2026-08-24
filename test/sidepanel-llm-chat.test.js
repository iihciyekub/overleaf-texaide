'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { isWosTab, buildWosQueryUrl, navigateLlmPromptHistory } = require('../src/sidepanel-llm-chat');
const { providerOfficialURL } = require('../src/sidepanel-ai-provider-settings');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('LLM conversation is hosted in the side panel and runs generated WOS queries', () => {
  const html = read('public/sidepanel.html');
  const chat = read('src/sidepanel-llm-chat.js');
  const background = read('src/background.js');
  const pipeline = read('src/wos-query-pipeline.js');
  const providerClient = read('src/ai-provider-client.js');
  const providerSettings = read('src/sidepanel-ai-provider-settings.js');
  const css = read('src/sidepanel.css');
  const contentScript = read('src/contentScript.js');

  assert.match(html, /id="llmChatMessages"/);
  assert.match(html, /id="llmChatMessages"[^>]*hidden/);
  assert.doesNotMatch(html, /Describe the literature search you want to run/);
  assert.match(html, /id="llmChatInput"/);
  assert.match(html, /id="sendLlmChatBtn"/);
  assert.match(chat, /GENERATE_WOS_QUERY/);
  assert.match(chat, /WOS_QUERY_PROGRESS/);
  assert.match(chat, /CANCEL_WOS_QUERY/);
  assert.match(chat, /state: 'thinking'/);
  assert.match(chat, /llm-chat-progress--\$\{responseState\}/);
  assert.match(chat, /fa-\$\{stopping \? 'stop' : 'paper-plane'\}/);
  assert.match(chat, /cancelActiveRequest/);
  assert.match(chat, /translate\('llm\.runAction'\)/);
  assert.match(chat, /translate\('llm\.copyAction'\)/);
  assert.match(chat, /dataset\.llmElapsed/);
  assert.match(background, /activeWosQueryRequests = new Map\(\)/);
  assert.match(background, /type: 'WOS_QUERY_PROGRESS'/);
  assert.match(background, /onStageChange/);
  assert.match(background, /onModelCall/);
  assert.match(background, /pendingWosQueryCancellations = new Set\(\)/);
  assert.match(background, /controller\.abort\(\)/);
  assert.match(pipeline, /requestCompletion\(config, activeRequest, \{ signal \}\)/);
  assert.match(providerClient, /signal: runtimeOptions\.signal/);
  assert.match(css, /\.llm-chat-progress--cancelled/);
  assert.match(css, /\.llm-chat-progress__details/);
  assert.match(css, /\.llm-chat-candidate-action[^}]*font-size:\s*10px/);
  assert.match(css, /\.llm-composer-send\.is-stopping/);
  assert.match(chat, /window\.wos\.query/);
  assert.doesNotMatch(chat, /void runQuery\(rowText\)\.catch/);
  assert.match(chat, /chrome\.tabs\.create\(\{ url, active: true \}/);
  assert.match(chat, /buildWosQueryUrl\(rowText\)/);
  assert.match(chat, /wosAideLlmChatHistory/);
  assert.match(chat, /elements\.messages\.hidden = true/);
  assert.match(chat, /elements\.messages\.hidden = false/);
  assert.doesNotMatch(chat, /review\.textContent = candidate\.review/);
  assert.doesNotMatch(chat, /candidateLabel\.textContent = candidate\.label/);
  assert.match(chat, /llm-chat-candidate-actions/);
  assert.match(chat, /llm-chat-candidate-tag/);
  assert.match(chat, /llm-chat-wrap-toggle/);
  assert.match(chat, /fa-text-width/);
  assert.match(chat, /classList\.toggle\('is-wrapped'\)/);
  assert.match(chat, /llm-history-item__title-input/);
  assert.match(chat, /finishEditing\(true\)/);
  assert.match(chat, /finishEditing\(false\)/);
  assert.doesNotMatch(chat, /window\.prompt/);
  assert.match(chat, /fa-regular fa-copy/);
  assert.match(background, /inputTokens: result\.usage\.inputTokens/);
  assert.match(html, /id="llmContextMeterBtn"/);
  assert.match(html, /id="llmContextRing"/);
  assert.match(html, /id="llmContextDialog"/);
  assert.match(html, /id="aiProviderTransportSelect"/);
  assert.match(html, /id="aiProviderOfficialLink"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.match(html, /id="aiProviderContextWindowInput"/);
  assert.match(html, /id="aiProviderContextWindowInput"[^>]*>[\s\S]*?<option value="128000">128K<\/option>/);
  assert.doesNotMatch(html, /<option value="(?:200000|256000|512000|1000000|2000000)">/);
  assert.match(html, /id="aiProviderContextWindowCustomInput"[^>]*type="text"/);
  assert.match(html, /id="aiProviderContextWindowResetBtn"/);
  assert.match(html, /id="aiProviderResetBtn"/);
  assert.match(providerSettings, /contextWindowFor\(currentProvider\)\.tokens/);
  assert.doesNotMatch(providerSettings, /usesProviderDefault/);
  assert.match(providerSettings, /contextWindowResetBtn\?\.addEventListener/);
  assert.match(providerSettings, /CONTEXT_WINDOW_OPTIONS/);
  assert.match(providerSettings, /PROVIDER_OFFICIAL_URLS/);
  assert.match(providerSettings, /platform\.openai\.com\/api-keys/);
  assert.match(providerSettings, /aistudio\.google\.com\/apikey/);
  assert.match(providerSettings, /providerOfficialURL\(currentProvider/);
  assert.match(providerSettings, /\[CHAT_SELECTION_KEY\]: chatSelection\(\)/);
  assert.match(providerSettings, /delete nextSettings\[currentProvider\]/);
  assert.match(providerSettings, /resetBtn\?\.addEventListener/);
  assert.match(chat, /const MODEL_SELECTION_KEYS = \[\s*CHAT_SELECTION_KEY/);
  assert.match(chat, /const persistedActiveSessionId = sessions\.some/);
  assert.match(chat, /if \(!history\.length\) \{\s*sessions = sessions\.filter/);
  assert.doesNotMatch(chat, /sessions = \[\.\.\.sessions, next\];\s*activeSessionId = next\.id;\s*history = \[\]/);
  assert.match(chat, /buildConversationContext/);
  assert.match(chat, /--context-progress/);
  assert.match(chat, /compactBeforeRun/);
  assert.match(background, /COMPACT_WOS_CONTEXT/);
  assert.match(pipeline, /Prior conversation context/);
  assert.match(providerClient, /usage\?\.input_tokens/);
  assert.match(css, /\.llm-chat-candidate-action \{[^}]*border: 0;/);
  assert.match(css, /\.llm-chat-candidate-tag \{[^}]*border:/);
  assert.match(css, /\.llm-chat-code \{[^}]*overflow-x:\s*auto[^}]*white-space:\s*pre/);
  assert.match(css, /\.llm-chat-code\.is-wrapped \{[^}]*white-space:\s*pre-wrap/);
  assert.match(css, /\.llm-context-ring \{[^}]*conic-gradient/);
  assert.match(css, /\.llm-composer-input \{[^}]*background:\s*#fafafa/);
  assert.match(css, /\.llm-composer-bar \{[^}]*flex-wrap:\s*nowrap[^}]*border-top:\s*0/);
  assert.match(css, /\.llm-model-picker \{[^}]*position:\s*static[^}]*flex:\s*0 1 auto/);
  assert.match(css, /\.llm-selected-model-label \{[^}]*max-width:\s*96px[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.llm-context-popover \{[^}]*right:\s*8px[^}]*width:\s*min\(300px, calc\(100vw - 16px\)\)[^}]*max-height:\s*calc\(100vh - 68px\)/);
  assert.match(css, /\.llm-context-popover-arrow::before \{[^}]*border-color:\s*var\(--border\) transparent transparent/);
  assert.match(html, /id="llmContextPopoverArrow" class="llm-context-popover-arrow"/);
  assert.match(chat, /const positionContextPopoverArrow = \(\) =>/);
  assert.match(chat, /arrowCenter - barRect\.left/);
  assert.match(css, /\.llm-model-menu \{[^}]*width:\s*max-content/);
  assert.match(css, /\.llm-model-menu \{[^}]*max-width:\s*min\(360px, calc\(100vw - 16px\)\)/);
  assert.match(css, /\.llm-model-menu \{[^}]*right:\s*8px[^}]*max-height:\s*min\(220px, calc\(100vh - 68px\)\)/);
  assert.match(css, /\.llm-context-meter-label \{ display:\s*none; \}/);
  assert.doesNotMatch(contentScript, /injectModule\('openaiChat'\)/);
  assert.match(contentScript, /action:\s*'sidepanel-llm'/);
});

test('provider official links follow the selected provider safely', () => {
  assert.equal(providerOfficialURL('openai'), 'https://platform.openai.com/api-keys');
  assert.equal(providerOfficialURL('deepseek'), 'https://platform.deepseek.com/api_keys');
  assert.equal(providerOfficialURL('ollama'), 'https://ollama.com/download');
  assert.equal(providerOfficialURL('compatible', 'https://example.com/v1'), 'https://example.com');
  assert.equal(providerOfficialURL('compatible', 'javascript:alert(1)'), '');
  assert.equal(providerOfficialURL('compatible', ''), '');
});

test('LLM query runner recognizes WOS tabs but ignores Chrome internal pages', () => {
  assert.equal(isWosTab({ id: 1, url: 'https://www.webofscience.com/wos/woscc/summary/abc' }), true);
  assert.equal(isWosTab({ id: 2, url: 'chrome://extensions/' }), false);
});

test('builds a WOS query URL without requiring an existing WOS tab', () => {
  const url = new URL(buildWosQueryUrl('TS=(platform governance)'));
  assert.equal(url.origin, 'https://www.webofscience.com');
  assert.equal(url.pathname, '/wos/woscc/general-summary');
  assert.deepEqual(JSON.parse(url.searchParams.get('queryJson')), [{ rowText: 'TS=(platform governance)' }]);
});

test('LLM prompt history navigates newest-first and clears after the newest prompt', () => {
  const history = [
    { prompt: 'older' },
    { prompt: 'newer' },
    { prompt: 'newer' }
  ];
  const newest = navigateLlmPromptHistory(history, -1, -1);
  const oldest = navigateLlmPromptHistory(history, newest.index, -1);
  const backToNewest = navigateLlmPromptHistory(history, oldest.index, 1);
  const blank = navigateLlmPromptHistory(history, backToNewest.index, 1);

  assert.deepEqual(newest, { index: 0, value: 'newer' });
  assert.deepEqual(oldest, { index: 1, value: 'older' });
  assert.deepEqual(backToNewest, { index: 0, value: 'newer' });
  assert.deepEqual(blank, { index: -1, value: '' });
});

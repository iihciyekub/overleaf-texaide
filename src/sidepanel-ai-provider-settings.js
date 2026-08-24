'use strict';

const {
  PROVIDER_PRESETS,
  presetFor,
  normalizeBaseURL,
  requestModels,
  requestCompletion
} = require('./ai-provider-client');
const {
  CHAT_SELECTION_KEY,
  STORAGE_KEYS,
  settingsForProvider,
  loadProviderConfig,
  saveProviderSettings
} = require('./wos-query-provider-settings');
const { contextWindowFor, MAX_CONTEXT_WINDOW_TOKENS } = require('./llm-context-manager');
const { message } = require('./i18n');

const statusClasses = ['status--success', 'status--error', 'status--info', 'status--muted'];
const TRANSPORT_LABEL_KEYS = Object.freeze({
  responses: 'llm.transport.responses',
  chatCompletions: 'llm.transport.chatCompletions',
  anthropicMessages: 'llm.transport.anthropicMessages',
  geminiGenerateContent: 'llm.transport.geminiGenerateContent'
});
const CONTEXT_WINDOW_OPTIONS = Object.freeze([
  4096, 8192, 16384, 32768, 64000, 128000
]);
const PROVIDER_OFFICIAL_URLS = Object.freeze({
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://platform.claude.com/settings/keys',
  gemini: 'https://aistudio.google.com/apikey',
  openrouter: 'https://openrouter.ai/settings/keys',
  deepseek: 'https://platform.deepseek.com/api_keys',
  siliconflow: 'https://cloud.siliconflow.cn/account/ak',
  groq: 'https://console.groq.com/keys',
  mistral: 'https://console.mistral.ai/api-keys/',
  azureOpenAI: 'https://portal.azure.com/',
  ollama: 'https://ollama.com/download',
  lmstudio: 'https://lmstudio.ai/download'
});

const transportsForProvider = provider => {
  if (provider === 'anthropic') return ['anthropicMessages'];
  if (provider === 'gemini') return ['geminiGenerateContent'];
  if (provider === 'azureOpenAI') return ['chatCompletions'];
  if (['openai', 'compatible', 'ollama', 'lmstudio'].includes(provider)) {
    return ['responses', 'chatCompletions'];
  }
  return ['chatCompletions'];
};

const providerOfficialURL = (provider, baseURL = '') => {
  if (PROVIDER_OFFICIAL_URLS[provider]) return PROVIDER_OFFICIAL_URLS[provider];
  if (provider !== 'compatible') return '';
  try {
    const parsed = new URL(baseURL);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : '';
  } catch (_error) {
    return '';
  }
};

function setHint(element, message, variant = 'status--muted') {
  if (!element) return;
  element.textContent = message;
  element.classList.remove(...statusClasses);
  element.classList.add(variant);
}

function initializeAiProviderSettings() {
  const elements = {
    panel: document.getElementById('openaiSettingsPanel'),
    select: document.getElementById('aiProviderSelect'),
    officialLink: document.getElementById('aiProviderOfficialLink'),
    hint: document.getElementById('aiProviderHint'),
    pricing: document.getElementById('aiProviderPricing'),
    baseUrlRow: document.getElementById('aiProviderBaseUrlRow'),
    baseUrl: document.getElementById('aiProviderBaseUrlInput'),
    apiVersionRow: document.getElementById('aiProviderApiVersionRow'),
    apiVersion: document.getElementById('aiProviderApiVersionInput'),
    apiKeyRow: document.getElementById('aiProviderApiKeyRow'),
    apiKey: document.getElementById('aiProviderApiKeyInput'),
    apiKeyToggle: document.getElementById('aiProviderApiKeyToggle'),
    transport: document.getElementById('aiProviderTransportSelect'),
    contextWindow: document.getElementById('aiProviderContextWindowInput'),
    contextWindowCustom: document.getElementById('aiProviderContextWindowCustomInput'),
    contextWindowResetBtn: document.getElementById('aiProviderContextWindowResetBtn'),
    model: document.getElementById('aiProviderModelInput'),
    modelSearchCount: document.getElementById('aiProviderModelSearchCount'),
    modelSearchResults: document.getElementById('aiProviderModelSearchResults'),
    refreshModelsBtn: document.getElementById('aiProviderRefreshModelsBtn'),
    modelSelectRow: document.getElementById('aiProviderModelSelectRow'),
    modelSelect: document.getElementById('aiProviderModelSelect'),
    removeModelBtn: document.getElementById('aiProviderRemoveModelBtn'),
    clearModelsBtn: document.getElementById('aiProviderClearModelsBtn'),
    structuredOutputRow: document.getElementById('aiProviderStructuredOutputRow'),
    structuredOutput: document.getElementById('aiProviderStructuredOutput'),
    resetBtn: document.getElementById('aiProviderResetBtn'),
    saveBtn: document.getElementById('aiProviderSaveBtn'),
    testBtn: document.getElementById('aiProviderTestBtn'),
    configHint: document.getElementById('aiProviderConfigHint')
  };

  if (!elements.panel || !elements.select) return;

  let currentProvider = 'openai';
  let allSettings = {};
  let providerModels = [];
  let availableModels = [];
  let currentModel = '';
  let modelsCleared = false;
  let modelLoadSignature = '';
  let modelLoadState = 'idle';
  let modelSearchTimer = null;
  let modelLoadRequest = null;
  let modelLoadGeneration = 0;
  let modelSearchDismissed = false;
  let candidateModelTest = null;
  let currentTransport = '';
  let modelContextWindows = {};

  const currentLanguage = () => document.documentElement?.lang === 'zh-CN' ? 'zh' : 'en';
  const localized = (key, fallback) => message(currentLanguage(), key) || fallback;

  const getStorage = keys => new Promise(resolve => {
    chrome.storage.local.get(keys, result => resolve(result || {}));
  });

  const setStorage = values => new Promise(resolve => {
    chrome.storage.local.set(values, () => resolve());
  });

  const chatSelection = () => ({
    provider: currentProvider,
    model: String(currentModel || '').trim()
  });

  const normalizeModels = values => Array.from(new Set((values || [])
    .map(value => String(value || '').trim())
    .filter(Boolean)));

  const renderSavedModels = () => {
    elements.modelSelect.replaceChildren();
    providerModels.forEach(model => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      option.selected = model === currentModel;
      elements.modelSelect.appendChild(option);
    });
    elements.modelSelectRow.style.display = providerModels.length ? 'flex' : 'none';
    elements.removeModelBtn.disabled = !providerModels.length;
    if (elements.clearModelsBtn) elements.clearModelsBtn.disabled = !providerModels.length;
  };

  const renderTransportOptions = savedTransport => {
    if (!elements.transport) return;
    const preset = presetFor(currentProvider);
    const transports = transportsForProvider(currentProvider);
    const selected = transports.includes(savedTransport) ? savedTransport : preset.transport;
    elements.transport.replaceChildren();
    transports.forEach(transport => {
      const option = document.createElement('option');
      option.value = transport;
      option.textContent = localized(TRANSPORT_LABEL_KEYS[transport], transport);
      option.selected = transport === selected;
      elements.transport.appendChild(option);
    });
    currentTransport = elements.transport.value || selected;
  };

  const renderContextWindow = () => {
    if (!elements.contextWindow) return;
    const savedValue = currentModel
      ? Math.min(MAX_CONTEXT_WINDOW_TOKENS, Math.floor(Number(modelContextWindows[currentModel]) || 0))
      : 0;
    const value = savedValue || contextWindowFor(currentProvider).tokens;
    const isPreset = CONTEXT_WINDOW_OPTIONS.includes(value);
    elements.contextWindow.value = isPreset ? String(value) : 'custom';
    if (elements.contextWindowCustom) {
      elements.contextWindowCustom.hidden = isPreset;
      elements.contextWindowCustom.value = isPreset ? '' : String(value);
    }
  };

  const normalizedContextWindow = () => {
    const source = elements.contextWindow?.value === 'custom'
      ? elements.contextWindowCustom?.value
      : elements.contextWindow?.value;
    const parsed = Math.floor(Number(String(source || '').replace(/[^0-9]/g, '')));
    if (!Number.isFinite(parsed) || parsed < 4096) return contextWindowFor(currentProvider).tokens;
    return Math.min(MAX_CONTEXT_WINDOW_TOKENS, parsed);
  };

  const renderProviderOfficialLink = () => {
    if (!elements.officialLink) return;
    const preset = presetFor(currentProvider);
    const url = providerOfficialURL(currentProvider, elements.baseUrl?.value);
    const enabled = Boolean(url);
    if (enabled) elements.officialLink.href = url;
    else elements.officialLink.removeAttribute('href');
    elements.officialLink.classList.toggle('is-disabled', !enabled);
    elements.officialLink.setAttribute('aria-disabled', String(!enabled));
    elements.officialLink.tabIndex = enabled ? 0 : -1;
    const title = enabled
      ? localized('llm.providerOfficialLinkFor', `Open ${preset.name} official page`).replace('{provider}', preset.name)
      : localized('llm.providerOfficialLinkUnavailable', 'Enter a Base URL to open the provider site.');
    elements.officialLink.title = title;
    elements.officialLink.setAttribute('aria-label', title);
  };

  const renderModelSearchResults = () => {
    if (!elements.modelSearchResults) return;
    const candidate = elements.model?.value.trim() || '';
    const query = candidate.toLocaleLowerCase();
    elements.modelSearchResults.replaceChildren();
    elements.modelSearchResults.hidden = modelSearchDismissed;
    if (!availableModels.length) {
      if (elements.modelSearchCount && modelLoadState === 'idle') {
        elements.modelSearchCount.textContent = localized('llm.modelSearchReady', 'Enter a model name to search.');
      }
      if (candidate && ['empty', 'error'].includes(modelLoadState) && !providerModels.includes(candidate)) {
        appendManualModelCandidate(candidate);
      }
      return;
    }
    const matches = availableModels.filter(model => !query || model.toLocaleLowerCase().includes(query));
    if (elements.modelSearchCount) {
      elements.modelSearchCount.textContent = localized('llm.modelSearchCount', `${matches.length} of ${availableModels.length} models`).replace('{shown}', matches.length).replace('{total}', availableModels.length);
    }
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'ai-provider-model-search-empty';
      empty.textContent = localized('llm.modelSearchEmpty', 'No matching provider models.');
      elements.modelSearchResults.appendChild(empty);
    }
    matches.forEach(model => {
      const saved = providerModels.includes(model);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ai-provider-model-search-result';
      button.setAttribute('role', 'option');
      button.disabled = saved;
      const label = document.createElement('span');
      label.textContent = model;
      const state = document.createElement('small');
      state.textContent = saved
        ? localized('llm.modelAlreadyAdded', 'Added')
        : localized('llm.modelAddAction', 'Add');
      button.append(label, state);
      if (!saved) button.addEventListener('click', () => { void addProviderModel(model); });
      elements.modelSearchResults.appendChild(button);
    });
    const hasExactProviderModel = availableModels.some(model => model.toLocaleLowerCase() === query);
    if (candidate && !hasExactProviderModel && !providerModels.includes(candidate)) appendManualModelCandidate(candidate);
  };

  const appendManualModelCandidate = model => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-provider-model-search-result ai-provider-model-search-result--manual';
    button.setAttribute('role', 'option');
    button.disabled = candidateModelTest === model;
    const label = document.createElement('span');
    label.textContent = model;
    const state = document.createElement('small');
    state.textContent = candidateModelTest === model
      ? localized('llm.modelTesting', 'Testing...').replace('{model}', model)
      : localized('llm.modelTestAddAction', 'Test and add');
    button.append(label, state);
    button.addEventListener('click', () => { void testAndAddProviderModel(model); });
    elements.modelSearchResults.appendChild(button);
  };

  const buildConfig = () => loadProviderConfig({
    [STORAGE_KEYS.provider]: currentProvider,
    [STORAGE_KEYS.settings]: allSettings,
    [STORAGE_KEYS.openaiApiKey]: elements.apiKey?.value || '',
    [STORAGE_KEYS.openaiModel]: currentModel,
    [STORAGE_KEYS.lmStudioBaseUrl]: elements.baseUrl?.value || '',
    [STORAGE_KEYS.lmStudioModel]: currentModel,
    [STORAGE_KEYS.lmStudioApiKey]: elements.apiKey?.value || ''
  });

  const currentModelLoadSignature = () => [
    currentProvider,
    normalizeBaseURL(elements.baseUrl?.value),
    elements.apiVersion?.value.trim(),
    elements.apiKey?.value.trim()
  ].join('\n');

  const resetAvailableModels = ({ autoReload = true } = {}) => {
    modelLoadGeneration += 1;
    availableModels = [];
    modelLoadSignature = '';
    modelLoadState = 'idle';
    modelLoadRequest = null;
    if (modelSearchTimer) window.clearTimeout(modelSearchTimer);
    modelSearchTimer = null;
    renderModelSearchResults();
    if (autoReload && elements.model?.value.trim()) {
      modelSearchTimer = window.setTimeout(() => { void loadModels(); }, 500);
    }
  };

  const applyProviderUI = () => {
    const preset = presetFor(currentProvider);
    const saved = settingsForProvider(currentProvider, {
      [STORAGE_KEYS.settings]: allSettings
    });

    elements.baseUrl.value = saved.baseURL || preset.baseURL || '';
    elements.apiVersion.value = saved.apiVersion || preset.apiVersion || '';
    modelsCleared = Boolean(saved.modelsCleared);
    currentModel = modelsCleared ? '' : (saved.model || preset.model || '');
    providerModels = normalizeModels([...(saved.models || []), currentModel]);
    currentTransport = saved.transport || preset.transport;
    modelContextWindows = saved.modelContextWindows && typeof saved.modelContextWindows === 'object'
      ? { ...saved.modelContextWindows }
      : {};
    elements.model.value = '';
    elements.apiKey.value = saved.apiKey || '';
    elements.structuredOutput.value = saved.structuredOutput || preset.structuredOutput || 'jsonSchemaStrict';
    renderTransportOptions(currentTransport);
    renderContextWindow();
    renderProviderOfficialLink();

    elements.baseUrlRow.style.display = 'flex';
    elements.apiVersionRow.style.display = currentProvider === 'azureOpenAI' ? 'flex' : 'none';
    elements.apiKeyRow.style.display = preset.requiresApiKey ? 'flex' : 'none';
    resetAvailableModels();
    renderSavedModels();

    if (preset.requiresApiKey) {
      elements.apiKey.placeholder = 'API key';
    } else {
      elements.apiKey.placeholder = 'API key (optional)';
    }

    setHint(elements.hint, `${preset.name} selected. Model and endpoint must match the provider.`, 'status--info');
    if (elements.pricing) elements.pricing.hidden = currentProvider !== 'openai';
    setHint(elements.configHint, 'Save after changing settings.', 'status--muted');
  };

  const persistProvider = async () => {
    const nextProvider = elements.select.value || 'openai';
    currentProvider = nextProvider;
    await setStorage({ [STORAGE_KEYS.provider]: currentProvider });
    applyProviderUI();
    await setStorage({ [CHAT_SELECTION_KEY]: chatSelection() });
  };

  const resetCurrentProvider = async () => {
    const preset = presetFor(currentProvider);
    const confirmation = localized(
      'llm.resetProviderConfirm',
      'This clears the saved API key, models, endpoint, and other settings for the current provider. Continue?'
    );
    if (!window.confirm(confirmation)) return;

    const nextSettings = { ...allSettings };
    delete nextSettings[currentProvider];
    allSettings = nextSettings;
    applyProviderUI();

    const resetValues = {
      [STORAGE_KEYS.settings]: allSettings,
      [STORAGE_KEYS.provider]: currentProvider,
      [CHAT_SELECTION_KEY]: chatSelection()
    };
    if (currentProvider === 'openai') {
      resetValues[STORAGE_KEYS.openaiApiKey] = '';
      resetValues[STORAGE_KEYS.openaiModel] = preset.model || '';
    }
    if (currentProvider === 'lmstudio') {
      resetValues[STORAGE_KEYS.lmStudioBaseUrl] = preset.baseURL || '';
      resetValues[STORAGE_KEYS.lmStudioModel] = preset.model || '';
      resetValues[STORAGE_KEYS.lmStudioApiKey] = '';
    }
    await setStorage(resetValues);
    setHint(
      elements.configHint,
      localized('llm.resetProviderDone', 'The current provider was reset to its defaults.'),
      'status--success'
    );
  };

  const persistCurrentSettings = async () => {
    const contextWindow = normalizedContextWindow();
    if (currentModel) {
      modelContextWindows[currentModel] = contextWindow;
    }
    const values = {
      baseURL: normalizeBaseURL(elements.baseUrl.value),
      apiKey: elements.apiKey.value.trim(),
      model: currentModel || providerModels[0] || '',
      models: normalizeModels(providerModels),
      modelsCleared,
      apiVersion: elements.apiVersion.value.trim(),
      transport: elements.transport?.value || currentTransport || presetFor(currentProvider).transport,
      modelContextWindows: { ...modelContextWindows },
      structuredOutput: elements.structuredOutput.value
    };
    const settings = saveProviderSettings(
      { [STORAGE_KEYS.settings]: allSettings },
      currentProvider,
      values
    );
    allSettings = settings;
    providerModels = values.models;
    currentModel = values.model;
    currentTransport = values.transport;
    modelContextWindows = values.modelContextWindows;
    modelsCleared = Boolean(values.modelsCleared);
    renderContextWindow();
    const legacyValues = {};
    if (currentProvider === 'openai') {
      legacyValues[STORAGE_KEYS.openaiApiKey] = values.apiKey;
      legacyValues[STORAGE_KEYS.openaiModel] = values.model;
    }
    if (currentProvider === 'lmstudio') {
      legacyValues[STORAGE_KEYS.lmStudioBaseUrl] = values.baseURL;
      legacyValues[STORAGE_KEYS.lmStudioModel] = values.model;
      legacyValues[STORAGE_KEYS.lmStudioApiKey] = values.apiKey;
    }
    await setStorage({
      [STORAGE_KEYS.settings]: allSettings,
      [STORAGE_KEYS.provider]: currentProvider,
      [CHAT_SELECTION_KEY]: chatSelection(),
      ...legacyValues
    });
  };

  const populateAvailableModels = models => {
    availableModels = normalizeModels(models);
    renderModelSearchResults();
  };

  const loadModels = async ({ force = false } = {}) => {
    const signature = currentModelLoadSignature();
    if (!force && (modelLoadState === 'loaded' || modelLoadState === 'empty') && modelLoadSignature === signature) {
      renderModelSearchResults();
      return availableModels;
    }
    if (modelLoadRequest && modelLoadSignature === signature) return modelLoadRequest;
    const preset = presetFor(currentProvider);
    if (preset.requiresApiKey && !elements.apiKey.value.trim()) {
      modelLoadState = 'error';
      const status = localized('llm.modelsApiKeyError', 'API key is missing or invalid. Check the provider settings.');
      setHint(elements.modelSearchCount, status, 'status--error');
      setHint(elements.configHint, status, 'status--error');
      return [];
    }
    modelLoadSignature = signature;
    modelLoadState = 'loading';
    const generation = modelLoadGeneration;
    setHint(elements.configHint, localized('llm.modelsLoading', 'Loading provider models...'), 'status--info');
    setHint(elements.modelSearchCount, localized('llm.modelsLoading', 'Loading provider models...'), 'status--info');
    modelLoadRequest = (async () => {
      await persistCurrentSettings();
      try {
        let timeoutId;
        const timeout = new Promise((_, reject) => {
          timeoutId = window.setTimeout(() => reject(new TypeError('Network request timed out')), 15000);
        });
        const models = await Promise.race([requestModels(buildConfig()), timeout])
          .finally(() => window.clearTimeout(timeoutId));
        if (generation !== modelLoadGeneration || signature !== currentModelLoadSignature()) return [];
        modelLoadState = models.length ? 'loaded' : 'empty';
        populateAvailableModels(models);
        const status = models.length
          ? localized('llm.modelsLoaded', `Loaded ${models.length} provider models.`).replace('{count}', models.length)
          : localized('llm.modelsEmpty', 'This provider returned no models.');
        setHint(elements.configHint, status, models.length ? 'status--success' : 'status--muted');
        if (!models.length) setHint(elements.modelSearchCount, status, 'status--muted');
        return models;
      } catch (error) {
        if (generation !== modelLoadGeneration || signature !== currentModelLoadSignature()) return [];
        modelLoadState = 'error';
        availableModels = [];
        renderModelSearchResults();
        const raw = String(error?.message || error || '');
        const isAuthError = /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid.{0,20}(api.?key|token)|api.?key.{0,20}(invalid|missing)/i.test(raw);
        const isNetworkError = error instanceof TypeError || /failed to fetch|network|load failed|internet|dns|cors|timeout|timed out/i.test(raw);
        const key = isAuthError ? 'llm.modelsApiKeyError' : 'llm.modelsNetworkError';
        const fallback = isAuthError
          ? 'API key is missing or invalid. Check the provider settings.'
          : 'Unable to reach the provider. Check your network or endpoint.';
        const status = localized(key, fallback);
        setHint(elements.modelSearchCount, status, 'status--error');
        setHint(elements.configHint, status, 'status--error');
        if (!isAuthError && !isNetworkError) console.warn('Provider model loading failed:', raw);
        return [];
      } finally {
        if (generation === modelLoadGeneration) modelLoadRequest = null;
      }
    })();
    return modelLoadRequest;
  };

  const testConnection = async () => {
    setHint(elements.configHint, 'Testing connection…', 'status--info');
    elements.testBtn.disabled = true;
    try {
      await persistCurrentSettings();
      await requestCompletion(buildConfig(), {
        schemaName: 'connection_probe',
        instructions: 'Return a minimal JSON object that confirms the connection.',
        input: 'Respond with {"ok":true}.',
        schema: '{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false}',
        maxOutputTokens: 32
      });
      setHint(elements.configHint, 'Connection succeeded.', 'status--success');
    } catch (error) {
      setHint(elements.configHint, error?.message || String(error), 'status--error');
    } finally {
      elements.testBtn.disabled = false;
    }
  };

  elements.select.addEventListener('change', async () => {
    await persistProvider();
  });

  elements.saveBtn.addEventListener('click', async () => {
    await persistCurrentSettings();
    setHint(elements.configHint, 'Provider settings saved.', 'status--success');
  });

  elements.testBtn.addEventListener('click', () => { void testConnection(); });
  elements.resetBtn?.addEventListener('click', () => { void resetCurrentProvider(); });

  elements.apiKeyToggle.addEventListener('click', () => {
    const isHidden = elements.apiKey.type === 'password';
    elements.apiKey.type = isHidden ? 'text' : 'password';
    const icon = elements.apiKeyToggle.querySelector('i');
    if (icon) {
      icon.className = isHidden ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
    }
  });

  const addProviderModel = async value => {
    const model = String(value || '').trim();
    if (!model) {
      setHint(elements.configHint, localized('llm.modelRequired', 'Enter a model identifier first.'), 'status--error');
      return false;
    }
    if (providerModels.includes(model)) {
      setHint(elements.configHint, localized('llm.modelDuplicate', `Model already added: ${model}`).replace('{model}', model), 'status--info');
      return false;
    }
    providerModels = normalizeModels([...providerModels, model]);
    modelsCleared = false;
    currentModel = model;
    renderContextWindow();
    elements.model.value = '';
    renderSavedModels();
    renderModelSearchResults();
    await persistCurrentSettings();
    setHint(elements.configHint, localized('llm.modelAdded', `Added model: ${model}`).replace('{model}', model), 'status--success');
    return true;
  };

  const testAndAddProviderModel = async value => {
    const model = String(value || '').trim();
    if (!model || candidateModelTest) return false;
    const preset = presetFor(currentProvider);
    if (preset.requiresApiKey && !elements.apiKey.value.trim()) {
      setHint(elements.configHint, localized('llm.modelsApiKeyError', 'API key is missing or invalid. Check the provider settings.'), 'status--error');
      return false;
    }
    candidateModelTest = model;
    renderModelSearchResults();
    setHint(elements.configHint, localized('llm.modelTesting', `Testing model ${model}...`).replace('{model}', model), 'status--info');
    try {
      await persistCurrentSettings();
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new TypeError('Network request timed out')), 15000);
      });
      await Promise.race([
        requestCompletion({ ...buildConfig(), model, structuredOutput: 'promptOnly' }, {
          schemaName: 'model_probe',
          instructions: 'Reply with the single word OK.',
          input: 'OK',
          schema: '{"type":"string"}',
          maxOutputTokens: 8
        }),
        timeout
      ]).finally(() => window.clearTimeout(timeoutId));
      candidateModelTest = null;
      return addProviderModel(model);
    } catch (error) {
      candidateModelTest = null;
      renderModelSearchResults();
      const detail = String(error?.message || error || 'Unknown error');
      const isAuthError = /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid.{0,20}(api.?key|token)|api.?key.{0,20}(invalid|missing)/i.test(detail);
      const isNetworkError = error instanceof TypeError || /failed to fetch|network|load failed|internet|dns|cors|timeout|timed out/i.test(detail);
      const status = isAuthError
        ? localized('llm.modelsApiKeyError', 'API key is missing or invalid. Check the provider settings.')
        : isNetworkError
          ? localized('llm.modelsNetworkError', 'Unable to reach the provider. Check your network or endpoint.')
          : localized('llm.modelTestFailed', `Model test failed: ${detail}`).replace('{error}', detail);
      setHint(elements.configHint, status, 'status--error');
      return false;
    }
  };

  elements.model.addEventListener('input', () => {
    modelSearchDismissed = false;
    renderModelSearchResults();
    if (modelSearchTimer) window.clearTimeout(modelSearchTimer);
    const query = elements.model.value.trim();
    if (!query) {
      if (!availableModels.length) setHint(elements.modelSearchCount, localized('llm.modelSearchReady', 'Enter a model name to search.'), 'status--muted');
      return;
    }
    const signature = currentModelLoadSignature();
    if (availableModels.length && modelLoadSignature === signature) return;
    setHint(elements.modelSearchCount, localized('llm.modelSearchWaiting', 'Preparing search...'), 'status--info');
    modelSearchTimer = window.setTimeout(() => { void loadModels(); }, 500);
  });

  elements.model.addEventListener('focus', () => {
    if (!elements.model.value.trim()) return;
    modelSearchDismissed = false;
    renderModelSearchResults();
  });

  elements.model.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    modelSearchDismissed = true;
    elements.modelSearchResults.hidden = true;
  });

  elements.refreshModelsBtn?.addEventListener('click', async () => {
    modelSearchDismissed = false;
    elements.refreshModelsBtn.disabled = true;
    elements.refreshModelsBtn.querySelector('i')?.classList.add('fa-spin');
    resetAvailableModels({ autoReload: false });
    try {
      await loadModels({ force: true });
    } finally {
      elements.refreshModelsBtn.disabled = false;
      elements.refreshModelsBtn.querySelector('i')?.classList.remove('fa-spin');
    }
  });

  document.addEventListener('click', event => {
    if (event.target.closest('.ai-provider-model-search')) return;
    modelSearchDismissed = true;
    if (elements.modelSearchResults) elements.modelSearchResults.hidden = true;
  });

  [elements.baseUrl, elements.apiVersion, elements.apiKey].forEach(input => {
    input?.addEventListener('input', resetAvailableModels);
  });

  elements.removeModelBtn.addEventListener('click', async () => {
    const model = elements.modelSelect.value;
    if (!model) return;
    providerModels = providerModels.filter(item => item !== model);
    currentModel = providerModels[0] || '';
    elements.model.value = '';
    renderSavedModels();
    renderModelSearchResults();
    await persistCurrentSettings();
    setHint(elements.configHint, `Removed model: ${model}`, 'status--muted');
  });

  elements.modelSelect.addEventListener('change', () => {
    const model = elements.modelSelect.value.trim();
    if (!model) return;
    currentModel = model;
    renderContextWindow();
    void persistCurrentSettings().then(() => {
      setHint(elements.configHint, `Selected model: ${model}`, 'status--success');
    });
  });

  elements.clearModelsBtn?.addEventListener('click', async () => {
    if (!providerModels.length && !currentModel) return;
    providerModels = [];
    currentModel = '';
    modelsCleared = true;
    renderSavedModels();
    await persistCurrentSettings();
    setHint(elements.configHint, localized('llm.modelsCleared', 'All configured models cleared.'), 'status--success');
  });

  [elements.baseUrl, elements.apiVersion, elements.contextWindowCustom].forEach(input => {
    if (!input) return;
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void persistCurrentSettings().then(() => {
          setHint(elements.configHint, 'Provider settings saved.', 'status--success');
        });
      }
    });
  });

  elements.baseUrl?.addEventListener('input', () => {
    if (currentProvider === 'compatible') renderProviderOfficialLink();
  });

  document.addEventListener('wos-aide:language-changed', () => renderProviderOfficialLink());

  elements.structuredOutput.addEventListener('change', () => {
    setHint(elements.configHint, 'Structured output changed. Save to apply.', 'status--info');
  });

  elements.transport?.addEventListener('change', () => {
    currentTransport = elements.transport.value;
    setHint(elements.configHint, localized('llm.transportChanged', 'API mode changed. Save to apply.'), 'status--info');
  });

  elements.contextWindow?.addEventListener('change', () => {
    const custom = elements.contextWindow.value === 'custom';
    if (elements.contextWindowCustom) {
      elements.contextWindowCustom.hidden = !custom;
      if (custom) {
        elements.contextWindowCustom.value = '';
        elements.contextWindowCustom.focus();
      }
    }
    setHint(elements.configHint, localized('llm.contextWindowChanged', 'Context window changed. Save to apply.'), 'status--info');
  });

  elements.contextWindowCustom?.addEventListener('input', () => {
    const digits = elements.contextWindowCustom.value.replace(/[^0-9]/g, '');
    if (digits !== elements.contextWindowCustom.value) elements.contextWindowCustom.value = digits;
    setHint(elements.configHint, localized('llm.contextWindowChanged', 'Context window changed. Save to apply.'), 'status--info');
  });

  elements.contextWindowResetBtn?.addEventListener('click', async () => {
    const defaultValue = contextWindowFor(currentProvider).tokens;
    elements.contextWindow.value = CONTEXT_WINDOW_OPTIONS.includes(defaultValue) ? String(defaultValue) : 'custom';
    if (elements.contextWindowCustom) {
      elements.contextWindowCustom.hidden = CONTEXT_WINDOW_OPTIONS.includes(defaultValue);
      elements.contextWindowCustom.value = CONTEXT_WINDOW_OPTIONS.includes(defaultValue) ? '' : String(defaultValue);
    }
    await persistCurrentSettings();
    setHint(elements.configHint, localized('llm.contextWindowResetDone', 'Context window reset to the provider default.'), 'status--success');
  });

  getStorage([
    STORAGE_KEYS.provider,
    STORAGE_KEYS.settings,
    STORAGE_KEYS.openaiApiKey,
    STORAGE_KEYS.openaiModel,
    STORAGE_KEYS.lmStudioBaseUrl,
    STORAGE_KEYS.lmStudioModel,
    STORAGE_KEYS.lmStudioApiKey
  ]).then(storage => {
    currentProvider = storage[STORAGE_KEYS.provider] || 'openai';
    if (!PROVIDER_PRESETS[currentProvider]) {
      currentProvider = 'openai';
    }
    allSettings = storage[STORAGE_KEYS.settings] || {};
    elements.select.value = currentProvider;

    const saved = settingsForProvider(currentProvider, storage);
    elements.baseUrl.value = saved.baseURL || presetFor(currentProvider).baseURL || '';
    elements.apiVersion.value = saved.apiVersion || presetFor(currentProvider).apiVersion || '';
    modelsCleared = Boolean(saved.modelsCleared);
    currentModel = modelsCleared ? '' : (saved.model || presetFor(currentProvider).model || '');
    currentTransport = saved.transport || presetFor(currentProvider).transport;
    modelContextWindows = saved.modelContextWindows && typeof saved.modelContextWindows === 'object'
      ? { ...saved.modelContextWindows }
      : {};
    elements.model.value = '';
    elements.apiKey.value = saved.apiKey || '';
    elements.structuredOutput.value = saved.structuredOutput || presetFor(currentProvider).structuredOutput || 'jsonSchemaStrict';
    applyProviderUI();
  });
}

module.exports = {
  initializeAiProviderSettings,
  PROVIDER_OFFICIAL_URLS,
  providerOfficialURL
};

'use strict';

const { PROVIDER_PRESETS, presetFor, normalizeBaseURL } = require('./ai-provider-client');

const CHAT_SELECTION_KEY = 'wosLlmChatSelection';
const STORAGE_KEYS = {
  provider: 'wosQueryProvider',
  settings: 'wosAiProviderSettings',
  openaiApiKey: 'wosOpenaiApiKey',
  openaiModel: 'wosOpenaiChatModel',
  lmStudioBaseUrl: 'wosLmStudioBaseUrl',
  lmStudioModel: 'wosLmStudioModel',
  lmStudioApiKey: 'wosLmStudioApiKey'
};

function emptySettings() {
  return {
    baseURL: '',
    model: '',
    models: [],
    modelsCleared: false,
    apiKey: '',
    apiVersion: '',
    transport: '',
    modelContextWindows: {},
    customHeaders: {}
  };
}

function settingsForProvider(providerId, storage) {
  const preset = presetFor(providerId);
  const allSettings = storage?.[STORAGE_KEYS.settings] || {};
  const saved = allSettings[providerId] || {};
  const settings = {
    ...emptySettings(),
    ...preset,
    ...saved
  };

  if (providerId === 'openai') {
    settings.baseURL = saved.baseURL || preset.baseURL;
    settings.model = saved.model || storage?.[STORAGE_KEYS.openaiModel] || preset.model;
    settings.apiKey = saved.apiKey || storage?.[STORAGE_KEYS.openaiApiKey] || '';
  }

  if (providerId === 'lmstudio') {
    settings.baseURL = saved.baseURL || storage?.[STORAGE_KEYS.lmStudioBaseUrl] || preset.baseURL;
    settings.model = saved.model || storage?.[STORAGE_KEYS.lmStudioModel] || preset.model;
    settings.apiKey = saved.apiKey || storage?.[STORAGE_KEYS.lmStudioApiKey] || '';
  }

  settings.models = Array.from(new Set([
    ...(Array.isArray(saved.models) ? saved.models : []),
    ...(saved.modelsCleared ? [] : [settings.model])
  ].map(value => String(value || '').trim()).filter(Boolean)));
  if (saved.modelsCleared) settings.model = '';

  return settings;
}

function loadProviderConfig(storage, providerOverride) {
  const provider = String(providerOverride || storage?.[STORAGE_KEYS.provider] || 'openai').trim();
  const preset = presetFor(provider);
  const saved = settingsForProvider(provider, storage);

  return {
    id: provider,
    presetId: provider,
    name: preset.name,
    kind: saved.kind || preset.kind,
    transport: saved.transport || preset.transport,
    structuredOutput: saved.structuredOutput || preset.structuredOutput,
    baseURL: normalizeBaseURL(saved.baseURL || preset.baseURL),
    model: String(saved.model || preset.model || '').trim(),
    contextWindow: Number(saved.modelContextWindows?.[saved.model || preset.model] || 0) || 0,
    apiKey: String(saved.apiKey || '').trim(),
    requiresApiKey: Boolean(saved.requiresApiKey !== undefined ? saved.requiresApiKey : preset.requiresApiKey),
    apiVersion: String(saved.apiVersion || preset.apiVersion || '').trim(),
    customHeaders: saved.customHeaders || {}
  };
}

function saveProviderSettings(storage, providerId, values) {
  const current = storage?.[STORAGE_KEYS.settings] || {};
  const previous = current[providerId] || {};
  const preset = presetFor(providerId);
  const next = {
    ...emptySettings(),
    ...preset,
    ...previous,
    ...(values || {})
  };
  return {
    ...current,
    [providerId]: next
  };
}

module.exports = {
  CHAT_SELECTION_KEY,
  STORAGE_KEYS,
  emptySettings,
  settingsForProvider,
  loadProviderConfig,
  saveProviderSettings
};

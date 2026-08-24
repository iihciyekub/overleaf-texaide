'use strict';

const { isWosLocation } = require('./wos-host');
const { PROVIDER_PRESETS } = require('./ai-provider-client');
const { CHAT_SELECTION_KEY, settingsForProvider } = require('./wos-query-provider-settings');
const { message, LANG_STORAGE_KEY } = require('./i18n');
const { translationInstructions, INTENT_SCHEMA } = require('./wos-query-prompts');
const {
  contextWindowFor,
  buildConversationContext,
  measureContext,
  formatTokenAmount
} = require('./llm-context-manager');
const {
  CHAT_STATE_KEY,
  CHAT_STATE_VERSION,
  sessionTitle: storedSessionTitle,
  createSession,
  normalizeSessions,
  sessionHasContent,
  pruneSessions,
  migrateChatState
} = require('./llm-session-store');

const HISTORY_KEY = 'wosAideLlmChatHistory';
const SESSIONS_KEY = 'wosAideLlmChatSessions';
const MAX_HISTORY_ITEMS = 100;
const CONTEXT_FIXED_PROMPT = `${translationInstructions('English')}\n${JSON.stringify(INTENT_SCHEMA)}`;
const MODEL_SELECTION_KEYS = [
  CHAT_SELECTION_KEY,
  'wosQueryProvider',
  'wosAiProviderSettings',
  'wosOpenaiApiKey',
  'wosOpenaiChatModel',
  'wosLmStudioBaseUrl',
  'wosLmStudioModel',
  'wosLmStudioApiKey'
];
const LLM_PROGRESS_STAGES = Object.freeze({
  compacting: { step: 0, key: 'llm.progress.compacting' },
  translating: { step: 1, key: 'llm.progress.translating' },
  composing: { step: 2, key: 'llm.progress.composing' },
  validating: { step: 3, key: 'llm.progress.validating' },
  completed: { step: 3, key: 'llm.progress.validating' }
});

const navigateLlmPromptHistory = (items, currentIndex, direction) => {
  const seen = new Set();
  const prompts = (Array.isArray(items) ? items : [])
    .slice()
    .reverse()
    .map(item => String(item?.prompt || '').trim())
    .filter(prompt => {
      if (!prompt || seen.has(prompt)) return false;
      seen.add(prompt);
      return true;
    });
  if (!prompts.length) return { index: -1, value: '' };
  if (direction < 0) {
    const index = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, prompts.length - 1);
    return { index, value: prompts[index] };
  }
  const index = currentIndex > 0 ? currentIndex - 1 : -1;
  return { index, value: index >= 0 ? prompts[index] : '' };
};

const queryActiveTab = () => new Promise(resolve => {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0] || null));
});

const isWosTab = tab => {
  try {
    const url = new URL(tab?.url || '');
    return Boolean(tab?.id && isWosLocation(url.hostname, url.href));
  } catch (_error) {
    return false;
  }
};

const buildWosQueryUrl = rowText => {
  const query = String(rowText || '').trim();
  if (!query) throw new Error('The WOS query is empty.');
  const queryJson = encodeURIComponent(JSON.stringify([{ rowText: query }]));
  return `https://www.webofscience.com/wos/woscc/general-summary?queryJson=${queryJson}`;
};

const sendRuntimeMessage = message => new Promise((resolve, reject) => {
  chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else if (!response?.success) {
      const error = new Error(response?.error || 'Request failed.');
      if (response?.cancelled) error.name = 'AbortError';
      reject(error);
    }
    else resolve(response);
  });
});

const executeWosQuery = (tabId, rowText) => new Promise((resolve, reject) => {
  chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async query => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (window.wos && typeof window.wos.query === 'function') {
          await window.wos.query(query);
          return true;
        }
        await new Promise(done => setTimeout(done, 100));
      }
      throw new Error('WOS page API is not ready. Reload the WOS page and try again.');
    },
    args: [rowText]
  }, results => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else resolve(Boolean(results?.[0]?.result));
  });
});

function initializeLlmSidePanelChat() {
  const elements = {
    messages: document.getElementById('llmChatMessages'),
    input: document.getElementById('llmChatInput'),
    sendBtn: document.getElementById('sendLlmChatBtn'),
    clearBtn: document.getElementById('clearLlmChatBtn'),
    status: document.getElementById('llmChatStatus'),
    parentTab: document.getElementById('tabLlm'),
    chatSubTab: document.getElementById('llmChatSubTab'),
    settingsSubTab: document.getElementById('llmSettingsSubTab'),
    historySubTab: document.getElementById('llmHistorySubTab'),
    chatSubPanel: document.getElementById('llmChatSubPanel'),
    settingsSubPanel: document.getElementById('llmSettingsSubPanel'),
    historySubPanel: document.getElementById('llmHistorySubPanel'),
    historyList: document.getElementById('llmHistoryList'),
    historyEmpty: document.getElementById('llmHistoryEmpty'),
    modelPickerBtn: document.getElementById('llmModelPickerBtn'),
    modelMenu: document.getElementById('llmModelMenu'),
    selectedModelLabel: document.getElementById('llmSelectedModelLabel'),
    contextMeterBtn: document.getElementById('llmContextMeterBtn'),
    contextRing: document.getElementById('llmContextRing'),
    contextMeterLabel: document.getElementById('llmContextMeterLabel'),
    contextPopover: document.getElementById('llmContextPopover'),
    contextPopoverArrow: document.getElementById('llmContextPopoverArrow'),
    contextPopoverUsage: document.getElementById('llmContextPopoverUsage'),
    contextPopoverHint: document.getElementById('llmContextPopoverHint'),
    contextPopoverProgress: document.getElementById('llmContextPopoverProgress'),
    contextPopoverProgressIcon: document.getElementById('llmContextPopoverProgressIcon'),
    contextPopoverProgressText: document.getElementById('llmContextPopoverProgressText'),
    contextPopoverProgressElapsed: document.getElementById('llmContextPopoverProgressElapsed'),
    compactContextBtn: document.getElementById('llmCompactContextBtn'),
    contextDialog: document.getElementById('llmContextDialog'),
    contextDialogMessage: document.getElementById('llmContextDialogMessage')
  };
  if (!elements.messages || !elements.input || !elements.sendBtn) return;

  let history = [];
  let sessions = [];
  let activeSessionId = '';
  let sending = false;
  let activeRequest = null;
  let conversationElapsedTimer = null;
  let modelOptions = [];
  let selectedModel = null;
  let currentLanguage = 'zh';
  let statusTimer = null;
  let statusElapsedTimer = null;
  let statusStartedAt = 0;
  let contextPopoverProgressTimer = null;
  let contextPopoverProgressElapsedTimer = null;
  let contextPopoverProgressStartedAt = 0;
  let promptHistoryIndex = -1;
  let latestContextMeasurement = null;

  const translate = key => message(currentLanguage, key);

  const hideContextPopoverProgress = () => {
    window.clearTimeout(contextPopoverProgressTimer);
    window.clearInterval(contextPopoverProgressElapsedTimer);
    contextPopoverProgressTimer = null;
    contextPopoverProgressElapsedTimer = null;
    if (!elements.contextPopoverProgress) return;
    elements.contextPopoverProgress.hidden = true;
    elements.contextPopoverProgress.className = 'llm-context-popover-progress';
    if (elements.contextPopoverProgressText) elements.contextPopoverProgressText.textContent = '';
    if (elements.contextPopoverProgressElapsed) elements.contextPopoverProgressElapsed.textContent = '';
  };

  const showContextPopoverProgress = (text, variant = 'muted', options = {}) => {
    if (!elements.contextPopoverProgress) return;
    const messageText = String(text || '').trim();
    window.clearTimeout(contextPopoverProgressTimer);
    window.clearInterval(contextPopoverProgressElapsedTimer);
    contextPopoverProgressTimer = null;
    contextPopoverProgressElapsedTimer = null;
    if (!messageText) {
      hideContextPopoverProgress();
      return;
    }
    if (elements.contextPopover) elements.contextPopover.hidden = false;
    elements.contextMeterBtn?.setAttribute('aria-expanded', 'true');
    positionContextPopoverArrow();
    elements.contextPopoverProgress.hidden = false;
    elements.contextPopoverProgress.className = `llm-context-popover-progress status--${variant}`;
    if (elements.contextPopoverProgressText) elements.contextPopoverProgressText.textContent = messageText;
    const spinner = Boolean(options.spinner);
    if (elements.contextPopoverProgressIcon) {
      elements.contextPopoverProgressIcon.className = spinner
        ? 'fa-solid fa-circle-notch fa-spin'
        : variant === 'error'
          ? 'fa-solid fa-triangle-exclamation'
          : 'fa-solid fa-circle-check';
      elements.contextPopoverProgressIcon.setAttribute('aria-hidden', 'true');
    }
    if (options.elapsed) {
      contextPopoverProgressStartedAt = Date.now();
      const updateElapsed = () => {
        const seconds = Math.max(0, Math.floor((Date.now() - contextPopoverProgressStartedAt) / 1000));
        if (elements.contextPopoverProgressElapsed) elements.contextPopoverProgressElapsed.textContent = elapsedText(seconds);
      };
      updateElapsed();
      contextPopoverProgressElapsedTimer = window.setInterval(updateElapsed, 1000);
    }
    const autoHideMs = Number(options.autoHideMs) || 0;
    if (autoHideMs > 0) {
      contextPopoverProgressTimer = window.setTimeout(hideContextPopoverProgress, autoHideMs);
    }
  };

  const applyLanguageTexts = () => {
    if (elements.selectedModelLabel) {
      elements.selectedModelLabel.textContent = selectedModel?.model || translate('llm.noModel');
      elements.selectedModelLabel.title = selectedModel?.label || translate('llm.noModelConfigured');
    }
    renderModelMenu();
    renderHistory();
    renderSessionHistory();
    updateSendAvailability();
    updateContextMeter();
  };

  const hideStatus = () => {
    if (!elements.status) return;
    window.clearTimeout(statusTimer);
    window.clearInterval(statusElapsedTimer);
    statusTimer = null;
    statusElapsedTimer = null;
    elements.status.hidden = true;
    elements.status.replaceChildren();
  };

  const setStatus = (message, variant = 'muted', options = {}) => {
    if (!elements.status) return;
    const text = String(message || '').trim();
    const spinner = Boolean(options.spinner);
    const elapsed = Boolean(options.elapsed);
    const autoHideMs = Number(options.autoHideMs) || 0;
    window.clearTimeout(statusTimer);
    window.clearInterval(statusElapsedTimer);
    statusTimer = null;
    statusElapsedTimer = null;

    if (!text) {
      hideStatus();
      return;
    }

    elements.status.hidden = false;
    elements.status.className = `llm-chat-status-inline status--${variant}`;
    elements.status.replaceChildren();

    if (spinner) {
      const icon = document.createElement('i');
      icon.className = 'fa-solid fa-circle-notch fa-spin';
      icon.setAttribute('aria-hidden', 'true');
      elements.status.appendChild(icon);
    }

    const label = document.createElement('span');
    label.className = 'llm-chat-status-text';
    label.textContent = text;
    elements.status.appendChild(label);

    if (elapsed) {
      statusStartedAt = Date.now();
      const updateElapsed = () => {
        const seconds = Math.max(0, Math.floor((Date.now() - statusStartedAt) / 1000));
        label.textContent = `${text} ${seconds}s`;
      };
      updateElapsed();
      statusElapsedTimer = window.setInterval(updateElapsed, 1000);
    }

    if (autoHideMs > 0) {
      statusTimer = window.setTimeout(() => hideStatus(), autoHideMs);
    }
  };

  const retainHistoryLimit = items => {
    const favorites = items.filter(item => item.favorite);
    const unstarred = items.filter(item => !item.favorite).slice(-Math.max(0, MAX_HISTORY_ITEMS - favorites.length));
    return [...favorites, ...unstarred];
  };

  const activeSession = () => sessions.find(session => session.id === activeSessionId) || null;

  const persistChatState = () => {
    sessions = pruneSessions(normalizeSessions(sessions, translate('llm.new')));
    const persistedActiveSessionId = sessions.some(session => session.id === activeSessionId)
      ? activeSessionId
      : '';
    chrome.storage.local.set({
      [CHAT_STATE_KEY]: { version: CHAT_STATE_VERSION, activeSessionId: persistedActiveSessionId, sessions },
      [HISTORY_KEY]: persistedActiveSessionId ? history : [],
      [SESSIONS_KEY]: sessions.filter(session => session.id !== persistedActiveSessionId)
    });
  };

  const syncActiveSession = ({ touch = true } = {}) => {
    history = retainHistoryLimit(history);
    if (!history.length) {
      sessions = sessions.filter(session => session.id !== activeSessionId);
      return;
    }
    const now = new Date().toISOString();
    const current = activeSession() || createSession({ id: activeSessionId, fallbackTitle: translate('llm.new') });
    const firstMessage = !current.messages?.length;
    const next = {
      ...current,
      title: firstMessage ? storedSessionTitle(history, translate('llm.new')) : current.title,
      updatedAt: touch ? now : current.updatedAt,
      lastModel: selectedModel ? { provider: selectedModel.provider, model: selectedModel.model } : current.lastModel,
      messages: history.map(item => ({ ...item, sessionId: activeSessionId }))
    };
    sessions = sessions.some(session => session.id === activeSessionId)
      ? sessions.map(session => session.id === activeSessionId ? next : session)
      : [...sessions, next];
  };

  const persistHistory = () => {
    syncActiveSession();
    persistChatState();
    updateContextMeter();
  };

  const persistSessions = () => {
    persistChatState();
  };

  const createAndActivateSession = () => {
    if (activeSessionId) {
      syncActiveSession();
      if (!history.length) {
        history = [];
        persistChatState();
        renderHistory();
        renderSessionHistory();
        updateContextMeter();
        return null;
      }
    }
    const next = createSession({ fallbackTitle: translate('llm.new') });
    activeSessionId = next.id;
    history = [];
    persistChatState();
    renderHistory();
    renderSessionHistory();
    updateContextMeter();
    return next;
  };

  const updateSessionMemory = memory => {
    sessions = sessions.map(session => session.id === activeSessionId
      ? { ...session, memory: { ...(session.memory || {}), ...memory }, updatedAt: new Date().toISOString() }
      : session);
    persistChatState();
  };

  const getStorage = keys => new Promise(resolve => {
    chrome.storage.local.get(keys, result => resolve(result || {}));
  });

  const setStorage = values => new Promise(resolve => {
    chrome.storage.local.set(values, () => resolve());
  });

  const updateSendAvailability = () => {
    if (!elements.sendBtn) return;
    const stopping = Boolean(sending && activeRequest);
    const action = translate(stopping ? 'llm.stop' : 'llm.send');
    elements.sendBtn.disabled = stopping ? false : !selectedModel;
    elements.sendBtn.classList.toggle('is-stopping', stopping);
    elements.sendBtn.title = action;
    elements.sendBtn.setAttribute('aria-label', action);
    const icon = document.createElement('i');
    icon.className = `fa-solid fa-${stopping ? 'stop' : 'paper-plane'}`;
    icon.setAttribute('aria-hidden', 'true');
    elements.sendBtn.replaceChildren(icon);
  };

  const buildModelOptions = async () => {
    const storage = await getStorage([...MODEL_SELECTION_KEYS, CHAT_SELECTION_KEY]);
    const savedSelection = storage[CHAT_SELECTION_KEY] || {};
    const preferredProvider = String(storage.wosQueryProvider || 'openai').trim();
    const options = [];

    const providerId = preferredProvider;
    const preset = PROVIDER_PRESETS[providerId] || PROVIDER_PRESETS.openai;
    {
      const saved = settingsForProvider(providerId, storage);
      const models = Array.from(new Set([
        ...(Array.isArray(saved.models) ? saved.models : []),
        saved.model || preset.model
      ].map(value => String(value || '').trim()).filter(Boolean)));
      const baseURL = String(saved.baseURL || '').trim();
      const requiresApiKey = saved.requiresApiKey !== false;
      const apiKey = String(saved.apiKey || '').trim();
      if (models.length && baseURL && (!requiresApiKey || apiKey)) models.forEach(model => {
        const contextWindow = contextWindowFor(providerId, saved.modelContextWindows?.[model]);
        options.push({
          provider: providerId,
          model,
          transport: saved.transport || preset.transport,
          contextWindow: contextWindow.tokens,
          contextWindowEstimated: contextWindow.estimated,
          label: `${preset.name} · ${model}`
        });
      });
    }

    const matches = (provider, model) => options.some(option => (
      option.provider === provider && option.model === model
    ));
    let selectedOption = null;
    if (matches(savedSelection.provider, savedSelection.model)) {
      selectedOption = options.find(option => (
        option.provider === savedSelection.provider && option.model === savedSelection.model
      )) || null;
    } else {
      selectedOption = options[0] || null;
    }

    return { options, selectedOption };
  };

  const closeModelMenu = () => {
    if (!elements.modelMenu) return;
    elements.modelMenu.hidden = true;
    elements.modelPickerBtn?.setAttribute('aria-expanded', 'false');
  };

  const positionContextPopoverArrow = () => {
    if (!elements.contextPopover || elements.contextPopover.hidden || !elements.contextPopoverArrow || !elements.contextRing) return;
    const bar = elements.contextPopover.closest('.llm-composer-bar');
    if (!bar) return;
    const barRect = bar.getBoundingClientRect();
    const popoverRect = elements.contextPopover.getBoundingClientRect();
    const ringRect = elements.contextRing.getBoundingClientRect();
    const ringCenter = ringRect.left + ringRect.width / 2;
    const arrowCenter = Math.min(popoverRect.right - 18, Math.max(popoverRect.left + 18, ringCenter));
    elements.contextPopoverArrow.style.left = `${arrowCenter - barRect.left}px`;
  };

  const renderModelMenu = () => {
    if (!elements.modelMenu) return;
    elements.modelMenu.replaceChildren();

    if (!modelOptions.length) {
      const empty = document.createElement('div');
      empty.className = 'llm-model-menu-empty';
      empty.textContent = translate('llm.noModelConfigured');
      elements.modelMenu.appendChild(empty);
      return;
    }

    modelOptions.forEach(option => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'llm-model-menu-item';
      item.textContent = option.label;
      if (selectedModel?.provider === option.provider && selectedModel?.model === option.model) {
        item.classList.add('is-selected');
      }
      item.addEventListener('click', () => {
        void selectModel(option);
      });
      elements.modelMenu.appendChild(item);
    });
  };

  const selectModel = async option => {
    selectedModel = option;
    if (elements.selectedModelLabel) {
      elements.selectedModelLabel.textContent = option.model;
      elements.selectedModelLabel.title = option.label;
    }
    await setStorage({
      [CHAT_SELECTION_KEY]: {
        provider: option.provider,
        model: option.model
      }
    });
    renderModelMenu();
    closeModelMenu();
    updateSendAvailability();
    updateContextMeter();
  };

  const populateModelPicker = async () => {
    const next = await buildModelOptions();
    modelOptions = next.options;
    selectedModel = next.selectedOption;
    if (elements.selectedModelLabel) {
      elements.selectedModelLabel.textContent = selectedModel?.model || translate('llm.noModel');
      elements.selectedModelLabel.title = selectedModel?.label || translate('llm.noModelConfigured');
    }
    renderModelMenu();
    updateSendAvailability();
    updateContextMeter();
  };

  const currentConversationContext = () => {
    const memory = activeSession()?.memory || {};
    return {
      ...buildConversationContext(history, memory),
      coveredRequestIds: Array.isArray(memory.coveredRequestIds) ? memory.coveredRequestIds : []
    };
  };

  const updateContextMeter = promptOverride => {
    if (!elements.contextMeterBtn || !elements.contextMeterLabel) return null;
    if (!selectedModel) {
      elements.contextMeterLabel.textContent = '--';
      elements.contextRing?.style.setProperty('--context-progress', '0%');
      elements.contextMeterBtn.disabled = true;
      return null;
    }
    elements.contextMeterBtn.disabled = false;
    const contextWindow = selectedModel?.contextWindow || contextWindowFor(selectedModel?.provider || 'compatible').tokens;
    const measurement = measureContext({
      context: currentConversationContext(),
      currentPrompt: promptOverride === undefined ? elements.input.value : promptOverride,
      fixedPrompt: CONTEXT_FIXED_PROMPT,
      contextWindow,
      maximumOutputTokens: 3000
    });
    latestContextMeasurement = measurement;
    const prefix = '~';
    const label = `${prefix}${formatTokenAmount(measurement.inputTokens)}/${formatTokenAmount(contextWindow)}`;
    elements.contextMeterLabel.textContent = label;
    const contextProgress = Math.min(100, Math.max(0, measurement.inputTokens / contextWindow * 100));
    elements.contextRing?.style.setProperty('--context-progress', `${contextProgress.toFixed(1)}%`);
    elements.contextMeterBtn.classList.remove('is-warning', 'is-decision', 'is-hard');
    if (measurement.level !== 'normal') elements.contextMeterBtn.classList.add(`is-${measurement.level}`);
    elements.contextMeterBtn.title = `${translate('llm.contextUsage')}: ${label}`;
    if (elements.contextPopoverUsage) {
      elements.contextPopoverUsage.textContent = `${formatTokenAmount(measurement.inputTokens)} / ${formatTokenAmount(measurement.usableTokens)}`;
    }
    if (elements.contextPopoverHint) {
      elements.contextPopoverHint.textContent = translate(selectedModel?.contextWindowEstimated ? 'llm.contextEstimate' : 'llm.contextExact');
    }
    if (elements.compactContextBtn) {
      elements.compactContextBtn.disabled = !currentConversationContext().olderTurns.length || sending;
    }
    return measurement;
  };

  const requestContextAction = measurement => {
    if (!elements.contextDialog) return Promise.resolve('cancel');
    const percent = Math.max(0, Math.round(measurement.ratio * 100));
    elements.contextDialogMessage.textContent = translate('llm.contextLimitMessage')
      .replace('{used}', formatTokenAmount(measurement.inputTokens))
      .replace('{limit}', formatTokenAmount(measurement.usableTokens))
      .replace('{percent}', String(percent));
    const compactButton = elements.contextDialog.querySelector('[value="compact"]');
    if (compactButton) compactButton.disabled = !currentConversationContext().olderTurns.length;
    elements.contextDialog.returnValue = 'cancel';
    elements.contextDialog.showModal();
    return new Promise(resolve => {
      elements.contextDialog.addEventListener('close', () => resolve(elements.contextDialog.returnValue || 'cancel'), { once: true });
    });
  };

  const setLlmSubPanel = panelId => {
    const isChat = panelId === 'llmChatSubPanel';
    const isHistory = panelId === 'llmHistorySubPanel';
    [elements.chatSubTab, elements.settingsSubTab, elements.historySubTab].forEach(button => {
      if (!button) return;
      const active = button === (isChat ? elements.chatSubTab : isHistory ? elements.historySubTab : elements.settingsSubTab);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    if (elements.chatSubPanel) elements.chatSubPanel.hidden = !isChat;
    if (elements.settingsSubPanel) elements.settingsSubPanel.hidden = isChat || isHistory;
    if (elements.historySubPanel) elements.historySubPanel.hidden = !isHistory;
    if (isChat) void populateModelPicker();
    if (isHistory) renderSessionHistory();
    chrome.storage.local.set({ wosAideLlmSubTab: isChat ? 'llmChatSubPanel' : isHistory ? 'llmHistorySubPanel' : 'llmSettingsSubPanel' });
  };

  const renderSessionHistory = () => {
    if (!elements.historyList || !elements.historyEmpty) return;
    const historySessions = sessions.filter(sessionHasContent);
    elements.historyList.replaceChildren();
    elements.historyEmpty.hidden = historySessions.length > 0;
    historySessions.slice().sort((a, b) => (
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
      || Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0)
    )).forEach(item => {
      const row = document.createElement('div');
      row.className = `llm-history-item${item.id === activeSessionId ? ' is-active' : ''}`;
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'llm-history-item__restore';
      restore.title = item.title;
      const title = document.createElement('strong');
      title.textContent = item.title;
      const meta = document.createElement('span');
      meta.textContent = `${item.messages?.length || 0} · ${new Date(item.updatedAt || item.createdAt).toLocaleString()}`;
      restore.append(title, meta);
      restore.addEventListener('click', () => {
        if (item.id === activeSessionId) {
          setLlmSubPanel('llmChatSubPanel');
          return;
        }
        syncActiveSession();
        activeSessionId = item.id;
        history = Array.isArray(item.messages) ? item.messages.map(messageItem => ({ ...messageItem })) : [];
        persistChatState();
        renderHistory();
        renderSessionHistory();
        updateContextMeter();
        setLlmSubPanel('llmChatSubPanel');
      });
      const actions = document.createElement('div');
      actions.className = 'llm-history-item__actions';
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'icon-button';
      pin.title = translate(item.pinned ? 'llm.unpin' : 'llm.pin');
      pin.setAttribute('aria-label', pin.title);
      pin.innerHTML = `<i class="fa-solid fa-${item.pinned ? 'thumbtack' : 'map-pin'}" aria-hidden="true"></i>`;
      pin.addEventListener('click', event => {
        event.stopPropagation();
        sessions = sessions.map(session => session.id === item.id
          ? { ...session, pinned: !session.pinned, updatedAt: new Date().toISOString() }
          : session);
        persistSessions();
        renderSessionHistory();
      });
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'icon-button llm-history-item__rename';
      rename.title = translate('llm.rename');
      rename.setAttribute('aria-label', rename.title);
      rename.innerHTML = '<i class="fa-solid fa-pen" aria-hidden="true"></i>';
      rename.addEventListener('click', event => {
        event.stopPropagation();
        const editor = document.createElement('div');
        editor.className = 'llm-history-item__editor';
        const input = document.createElement('input');
        input.className = 'llm-history-item__title-input';
        input.type = 'text';
        input.value = item.title;
        input.maxLength = 120;
        input.setAttribute('aria-label', translate('llm.renamePrompt'));
        const editorMeta = meta.cloneNode(true);
        editor.append(input, editorMeta);
        restore.replaceWith(editor);
        rename.disabled = true;

        let finished = false;
        const finishEditing = save => {
          if (finished) return;
          finished = true;
          const nextTitle = input.value.trim();
          if (save && nextTitle) {
            sessions = sessions.map(session => session.id === item.id
              ? { ...session, title: nextTitle, updatedAt: new Date().toISOString() }
              : session);
            persistSessions();
          }
          renderSessionHistory();
        };
        input.addEventListener('click', inputEvent => inputEvent.stopPropagation());
        input.addEventListener('blur', () => finishEditing(true));
        input.addEventListener('keydown', inputEvent => {
          inputEvent.stopPropagation();
          if (inputEvent.key === 'Enter') {
            inputEvent.preventDefault();
            finishEditing(true);
          } else if (inputEvent.key === 'Escape') {
            inputEvent.preventDefault();
            finishEditing(false);
          }
        });
        input.focus();
        input.select();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-button';
      remove.title = translate('llm.deleteConversation');
      remove.setAttribute('aria-label', remove.title);
      remove.innerHTML = '<i class="fa-solid fa-trash-can" aria-hidden="true"></i>';
      remove.addEventListener('click', event => {
        event.stopPropagation();
        if (!window.confirm(translate('llm.deleteConversation'))) return;
        const deletingActive = item.id === activeSessionId;
        sessions = sessions.filter(session => session.id !== item.id);
        if (deletingActive) {
          const next = sessions.slice().sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0))[0]
            || createSession({ fallbackTitle: translate('llm.new') });
          activeSessionId = next.id;
          history = (next.messages || []).map(messageItem => ({ ...messageItem }));
          renderHistory();
        }
        persistChatState();
        renderSessionHistory();
        updateContextMeter();
      });
      actions.append(pin, rename, remove);
      row.append(restore, actions);
      elements.historyList.appendChild(row);
    });
  };

  const elapsedSecondsFor = item => {
    if (Number.isFinite(Number(item?.elapsedSeconds))) return Math.max(0, Number(item.elapsedSeconds));
    const startedAt = Date.parse(item?.startedAt || item?.createdAt || '');
    return Number.isFinite(startedAt) ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
  };

  const elapsedText = seconds => translate('llm.elapsed').replace('{seconds}', String(seconds));

  const copyText = async text => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Clipboard access was denied.');
  };

  const renderHistory = () => {
    elements.messages.replaceChildren();
    if (!history.length) {
      elements.messages.hidden = true;
      return;
    }

    elements.messages.hidden = false;
    history.forEach(item => {
      const userRow = document.createElement('div');
      userRow.className = 'llm-chat-row llm-chat-row--user';

      const userContent = document.createElement('div');
      userContent.className = 'llm-chat-row__content';
      const userBubble = document.createElement('div');
      userBubble.className = 'llm-chat-bubble llm-chat-bubble--user';
      userBubble.textContent = item.prompt;
      userContent.append(userBubble);

      const userAvatar = document.createElement('div');
      userAvatar.className = 'llm-chat-avatar llm-chat-avatar--user';
      userAvatar.innerHTML = '<i class="fa-regular fa-user" aria-hidden="true"></i>';
      userRow.append(userContent, userAvatar);
      elements.messages.append(userRow);

      const responseState = item.state || 'completed';
      if (responseState !== 'completed') {
        const assistantRow = document.createElement('div');
        assistantRow.className = 'llm-chat-row llm-chat-row--assistant';
        const assistantAvatar = document.createElement('div');
        assistantAvatar.className = 'llm-chat-avatar llm-chat-avatar--assistant';
        assistantAvatar.innerHTML = '<i class="fa-solid fa-robot" aria-hidden="true"></i>';
        const assistantContent = document.createElement('div');
        assistantContent.className = 'llm-chat-row__content';
        const progress = document.createElement('div');
        progress.className = `llm-chat-progress llm-chat-progress--${responseState}`;
        progress.setAttribute('role', 'status');
        const icon = document.createElement('i');
        icon.className = responseState === 'thinking'
          ? 'fa-solid fa-circle-notch fa-spin'
          : responseState === 'cancelled'
            ? 'fa-regular fa-circle-stop'
            : 'fa-solid fa-triangle-exclamation';
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = responseState === 'thinking'
          ? translate(LLM_PROGRESS_STAGES[item.progressStage]?.key || 'llm.thinking')
          : responseState === 'cancelled'
            ? translate(item.cancelledByUser ? 'llm.cancelledByUser' : 'llm.interrupted')
            : `${translate('llm.failed')}: ${item.errorMessage || translate('llm.unknownError')}`;
        const elapsed = document.createElement('time');
        elapsed.className = 'llm-chat-progress__elapsed';
        elapsed.textContent = elapsedText(elapsedSecondsFor(item));
        if (responseState === 'thinking' && item.requestId) elapsed.dataset.llmElapsed = item.requestId;
        progress.append(icon, label, elapsed);
        if (responseState === 'thinking') {
          const stage = LLM_PROGRESS_STAGES[item.progressStage];
          const details = document.createElement('small');
          details.className = 'llm-chat-progress__details';
          const detailsParts = [];
          if (stage) {
            detailsParts.push(translate('llm.progress.step')
              .replace('{step}', String(stage.step)).replace('{total}', '3'));
          }
          detailsParts.push(translate('llm.progress.rounds')
            .replace('{completed}', String(Number(item.completedModelCalls || 0))).replace('{total}', '3'));
          details.textContent = detailsParts.join(' · ');
          progress.appendChild(details);
        }
        assistantContent.appendChild(progress);
        assistantRow.append(assistantAvatar, assistantContent);
        elements.messages.appendChild(assistantRow);
        return;
      }

      const candidates = Array.isArray(item.candidates) && item.candidates.length
        ? item.candidates
        : [{ id: 'default', label: 'WOS query', query: item.rowText }].filter(candidate => candidate.query);

      candidates.forEach(candidate => {
        const assistantRow = document.createElement('div');
        assistantRow.className = 'llm-chat-row llm-chat-row--assistant';

        const assistantAvatar = document.createElement('div');
        assistantAvatar.className = 'llm-chat-avatar llm-chat-avatar--assistant';
        assistantAvatar.innerHTML = '<i class="fa-solid fa-robot" aria-hidden="true"></i>';

        const assistantContent = document.createElement('div');
        assistantContent.className = 'llm-chat-row__content';

        const code = document.createElement('code');
        code.className = 'llm-chat-code';
        code.textContent = candidate.query;

        const runButton = document.createElement('button');
        runButton.type = 'button';
        runButton.className = 'llm-chat-candidate-action';
        runButton.title = translate('llm.runQuery');
        runButton.setAttribute('aria-label', runButton.title);
        const runIcon = document.createElement('i');
        runIcon.className = 'fa-solid fa-play';
        runIcon.setAttribute('aria-hidden', 'true');
        const runLabel = document.createElement('span');
        runLabel.textContent = translate('llm.runAction');
        runButton.append(runIcon, runLabel);
        runButton.addEventListener('click', async () => {
          runButton.disabled = true;
          try {
            updateRequestHistory(item.requestId, { selectedCandidateId: candidate.id || '' });
            await runQuery(candidate.query);
          } catch (error) {
            setStatus(error?.message || String(error), 'error', { autoHideMs: 2400 });
          } finally {
            runButton.disabled = false;
          }
        });

        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.className = 'llm-chat-candidate-action';
        copyButton.title = translate('llm.copyQuery');
        copyButton.setAttribute('aria-label', copyButton.title);
        const copyIcon = document.createElement('i');
        copyIcon.className = 'fa-regular fa-copy';
        copyIcon.setAttribute('aria-hidden', 'true');
        const copyLabel = document.createElement('span');
        copyLabel.textContent = translate('llm.copyAction');
        copyButton.append(copyIcon, copyLabel);
        copyButton.addEventListener('click', async () => {
          try {
            await copyText(candidate.query);
            setStatus(translate('llm.queryCopied'), 'success', { autoHideMs: 1200 });
          } catch (error) {
            setStatus(error?.message || String(error), 'error', { autoHideMs: 2400 });
          }
        });

        const wrapButton = document.createElement('button');
        wrapButton.type = 'button';
        wrapButton.className = 'llm-chat-candidate-action llm-chat-wrap-toggle';
        const updateWrapButton = wrapped => {
          const title = translate(wrapped ? 'llm.unwrapQuery' : 'llm.wrapQuery');
          wrapButton.title = title;
          wrapButton.setAttribute('aria-label', title);
          wrapButton.setAttribute('aria-pressed', String(wrapped));
          wrapButton.innerHTML = `<i class="fa-solid ${wrapped ? 'fa-text-slash' : 'fa-text-width'}" aria-hidden="true"></i>`;
        };
        updateWrapButton(false);
        wrapButton.addEventListener('click', () => {
          const wrapped = code.classList.toggle('is-wrapped');
          updateWrapButton(wrapped);
        });

        const actions = document.createElement('div');
        actions.className = 'llm-chat-candidate-actions';
        actions.append(runButton, copyButton, wrapButton);
        const candidateTag = document.createElement('span');
        candidateTag.className = 'llm-chat-candidate-tag';
        candidateTag.textContent = String(candidate.label || 'WOS query').trim();
        candidateTag.title = candidateTag.textContent;
        actions.appendChild(candidateTag);
        assistantContent.append(code, actions);
        assistantRow.append(assistantAvatar, assistantContent);
        elements.messages.append(assistantRow);
      });
    });
    elements.messages.scrollTop = elements.messages.scrollHeight;
  };

  const runQuery = async rowText => {
    const url = buildWosQueryUrl(rowText);
    await new Promise((resolve, reject) => {
      chrome.tabs.create({ url, active: true }, tab => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(tab);
      });
    });
    setStatus(translate('llm.generated'), 'success', { autoHideMs: 1200 });
    return true;
  };

  const stopConversationElapsedTimer = () => {
    window.clearInterval(conversationElapsedTimer);
    conversationElapsedTimer = null;
  };

  const updateConversationElapsed = () => {
    if (!activeRequest) return;
    const elapsed = Math.max(0, Math.floor((Date.now() - activeRequest.startedAt) / 1000));
    const timer = elements.messages.querySelector(`[data-llm-elapsed="${activeRequest.id}"]`);
    if (timer) timer.textContent = elapsedText(elapsed);
  };

  const updateRequestHistory = (requestId, patch) => {
    history = history.map(item => item.requestId === requestId ? { ...item, ...patch } : item);
    persistHistory();
    renderHistory();
  };

  const finishActiveRequest = context => {
    if (activeRequest !== context) return;
    stopConversationElapsedTimer();
    activeRequest = null;
    sending = false;
    updateSendAvailability();
    updateContextMeter();
    elements.input.focus();
  };

  const cancelActiveRequest = () => {
    const context = activeRequest;
    if (!context) return;
    context.cancelled = true;
    void sendRuntimeMessage({ type: 'CANCEL_WOS_QUERY', requestId: context.id }).catch(() => {});
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - context.startedAt) / 1000));
    if (context.kind === 'compact') {
      showContextPopoverProgress(translate('llm.cancelledByUser'), 'cancelled', { autoHideMs: 1800 });
    } else {
      updateRequestHistory(context.id, {
        state: 'cancelled',
        cancelledByUser: true,
        elapsedSeconds,
        finishedAt: new Date().toISOString()
      });
    }
    finishActiveRequest(context);
  };

  const compactCurrentContext = async () => {
    if (sending || !selectedModel) return false;
    const conversationContext = currentConversationContext();
    if (!conversationContext.olderTurns.length) {
      showContextPopoverProgress(translate('llm.nothingToCompact'), 'muted', { autoHideMs: 1800 });
      return false;
    }
    const requestId = `llm-compact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const context = { id: requestId, startedAt: Date.now(), cancelled: false, kind: 'compact' };
    activeRequest = context;
    sending = true;
    elements.compactContextBtn?.setAttribute('aria-busy', 'true');
    updateSendAvailability();
    updateContextMeter();
    hideStatus();
    showContextPopoverProgress(translate('llm.compacting'), 'muted', { spinner: true, elapsed: true });
    try {
      const response = await sendRuntimeMessage({
        type: 'COMPACT_WOS_CONTEXT',
        requestId,
        sessionId: activeSessionId,
        provider: selectedModel.provider,
        model: selectedModel.model,
        conversationContext
      });
      if (context.cancelled) return false;
      updateSessionMemory({
        summary: response.summary || null,
        coveredRequestIds: response.coveredRequestIds || [],
        compactedAt: new Date().toISOString(),
        usedFallback: Boolean(response.usedFallback)
      });
      showContextPopoverProgress(translate('llm.compacted'), 'success', { autoHideMs: 1800 });
      updateContextMeter();
      return true;
    } catch (error) {
      if (!context.cancelled) {
        showContextPopoverProgress(error?.message || String(error), 'error', { autoHideMs: 2600 });
      }
      return false;
    } finally {
      elements.compactContextBtn?.removeAttribute('aria-busy');
      finishActiveRequest(context);
    }
  };

  const send = async () => {
    const prompt = elements.input.value.trim();
    if (!prompt || sending) return;
    if (!selectedModel) {
      setStatus(translate('llm.noModelConfigured'), 'error', { autoHideMs: 2400 });
      return;
    }
    let conversationContext = currentConversationContext();
    let compactBeforeRun = false;
    const measurement = updateContextMeter(prompt);
    if (measurement && ['decision', 'hard'].includes(measurement.level)) {
      const action = await requestContextAction(measurement);
      if (action === 'cancel') return;
      if (action === 'new') {
        createAndActivateSession();
        conversationContext = currentConversationContext();
        const freshMeasurement = updateContextMeter(prompt);
        if (freshMeasurement?.level === 'hard') {
          setStatus(translate('llm.contextLimitMessage')
            .replace('{used}', formatTokenAmount(freshMeasurement.inputTokens))
            .replace('{limit}', formatTokenAmount(freshMeasurement.usableTokens))
            .replace('{percent}', String(Math.round(freshMeasurement.ratio * 100))), 'error', { autoHideMs: 3000 });
          return;
        }
      } else if (action === 'compact') {
        compactBeforeRun = true;
      }
    }
    const requestId = `llm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    const context = { id: requestId, startedAt, cancelled: false };
    activeRequest = context;
    sending = true;
    hideStatus();
    history.push({
      requestId,
      sessionId: activeSessionId,
      prompt,
      rowText: '',
      candidates: [],
      state: 'thinking',
      startedAt: new Date(startedAt).toISOString(),
      createdAt: new Date(startedAt).toISOString(),
      provider: selectedModel.provider,
      model: selectedModel.model,
      transport: selectedModel.transport,
      favorite: false
    });
    persistHistory();
    renderHistory();
    elements.input.value = '';
    promptHistoryIndex = -1;
    resizeTextarea();
    updateSendAvailability();
    updateConversationElapsed();
    conversationElapsedTimer = window.setInterval(updateConversationElapsed, 1000);
    try {
      const response = await sendRuntimeMessage({
        type: 'GENERATE_WOS_QUERY',
        requestId,
        sessionId: activeSessionId,
        text: prompt,
        provider: selectedModel.provider,
        model: selectedModel.model,
        conversationContext,
        compactBeforeRun
      });
      if (context.cancelled) return;
      const rowText = String(response.rowText || '').trim();
      if (!rowText) throw new Error('The LLM returned an empty WOS query.');
      const candidates = Array.isArray(response.candidates)
        ? response.candidates.map(candidate => ({
            id: candidate.id || '',
            label: candidate.label || 'WOS query',
            query: String(candidate.query || '').trim(),
            review: String(candidate.review || '').trim()
          })).filter(candidate => candidate.query)
        : [];
      const elapsedMilliseconds = Math.max(0, Date.now() - startedAt);
      const elapsedSeconds = Math.floor(elapsedMilliseconds / 1000);
      if (response.compaction) {
        updateSessionMemory({
          summary: response.compaction.summary || null,
          coveredRequestIds: response.compaction.coveredRequestIds || [],
          compactedAt: new Date().toISOString(),
          usedFallback: Boolean(response.compaction.usedFallback)
        });
      }
      updateRequestHistory(requestId, {
        rowText,
        candidates,
        intent: response.intent || null,
        organizationResolutions: response.organizationResolutions || [],
        state: 'completed',
        usage: response.usage || null,
        elapsedMilliseconds,
        elapsedSeconds,
        finishedAt: new Date().toISOString()
      });
      finishActiveRequest(context);
    } catch (error) {
      if (context.cancelled) return;
      const cancelled = error?.name === 'AbortError';
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      updateRequestHistory(requestId, {
        state: cancelled ? 'cancelled' : 'error',
        cancelledByUser: false,
        errorMessage: cancelled ? '' : error?.message || String(error),
        elapsedSeconds,
        finishedAt: new Date().toISOString()
      });
    } finally {
      finishActiveRequest(context);
    }
  };

  elements.sendBtn.addEventListener('click', () => {
    if (sending) cancelActiveRequest();
    else void send();
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== 'WOS_QUERY_PROGRESS' || !activeRequest || message.requestId !== activeRequest.id) return;
    updateRequestHistory(message.requestId, {
      progressStage: message.stage || 'translating',
      completedModelCalls: Number(message.completedModelCalls || 0),
      modelAttempts: Number(message.modelAttempts || 0),
      progressUsage: message.usage || null,
      progressElapsedMilliseconds: Number(message.elapsedMilliseconds || 0)
    });
  });
  const handleModelPickerClick = () => {
    if (!selectedModel) {
      closeModelMenu();
      setLlmSubPanel('llmSettingsSubPanel');
      const modelInput = document.getElementById('aiProviderModelInput');
      window.setTimeout(() => {
        modelInput?.scrollIntoView({ block: 'center', inline: 'nearest' });
        modelInput?.focus();
      }, 0);
      return;
    }
    const willOpen = elements.modelMenu?.hidden;
    elements.modelMenu.hidden = !willOpen;
    elements.modelPickerBtn?.setAttribute('aria-expanded', String(Boolean(willOpen)));
    if (willOpen) renderModelMenu();
  };
  elements.modelPickerBtn?.addEventListener('click', handleModelPickerClick);
  elements.selectedModelLabel?.addEventListener('click', handleModelPickerClick);
  elements.contextMeterBtn?.addEventListener('click', () => {
    if (!elements.contextPopover) return;
    if (activeRequest?.kind === 'compact') {
      elements.contextPopover.hidden = false;
      elements.contextMeterBtn.setAttribute('aria-expanded', 'true');
      positionContextPopoverArrow();
      return;
    }
    const willOpen = elements.contextPopover.hidden;
    elements.contextPopover.hidden = !willOpen;
    elements.contextMeterBtn.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
      updateContextMeter();
      positionContextPopoverArrow();
    }
  });
  window.addEventListener('resize', positionContextPopoverArrow);
  elements.compactContextBtn?.addEventListener('click', () => {
    void compactCurrentContext();
  });
  document.addEventListener('click', event => {
    if (
      elements.modelPickerBtn
      && elements.modelMenu
      && !elements.modelPickerBtn.contains(event.target)
      && !elements.selectedModelLabel?.contains(event.target)
      && !elements.modelMenu.contains(event.target)
    ) {
      closeModelMenu();
      elements.modelPickerBtn.setAttribute('aria-expanded', 'false');
    }
    if (
      elements.contextPopover
      && !elements.contextMeterBtn?.contains(event.target)
      && !elements.contextPopover.contains(event.target)
      && activeRequest?.kind !== 'compact'
    ) {
      elements.contextPopover.hidden = true;
      elements.contextMeterBtn?.setAttribute('aria-expanded', 'false');
    }
  });
  const resizeTextarea = () => {
    const textarea = elements.input;
    textarea.rows = 3;
    while (textarea.scrollHeight > textarea.clientHeight && textarea.rows < 6) {
      textarea.rows += 1;
    }
  };
  elements.input.addEventListener('keydown', event => {
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.altKey && !event.shiftKey) {
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      const forced = event.ctrlKey || event.metaKey;
      const selectionCollapsed = elements.input.selectionStart === elements.input.selectionEnd;
      const beforeCaret = elements.input.value.slice(0, elements.input.selectionStart || 0);
      const afterCaret = elements.input.value.slice(elements.input.selectionStart || 0);
      const atBoundary = direction < 0 ? !beforeCaret.includes('\n') : !afterCaret.includes('\n');
      const browsingHistory = promptHistoryIndex >= 0;
      if (browsingHistory || forced || selectionCollapsed && atBoundary) {
        const navigation = navigateLlmPromptHistory(history, promptHistoryIndex, direction);
        if (navigation.index !== promptHistoryIndex || browsingHistory) {
          event.preventDefault();
          promptHistoryIndex = navigation.index;
          elements.input.value = navigation.value;
          elements.input.setSelectionRange(elements.input.value.length, elements.input.value.length);
          resizeTextarea();
          return;
        }
      }
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  });
  elements.input.addEventListener('input', () => {
    promptHistoryIndex = -1;
    resizeTextarea();
    updateContextMeter();
  });
  elements.clearBtn.addEventListener('click', () => {
    if (sending) cancelActiveRequest();
    createAndActivateSession();
    setStatus(translate('llm.new'), 'muted', { autoHideMs: 1200 });
  });

  elements.chatSubTab?.addEventListener('click', () => setLlmSubPanel('llmChatSubPanel'));
  elements.settingsSubTab?.addEventListener('click', () => setLlmSubPanel('llmSettingsSubPanel'));
  elements.historySubTab?.addEventListener('click', () => setLlmSubPanel('llmHistorySubPanel'));
  elements.parentTab?.addEventListener('click', () => setLlmSubPanel('llmChatSubPanel'));

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes[LANG_STORAGE_KEY]) {
      currentLanguage = changes[LANG_STORAGE_KEY].newValue === 'en' ? 'en' : 'zh';
      applyLanguageTexts();
    }
    const shouldRefresh = MODEL_SELECTION_KEYS.some(key => Object.prototype.hasOwnProperty.call(changes, key));
    if (shouldRefresh) void populateModelPicker();
  });

  document.addEventListener('wos-aide:language-changed', event => {
    currentLanguage = event.detail?.language === 'en' ? 'en' : 'zh';
    applyLanguageTexts();
  });

  window.addEventListener('pagehide', () => {
    if (activeRequest) {
      chrome.runtime.sendMessage({ type: 'CANCEL_WOS_QUERY', requestId: activeRequest.id }, () => void chrome.runtime.lastError);
    }
    stopConversationElapsedTimer();
  });

  chrome.storage.local.get([HISTORY_KEY, SESSIONS_KEY, CHAT_STATE_KEY], result => {
    const migrated = migrateChatState(
      result[CHAT_STATE_KEY],
      result[HISTORY_KEY],
      result[SESSIONS_KEY],
      translate('llm.new')
    );
    activeSessionId = migrated.activeSessionId || createSession({ fallbackTitle: translate('llm.new') }).id;
    sessions = migrated.sessions.map(session => ({
      ...session,
      messages: retainHistoryLimit((session.messages || []).map(item => {
          if (item?.state === 'thinking') {
            return {
              ...item,
              state: 'cancelled',
              cancelledByUser: false,
              elapsedSeconds: elapsedSecondsFor(item),
              finishedAt: new Date().toISOString(),
              favorite: Boolean(item.favorite)
            };
          }
          return { ...item, favorite: Boolean(item.favorite) };
        }))
    }));
    const current = activeSession();
    history = current ? current.messages.map(item => ({ ...item })) : [];
    // Always write the normalized state back so duplicate/legacy records are repaired once on restore.
    persistChatState();
    renderHistory();
    renderSessionHistory();
    updateContextMeter();
  });

  chrome.storage.local.get([LANG_STORAGE_KEY], result => {
    currentLanguage = result[LANG_STORAGE_KEY] === 'en' ? 'en' : 'zh';
    applyLanguageTexts();
  });

  chrome.storage.local.get(['wosAideLlmSubTab'], result => {
    setLlmSubPanel(result.wosAideLlmSubTab || 'llmChatSubPanel');
  });
}

module.exports = {
  initializeLlmSidePanelChat,
  isWosTab,
  buildWosQueryUrl,
  navigateLlmPromptHistory
};

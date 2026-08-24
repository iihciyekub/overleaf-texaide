'use strict';

const { resolveWosSidInMainWorld } = require('./wos-sid-main-world');
const { runWosQueryPipeline } = require('./wos-query-pipeline');
const { loadProviderConfig } = require('./wos-query-provider-settings');
const { compactConversationContext } = require('./wos-conversation-context');

const enableActionSidePanel = () => {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => {
    console.warn('[WOS Aide] Could not enable action side panel:', error);
  });
};

enableActionSidePanel();
chrome.runtime.onInstalled.addListener(enableActionSidePanel);
chrome.runtime.onStartup.addListener(enableActionSidePanel);

// With background scripts you can communicate with popup
// and contentScript files.
// For more information on background script,
// See https://developer.chrome.com/extensions/background_pages

// 存储已选择的目录句柄
let directoryHandle = null;
let fileCache = new Map();
let wosQueryPromptCache = null;
const activeWosQueryRequests = new Map();
const pendingWosQueryCancellations = new Set();

const CHAT_API_KEY_STORAGE_KEY = 'wosOpenaiApiKey';
const CHAT_MODEL_STORAGE_KEY = 'wosOpenaiChatModel';
const WOS_QUERY_PROVIDER_STORAGE_KEY = 'wosQueryProvider';
const LM_STUDIO_BASE_URL_STORAGE_KEY = 'wosLmStudioBaseUrl';
const LM_STUDIO_MODEL_STORAGE_KEY = 'wosLmStudioModel';
const LM_STUDIO_API_KEY_STORAGE_KEY = 'wosLmStudioApiKey';
const EASYSCHOLAR_API_KEY_STORAGE_KEY = 'wos-easyscholar-api-key';
const OPENAI_HOST_ORIGINS = ['https://api.openai.com/*'];
const EASYSCHOLAR_HOST_ORIGINS = ['https://www.easyscholar.cc/*'];
const LM_STUDIO_HOST_ORIGIN_MAP = {
  'http://127.0.0.1': 'http://127.0.0.1/*',
  'http://localhost': 'http://localhost/*'
};

const easyscholarMapping = {
  swufe: '西南财经大学',
  cqu: '重庆大学',
  sciif: 'SCI影响因子-JCR',
  cufe: '中央财经大学',
  nju: '南京大学',
  sci: 'SCI分区-JCR',
  uibe: '对外经济贸易大学',
  xju: '新疆大学',
  ssci: 'SSCI分区-JCR',
  sdufe: '山东财经大学',
  cug: '中国地质大学',
  jci: 'JCI指数-JCR',
  xdu: '西安电子科技大学',
  ccf: '中国计算机学会',
  sciif5: 'SCI五年影响因子-JCR',
  swjtu: '西南交通大学',
  cju: '长江大学（不是计量大学）',
  sciwarn: '中科院预警',
  ruc: '中国人民大学',
  zju: '浙江大学',
  sciBase: 'SCI基础版分区-中科院',
  xmu: '厦门大学',
  zhongguokejihexin: '中国科技核心期刊',
  sciUp: 'SCI升级版分区-中科院',
  sjtu: '上海交通大学',
  fms: 'FMS',
  ajg: 'ABS学术期刊指南',
  fdu: '复旦大学',
  utd24: 'UTD24',
  ft50: 'FT50',
  hhu: '河海大学',
  eii: 'EI检索',
  cscd: '中国科学引文数据库',
  pku: '北大核心',
  cssci: '南大核心',
  ahci: 'A&HCI',
  scu: '四川大学',
  sciUpSmall: '中科院升级版小类分区',
  esi: 'ESI学科分类',
  sciUpTop: '中科院升级版Top分区',
  cpu: '中国药科大学'
};

const getStorage = (keys) => new Promise((resolve) => {
  chrome.storage.local.get(keys, result => resolve(result || {}));
});

const containsOriginPermissions = (origins) => new Promise((resolve) => {
  if (!chrome.permissions?.contains || !Array.isArray(origins) || !origins.length) {
    resolve(false);
    return;
  }
  chrome.permissions.contains({ origins }, (granted) => {
    if (chrome.runtime.lastError) {
      resolve(false);
      return;
    }
    resolve(Boolean(granted));
  });
});

const getLmStudioPermissionOrigins = (baseUrl) => {
  try {
    const parsed = new URL((baseUrl || 'http://127.0.0.1:1234/v1').trim() || 'http://127.0.0.1:1234/v1');
    const normalizedOrigin = `${parsed.protocol}//${parsed.hostname}`.toLowerCase();
    const matchPattern = LM_STUDIO_HOST_ORIGIN_MAP[normalizedOrigin];
    return matchPattern ? [matchPattern] : [];
  } catch (_error) {
    return [];
  }
};

const normalizeOgAndOperators = (rowText) => String(rowText || '').replace(/OG=\(([^)]*)\)/gi, (_match, inner) => {
  const normalizedInner = inner
    .replace(/\band\b/gi, '&')
    .replace(/\s*&\s*/g, ' & ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return `OG=(${normalizedInner})`;
});

const extractJsonText = (rawText) => {
  const text = String(rawText || '').trim();
  if (!text) {
    return '';
  }
  const codeBlockMatch = text.match(/```(?:wosquery|json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch?.[1]) {
    return codeBlockMatch[1].trim();
  }
  const objectMatch = text.match(/\{[\s\S]*\}/);
  return objectMatch ? objectMatch[0].trim() : text;
};

const extractResponseText = (result) => {
  if (!result) return '';
  if (typeof result.output_text === 'string' && result.output_text) {
    return result.output_text;
  }
  if (Array.isArray(result.output_text)) {
    return result.output_text.filter(Boolean).join('');
  }
  const contentText = result.output?.[0]?.content?.[0]?.text;
  if (typeof contentText === 'string') {
    return contentText;
  }
  const contentBlocks = result.output?.[0]?.content;
  if (Array.isArray(contentBlocks)) {
    return contentBlocks
      .map(block => block?.text || block?.output_text || '')
      .filter(Boolean)
      .join('');
  }
  return '';
};

async function loadWosQueryPrompt() {
  if (wosQueryPromptCache) {
    return wosQueryPromptCache;
  }
  const response = await fetch(chrome.runtime.getURL('prompts/wos-query.md'));
  if (!response.ok) {
    throw new Error(`Failed to load prompt (${response.status})`);
  }
  wosQueryPromptCache = (await response.text()).trim();
  return wosQueryPromptCache;
}

async function buildOpenAIWosQueryPayload(text, model) {
  const basePrompt = await loadWosQueryPrompt();
  const systemPrompt = `${basePrompt}

Additional output rules:
1. Return JSON only. Do not return markdown, code fences, or explanation text.
2. The JSON shape must be {"wos_query":[{"rowText":"..."}]}.
3. If rowText contains an OG=(...) segment, replace the standalone word "and" inside the parentheses with "&".
4. Do not change "and" outside OG=(...).`;

  return {
    model: model || 'gpt-5.6-luna',
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: systemPrompt }]
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: `${text}` }]
      }
    ],
    text: {
      format: {
        type: 'text'
      }
    },
    tools: [],
    temperature: 0,
    max_output_tokens: 1024,
    top_p: 1,
    store: false,
  };
}

async function callOpenAI(apiKey, jsonData) {
  const hasPermission = await containsOriginPermissions(OPENAI_HOST_ORIGINS);
  if (!hasPermission) {
    throw new Error('OpenAI host access is not granted. Open the LLM tab in the side panel and enable or test OpenAI first.');
  }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(jsonData)
  });
  if (!response.ok) {
    throw new Error(`OpenAI Error: ${response.status} - ${await response.text()}`);
  }
  return response.json();
}

async function callLmStudio(baseUrl, apiKey, payload) {
  const normalizedBaseUrl = (baseUrl || 'http://127.0.0.1:1234/v1').replace(/\/$/, '');
  const origins = getLmStudioPermissionOrigins(normalizedBaseUrl);
  if (!origins.length) {
    throw new Error('LM Studio host must use localhost or 127.0.0.1 over http.');
  }
  if (!await containsOriginPermissions(origins)) {
    throw new Error('LM Studio host access is not granted. Open the LLM tab in the side panel and enable or test LM Studio first.');
  }
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const response = await fetch(`${normalizedBaseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`LM Studio Error: ${response.status} - ${await response.text()}`);
  }
  return response.json();
}

async function generateWosQuery(text, providerOverride, modelOverride, signal, onProgress = () => {}, conversationContext = {}, compactBeforeRun = false) {
  const storage = await getStorage([
    CHAT_API_KEY_STORAGE_KEY,
    CHAT_MODEL_STORAGE_KEY,
    WOS_QUERY_PROVIDER_STORAGE_KEY,
    LM_STUDIO_BASE_URL_STORAGE_KEY,
    LM_STUDIO_MODEL_STORAGE_KEY,
    LM_STUDIO_API_KEY_STORAGE_KEY,
    'wosAiProviderSettings'
  ]);
  const config = loadProviderConfig(storage, providerOverride);
  if (modelOverride && String(modelOverride).trim()) {
    config.model = String(modelOverride).trim();
  }
  let completedModelCalls = 0;
  let modelAttempts = 0;
  const progressUsage = {
    inputTokens: 0,
    cachedInputTokens: 0
  };
  let effectiveConversationContext = conversationContext || {};
  let compaction = null;
  if (compactBeforeRun) {
    onProgress({ stage: 'compacting', completedModelCalls, modelAttempts, usage: { ...progressUsage } });
    compaction = await compactConversationContext(effectiveConversationContext, config, {
      signal,
      coveredRequestIds: conversationContext?.coveredRequestIds
    });
    effectiveConversationContext = {
      summary: compaction.summary,
      olderTurns: [],
      recentTurns: conversationContext?.recentTurns || []
    };
    progressUsage.inputTokens += Number(compaction.usage?.inputTokens || 0);
    progressUsage.cachedInputTokens += Number(compaction.usage?.cachedInputTokens || 0);
  }
  const result = await runWosQueryPipeline(text, config, {
    localeIdentifier: 'English',
    signal,
    conversationContext: effectiveConversationContext,
    onStageChange: stage => onProgress({
      stage,
      completedModelCalls,
      modelAttempts,
      usage: { ...progressUsage }
    }),
    onModelCall: observation => {
      modelAttempts += 1;
      if (observation?.succeeded) completedModelCalls += 1;
      progressUsage.inputTokens += Number(observation?.usage?.inputTokens || 0);
      progressUsage.cachedInputTokens += Number(observation?.usage?.cachedInputTokens || 0);
      onProgress({
        stage: '',
        completedModelCalls,
        modelAttempts,
        usage: { ...progressUsage }
      });
    }
  });
  const firstCandidate = result.candidates[0];
  if (!firstCandidate?.query) {
    throw new Error('The model did not return a usable WOS query.');
  }
  return {
    rowText: firstCandidate.query,
    candidates: result.candidates,
    intent: result.intent,
    organizationResolutions: result.organizationResolutions,
    usage: {
      inputTokens: result.usage.inputTokens + Number(compaction?.usage?.inputTokens || 0),
      cachedInputTokens: result.usage.cachedInputTokens + Number(compaction?.usage?.cachedInputTokens || 0),
      outputTokens: result.usage.outputTokens + Number(compaction?.usage?.outputTokens || 0)
    },
    compaction
  };
}

async function fetchEasyScholarRank(publicationName) {
  const storage = await getStorage([EASYSCHOLAR_API_KEY_STORAGE_KEY]);
  const apiKey = (storage[EASYSCHOLAR_API_KEY_STORAGE_KEY] || '').trim();
  if (!apiKey) {
    throw new Error('EasyScholar API key missing. Please set it in the side panel.');
  }
  const hasPermission = await containsOriginPermissions(EASYSCHOLAR_HOST_ORIGINS);
  if (!hasPermission) {
    throw new Error('EasyScholar host access is not granted. Open the Scholar tab in the side panel and enable or test EasyScholar first.');
  }

  const url = `https://www.easyscholar.cc/open/getPublicationRank?secretKey=${encodeURIComponent(apiKey)}&publicationName=${encodeURIComponent(publicationName)}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.code !== 200) {
    throw new Error(data.message || 'EasyScholar request failed.');
  }

  const rawRanks = data?.data?.officialRank?.all || {};
  const mappedRanks = {};
  for (const key of Object.keys(rawRanks)) {
    mappedRanks[easyscholarMapping[key] || key] = rawRanks[key];
  }
  return { result: mappedRanks };
}

/**
 * 递归读取目录中的所有文件
 * @param {FileSystemDirectoryHandle} dirHandle - 目录句柄
 * @param {string} basePath - 基础路径
 * @returns {Promise<Array>} 文件列表
 */
async function readAllFiles(dirHandle, basePath = '') {
  const files = [];
  
  try {
    for await (const entry of dirHandle.values()) {
      const fullPath = basePath ? `${basePath}/${entry.name}` : entry.name;
      
      if (entry.kind === 'file') {
        files.push({
          name: entry.name,
          path: fullPath,
          handle: entry
        });
      } else if (entry.kind === 'directory') {
        // 递归读取子目录
        const subFiles = await readAllFiles(entry, fullPath);
        files.push(...subFiles);
      }
    }
  } catch (error) {
    console.error('读取目录出错:', error);
  }
  
  return files;
}

/**
 * 读取文件内容
 * @param {FileSystemFileHandle} fileHandle - 文件句柄
 * @returns {Promise<string>} 文件内容
 */
async function readFileContent(fileHandle) {
  try {
    const file = await fileHandle.getFile();
    const content = await file.text();
    return content;
  } catch (error) {
    console.error('读取文件内容出错:', error);
    throw error;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_CURRENT_WOS_SID') {
    (async () => {
      const tabId = sender.tab && Number.isInteger(sender.tab.id) ? sender.tab.id : null;
      if (!tabId) {
        sendResponse({ success: false, sid: '', error: 'No sender tab is available.' });
        return;
      }
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: resolveWosSidInMainWorld
        });
        const sid = String(results?.[0]?.result || '').trim();
        sendResponse({ success: Boolean(sid), sid });
      } catch (error) {
        sendResponse({ success: false, sid: '', error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (request.type === 'INJECT_MAIN_WORLD_FILES') {
    (async () => {
      const allowedFiles = new Set([
        'jquery-3.7.0.js',
        'z-Wos.js',
        'pub-fun.js',
        'z-easyscholar.js',
        'z-wos-doi-query.js',
        'z-doi-pdf-download.js',
        'z-cnki-pdf-download.js',
        'z-chat.js',
        'injected.js',
        'module-bridge.js',
        'chatgpt-prompts-quickload.js'
      ]);
      const tabId = sender.tab && Number.isInteger(sender.tab.id) ? sender.tab.id : null;
      const files = Array.isArray(request.files) ? request.files : [];

      if (!tabId) {
        sendResponse({ success: false, error: 'No sender tab is available for MAIN world injection.' });
        return;
      }
      if (!files.length || files.some(file => !allowedFiles.has(file))) {
        sendResponse({ success: false, error: 'The requested MAIN world file list is not allowed.' });
        return;
      }

      try {
        const extensionBaseUrl = chrome.runtime.getURL('');
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (currentTabId, baseUrl) => {
            globalThis.__WOS_AIDE_TAB_ID__ = currentTabId;
            globalThis.__WOS_AIDE_EXTENSION_BASE_URL__ = baseUrl;
          },
          args: [tabId, extensionBaseUrl]
        });
        for (const file of files) {
          await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            files: [file]
          });
        }
        sendResponse({ success: true, tabId, files });
      } catch (error) {
        sendResponse({ success: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (request.type === 'GET_CURRENT_TAB_ID') {
    sendResponse({
      success: true,
      tabId: sender.tab && Number.isInteger(sender.tab.id) ? sender.tab.id : null
    });
    return true;
  }

  if (request.type === 'ENSURE_FONT_AWESOME') {
    (async () => {
      try {
        if (sender.tab && sender.tab.id) {
          await chrome.scripting.insertCSS({
            target: { tabId: sender.tab.id, allFrames: true },
            files: ['all.min.css'],
          });
          await chrome.scripting.executeScript({
            target: { tabId: sender.tab.id, allFrames: true },
            files: ['all.min.js'],
          });
        }
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
    // 获取当前已选目录名
    if (request.type === 'GET_DIRECTORY_NAME') {
      sendResponse({
        name: directoryHandle && directoryHandle.name ? directoryHandle.name : ''
      });
      return true;
    }
  if (request.type === 'CANCEL_WOS_QUERY') {
    const requestId = String(request.requestId || '');
    const controller = activeWosQueryRequests.get(requestId);
    if (controller) controller.abort();
    else if (requestId) pendingWosQueryCancellations.add(requestId);
    sendResponse({ success: true, cancelled: Boolean(controller) });
    return false;
  }
  if (request.type === 'COMPACT_WOS_CONTEXT') {
    (async () => {
      const requestId = String(request.requestId || '');
      const controller = new AbortController();
      if (requestId) activeWosQueryRequests.set(requestId, controller);
      try {
        const storage = await getStorage([
          CHAT_API_KEY_STORAGE_KEY,
          CHAT_MODEL_STORAGE_KEY,
          WOS_QUERY_PROVIDER_STORAGE_KEY,
          LM_STUDIO_BASE_URL_STORAGE_KEY,
          LM_STUDIO_MODEL_STORAGE_KEY,
          LM_STUDIO_API_KEY_STORAGE_KEY,
          'wosAiProviderSettings'
        ]);
        const config = loadProviderConfig(storage, request.provider || '');
        if (request.model && String(request.model).trim()) config.model = String(request.model).trim();
        const result = await compactConversationContext(request.conversationContext || {}, config, {
          signal: controller.signal,
          coveredRequestIds: request.conversationContext?.coveredRequestIds
        });
        sendResponse({ success: true, ...result });
      } catch (error) {
        const cancelled = error?.name === 'AbortError' || controller.signal.aborted;
        sendResponse({ success: false, cancelled, error: cancelled ? 'Request cancelled.' : error.message });
      } finally {
        if (requestId && activeWosQueryRequests.get(requestId) === controller) activeWosQueryRequests.delete(requestId);
      }
    })();
    return true;
  }
  if (request.type === 'GENERATE_WOS_QUERY') {
    (async () => {
      const requestId = String(request.requestId || '');
      const controller = new AbortController();
      const startedAt = Date.now();
      let currentStage = 'translating';
      const reportProgress = progress => {
        if (progress.stage) currentStage = progress.stage;
        chrome.runtime.sendMessage({
          type: 'WOS_QUERY_PROGRESS',
          requestId,
          stage: currentStage,
          completedModelCalls: Number(progress.completedModelCalls || 0),
          modelAttempts: Number(progress.modelAttempts || 0),
          usage: progress.usage || null,
          elapsedMilliseconds: Date.now() - startedAt
        }, () => void chrome.runtime.lastError);
      };
      if (requestId) {
        activeWosQueryRequests.get(requestId)?.abort();
        activeWosQueryRequests.set(requestId, controller);
        if (pendingWosQueryCancellations.delete(requestId)) controller.abort();
      }
      try {
        const result = await generateWosQuery(
          request.text || '',
          request.provider || '',
          request.model || '',
          controller.signal,
          reportProgress,
          request.conversationContext || {},
          Boolean(request.compactBeforeRun)
        );
        sendResponse({ success: true, ...result });
      } catch (error) {
        const cancelled = error?.name === 'AbortError' || controller.signal.aborted;
        sendResponse({ success: false, cancelled, error: cancelled ? 'Request cancelled.' : error.message });
      } finally {
        if (requestId && activeWosQueryRequests.get(requestId) === controller) {
          activeWosQueryRequests.delete(requestId);
        }
      }
    })();
    return true;
  }

  if (request.type === 'FETCH_EASYSCHOLAR_RANK') {
    (async () => {
      try {
        const result = await fetchEasyScholarRank(request.publicationName || '');
        sendResponse({ success: true, ...result });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
  
  // 选择目录
  if (request.type === 'SELECT_DIRECTORY') {
    (async () => {
      try {
        // 注意：这个API需要用户手势触发，所以需要从popup或content script调用
        directoryHandle = await globalThis.showDirectoryPicker();
        const files = await readAllFiles(directoryHandle);
        
        // 缓存文件信息
        fileCache.clear();
        for (const file of files) {
          fileCache.set(file.path, file.handle);
        }
        
        sendResponse({
          success: true,
          files: files.map(f => ({ name: f.name, path: f.path }))
        });
      } catch (error) {
        sendResponse({
          success: false,
          error: error.message
        });
      }
    })();
    return true; // 保持消息通道开启
  }
  
  // 读取文件内容
  if (request.type === 'READ_FILE') {
    (async () => {
      try {
        const fileHandle = fileCache.get(request.filePath);
        if (!fileHandle) {
          sendResponse({
            success: false,
            error: '文件未找到，请先选择目录'
          });
          return;
        }
        
        const content = await readFileContent(fileHandle);
        sendResponse({
          success: true,
          content: content
        });
      } catch (error) {
        sendResponse({
          success: false,
          error: error.message
        });
      }
    })();
    return true; // 保持消息通道开启
  }
  
  // 获取所有文件列表
  if (request.type === 'GET_FILES') {
    const files = Array.from(fileCache.keys());
    sendResponse({
      success: true,
      files: files
    });
    return true;
  }
});

'use strict';

const { isWosLocation } = require('./wos-host');
const { message } = require('./i18n');
const { toStandardJson } = require('./wos-txt-standard-json');

const UUID_PATTERN = /[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}-[A-Fa-f0-9]{10}/;
const WOS_ID_PATTERN = /\bWOS:[A-Z0-9]{10,}\b/gi;
const DOI_PATTERN = /\b(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*|urn:\s*doi:\s*)?(10\.\d{4,9}\/[^\s"'<>()\[\],;]+)/gi;
const SCHOLAR_HISTORY_KEY = 'wosAideScholarQueryHistory';
const EASYSCHOLAR_API_KEY_STORAGE_KEY = 'wos-easyscholar-api-key';
const EASYSCHOLAR_API_KEY_VERIFIED_STORAGE_KEY = 'wos-easyscholar-api-key-verified';
const MAX_SCHOLAR_HISTORY_ITEMS = 30;
const IDENTIFIER_FILE_EXTENSIONS = new Set(['txt', 'bib', 'md', 'json', 'xml', 'ris', 'csv']);
const MAX_IDENTIFIER_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IDENTIFIER_FILES = 20;

const isWosUrl = value => {
  try {
    const url = new URL(value || '');
    return isWosLocation(url.hostname, url.href);
  } catch (_error) {
    return false;
  }
};

const extractIdentifiers = value => {
  const source = String(value || '');
  const wosids = [];
  const matchedWosIds = [];
  let match;
  WOS_ID_PATTERN.lastIndex = 0;
  while ((match = WOS_ID_PATTERN.exec(source)) !== null) {
    const normalized = match[0].toUpperCase();
    wosids.push(normalized);
    matchedWosIds.push(match[0]);
  }
  let remaining = source;
  matchedWosIds.forEach(id => { remaining = remaining.replace(id, ' '); });
  const dois = [];
  DOI_PATTERN.lastIndex = 0;
  while ((match = DOI_PATTERN.exec(remaining)) !== null) {
    let doi = match[1] || match[0];
    try { doi = decodeURIComponent(doi); } catch (_error) { /* keep source text */ }
    doi = doi.replace(/[.,;:)\]}]+$/g, '').trim().toLowerCase();
    if (doi) dois.push(doi);
  }
  return {
    wosids: Array.from(new Set(wosids)),
    dois: Array.from(new Set(dois))
  };
};

const extractUuid = value => String(value || '').match(UUID_PATTERN)?.[0] || '';

const queryActiveTab = () => new Promise(resolve => {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0] || null));
});

const executeMain = (tabId, func, args = []) => new Promise((resolve, reject) => {
  chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func,
    args
  }, results => {
    if (chrome.runtime.lastError) {
      reject(new Error(chrome.runtime.lastError.message));
      return;
    }
    resolve(results?.[0]?.result);
  });
});

const openHandleDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('wos-aide-sidepanel', 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains('handles')) request.result.createObjectStore('handles');
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const persistHandle = async (key, handle) => {
  const database = await openHandleDatabase();
  await new Promise(resolve => {
    const transaction = database.transaction('handles', 'readwrite');
    transaction.objectStore('handles').put(handle, key);
    transaction.oncomplete = resolve;
    transaction.onerror = resolve;
  });
};

const restoreHandle = async key => {
  try {
    const database = await openHandleDatabase();
    return await new Promise(resolve => {
      const request = database.transaction('handles', 'readonly').objectStore('handles').get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch (_error) {
    return null;
  }
};

const hasWritePermission = async (handle, requestPermission = false) => {
  if (!handle) return false;
  try {
    const options = { mode: 'readwrite' };
    if (await handle.queryPermission(options) === 'granted') return true;
    return requestPermission && await handle.requestPermission(options) === 'granted';
  } catch (_error) {
    return false;
  }
};

const writeTextFile = async (directory, fileName, data) => {
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(String(data));
  await writable.close();
};

const sendRuntimeMessage = message => new Promise((resolve, reject) => {
  chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else if (!response?.success) reject(new Error(response?.error || 'Request failed.'));
    else resolve(response);
  });
});

function initializeWosSidePanelTools() {
  const elements = {
    doiTab: document.getElementById('wosDoiToolTab'),
    uuidTab: document.getElementById('wosUuidToolTab'),
    doiDownloadTab: document.getElementById('wosDoiDownloadToolTab'),
    doiPanel: document.getElementById('wosDoiToolPanel'),
    uuidPanel: document.getElementById('wosUuidToolPanel'),
    doiDownloadPanel: document.getElementById('wosDoiDownloadToolPanel'),
    doiInput: document.getElementById('wosDoiQueryInput'),
    doiCount: document.getElementById('wosDoiCount'),
    wosIdCount: document.getElementById('wosIdCount'),
    normalizeBtn: document.getElementById('normalizeWosDoiBtn'),
    doiSearchBtn: document.getElementById('runWosDoiSearchBtn'),
    doiStatus: document.getElementById('wosDoiToolStatus'),
    uuidInput: document.getElementById('wosUuidInput'),
    uuidInfo: document.getElementById('wosUuidInfo'),
    refreshUuidBtn: document.getElementById('refreshWosUuidBtn'),
    openUuidBtn: document.getElementById('openWosUuidPageBtn'),
    chooseFolderBtn: document.getElementById('chooseWosExportFolderBtn'),
    folderName: document.getElementById('wosExportFolderName'),
    format: document.getElementById('wosExportFormat'),
    exportBtn: document.getElementById('runWosUuidExportBtn'),
    exportJson: document.getElementById('wosExportJsonCheckbox'),
    exportBar: document.getElementById('wosExportProgressBar'),
    exportStatus: document.getElementById('wosExportStatus'),
    scholarInput: document.getElementById('scholarJournalInput'),
    scholarSearchBtn: document.getElementById('searchScholarRankBtn'),
    scholarOpenBtn: document.getElementById('openScholarSoBtn'),
    scholarPickBtn: document.getElementById('pickScholarJournalBtn'),
    scholarStatus: document.getElementById('scholarQueryStatus'),
    scholarResults: document.getElementById('scholarRankResults'),
    scholarParentTab: document.getElementById('tabScholar'),
    scholarConfigTab: document.getElementById('scholarConfigSubTab'),
    scholarQueryTab: document.getElementById('scholarQuerySubTab'),
    scholarHistoryTab: document.getElementById('scholarHistorySubTab'),
    scholarConfigPanel: document.getElementById('scholarConfigSubPanel'),
    scholarQueryPanel: document.getElementById('scholarQuerySubPanel'),
    scholarHistoryPanel: document.getElementById('scholarHistorySubPanel'),
    scholarHistoryList: document.getElementById('scholarHistoryList'),
    scholarHistoryEmpty: document.getElementById('scholarHistoryEmpty'),
    scholarHistoryClearBtn: document.getElementById('clearScholarHistoryBtn')
  };
  if (!elements.doiPanel || !elements.uuidPanel || !elements.doiDownloadPanel || !elements.scholarInput) return;

  const DIRECTORY_KEY = 'wos-uuid-export-directory';
  const EXPORT_JSON_KEY = 'wos-uuid-export-json';
  let exportDirectory = null;
  let connectedWosTab = null;
  let exportRunning = false;
  let scholarHistory = [];
  const wosText = (key, tokens = {}) => Object.entries(tokens).reduce(
    (text, [token, value]) => text.replace(`{${token}}`, String(value)),
    message(document.documentElement.lang === 'en' ? 'en' : 'zh', key)
  );

  const setToolPanel = panel => {
    const selected = ['doi', 'uuid', 'doi-download'].includes(panel) ? panel : 'doi';
    const tools = [
      { id: 'doi', tab: elements.doiTab, panel: elements.doiPanel },
      { id: 'uuid', tab: elements.uuidTab, panel: elements.uuidPanel },
      { id: 'doi-download', tab: elements.doiDownloadTab, panel: elements.doiDownloadPanel }
    ];
    tools.forEach(tool => {
      const active = tool.id === selected;
      tool.tab.classList.toggle('is-active', active);
      tool.tab.setAttribute('aria-selected', String(active));
      tool.tab.tabIndex = active ? 0 : -1;
      tool.panel.hidden = !active;
    });
    chrome.storage.local.set({ wosAideWosTool: selected });
    if (selected === 'uuid') void refreshUuid();
  };

  const updateIdentifierCounts = ({ normalize = false } = {}) => {
    const extracted = extractIdentifiers(elements.doiInput.value);
    elements.doiCount.textContent = String(extracted.dois.length);
    elements.wosIdCount.textContent = String(extracted.wosids.length);
    if (normalize) elements.doiInput.value = [...extracted.wosids, ...extracted.dois].join('\n');
    elements.doiSearchBtn.disabled = !(connectedWosTab?.id && (extracted.dois.length || extracted.wosids.length));
    return extracted;
  };

  const setDoiStatus = (text, variant = 'muted') => {
    elements.doiStatus.textContent = text;
    elements.doiStatus.className = `helper status--${variant}`;
  };

  const importIdentifierFiles = async fileList => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.length > MAX_IDENTIFIER_FILES) {
      setDoiStatus(wosText('wos.doiFilesTooMany'), 'error');
      return;
    }
    const unsupported = files.find(file => {
      const extension = String(file.name || '').split('.').pop()?.toLocaleLowerCase('en-US');
      return !IDENTIFIER_FILE_EXTENSIONS.has(extension);
    });
    if (unsupported) {
      setDoiStatus(wosText('wos.doiFilesUnsupported', { file: unsupported.name || '-' }), 'error');
      return;
    }
    const oversized = files.find(file => file.size > MAX_IDENTIFIER_FILE_BYTES);
    if (oversized) {
      setDoiStatus(wosText('wos.doiFileTooLarge', { file: oversized.name || '-' }), 'error');
      return;
    }

    setDoiStatus(wosText('wos.doiFilesReading', { files: files.length }), 'info');
    try {
      const contents = await Promise.all(files.map(file => file.text()));
      const imported = extractIdentifiers(contents.join('\n'));
      if (!imported.dois.length && !imported.wosids.length) {
        setDoiStatus(wosText('wos.doiFilesNoIdentifiers'), 'error');
        return;
      }
      const existing = extractIdentifiers(elements.doiInput.value);
      const dois = Array.from(new Set([...existing.dois, ...imported.dois]));
      const wosids = Array.from(new Set([...existing.wosids, ...imported.wosids]));
      const addedDois = dois.length - existing.dois.length;
      const addedWosIds = wosids.length - existing.wosids.length;
      elements.doiInput.value = [...wosids, ...dois].join('\n');
      updateIdentifierCounts();
      setDoiStatus(
        addedDois || addedWosIds
          ? wosText('wos.doiFilesImported', { files: files.length, dois: addedDois, wosids: addedWosIds })
          : wosText('wos.doiFilesNoNew'),
        addedDois || addedWosIds ? 'success' : 'muted'
      );
    } catch (error) {
      setDoiStatus(wosText('wos.doiFilesReadFailed', { error: error?.message || String(error) }), 'error');
    }
  };

  const updateExportAvailability = () => {
    const uuid = extractUuid(elements.uuidInput.value);
    elements.exportBtn.disabled = exportRunning || !connectedWosTab?.id || !exportDirectory || !uuid;
  };

  const updateJsonOption = () => {
    if (!elements.exportJson) return;
    const enabled = elements.format.value === 'txt';
    elements.exportJson.disabled = !enabled;
    if (!enabled) elements.exportJson.checked = false;
  };

  const prepareWosPageBridge = async tabId => {
    if (!tabId) return;
    await executeMain(tabId, () => {
      window.__WOS_AIDE_WAIT_FOR_WOS__ = async () => {
        for (let attempt = 0; attempt < 30; attempt += 1) {
          if (window.wos?.uuid && typeof window.wos.query_wosid_or_doi === 'function') return window.wos;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('WOS page API is not ready. Reload the WOS page and try again.');
      };
      try {
        ['clipboard-reader-box', 'wos_easyscholar_panel', 'wos_openai_panel', 'wos-aide-toolbar-shortcuts'].forEach(id => {
          document.getElementById(id)?.remove();
        });
      } catch (_error) { /* page cleanup is best effort */ }
      return true;
    });
  };

  const refreshConnection = async () => {
    const tab = await queryActiveTab();
    connectedWosTab = tab?.id && isWosUrl(tab.url) ? tab : null;
    if (connectedWosTab) {
      try {
        await prepareWosPageBridge(connectedWosTab.id);
        elements.doiStatus.textContent = 'Ready to search in the current WOS session.';
        elements.doiStatus.className = 'helper status--success';
      } catch (error) {
        connectedWosTab = null;
        elements.doiStatus.textContent = error?.message || String(error);
        elements.doiStatus.className = 'helper status--error';
      }
    } else {
      elements.doiStatus.textContent = 'Open a Web of Science page first.';
      elements.doiStatus.className = 'helper status--error';
    }
    updateIdentifierCounts();
    updateExportAvailability();
    return connectedWosTab;
  };

  const refreshUuid = async () => {
    const activeTab = await queryActiveTab();
    const tab = await refreshConnection();
    const urlUuid = extractUuid(activeTab?.url);
    let state = { uuid: urlUuid, count: '' };
    let pageError = null;
    if (tab) {
      elements.refreshUuidBtn.querySelector('i')?.classList.add('fa-spin');
      try {
        state = await executeMain(tab.id, async pattern => {
          await window.__WOS_AIDE_WAIT_FOR_WOS__();
          const match = String(location.href).match(new RegExp(pattern));
          let info = null;
          if (match && window.wos?.uuid?.info) {
            try { info = await window.wos.uuid.info(); } catch (_error) { /* URL is still useful */ }
          }
          return { uuid: match?.[0] || info?.uuid || '', count: info?.ref_count || '' };
        }, [UUID_PATTERN.source]);
      } catch (error) {
        pageError = error;
      } finally {
        elements.refreshUuidBtn.querySelector('i')?.classList.remove('fa-spin');
      }
    }
    if (!state?.uuid) state = { uuid: urlUuid, count: '' };
    if (state.uuid) {
      elements.uuidInput.value = state.uuid;
      if (state.count) {
        elements.uuidInfo.textContent = wosText('wos.resultSetCount', {
          count: String(state.count).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
        });
        elements.uuidInfo.className = 'helper status--success';
      } else if (!pageError && tab) {
        elements.uuidInfo.textContent = wosText('wos.resultSetDetected');
        elements.uuidInfo.className = 'helper status--success';
      } else {
        elements.uuidInfo.textContent = wosText('wos.resultSetFromUrl');
        elements.uuidInfo.className = 'helper status--muted';
      }
    } else {
      elements.uuidInput.value = '';
      elements.uuidInfo.textContent = pageError
        ? (pageError?.message || String(pageError))
        : tab
          ? wosText('wos.noResultSet')
          : wosText('wos.openResultsFirst');
      elements.uuidInfo.className = pageError ? 'helper status--error' : 'helper status--muted';
    }
    updateExportAvailability();
    return elements.uuidInput.value;
  };

  const renderScholarResults = result => {
    elements.scholarResults.replaceChildren();
    const entries = Object.entries(result || {});
    if (!entries.length) {
      elements.scholarResults.hidden = true;
      return;
    }
    entries.forEach(([label, value]) => {
      const row = document.createElement('div');
      const key = document.createElement('span');
      const rank = document.createElement('strong');
      key.textContent = label;
      rank.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
      row.append(key, rank);
      elements.scholarResults.appendChild(row);
    });
    elements.scholarResults.hidden = false;
  };

  const scholarLanguage = () => document.documentElement.lang === 'en' ? 'en' : 'zh';

  const easyScholarApiState = () => new Promise(resolve => {
    chrome.storage.local.get([
      EASYSCHOLAR_API_KEY_STORAGE_KEY,
      EASYSCHOLAR_API_KEY_VERIFIED_STORAGE_KEY
    ], result => resolve({
      hasKey: Boolean(String(result[EASYSCHOLAR_API_KEY_STORAGE_KEY] || '').trim()),
      verified: result[EASYSCHOLAR_API_KEY_VERIFIED_STORAGE_KEY] === true
        || result[EASYSCHOLAR_API_KEY_VERIFIED_STORAGE_KEY] === 'true'
    }));
  });

  const setScholarSubPanel = panelId => {
    const panels = [elements.scholarQueryPanel, elements.scholarHistoryPanel, elements.scholarConfigPanel];
    const tabs = [elements.scholarQueryTab, elements.scholarHistoryTab, elements.scholarConfigTab];
    const selectedPanel = panels.find(panel => panel?.id === panelId) || elements.scholarQueryPanel;
    panels.forEach(panel => {
      if (panel) panel.hidden = panel !== selectedPanel;
    });
    tabs.forEach((tab, index) => {
      if (!tab) return;
      const active = panels[index] === selectedPanel;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    chrome.storage.local.set({ wosAideScholarSubTab: selectedPanel?.id });
  };

  const retainScholarHistoryLimit = items => {
    let remainingUnstarred = Math.max(0, MAX_SCHOLAR_HISTORY_ITEMS - items.filter(item => item.favorite).length);
    return items.filter(item => item.favorite || remainingUnstarred-- > 0);
  };

  const orderScholarHistory = items => [...items].sort(
    (left, right) => Number(Boolean(right.favorite)) - Number(Boolean(left.favorite))
  );

  const renderScholarHistory = () => {
    if (!elements.scholarHistoryList || !elements.scholarHistoryEmpty) return;
    elements.scholarHistoryList.replaceChildren();
    elements.scholarHistoryEmpty.hidden = scholarHistory.length > 0;
    if (elements.scholarHistoryClearBtn) elements.scholarHistoryClearBtn.disabled = scholarHistory.length === 0;

    scholarHistory.forEach(item => {
      const row = document.createElement('div');
      row.className = 'scholar-history-item';
      const restore = document.createElement('button');
      restore.className = 'scholar-history-item__restore';
      restore.type = 'button';

      const header = document.createElement('span');
      header.className = 'scholar-history-item__header';
      const journal = document.createElement('span');
      journal.className = 'scholar-history-item__journal';
      journal.textContent = item.journal;
      header.append(journal);

      const summary = document.createElement('span');
      summary.className = 'scholar-history-item__summary';
      summary.textContent = Object.entries(item.result || {}).slice(0, 3)
        .map(([label, value]) => `${label}: ${value ?? '—'}`)
        .join(' · ');
      restore.append(header, summary);
      restore.addEventListener('click', () => {
        elements.scholarInput.value = item.journal;
        renderScholarResults(item.result);
        elements.scholarStatus.textContent = message(scholarLanguage(), 'scholar.historyLoaded');
        elements.scholarStatus.className = 'helper status--success';
        setScholarSubPanel('scholarQuerySubPanel');
        elements.scholarInput.focus();
      });
      const favorite = document.createElement('button');
      favorite.className = `history-favorite-button${item.favorite ? ' is-favorite' : ''}`;
      favorite.type = 'button';
      favorite.title = message(scholarLanguage(), item.favorite ? 'history.unfavorite' : 'history.favorite');
      favorite.setAttribute('aria-label', `${favorite.title}: ${item.journal}`);
      favorite.setAttribute('aria-pressed', String(Boolean(item.favorite)));
      favorite.innerHTML = `<i class="fa-${item.favorite ? 'solid' : 'regular'} fa-star" aria-hidden="true"></i>`;
      favorite.addEventListener('click', () => {
        scholarHistory = orderScholarHistory(scholarHistory.map(historyItem => historyItem === item
          ? { ...historyItem, favorite: !historyItem.favorite }
          : historyItem));
        chrome.storage.local.set({ [SCHOLAR_HISTORY_KEY]: scholarHistory });
        renderScholarHistory();
      });
      row.append(restore, favorite);
      elements.scholarHistoryList.appendChild(row);
    });
  };

  const saveScholarHistory = (journal, result) => {
    const normalizedJournal = journal.toLocaleLowerCase();
    const existing = scholarHistory.find(item => item.journal.toLocaleLowerCase() === normalizedJournal);
    scholarHistory = orderScholarHistory(retainScholarHistoryLimit([
      { journal, result: result || {}, queriedAt: Date.now(), favorite: Boolean(existing?.favorite) },
      ...scholarHistory.filter(item => item.journal.toLocaleLowerCase() !== normalizedJournal)
    ]));
    chrome.storage.local.set({ [SCHOLAR_HISTORY_KEY]: scholarHistory });
    renderScholarHistory();
  };

  elements.doiTab.addEventListener('click', () => setToolPanel('doi'));
  elements.uuidTab.addEventListener('click', () => setToolPanel('uuid'));
  elements.doiDownloadTab.addEventListener('click', () => setToolPanel('doi-download'));
  elements.doiInput.addEventListener('input', () => updateIdentifierCounts());
  const restoreScholarHistoryItem = item => {
    if (!item) {
      elements.scholarInput.value = '';
      renderScholarResults(null);
      return;
    }
    elements.scholarInput.value = item.journal;
    renderScholarResults(item.result);
  };
  elements.scholarInput.addEventListener('keydown', event => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' || !scholarHistory.length) return;
    event.preventDefault();
    const current = scholarHistory.findIndex(item => item.journal === elements.scholarInput.value.trim());
    const next = event.key === 'ArrowUp'
      ? (current < 0 ? 0 : Math.max(0, current - 1))
      : (current < 0 ? -1 : current + 1);
    restoreScholarHistoryItem(next >= 0 && next < scholarHistory.length ? scholarHistory[next] : null);
  });
  let doiInputDragDepth = 0;
  const isFileDrag = event => Boolean(
    event.dataTransfer?.files?.length
    || Array.from(event.dataTransfer?.types || []).includes('Files')
  );
  elements.doiInput.addEventListener('dragenter', event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    doiInputDragDepth += 1;
    elements.doiInput.classList.add('is-file-dragover');
  });
  elements.doiInput.addEventListener('dragover', event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  elements.doiInput.addEventListener('dragleave', event => {
    event.preventDefault();
    doiInputDragDepth = Math.max(0, doiInputDragDepth - 1);
    if (!doiInputDragDepth) elements.doiInput.classList.remove('is-file-dragover');
  });
  elements.doiInput.addEventListener('drop', event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    doiInputDragDepth = 0;
    elements.doiInput.classList.remove('is-file-dragover');
    void importIdentifierFiles(event.dataTransfer?.files);
  });
  elements.normalizeBtn.addEventListener('click', () => updateIdentifierCounts({ normalize: true }));
  elements.doiSearchBtn.addEventListener('click', async () => {
    const tab = await refreshConnection();
    const extracted = updateIdentifierCounts({ normalize: true });
    if (!tab || (!extracted.wosids.length && !extracted.dois.length)) return;
    elements.doiSearchBtn.disabled = true;
    elements.doiStatus.textContent = 'Opening the combined query in WOS…';
    elements.doiStatus.className = 'helper status--info';
    try {
      await executeMain(tab.id, async (wosids, dois) => {
        const api = await window.__WOS_AIDE_WAIT_FOR_WOS__();
        return api.query_wosid_or_doi(wosids, dois);
      }, [extracted.wosids, extracted.dois]);
      elements.doiStatus.textContent = `Opened ${extracted.dois.length} DOI and ${extracted.wosids.length} WOS ID in WOS.`;
      elements.doiStatus.className = 'helper status--success';
    } catch (error) {
      elements.doiStatus.textContent = error?.message || String(error);
      elements.doiStatus.className = 'helper status--error';
    } finally {
      updateIdentifierCounts();
    }
  });

  elements.refreshUuidBtn.addEventListener('click', () => { void refreshUuid(); });
  elements.uuidInput.addEventListener('input', () => {
    const uuid = extractUuid(elements.uuidInput.value);
    if (uuid && uuid !== elements.uuidInput.value) elements.uuidInput.value = uuid;
    updateExportAvailability();
  });
  elements.openUuidBtn.addEventListener('click', async () => {
    const tab = await refreshConnection();
    const uuid = extractUuid(elements.uuidInput.value);
    if (!tab || !uuid) {
      elements.uuidInfo.textContent = wosText('wos.invalidResultSet');
      elements.uuidInfo.className = 'helper status--error';
      return;
    }
    elements.openUuidBtn.disabled = true;
    elements.uuidInfo.textContent = wosText('wos.openingResults');
    try {
      await executeMain(tab.id, async value => {
        const api = await window.__WOS_AIDE_WAIT_FOR_WOS__();
        await api.uuid.open(value);
        return true;
      }, [uuid]);
      await refreshUuid();
    } catch (error) {
      elements.uuidInfo.textContent = error?.message || String(error);
      elements.uuidInfo.className = 'helper status--error';
    } finally {
      elements.openUuidBtn.disabled = false;
    }
  });

  elements.chooseFolderBtn.addEventListener('click', async () => {
    try {
      if (!window.showDirectoryPicker) throw new Error('This Chrome version does not support folder selection.');
      const handle = await window.showDirectoryPicker({ id: 'wos-aide-wos-export', mode: 'readwrite' });
      if (!await hasWritePermission(handle, true)) throw new Error('Folder write permission was not granted.');
      exportDirectory = handle;
      elements.folderName.textContent = handle.name || 'Selected folder';
      await persistHandle(DIRECTORY_KEY, handle);
      elements.exportStatus.textContent = wosText('wos.folderSelected');
      elements.exportStatus.className = 'helper status--success';
    } catch (error) {
      if (error?.name !== 'AbortError') {
        elements.exportStatus.textContent = error?.message || String(error);
        elements.exportStatus.className = 'helper status--error';
      }
    } finally {
      updateExportAvailability();
    }
  });

  elements.exportBtn.addEventListener('click', async () => {
    if (exportRunning) return;
    const tab = await refreshConnection();
    const uuid = extractUuid(elements.uuidInput.value);
    if (!tab || !uuid || !await hasWritePermission(exportDirectory, true)) {
      elements.exportStatus.textContent = wosText('wos.exportPrerequisites');
      elements.exportStatus.className = 'helper status--error';
      return;
    }
    exportRunning = true;
    updateExportAvailability();
    elements.exportBar.style.width = '0%';
    const format = elements.format.value === 'bib' ? 'bib' : 'txt';
    const exportJson = format === 'txt' && Boolean(elements.exportJson?.checked);
    try {
      const currentUuid = await executeMain(tab.id, async (value, pattern) => {
        const api = await window.__WOS_AIDE_WAIT_FOR_WOS__();
        const current = String(location.href).match(new RegExp(pattern))?.[0] || '';
        if (current !== value) await api.uuid.open(value);
        const info = await api.uuid.info();
        return { uuid: info?.uuid || value, count: info?.ref_count || 0, status: info?.status || '' };
      }, [uuid, UUID_PATTERN.source]);
      const totalRecords = Number.parseInt(String(currentUuid?.count || '0').replace(/,/g, ''), 10) || 0;
      if (!totalRecords || currentUuid?.status === 'failed') throw new Error(wosText('wos.recordCountUnavailable'));
      const totalBatches = Math.ceil(totalRecords / 500);
      for (let batch = 0; batch < totalBatches; batch += 1) {
        const markFrom = batch * 500 + 1;
        const markTo = Math.min(markFrom + 499, totalRecords);
        elements.exportStatus.textContent = wosText('wos.exportingBatch', {
          batch: batch + 1,
          batches: totalBatches,
          from: markFrom,
          to: markTo
        });
        elements.exportStatus.className = 'helper status--info';
        const result = await executeMain(tab.id, async (from, to, selectedFormat) => {
          const api = await window.__WOS_AIDE_WAIT_FOR_WOS__();
          if (typeof api.uuid.export_range_data !== 'function') {
            throw new Error('Reload the WOS page once to activate the updated exporter.');
          }
          return api.uuid.export_range_data(from, to, selectedFormat);
        }, [markFrom, markTo, format]);
        const fileName = `${result.uuid}_${result.markFrom}_${result.markTo}.${format}`;
        await writeTextFile(exportDirectory, fileName, result.data);
        if (exportJson) {
          const jsonName = fileName.replace(/\.txt$/i, '.json');
          await writeTextFile(exportDirectory, jsonName, JSON.stringify(toStandardJson(result.data), null, 2));
        }
        elements.exportBar.style.width = `${Math.round((batch + 1) / totalBatches * 100)}%`;
      }
      elements.exportStatus.textContent = wosText('wos.exportComplete', {
        records: totalRecords.toLocaleString(),
        files: totalBatches,
        format: format.toUpperCase()
      });
      elements.exportStatus.className = 'helper status--success';
    } catch (error) {
      elements.exportStatus.textContent = error?.message || String(error);
      elements.exportStatus.className = 'helper status--error';
    } finally {
      exportRunning = false;
      updateExportAvailability();
    }
  });

  elements.format.addEventListener('change', updateJsonOption);
  elements.exportJson?.addEventListener('change', () => {
    chrome.storage.local.set({ [EXPORT_JSON_KEY]: Boolean(elements.exportJson.checked) });
  });
  updateJsonOption();
  chrome.storage.local.get(EXPORT_JSON_KEY).then(values => {
    if (elements.exportJson && typeof values?.[EXPORT_JSON_KEY] === 'boolean') elements.exportJson.checked = values[EXPORT_JSON_KEY];
    updateJsonOption();
  });

  elements.scholarSearchBtn.addEventListener('click', async () => {
    const journal = elements.scholarInput.value.trim();
    if (!journal) {
      elements.scholarStatus.textContent = 'Enter a journal title first.';
      elements.scholarStatus.className = 'helper status--error';
      return;
    }
    const apiState = await easyScholarApiState();
    if (!apiState.hasKey || !apiState.verified) {
      setScholarSubPanel('scholarConfigSubPanel');
      elements.scholarStatus.textContent = message(scholarLanguage(), 'myJournals.apiRequired');
      elements.scholarStatus.className = 'helper status--error';
      window.setTimeout(() => {
        const target = document.getElementById(apiState.hasKey ? 'easyScholarApiKeyTestBtn' : 'easyScholarApiKeyInput');
        target?.focus();
      }, 0);
      return;
    }
    elements.scholarSearchBtn.disabled = true;
    elements.scholarStatus.textContent = `Querying ${journal}…`;
    elements.scholarStatus.className = 'helper status--info';
    try {
      const response = await sendRuntimeMessage({ type: 'FETCH_EASYSCHOLAR_RANK', publicationName: journal });
      renderScholarResults(response.result);
      saveScholarHistory(journal, response.result);
      elements.scholarStatus.textContent = 'Journal ratings loaded.';
      elements.scholarStatus.className = 'helper status--success';
    } catch (error) {
      renderScholarResults(null);
      elements.scholarStatus.textContent = error?.message || String(error);
      elements.scholarStatus.className = 'helper status--error';
    } finally {
      elements.scholarSearchBtn.disabled = false;
    }
  });

  elements.scholarOpenBtn.addEventListener('click', async () => {
    const journal = elements.scholarInput.value.trim();
    const tab = await refreshConnection();
    if (!journal || !tab) {
      elements.scholarStatus.textContent = 'Enter a journal title and open a WOS page first.';
      elements.scholarStatus.className = 'helper status--error';
      return;
    }
    try {
      await executeMain(tab.id, async value => {
        const api = await window.__WOS_AIDE_WAIT_FOR_WOS__();
        await api.query(`SO=${value}`);
        return true;
      }, [journal]);
      elements.scholarStatus.textContent = 'SO search opened in WOS.';
      elements.scholarStatus.className = 'helper status--success';
    } catch (error) {
      elements.scholarStatus.textContent = error?.message || String(error);
      elements.scholarStatus.className = 'helper status--error';
    }
  });

  elements.scholarPickBtn.addEventListener('click', async () => {
    const tab = await refreshConnection();
    if (!tab) {
      elements.scholarStatus.textContent = 'Open a WOS record page first.';
      elements.scholarStatus.className = 'helper status--error';
      return;
    }
    elements.scholarPickBtn.disabled = true;
    elements.scholarStatus.textContent = 'Click the journal title on the WOS page. Press Esc to cancel.';
    elements.scholarStatus.className = 'helper status--info';
    try {
      const selected = await executeMain(tab.id, () => new Promise((resolve, reject) => {
        let highlighted = null;
        const previousOutline = new WeakMap();
        const cleanup = () => {
          document.removeEventListener('mouseover', onMouseOver, true);
          document.removeEventListener('click', onClick, true);
          document.removeEventListener('keydown', onKeyDown, true);
          if (highlighted) highlighted.style.outline = previousOutline.get(highlighted) || '';
          clearTimeout(timeout);
        };
        const textFor = target => String(
          target?.closest?.('a, button, [data-ta], span, div')?.textContent || target?.textContent || ''
        ).replace(/\s+/g, ' ').trim().slice(0, 300);
        const onMouseOver = event => {
          const target = event.target instanceof HTMLElement ? event.target : null;
          if (!target) return;
          if (highlighted) highlighted.style.outline = previousOutline.get(highlighted) || '';
          highlighted = target;
          previousOutline.set(target, target.style.outline);
          target.style.outline = '2px solid #202123';
        };
        const onClick = event => {
          event.preventDefault();
          event.stopImmediatePropagation();
          const value = textFor(event.target);
          cleanup();
          if (value) resolve(value);
          else reject(new Error('No text was found in the selected element.'));
        };
        const onKeyDown = event => {
          if (event.key !== 'Escape') return;
          cleanup();
          reject(new Error('Journal picking cancelled.'));
        };
        document.addEventListener('mouseover', onMouseOver, true);
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKeyDown, true);
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Journal picking timed out.'));
        }, 30000);
      }));
      elements.scholarInput.value = selected || '';
      elements.scholarStatus.textContent = selected ? 'Journal text captured from WOS.' : 'Nothing was selected.';
      elements.scholarStatus.className = selected ? 'helper status--success' : 'helper status--muted';
    } catch (error) {
      elements.scholarStatus.textContent = error?.message || String(error);
      elements.scholarStatus.className = 'helper status--error';
    } finally {
      elements.scholarPickBtn.disabled = false;
    }
  });

  elements.scholarConfigTab?.addEventListener('click', () => setScholarSubPanel('scholarConfigSubPanel'));
  elements.scholarQueryTab?.addEventListener('click', () => setScholarSubPanel('scholarQuerySubPanel'));
  elements.scholarHistoryTab?.addEventListener('click', () => setScholarSubPanel('scholarHistorySubPanel'));
  elements.scholarParentTab?.addEventListener('click', () => setScholarSubPanel('scholarQuerySubPanel'));
  elements.scholarHistoryClearBtn?.addEventListener('click', () => {
    if (!window.confirm(message(scholarLanguage(), 'scholar.clearHistoryConfirm'))) return;
    scholarHistory = scholarHistory.filter(item => item.favorite);
    chrome.storage.local.set({ [SCHOLAR_HISTORY_KEY]: scholarHistory });
    renderScholarHistory();
  });
  document.addEventListener('wos-aide:language-changed', renderScholarHistory);

  chrome.storage.local.get(['wosAideWosTool'], result => setToolPanel(result.wosAideWosTool));
  chrome.storage.local.get([SCHOLAR_HISTORY_KEY], result => {
    scholarHistory = Array.isArray(result[SCHOLAR_HISTORY_KEY])
      ? result[SCHOLAR_HISTORY_KEY]
        .filter(item => item && typeof item.journal === 'string' && item.journal.trim())
        .map(item => ({ ...item, favorite: Boolean(item.favorite) }))
      : [];
    scholarHistory = orderScholarHistory(retainScholarHistoryLimit(scholarHistory));
    renderScholarHistory();
  });
  chrome.storage.local.get(['wosAideScholarSubTab'], result => {
    const saved = result.wosAideScholarSubTab;
    setScholarSubPanel([elements.scholarQueryPanel, elements.scholarHistoryPanel, elements.scholarConfigPanel]
      .some(panel => panel?.id === saved) ? saved : 'scholarQuerySubPanel');
  });
  restoreHandle(DIRECTORY_KEY).then(async handle => {
    if (!handle) return;
    exportDirectory = handle;
    const granted = await hasWritePermission(handle);
    elements.folderName.textContent = `${handle.name || 'Selected folder'}${granted ? '' : ' (permission required)'}`;
    updateExportAvailability();
  });
  chrome.tabs.onActivated.addListener(() => { void refreshConnection(); });
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (tab.active && (changeInfo.status === 'complete' || changeInfo.url)) void refreshConnection();
  });
  window.addEventListener('wos-aide:wos-tab-activated', async () => {
    await refreshConnection();
    if (elements.uuidTab.classList.contains('is-active')) await refreshUuid();
  });
  void refreshConnection();
}

module.exports = {
  extractIdentifiers,
  extractUuid,
  initializeWosSidePanelTools
};

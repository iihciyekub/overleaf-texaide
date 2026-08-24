'use strict';

const { message } = require('./i18n');
const {
  normalizeDoi,
  normalizeCrossrefItem,
  normalizePersistedCrossrefRecord,
  buildBibtex
} = require('./crossref-bib');
const { renderCslBibliography, wordClipboardFragment, wordClipboardHtml } = require('./crossref-csl');
const { referenceHtmlToDocxBlob } = require('./crossref-docx');
const {
  getActiveStyleId,
  getStyle,
  installOfficialStyle,
  installedStyles,
  searchOfficialStyles,
  setActiveStyleId
} = require('./crossref-style-store');

const CROSSREF_HISTORY_KEY = 'wosAideCrossrefHistory';
const CROSSREF_QUERY_HISTORY_KEY = 'wosAideCrossrefQueryHistory';
const CROSSREF_CACHE_KEY = 'wosAideCrossrefCache';
const CROSSREF_REFERENCES_WRAP_KEY = 'wosAideCrossrefReferencesWrap';
const MAX_HISTORY_ITEMS = 100;
const MAX_QUERY_HISTORY_ITEMS = 30;
const MAX_SEARCH_RESULTS = 20;
const CROSSREF_FILE_EXTENSIONS = new Set(['txt', 'md', 'json', 'xml', 'ris', 'csv', 'bib']);

const storageGet = keys => new Promise(resolve => chrome.storage.local.get(keys, result => resolve(result || {})));
const storageSet = values => new Promise(resolve => chrome.storage.local.set(values, resolve));

const crossrefUrlForQuery = query => {
  const normalized = normalizeDoi(query);
  if (/^10\.\d{4,9}\/\S+$/i.test(normalized)) {
    return `https://api.crossref.org/works/${encodeURIComponent(normalized)}`;
  }
  const params = new URLSearchParams({ rows: String(MAX_SEARCH_RESULTS), 'query.bibliographic': String(query || '').trim() });
  return `https://api.crossref.org/works?${params}`;
};

const normalizeCrossrefQueryHistory = (items, limit = MAX_QUERY_HISTORY_ITEMS) => {
  const unique = new Set();
  return (Array.isArray(items) ? items : [])
    .map(value => String(value || '').trim())
    .filter(value => {
      if (!value || unique.has(value)) return false;
      unique.add(value);
      return true;
    })
    .slice(0, Math.max(1, Number(limit || MAX_QUERY_HISTORY_ITEMS)));
};

const addCrossrefQueryHistory = (items, query) => normalizeCrossrefQueryHistory([
  String(query || '').trim(),
  ...(Array.isArray(items) ? items : [])
]);

const navigateCrossrefQueryHistory = (items, currentIndex, direction) => {
  const historyItems = normalizeCrossrefQueryHistory(items);
  if (!historyItems.length) return { index: -1, value: '' };
  if (direction < 0) {
    const index = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, historyItems.length - 1);
    return { index, value: historyItems[index] };
  }
  const index = currentIndex > 0 ? currentIndex - 1 : -1;
  return { index, value: index >= 0 ? historyItems[index] : '' };
};

const initializeCrossrefPanel = () => {
  const elements = {
    parentTab: document.getElementById('tabCrossref'),
    tabs: [
      document.getElementById('crossrefSearchSubTab'),
      document.getElementById('crossrefPreviewSubTab'),
      document.getElementById('crossrefReferencesSubTab'),
      document.getElementById('crossrefHistorySubTab')
    ],
    panels: [
      document.getElementById('crossrefSearchSubPanel'),
      document.getElementById('crossrefPreviewSubPanel'),
      document.getElementById('crossrefReferencesSubPanel'),
      document.getElementById('crossrefHistorySubPanel')
    ],
    form: document.getElementById('crossrefSearchForm'),
    input: document.getElementById('crossrefSearchInput'),
    searchBtn: document.getElementById('crossrefSearchBtn'),
    clearInputBtn: document.getElementById('crossrefClearInputBtn'),
    batchInputCount: document.getElementById('crossrefBatchInputCount'),
    batchProgress: document.getElementById('crossrefBatchProgress'),
    batchProgressBar: document.getElementById('crossrefBatchProgressBar'),
    batchProgressText: document.getElementById('crossrefBatchProgressText'),
    searchStatus: document.getElementById('crossrefSearchStatus'),
    results: document.getElementById('crossrefSearchResults'),
    resultCount: document.getElementById('crossrefResultCount'),
    selectAllResults: document.getElementById('crossrefSelectAllResults'),
    preview: document.getElementById('crossrefBibPreview'),
    previewCount: document.getElementById('crossrefPreviewCount'),
    previewStatus: document.getElementById('crossrefPreviewStatus'),
    copyPreviewBtn: document.getElementById('crossrefCopyPreviewBtn'),
    exportPreviewBtn: document.getElementById('crossrefExportPreviewBtn'),
    referencesPanel: document.getElementById('crossrefReferencesSubPanel'),
    referencesPreview: document.getElementById('crossrefReferencesPreview'),
    referencesCount: document.getElementById('crossrefReferencesCount'),
    referencesStatus: document.getElementById('crossrefReferencesStatus'),
    copyReferencesBtn: document.getElementById('crossrefCopyReferencesBtn'),
    exportReferencesBtn: document.getElementById('crossrefExportReferencesBtn'),
    referenceWrapBtn: document.getElementById('crossrefReferenceWrapBtn'),
    cslStyleSelect: document.getElementById('crossrefCslStyleSelect'),
    cslStyleOfficialName: document.getElementById('crossrefCslStyleOfficialName'),
    openStyleManagerBtn: document.getElementById('crossrefOpenStyleManagerBtn'),
    closeStyleManagerBtn: document.getElementById('crossrefCloseStyleManagerBtn'),
    cslManager: document.getElementById('crossrefCslManager'),
    cslSearchForm: document.getElementById('crossrefCslSearchForm'),
    cslSearchInput: document.getElementById('crossrefCslSearchInput'),
    cslSearchBtn: document.getElementById('crossrefCslSearchBtn'),
    cslSearchStatus: document.getElementById('crossrefCslSearchStatus'),
    cslSearchResults: document.getElementById('crossrefCslSearchResults'),
    history: document.getElementById('crossrefHistoryList'),
    historyEmpty: document.getElementById('crossrefHistoryEmpty'),
    historyStatus: document.getElementById('crossrefHistoryStatus'),
    selectAllHistory: document.getElementById('crossrefSelectAllHistory'),
    restoreHistoryBtn: document.getElementById('crossrefRestoreHistoryBtn'),
    copyHistoryBtn: document.getElementById('crossrefCopyHistoryBtn'),
    exportHistoryBtn: document.getElementById('crossrefExportHistoryBtn'),
    clearHistoryBtn: document.getElementById('crossrefClearHistoryBtn'),
    clearAllHistoryBtn: document.getElementById('crossrefClearAllHistoryBtn')
  };
  if (!elements.form || elements.tabs.some(tab => !tab) || elements.panels.some(panel => !panel)) return;

  let results = [];
  let history = [];
  let cache = [];
  let queryHistory = [];
  let queryHistoryIndex = -1;
  let activeStyle = null;
  let referencesOutput = { html: '', text: '', entryCount: 0 };
  let referencesRenderVersion = 0;
  let wrapReferences = false;
  const selectedIds = new Set();

  const language = () => document.documentElement.lang.startsWith('zh') ? 'zh' : 'en';
  const t = key => message(language(), key);
  const citationLocale = () => language() === 'zh' ? 'zh-CN' : 'en-US';
  const renderCslStyleOfficialName = style => {
    if (!elements.cslStyleOfficialName) return;
    const name = String(style?.label || style?.id || '').trim();
    elements.cslStyleOfficialName.textContent = name
      ? t('crossref.cslOfficialName').replace('{name}', name)
      : '';
    elements.cslStyleOfficialName.title = name;
  };
  const applyReferencesWrap = () => {
    elements.referencesPreview.classList.toggle('is-wrapped', wrapReferences);
    elements.referenceWrapBtn.setAttribute('aria-pressed', String(wrapReferences));
  };
  const updateBatchInputCount = () => {
    if (!elements.batchInputCount) return;
    const count = elements.input.value.split(/\r?\n/).filter(value => value.trim()).length;
    elements.batchInputCount.textContent = t('crossref.batchInputCount').replace('{count}', String(count));
  };
  const applyQueryHistoryNavigation = direction => {
    const navigation = navigateCrossrefQueryHistory(queryHistory, queryHistoryIndex, direction);
    queryHistoryIndex = navigation.index;
    elements.input.value = navigation.value;
    elements.input.setSelectionRange(elements.input.value.length, elements.input.value.length);
    updateBatchInputCount();
  };
  const extractDoisFromText = text => {
    const found = [];
    const seen = new Set();
    const pattern = /\b(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*|urn:doi:\s*)?(10\.\d{4,9}\/[^\s"'<>()\[\],;]+)/gi;
    let match;
    while ((match = pattern.exec(String(text || ''))) !== null) {
      const doi = (match[1] || match[0]).replace(/[.,;:)\]}]+$/g, '').trim().toLowerCase();
      if (doi && !seen.has(doi)) { seen.add(doi); found.push(doi); }
    }
    return found;
  };
  const setFileDropActive = active => elements.input.classList.toggle('is-file-dragover', active);
  const isFileDrag = event => Boolean(event.dataTransfer?.files?.length || Array.from(event.dataTransfer?.types || []).includes('Files'));
  let fileDragDepth = 0;
  elements.input.addEventListener('dragenter', event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    fileDragDepth += 1;
    setFileDropActive(true);
  });
  elements.input.addEventListener('dragover', event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  elements.input.addEventListener('dragleave', event => {
    event.preventDefault();
    fileDragDepth = Math.max(0, fileDragDepth - 1);
    if (!fileDragDepth) setFileDropActive(false);
  });
  elements.input.addEventListener('drop', event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    fileDragDepth = 0;
    setFileDropActive(false);
    const files = Array.from(event.dataTransfer?.files || []);
    const unsupported = files.find(file => !CROSSREF_FILE_EXTENSIONS.has(String(file.name || '').split('.').pop()?.toLowerCase()));
    if (unsupported) {
      setStatus(elements.searchStatus, t('crossref.fileUnsupported').replace('{file}', unsupported.name || '-'), 'error');
      return;
    }
    void Promise.all(files.map(file => file.text())).then(contents => {
      const dois = extractDoisFromText(contents.join('\n'));
      if (!dois.length) {
        setStatus(elements.searchStatus, t('crossref.fileNoDoi'), 'error');
        return;
      }
      const current = elements.input.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      elements.input.value = [...current, ...dois].join('\n');
      queryHistoryIndex = -1;
      updateBatchInputCount();
      setStatus(elements.searchStatus, t('crossref.fileImported').replace('{count}', String(dois.length)), 'success');
    }).catch(error => setStatus(elements.searchStatus, `${t('crossref.fileReadFailed')}: ${error.message || error}`, 'error'));
  });
  const selectedRecords = () => history.filter(record => selectedIds.has(record.id));
  const retainHistoryLimit = records => {
    const favorites = records.filter(record => record.favorite);
    const unstarred = records.filter(record => !record.favorite)
      .slice(0, Math.max(0, MAX_HISTORY_ITEMS - favorites.length));
    return [...favorites, ...unstarred];
  };

  const setStatus = (element, text, variant = 'muted') => {
    if (!element) return;
    element.textContent = text;
    element.className = `helper status--${variant}`;
  };

  const setSubPanel = panelId => {
    const selectedPanel = elements.panels.find(panel => panel.id === panelId) || elements.panels[0];
    elements.panels.forEach(panel => { panel.hidden = panel !== selectedPanel; });
    elements.tabs.forEach((tab, index) => {
      const active = elements.panels[index] === selectedPanel;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    if (selectedPanel === elements.referencesPanel) void renderReferencesPreview(selectedRecords());
    else setStyleManagerOpen(false);
    void storageSet({ wosAideCrossrefSubTab: selectedPanel?.id });
  };

  const authorSummary = record => {
    const names = (Array.isArray(record.authors) ? record.authors : []).map(author => [author.given, author.family].filter(Boolean).join(' ') || author.literal).filter(Boolean);
    return names.length > 3 ? `${names.slice(0, 3).join(', ')} et al.` : names.join(', ');
  };

  const updateSelectAll = (checkbox, records) => {
    const selectedCount = records.filter(record => selectedIds.has(record.id)).length;
    checkbox.checked = records.length > 0 && selectedCount === records.length;
    checkbox.indeterminate = selectedCount > 0 && selectedCount < records.length;
    checkbox.disabled = records.length === 0;
  };

  const renderReferencesEmpty = text => {
    const empty = document.createElement('div');
    empty.className = 'crossref-empty';
    empty.textContent = text;
    elements.referencesPreview.replaceChildren(empty);
  };

  const setStyleManagerOpen = open => {
    const visible = Boolean(open);
    elements.cslManager.hidden = !visible;
    elements.openStyleManagerBtn.setAttribute('aria-expanded', String(visible));
    if (visible) elements.cslSearchInput.focus();
  };

  const refreshStyleOptions = async () => {
    const styles = await installedStyles();
    const activeId = activeStyle?.id || await getActiveStyleId();
    activeStyle = await getStyle(activeId) || await getStyle('apa');
    elements.cslStyleSelect.replaceChildren(...styles.map(style => {
      const option = document.createElement('option');
      option.value = style.id;
      option.textContent = style.label;
      option.selected = style.id === activeStyle.id;
      return option;
    }));
    renderCslStyleOfficialName(activeStyle);
    return styles;
  };

  const renderReferencesPreview = async records => {
    const renderVersion = ++referencesRenderVersion;
    referencesOutput = { html: '', text: '', entryCount: 0 };
    elements.copyReferencesBtn.disabled = true;
    elements.exportReferencesBtn.disabled = true;
    if (!records.length) {
      renderReferencesEmpty(t('crossref.referencesEmpty'));
      return;
    }
    renderReferencesEmpty(t('crossref.generatingReferences'));
    try {
      if (!activeStyle) {
        const activeId = await getActiveStyleId();
        activeStyle = await getStyle(activeId) || await getStyle('apa');
      }
      const output = renderCslBibliography(records, activeStyle, citationLocale());
      if (renderVersion !== referencesRenderVersion) return;
      referencesOutput = output;
      elements.referencesPreview.innerHTML = output.html;
      elements.copyReferencesBtn.disabled = false;
      elements.exportReferencesBtn.disabled = false;
      setStatus(elements.referencesStatus, '', 'muted');
    } catch (error) {
      if (renderVersion !== referencesRenderVersion) return;
      renderReferencesEmpty(`${t('crossref.referencesFailed')}: ${error.message || error}`);
      setStatus(elements.referencesStatus, `${t('crossref.referencesFailed')}: ${error.message || error}`, 'error');
    }
  };

  const activateStyle = async style => {
    await setActiveStyleId(style.id);
    activeStyle = style;
    await refreshStyleOptions();
    await renderReferencesPreview(selectedRecords());
    setStatus(elements.cslSearchStatus, t('crossref.cslApplied').replace('{style}', style.label), 'success');
  };

  const renderOfficialStyleResults = styles => {
    elements.cslSearchResults.replaceChildren(...styles.map(style => {
      const button = document.createElement('button');
      button.className = `crossref-csl-result${style.installed ? ' is-installed' : ''}`;
      button.type = 'button';
      const label = document.createElement('span');
      label.textContent = style.label;
      const status = document.createElement('small');
      status.textContent = t(style.installed ? 'crossref.cslInstalled' : 'crossref.cslInstall');
      button.append(label, status);
      button.addEventListener('click', async () => {
        button.disabled = true;
        status.textContent = t(style.installed ? 'crossref.cslApplying' : 'crossref.cslInstalling');
        try {
          const installed = style.installed ? await getStyle(style.id) : await installOfficialStyle(style);
          if (!installed) throw new Error('The installed style could not be loaded.');
          await activateStyle(installed);
          style.installed = true;
          button.classList.add('is-installed');
          status.textContent = t('crossref.cslInstalled');
        } catch (error) {
          setStatus(elements.cslSearchStatus, `${t('crossref.cslInstallFailed')}: ${error.message || error}`, 'error');
          status.textContent = t('crossref.cslInstall');
        } finally {
          button.disabled = false;
        }
      });
      return button;
    }));
  };

  const searchCslStyles = async () => {
    const query = elements.cslSearchInput.value.trim();
    if (query.length < 2) {
      setStatus(elements.cslSearchStatus, t('crossref.cslSearchMinimum'), 'error');
      elements.cslSearchInput.focus();
      return;
    }
    elements.cslSearchBtn.disabled = true;
    setStatus(elements.cslSearchStatus, t('crossref.cslSearching'), 'info');
    try {
      const styles = await searchOfficialStyles(query);
      renderOfficialStyleResults(styles);
      setStatus(elements.cslSearchStatus, styles.length
        ? t('crossref.cslSearchResults').replace('{count}', String(styles.length))
        : t('crossref.cslNoResults'), styles.length ? 'success' : 'muted');
    } catch (error) {
      setStatus(elements.cslSearchStatus, `${t('crossref.cslSearchFailed')}: ${error.message || error}`, 'error');
    } finally {
      elements.cslSearchBtn.disabled = false;
    }
  };

  const updateActions = () => {
    const records = selectedRecords();
    const enabled = records.length > 0;
    elements.copyPreviewBtn.disabled = !enabled;
    elements.exportPreviewBtn.disabled = !enabled;
    elements.copyReferencesBtn.disabled = true;
    elements.exportReferencesBtn.disabled = true;
    elements.restoreHistoryBtn.disabled = !enabled;
    elements.copyHistoryBtn.disabled = !enabled;
    elements.exportHistoryBtn.disabled = !enabled;
    elements.previewCount.textContent = enabled ? `${records.length} ${t('crossref.selectedCount')}` : t('crossref.noneSelected');
    elements.referencesCount.textContent = enabled ? `${records.length} ${t('crossref.selectedCount')}` : t('crossref.noneSelected');
    elements.preview.textContent = enabled ? buildBibtex(records) : t('crossref.previewEmpty');
    referencesOutput = { html: '', text: '', entryCount: 0 };
    if (!elements.referencesPanel.hidden) void renderReferencesPreview(records);
    updateSelectAll(elements.selectAllResults, results);
    updateSelectAll(elements.selectAllHistory, history);
  };

  const toggleRecord = (record, checked) => {
    if (checked) selectedIds.add(record.id);
    else selectedIds.delete(record.id);
    renderLists();
  };

  const isFavoriteRecord = record => Boolean(
    history.find(item => item.id === record.id)?.favorite
  );

  const toggleFavorite = async record => {
    const existing = history.find(item => item.id === record.id);
    const updated = {
      ...(existing || record),
      query: existing?.query || elements.input.value.trim(),
      queriedAt: existing?.queriedAt || Date.now(),
      favorite: !Boolean(existing?.favorite)
    };
    history = retainHistoryLimit([
      updated,
      ...history.filter(item => item.id !== record.id)
    ]);
    await storageSet({ [CROSSREF_HISTORY_KEY]: history });
    renderLists();
  };

  const createRecordRow = (record, isHistory = false) => {
    const shell = document.createElement('div');
    shell.className = 'crossref-record-row-shell has-favorite';
    const label = document.createElement('label');
    label.className = 'crossref-record-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedIds.has(record.id);
    checkbox.setAttribute('aria-label', record.title || record.doi);
    checkbox.addEventListener('change', () => toggleRecord(record, checkbox.checked));
    const content = document.createElement('span');
    content.className = 'crossref-record-content';
    const title = document.createElement('strong');
    title.textContent = record.title || record.doi;
    const metadata = document.createElement('span');
    metadata.textContent = [authorSummary(record), record.journal, record.year].filter(Boolean).join(' · ');
    const doi = document.createElement('code');
    doi.textContent = record.doi || record.url;
    content.append(title, metadata, doi);
    label.append(checkbox, content);
    shell.appendChild(label);
    {
      const favorite = document.createElement('button');
      const isFavorite = isFavoriteRecord(record);
      favorite.className = `history-favorite-button${isFavorite ? ' is-favorite' : ''}`;
      favorite.type = 'button';
      favorite.title = t(isFavorite ? 'history.unfavorite' : 'history.favorite');
      favorite.setAttribute('aria-label', `${favorite.title}: ${record.title || record.doi}`);
      favorite.setAttribute('aria-pressed', String(isFavorite));
      favorite.innerHTML = `<i class="fa-${isFavorite ? 'solid' : 'regular'} fa-star" aria-hidden="true"></i>`;
      favorite.addEventListener('pointerdown', event => {
        event.preventDefault();
        event.stopPropagation();
      });
      favorite.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        void toggleFavorite(record);
      });
      shell.appendChild(favorite);
    }
    return shell;
  };

  const renderList = (container, records, isHistory = false) => {
    container.replaceChildren(...records.map(record => createRecordRow(record, isHistory)));
  };

  function renderLists() {
    renderList(elements.results, results);
    renderList(elements.history, history, true);
    elements.resultCount.textContent = `${results.length} ${t('crossref.results')}`;
    elements.historyEmpty.hidden = history.length > 0;
    updateActions();
  }

  const mergeHistory = async (records, query) => {
    const now = Date.now();
    const favoriteIds = new Set(history.filter(record => record.favorite).map(record => record.id));
    const incoming = records.map(record => ({ ...record, query, queriedAt: now, favorite: favoriteIds.has(record.id) }));
    const incomingIds = new Set(incoming.map(record => record.id));
    history = retainHistoryLimit([...incoming, ...history.filter(record => !incomingIds.has(record.id))]);
    const cacheById = new Map(cache.map(record => [record.id, record]));
    incoming.forEach(record => cacheById.set(record.id, record));
    cache = Array.from(cacheById.values()).slice(-500);
    await storageSet({ [CROSSREF_HISTORY_KEY]: history, [CROSSREF_CACHE_KEY]: cache });
  };

  const exactDoiFromQuery = query => {
    const normalized = normalizeDoi(query);
    return /^10\.\d{4,9}\/\S+$/i.test(normalized) ? normalized : '';
  };

  const setBatchProgress = (current, total, visible = true) => {
    if (!elements.batchProgress || !elements.batchProgressBar || !elements.batchProgressText) return;
    elements.batchProgress.hidden = !visible;
    const percentage = total > 0 ? Math.round(current / total * 100) : 0;
    elements.batchProgressBar.style.width = `${percentage}%`;
    elements.batchProgressText.textContent = t('crossref.batchProgress')
      .replace('{current}', String(current)).replace('{total}', String(total));
  };

  const recordsForPayload = payload => {
    const items = Array.isArray(payload?.message?.items) ? payload.message.items : payload?.message ? [payload.message] : [];
    const ranked = items.map((item, index) => ({
      record: normalizeCrossrefItem(item),
      score: Number.isFinite(Number(item?.score)) ? Number(item.score) : 0,
      index
    })).filter(({ record }) => record.id && (record.title || record.doi));
    ranked.sort((left, right) => right.score - left.score || left.index - right.index);
    const unique = new Map();
    ranked.forEach(({ record }) => { if (!unique.has(record.id)) unique.set(record.id, record); });
    return Array.from(unique.values()).slice(0, 3);
  };

  const runSearch = async () => {
    const queryText = elements.input.value.trim();
    const queries = [];
    const seenQueries = new Set();
    queryText.split(/\r?\n/).map(value => value.trim()).filter(Boolean).forEach(query => {
      const key = exactDoiFromQuery(query) || query.toLocaleLowerCase();
      if (seenQueries.has(key)) return;
      seenQueries.add(key);
      queries.push(query);
    });
    if (!queries.length) {
      setStatus(elements.searchStatus, t('crossref.ready'));
      elements.input.focus();
      return;
    }
    elements.searchBtn.disabled = true;
    queryHistory = addCrossrefQueryHistory(queryHistory, queryText);
    queryHistoryIndex = -1;
    await storageSet({ [CROSSREF_QUERY_HISTORY_KEY]: queryHistory });
    setBatchProgress(0, queries.length);
    setStatus(elements.searchStatus, t('crossref.searching'), 'info');
    const merged = new Map();
    let failures = 0;
    let restored = 0;
    const historyByDoi = new Map([...cache, ...history].filter(record => record?.doi).map(record => [normalizeDoi(record.doi), record]));
    try {
      for (let index = 0; index < queries.length; index += 1) {
        const cachedDoi = exactDoiFromQuery(queries[index]);
        const cachedRecord = cachedDoi ? historyByDoi.get(cachedDoi) : null;
        if (cachedRecord) {
          merged.set(cachedRecord.id, cachedRecord);
          restored += 1;
          setBatchProgress(index + 1, queries.length);
          continue;
        }
        try {
          const response = await fetch(crossrefUrlForQuery(queries[index]), {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(15000)
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const records = recordsForPayload(await response.json());
          records.forEach(record => { if (!merged.has(record.id)) merged.set(record.id, record); });
        } catch (_error) {
          failures += 1;
        }
        setBatchProgress(index + 1, queries.length);
      }
      results = Array.from(merged.values());
      await mergeHistory(results, queries.join('\n'));
      renderLists();
      const status = results.length ? `${results.length} ${t('crossref.results')}` : t('crossref.noResults');
      const restoredNote = restored ? ` (${t('crossref.cacheRestored').replace('{count}', String(restored))})` : '';
      const failureNote = failures
        ? ` (${t('crossref.batchFailed').replace('{failed}', String(failures)).replace('{total}', String(queries.length))})`
        : '';
      setStatus(elements.searchStatus, `${status}${restoredNote}${failureNote}`, results.length ? 'success' : 'muted');
    } catch (error) {
      setStatus(elements.searchStatus, `${t('crossref.searchFailed')}: ${error.message || error}`, 'error');
    } finally {
      elements.searchBtn.disabled = false;
      window.setTimeout(() => setBatchProgress(0, 0, false), 500);
    }
  };

  const copyText = async text => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (_error) {
        // Continue with the selection-based fallback below.
      }
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Clipboard access was denied.');
  };

  const copyRichText = async (html, text) => {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      try {
        const item = new ClipboardItem({
          'text/html': new Blob([wordClipboardHtml(html)], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        });
        await navigator.clipboard.write([item]);
        return;
      } catch (_error) {
        // Some browsers expose clipboard.write but deny HTML writes.
      }
    }
    const container = document.createElement('div');
    container.contentEditable = 'true';
    container.style.position = 'fixed';
    container.style.left = '-10000px';
    container.innerHTML = wordClipboardFragment(html);
    document.body.appendChild(container);
    const selection = window.getSelection();
    let copied = false;
    try {
      const range = document.createRange();
      range.selectNodeContents(container);
      selection?.removeAllRanges();
      selection?.addRange(range);
      copied = document.execCommand('copy');
    } catch (_error) {
      copied = false;
    } finally {
      selection?.removeAllRanges();
      container.remove();
    }
    if (!copied) await copyText(text);
  };

  const copySelected = async (format = 'bibtex') => {
    const bibtex = buildBibtex(selectedRecords());
    if (!bibtex) return;
    try {
      if (format === 'references') {
        if (!referencesOutput.html || !referencesOutput.text) return;
        await copyRichText(referencesOutput.html, referencesOutput.text);
        setStatus(elements.referencesStatus, t('crossref.referencesCopied'), 'success');
      } else {
        await copyText(bibtex);
        setStatus(elements.previewStatus, t('crossref.copied'), 'success');
        setStatus(elements.historyStatus, t('crossref.copied'), 'success');
      }
    } catch (error) {
      setStatus(format === 'references' ? elements.referencesStatus : elements.previewStatus, error.message || String(error), 'error');
      if (format === 'bibtex') setStatus(elements.historyStatus, error.message || String(error), 'error');
    }
  };

  const exportSelected = () => {
    const bibtex = buildBibtex(selectedRecords());
    if (!bibtex) return;
    const url = URL.createObjectURL(new Blob([`${bibtex}\n`], { type: 'application/x-bibtex;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `crossref-${new Date().toISOString().slice(0, 10)}.bib`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(elements.previewStatus, t('crossref.exported'), 'success');
    setStatus(elements.historyStatus, t('crossref.exported'), 'success');
  };

  const exportReferences = async () => {
    if (!referencesOutput.html) return;
    elements.exportReferencesBtn.disabled = true;
    setStatus(elements.referencesStatus, t('crossref.exportingDocx'), 'info');
    try {
      const blob = await referenceHtmlToDocxBlob(referencesOutput.html);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `crossref-references-${new Date().toISOString().slice(0, 10)}.docx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(elements.referencesStatus, t('crossref.docxExported'), 'success');
    } catch (error) {
      setStatus(elements.referencesStatus, `${t('crossref.docxExportFailed')}: ${error.message || error}`, 'error');
    } finally {
      elements.exportReferencesBtn.disabled = !referencesOutput.html;
    }
  };

  const selectRecords = (records, checked) => {
    records.forEach(record => checked ? selectedIds.add(record.id) : selectedIds.delete(record.id));
    renderLists();
  };

  const restoreSelectedHistory = () => {
    const restored = selectedRecords();
    if (!restored.length) return;
    results = restored;
    const queries = [...new Set(restored.map(record => String(record.query || '').trim()).filter(Boolean))];
    elements.input.value = queries.length === 1
      ? queries[0]
      : restored.map(record => record.doi || record.title).filter(Boolean).join('\n');
    queryHistoryIndex = -1;
    updateBatchInputCount();
    renderLists();
    setSubPanel('crossrefSearchSubPanel');
    setStatus(elements.searchStatus, t('crossref.historyRestored').replace('{count}', String(restored.length)), 'success');
  };

  elements.form.addEventListener('submit', event => {
    event.preventDefault();
    void runSearch();
  });
  elements.input.addEventListener('input', () => {
    queryHistoryIndex = -1;
    updateBatchInputCount();
  });
  elements.input.addEventListener('keydown', event => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' || event.altKey || event.shiftKey) return;
    const direction = event.key === 'ArrowUp' ? -1 : 1;
    const forced = event.ctrlKey || event.metaKey;
    const selectionCollapsed = elements.input.selectionStart === elements.input.selectionEnd;
    const beforeCaret = elements.input.value.slice(0, elements.input.selectionStart || 0);
    const afterCaret = elements.input.value.slice(elements.input.selectionStart || 0);
    const atBoundary = direction < 0 ? !beforeCaret.includes('\n') : !afterCaret.includes('\n');
    const browsingHistory = queryHistoryIndex >= 0;
    if (!queryHistory.length || direction > 0 && !browsingHistory || !forced && !browsingHistory && (!selectionCollapsed || !atBoundary)) return;
    event.preventDefault();
    applyQueryHistoryNavigation(direction);
  });
  elements.clearInputBtn?.addEventListener('click', () => {
    elements.input.value = '';
    queryHistoryIndex = -1;
    results = [];
    selectedIds.clear();
    renderLists();
    setStatus(elements.searchStatus, t('crossref.ready'));
    elements.input.focus();
    updateBatchInputCount();
  });
  elements.tabs.forEach((tab, index) => tab.addEventListener('click', () => setSubPanel(elements.panels[index].id)));
  elements.parentTab?.addEventListener('click', () => setSubPanel('crossrefSearchSubPanel'));
  elements.selectAllResults.addEventListener('change', () => selectRecords(results, elements.selectAllResults.checked));
  elements.selectAllHistory.addEventListener('change', () => selectRecords(history, elements.selectAllHistory.checked));
  elements.cslStyleSelect.addEventListener('change', async () => {
    const style = await getStyle(elements.cslStyleSelect.value);
    if (!style) return;
    try {
      await activateStyle(style);
    } catch (error) {
      setStatus(elements.referencesStatus, `${t('crossref.referencesFailed')}: ${error.message || error}`, 'error');
    }
  });
  elements.openStyleManagerBtn.addEventListener('click', () => setStyleManagerOpen(elements.cslManager.hidden));
  elements.closeStyleManagerBtn.addEventListener('click', () => setStyleManagerOpen(false));
  elements.cslSearchForm.addEventListener('submit', event => {
    event.preventDefault();
    void searchCslStyles();
  });
  elements.copyPreviewBtn.addEventListener('click', () => { void copySelected('bibtex'); });
  elements.copyReferencesBtn.addEventListener('click', () => { void copySelected('references'); });
  elements.exportReferencesBtn.addEventListener('click', () => { void exportReferences(); });
  elements.referenceWrapBtn.addEventListener('click', () => {
    wrapReferences = !wrapReferences;
    applyReferencesWrap();
    void storageSet({ [CROSSREF_REFERENCES_WRAP_KEY]: wrapReferences });
  });
  elements.restoreHistoryBtn.addEventListener('click', restoreSelectedHistory);
  elements.copyHistoryBtn.addEventListener('click', () => { void copySelected('bibtex'); });
  elements.exportPreviewBtn.addEventListener('click', exportSelected);
  elements.exportHistoryBtn.addEventListener('click', exportSelected);
  elements.clearHistoryBtn.addEventListener('click', async () => {
    const checkedHistory = history.filter(record => selectedIds.has(record.id));
    const keepsChecked = checkedHistory.length > 0;
    if (!window.confirm(t(keepsChecked ? 'crossref.clearUnselectedConfirm' : 'crossref.clearConfirm'))) return;
    history = history.filter(record => record.favorite || selectedIds.has(record.id));
    if (!keepsChecked) {
      results = [];
      selectedIds.clear();
    }
    await storageSet({ [CROSSREF_HISTORY_KEY]: history });
    renderLists();
    setStatus(elements.searchStatus, t('crossref.ready'));
  });
  elements.clearAllHistoryBtn?.addEventListener('click', async () => {
    if (!window.confirm(t('crossref.clearAllConfirm'))) return;
    history = [];
    queryHistory = [];
    queryHistoryIndex = -1;
    results = [];
    selectedIds.clear();
    cache = [];
    await storageSet({ [CROSSREF_HISTORY_KEY]: [], [CROSSREF_QUERY_HISTORY_KEY]: [], [CROSSREF_CACHE_KEY]: [] });
    renderLists();
    setStatus(elements.searchStatus, t('crossref.ready'));
  });
  document.addEventListener('wos-aide:language-changed', () => {
    renderLists();
    updateBatchInputCount();
    void refreshStyleOptions();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !elements.cslManager.hidden) setStyleManagerOpen(false);
  });

  void Promise.all([
    storageGet([CROSSREF_HISTORY_KEY, CROSSREF_QUERY_HISTORY_KEY, CROSSREF_CACHE_KEY, CROSSREF_REFERENCES_WRAP_KEY, 'wosAideCrossrefSubTab']),
    getActiveStyleId()
  ]).then(async ([stored, activeStyleId]) => {
    const storedHistory = Array.isArray(stored[CROSSREF_HISTORY_KEY]) ? stored[CROSSREF_HISTORY_KEY] : [];
    history = retainHistoryLimit(storedHistory.map(normalizePersistedCrossrefRecord).filter(record => record?.id));
    const storedCache = Array.isArray(stored[CROSSREF_CACHE_KEY]) ? stored[CROSSREF_CACHE_KEY] : [];
    cache = [...storedCache, ...history].map(normalizePersistedCrossrefRecord).filter(record => record?.id)
      .filter((record, index, records) => records.findIndex(item => item.id === record.id) === index).slice(-500);
    queryHistory = normalizeCrossrefQueryHistory(stored[CROSSREF_QUERY_HISTORY_KEY]);
    wrapReferences = stored[CROSSREF_REFERENCES_WRAP_KEY] === true;
    applyReferencesWrap();
    if (!queryHistory.length) {
      queryHistory = normalizeCrossrefQueryHistory([...history]
        .sort((left, right) => Number(right.queriedAt || 0) - Number(left.queriedAt || 0))
        .map(record => record.query));
    }
    if (storedHistory.length || storedCache.length) await storageSet({ [CROSSREF_HISTORY_KEY]: history, [CROSSREF_CACHE_KEY]: cache });
    activeStyle = await getStyle(activeStyleId) || await getStyle('apa');
    await refreshStyleOptions();
    renderLists();
    const savedSubTab = stored.wosAideCrossrefSubTab;
    setSubPanel(elements.panels.some(panel => panel.id === savedSubTab) ? savedSubTab : 'crossrefSearchSubPanel');
  }).catch(error => {
    setStatus(elements.referencesStatus, `${t('crossref.referencesFailed')}: ${error.message || error}`, 'error');
  });
  updateBatchInputCount();
};

module.exports = {
  CROSSREF_HISTORY_KEY,
  CROSSREF_QUERY_HISTORY_KEY,
  CROSSREF_CACHE_KEY,
  CROSSREF_REFERENCES_WRAP_KEY,
  MAX_HISTORY_ITEMS,
  MAX_QUERY_HISTORY_ITEMS,
  addCrossrefQueryHistory,
  crossrefUrlForQuery,
  initializeCrossrefPanel,
  navigateCrossrefQueryHistory,
  normalizeCrossrefQueryHistory
};

'use strict';

const {
  DEFAULT_LIBRARIES, LIBRARY_LIST_URL, extractDois, normalizeLibrary,
  normalizeLibraryList, resolveLibraryDoi, searchLibrariesDetailed
} = require('./library-access');
const { message } = require('./i18n');

const STORAGE_KEY = 'wosAideLibraryAccess';
const LIBRARY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_HISTORY_ITEMS = 200;
const DOI_FILE_EXTENSIONS = new Set(['txt', 'bib', 'md', 'json', 'xml', 'ris', 'csv']);
const MAX_DOI_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DOI_FILES = 20;
const getStorage = keys => new Promise(resolve => chrome.storage.local.get(keys, resolve));
const setStorage = value => new Promise(resolve => chrome.storage.local.set(value, resolve));
const accessHistoryId = item => `${item?.libraryId || ''}:${item?.doi || ''}`.toLocaleLowerCase('en-US');
const retainAccessHistory = (items, limit = MAX_HISTORY_ITEMS) => {
  let remainingUnstarred = Math.max(0, limit - items.filter(item => item.favorite).length);
  return items.filter(item => item.favorite || remainingUnstarred-- > 0);
};
const orderAccessHistory = items => [...items].sort(
  (left, right) => Number(Boolean(right.favorite)) - Number(Boolean(left.favorite))
);
const mergeAccessHistory = (history, incoming, limit = MAX_HISTORY_ITEMS) => {
  const incomingIds = new Set(incoming.map(accessHistoryId));
  return orderAccessHistory(retainAccessHistory([
    ...incoming,
    ...history.filter(item => !incomingIds.has(accessHistoryId(item)))
  ], limit));
};

function initializeLibraryAccess() {
  const elements = {
    parentTab: document.getElementById('tabLibraryAccess'),
    tabs: ['Query', 'Config', 'History'].map(name => document.getElementById(`libraryAccess${name}SubTab`)),
    panels: ['Query', 'Config', 'History'].map(name => document.getElementById(`libraryAccess${name}SubPanel`)),
    institutionSelect: document.getElementById('libraryAccessInstitutionSelect'),
    doiInput: document.getElementById('libraryAccessDoiInput'), count: document.getElementById('libraryAccessDoiCount'),
    clearDois: document.getElementById('clearLibraryAccessDoisBtn'),
    resolve: document.getElementById('resolveLibraryAccessBtn'), status: document.getElementById('libraryAccessStatus'),
    output: document.getElementById('libraryAccessResults'), configuredList: document.getElementById('libraryAccessConfiguredList'),
    configuredToggle: document.getElementById('libraryAccessConfiguredToggle'),
    configuredToggleIcon: document.getElementById('libraryAccessConfiguredToggleIcon'),
    configuredBody: document.getElementById('libraryAccessConfiguredBody'),
    search: document.getElementById('libraryAccessSearch'), searchMode: document.getElementById('libraryAccessSearchMode'),
    searchResults: document.getElementById('libraryAccessSearchResults'), configStatus: document.getElementById('libraryAccessConfigStatus'),
    historyList: document.getElementById('libraryAccessHistoryList'), historyEmpty: document.getElementById('libraryAccessHistoryEmpty'),
    clearHistory: document.getElementById('clearLibraryAccessHistoryBtn')
  };
  if (elements.tabs.some(tab => !tab) || elements.panels.some(panel => !panel) || !elements.clearDois || !elements.resolve) return;

  let libraryIndex = DEFAULT_LIBRARIES.slice();
  let configuredLibraries = DEFAULT_LIBRARIES.slice();
  let selectedLibraryId = configuredLibraries[0].libraryId;
  let history = [];
  let currentResults = [];
  let running = false;
  let autoResolveTimer = null;
  let storedState = {};
  const t = (key, tokens = {}) => Object.entries(tokens).reduce(
    (text, [token, value]) => text.replace(`{${token}}`, String(value)),
    message(document.documentElement.lang === 'en' ? 'en' : 'zh', key)
  );
  const selectedLibrary = () => configuredLibraries.find(library => library.libraryId === selectedLibraryId) || configuredLibraries[0] || null;
  const normalizeDoiInput = () => {
    const raw = elements.doiInput.value;
    const dois = extractDois(raw);
    if (!dois.length || raw.trim() === dois.join('\n')) return dois;
    const wasAtEnd = elements.doiInput.selectionStart === raw.length;
    elements.doiInput.value = dois.join('\n');
    if (wasAtEnd) elements.doiInput.selectionStart = elements.doiInput.selectionEnd = elements.doiInput.value.length;
    return dois;
  };
  const setStatus = (element, text, variant = 'muted') => {
    element.textContent = text;
    element.className = `helper status--${variant}`;
  };
  const persist = async () => {
    storedState = { ...storedState, configuredLibraries, selectedLibrary: selectedLibrary(), history };
    await setStorage({ [STORAGE_KEY]: storedState });
  };
  const setConfiguredCollapsed = collapsed => {
    const isCollapsed = Boolean(collapsed);
    elements.configuredBody.hidden = isCollapsed;
    elements.configuredToggle.setAttribute('aria-expanded', String(!isCollapsed));
    elements.configuredToggleIcon.className = `fa-solid fa-chevron-${isCollapsed ? 'down' : 'up'}`;
  };
  const setSubPanel = panelId => {
    const chosen = elements.panels.find(panel => panel.id === panelId) || elements.panels[0];
    elements.panels.forEach(panel => { panel.hidden = panel !== chosen; });
    elements.tabs.forEach((tab, index) => {
      const active = elements.panels[index] === chosen;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    chrome.storage.local.set({ wosAideLibraryAccessSubTab: chosen?.id });
  };
  const renderQueryControls = () => {
    const current = selectedLibrary();
    elements.institutionSelect.innerHTML = configuredLibraries.map(library =>
      `<option value="${escapeHtml(library.libraryId)}">${escapeHtml(library.name)} (${escapeHtml(library.libraryId)})</option>`
    ).join('');
    elements.institutionSelect.value = current?.libraryId || '';
    const dois = extractDois(elements.doiInput.value);
    elements.count.textContent = String(dois.length);
    elements.resolve.disabled = running || !current || !dois.length;
    elements.clearDois.disabled = running || elements.doiInput.value.length === 0;
    renderQueryResults();
  };
  const renderConfigured = () => {
    elements.configuredList.innerHTML = configuredLibraries.map(library => {
      const active = library.libraryId === selectedLibrary()?.libraryId;
      return `<div class="library-access-configured-row${active ? ' is-active' : ''}">
        <button type="button" data-select-library="${escapeHtml(library.libraryId)}"><i class="fa-${active ? 'solid fa-circle-check' : 'regular fa-circle'}" aria-hidden="true"></i><span>${escapeHtml(library.name)}</span><code>${escapeHtml(library.libraryId)}</code></button>
        <button class="icon-button" type="button" data-remove-library="${escapeHtml(library.libraryId)}" title="${escapeHtml(t('access.remove'))}" aria-label="${escapeHtml(t('access.remove'))}"${configuredLibraries.length === 1 ? ' disabled' : ''}><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
      </div>`;
    }).join('');
  };
  const renderSearchResults = () => {
    const query = elements.search.value.trim();
    if (!query) {
      setStatus(elements.configStatus, t('access.searchReady', { count: libraryIndex.length }));
      elements.searchResults.innerHTML = '';
      return;
    }
    const { matches, error } = searchLibrariesDetailed(libraryIndex, query, { mode: elements.searchMode.value, limit: 50 });
    if (error) {
      setStatus(elements.configStatus, t('access.invalidRegex'), 'error');
      elements.searchResults.innerHTML = '';
      return;
    }
    setStatus(elements.configStatus, matches.length ? t('access.matches', { count: matches.length }) : t('access.noMatch'), matches.length ? 'success' : 'muted');
    elements.searchResults.innerHTML = matches.map(library => {
      const saved = configuredLibraries.some(item => item.libraryId === library.libraryId);
      const aliases = library.aliases?.length ? `<small>${escapeHtml(library.aliases.slice(0, 2).join(' · '))}</small>` : '';
      let homepage = '';
      try {
        const url = new URL(library.homepage || '');
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          homepage = `<a class="library-access-search-homepage" href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer" data-library-homepage><i class="fa-solid fa-globe" aria-hidden="true"></i>${escapeHtml(url.hostname)}</a>`;
        }
      } catch (_error) { /* ignore malformed provider URLs */ }
      return `<button type="button" data-add-library="${escapeHtml(library.libraryId)}"${saved ? ' disabled' : ''}><span>${homepage}<strong>${escapeHtml(library.name)}</strong>${aliases}</span><span><code>${escapeHtml(library.libraryId)}</code><b>${escapeHtml(t(saved ? 'access.saved' : 'access.add'))}</b></span></button>`;
    }).join('');
  };
  const toggleFavorite = async item => {
    const id = accessHistoryId(item);
    const existing = history.find(record => accessHistoryId(record) === id);
    if (!existing) return;
    const favorite = !Boolean(existing.favorite);
    history = orderAccessHistory(history.map(record => accessHistoryId(record) === id ? { ...record, favorite } : record));
    currentResults = currentResults.map(record => accessHistoryId(record) === id ? { ...record, favorite } : record);
    await persist();
    renderQueryResults();
    renderHistory();
  };
  const renderRecordList = (container, items) => {
    container.replaceChildren();
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = `scholar-history-item library-access-record${item.status === 'pending' ? ' is-pending' : ''}${item.accessUrl ? ' has-url' : ''}`;
      const action = document.createElement('button');
      action.className = 'scholar-history-item__restore';
      action.type = 'button';
      const header = document.createElement('span');
      header.className = 'scholar-history-item__header';
      const doi = document.createElement('span');
      doi.className = 'scholar-history-item__journal';
      doi.textContent = item.doi;
      header.append(doi);
      const summary = document.createElement('span');
      summary.className = 'scholar-history-item__summary';
      summary.textContent = item.status === 'pending'
        ? t('access.pending')
        : item.error || item.libraryName || t('access.noAddress');
      action.append(header, summary);
      action.addEventListener('click', () => {
        if (item.accessUrl) chrome.tabs.create({ url: item.accessUrl, active: true });
      });
      row.append(action);
      if (item.status !== 'pending') {
        const actions = document.createElement('span');
        actions.className = 'library-access-record__actions';
        if (item.accessUrl) {
          const copy = document.createElement('button');
          copy.className = 'history-favorite-button';
          copy.type = 'button';
          copy.title = t('access.copy');
          copy.setAttribute('aria-label', `${copy.title}: ${item.doi}`);
          copy.innerHTML = '<i class="fa-regular fa-copy" aria-hidden="true"></i>';
          copy.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(item.accessUrl);
              setStatus(elements.status, t('access.copied'), 'success');
            } catch (error) {
              setStatus(elements.status, t('access.copyFailed', { error: error?.message || String(error) }), 'error');
            }
          });
          const open = document.createElement('button');
          open.className = 'history-favorite-button';
          open.type = 'button';
          open.title = t('access.open');
          open.setAttribute('aria-label', `${open.title}: ${item.doi}`);
          open.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>';
          open.addEventListener('click', () => chrome.tabs.create({ url: item.accessUrl, active: true }));
          actions.append(copy, open);
        }
        const favorite = document.createElement('button');
        favorite.className = `history-favorite-button${item.favorite ? ' is-favorite' : ''}`;
        favorite.type = 'button';
        favorite.title = t(item.favorite ? 'history.unfavorite' : 'history.favorite');
        favorite.setAttribute('aria-label', `${favorite.title}: ${item.doi}`);
        favorite.setAttribute('aria-pressed', String(Boolean(item.favorite)));
        favorite.innerHTML = `<i class="fa-${item.favorite ? 'solid' : 'regular'} fa-star" aria-hidden="true"></i>`;
        favorite.addEventListener('click', () => { void toggleFavorite(item); });
        actions.append(favorite);
        row.append(actions);
      }
      container.append(row);
    });
  };
  function renderQueryResults() {
    const library = selectedLibrary();
    const items = extractDois(elements.doiInput.value).map(doi =>
      currentResults.find(item => item.doi === doi && item.libraryId === library?.libraryId)
      || { doi, libraryId: library?.libraryId || '', libraryName: library?.name || '', status: 'pending', accessUrl: '' }
    );
    renderRecordList(elements.output, items);
  }
  const renderHistory = () => {
    const linkedHistory = history.filter(item => item.accessUrl);
    elements.historyEmpty.hidden = linkedHistory.length > 0;
    elements.clearHistory.disabled = linkedHistory.length === 0;
    renderRecordList(elements.historyList, linkedHistory);
  };
  const renderAll = () => { renderQueryControls(); renderConfigured(); renderSearchResults(); renderHistory(); };
  const resolveIncremental = async ({ force = false } = {}) => {
    const library = selectedLibrary();
    if (!library || running) return;
    const enteredDois = extractDois(elements.doiInput.value);
    const handledDois = new Set(force ? [] : currentResults
      .filter(item => item.libraryId === library.libraryId)
      .map(item => item.doi));
    const dois = enteredDois.filter(doi => !handledDois.has(doi));
    if (!dois.length) return;
    running = true;
    renderQueryControls();
    const newHistory = [];
    let resolved = 0;
    for (let index = 0; index < dois.length; index += 1) {
      const doi = dois[index];
      setStatus(elements.status, t('access.resolving', { current: index + 1, total: dois.length, doi }), 'info');
      let result;
      try { result = await resolveLibraryDoi({ libraryId: library.libraryId, doi }); }
      catch (error) { result = { doi, accessUrl: '', status: 'error', error: error?.message || String(error) }; }
      if (result.accessUrl) resolved += 1;
      const itemId = accessHistoryId({ libraryId: library.libraryId, doi });
      const existing = history.find(item => accessHistoryId(item) === itemId);
      const item = { ...result, libraryId: library.libraryId, libraryName: library.name, resolvedAt: Date.now(), favorite: Boolean(existing?.favorite) };
      newHistory.push(item);
      currentResults = [
        ...currentResults.filter(record => accessHistoryId(record) !== itemId),
        item
      ];
      renderQueryResults();
    }
    history = mergeAccessHistory(history, newHistory);
    await persist();
    running = false;
    renderQueryControls();
    renderHistory();
    setStatus(elements.status, t('access.complete', { resolved, total: dois.length }), resolved ? 'success' : 'error');
    void resolveIncremental();
  };
  const scheduleAutoResolve = () => {
    clearTimeout(autoResolveTimer);
    autoResolveTimer = setTimeout(() => { void resolveIncremental(); }, 350);
  };
  const importDoiFiles = async fileList => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.length > MAX_DOI_FILES) {
      setStatus(elements.status, t('access.filesTooMany'), 'error');
      return;
    }
    const unsupported = files.find(file => {
      const extension = String(file.name || '').split('.').pop()?.toLocaleLowerCase('en-US');
      return !DOI_FILE_EXTENSIONS.has(extension);
    });
    if (unsupported) {
      setStatus(elements.status, t('access.filesUnsupported', { file: unsupported.name || '-' }), 'error');
      return;
    }
    const oversized = files.find(file => file.size > MAX_DOI_FILE_BYTES);
    if (oversized) {
      setStatus(elements.status, t('access.fileTooLarge', { file: oversized.name || '-' }), 'error');
      return;
    }
    setStatus(elements.status, t('access.filesReading', { files: files.length }), 'info');
    try {
      const contents = await Promise.all(files.map(file => file.text()));
      const imported = extractDois(contents.join('\n'));
      if (!imported.length) {
        setStatus(elements.status, t('access.filesNoDoi'), 'error');
        return;
      }
      const existing = extractDois(elements.doiInput.value);
      const combined = Array.from(new Set([...existing, ...imported]));
      const added = combined.length - existing.length;
      elements.doiInput.value = combined.join('\n');
      renderQueryControls();
      setStatus(elements.status, added
        ? t('access.filesImported', { files: files.length, dois: added })
        : t('access.filesNoNew'), added ? 'success' : 'muted');
      if (added) scheduleAutoResolve();
    } catch (error) {
      setStatus(elements.status, t('access.filesFailed', { error: error?.message || String(error) }), 'error');
    }
  };

  elements.tabs.forEach((tab, index) => tab.addEventListener('click', () => setSubPanel(elements.panels[index].id)));
  elements.parentTab?.addEventListener('click', () => setSubPanel(elements.panels[0].id));
  elements.doiInput.addEventListener('input', event => {
    const shouldNormalize = ['insertFromPaste', 'insertFromDrop'].includes(event.inputType);
    const dois = new Set(shouldNormalize ? normalizeDoiInput() : extractDois(elements.doiInput.value));
    currentResults = currentResults.filter(item => dois.has(item.doi));
    renderQueryControls();
    scheduleAutoResolve();
  });
  elements.doiInput.addEventListener('blur', () => {
    normalizeDoiInput();
    renderQueryControls();
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
    void importDoiFiles(event.dataTransfer?.files);
  });
  elements.institutionSelect.addEventListener('change', async () => {
    selectedLibraryId = elements.institutionSelect.value;
    currentResults = [];
    await persist();
    renderAll();
    scheduleAutoResolve();
  });
  elements.clearDois.addEventListener('click', () => {
    clearTimeout(autoResolveTimer);
    elements.doiInput.value = '';
    currentResults = [];
    renderQueryControls();
    setStatus(elements.status, t('access.inputCleared'), 'success');
    elements.doiInput.focus();
  });
  elements.resolve.addEventListener('click', () => void resolveIncremental({ force: true }));
  elements.search.addEventListener('input', renderSearchResults);
  elements.searchMode.addEventListener('change', renderSearchResults);
  elements.configuredToggle.addEventListener('click', async () => {
    const collapsed = elements.configuredToggle.getAttribute('aria-expanded') === 'true';
    setConfiguredCollapsed(collapsed);
    storedState = { ...storedState, configuredCollapsed: collapsed };
    await persist();
  });
  elements.searchResults.addEventListener('click', async event => {
    if (event.target.closest('[data-library-homepage]')) return;
    const id = event.target.closest('[data-add-library]')?.dataset.addLibrary;
    const library = libraryIndex.find(item => item.libraryId === id);
    if (!library || configuredLibraries.some(item => item.libraryId === id)) return;
    configuredLibraries = [...configuredLibraries, library];
    selectedLibraryId = library.libraryId;
    await persist();
    renderAll();
  });
  elements.configuredList.addEventListener('click', async event => {
    const selectId = event.target.closest('[data-select-library]')?.dataset.selectLibrary;
    const removeId = event.target.closest('[data-remove-library]')?.dataset.removeLibrary;
    if (selectId) selectedLibraryId = selectId;
    if (removeId && configuredLibraries.length > 1) {
      configuredLibraries = configuredLibraries.filter(item => item.libraryId !== removeId);
      if (selectedLibraryId === removeId) selectedLibraryId = configuredLibraries[0].libraryId;
    }
    if (!selectId && !removeId) return;
    await persist();
    renderAll();
  });
  elements.clearHistory.addEventListener('click', async () => {
    if (history.length && !window.confirm(t('access.clearConfirm'))) return;
    history = history.filter(item => item.favorite);
    const retainedIds = new Set(history.map(accessHistoryId));
    currentResults = currentResults.filter(item => retainedIds.has(accessHistoryId(item)));
    await persist();
    renderQueryResults();
    renderHistory();
  });
  document.addEventListener('wos-aide:language-changed', renderAll);

  void (async () => {
    storedState = (await getStorage([STORAGE_KEY]))[STORAGE_KEY] || {};
    const savedConfigured = normalizeLibraryList(storedState.configuredLibraries || []);
    const legacySelected = normalizeLibrary(storedState.selectedLibrary);
    configuredLibraries = savedConfigured.length ? savedConfigured : DEFAULT_LIBRARIES.slice();
    if (legacySelected && !configuredLibraries.some(library => library.libraryId === legacySelected.libraryId)) {
      configuredLibraries.push(legacySelected);
    }
    selectedLibraryId = legacySelected?.libraryId || configuredLibraries[0].libraryId;
    history = Array.isArray(storedState.history)
      ? orderAccessHistory(retainAccessHistory(storedState.history
        .filter(item => item?.doi && item?.libraryId)
        .map(item => ({ ...item, favorite: Boolean(item.favorite) }))))
      : [];
    const cachedLibraries = normalizeLibraryList(storedState.libraries);
    const cacheIsFresh = cachedLibraries.length && Date.now() - Number(storedState.librariesFetchedAt || 0) < LIBRARY_CACHE_TTL_MS;
    if (cachedLibraries.length) libraryIndex = cachedLibraries;
    renderAll();
    setConfiguredCollapsed(storedState.configuredCollapsed);
    const savedSubTab = (await getStorage(['wosAideLibraryAccessSubTab'])).wosAideLibraryAccessSubTab;
    setSubPanel(elements.panels.some(panel => panel.id === savedSubTab) ? savedSubTab : elements.panels[0].id);
    if (cacheIsFresh) return;
    setStatus(elements.configStatus, t('access.loading'), 'info');
    try {
      const response = await fetch(LIBRARY_LIST_URL, {
        credentials: 'include',
        headers: { accept: 'application/vnd.api+json' },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const loaded = normalizeLibraryList(await response.json());
      if (loaded.length) libraryIndex = loaded;
      storedState = { ...storedState, libraries: libraryIndex, librariesFetchedAt: Date.now() };
      await persist();
      renderSearchResults();
    } catch (error) {
      setStatus(elements.configStatus, t('access.listFailed', { error: error?.message || error }), 'error');
    }
  })();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = {
  accessHistoryId,
  initializeLibraryAccess,
  mergeAccessHistory,
  orderAccessHistory,
  retainAccessHistory
};

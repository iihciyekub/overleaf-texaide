'use strict';

const {
  MAX_CSV_BYTES,
  parseJournalCsv,
  mergeJournalRecords,
  matchJournals
} = require('./journal-catalog');
const {
  listJournalSources,
  saveJournalSources,
  deleteJournalSource,
  clearJournalSources
} = require('./journal-catalog-storage');
const {
  REMOTE_DATASETS,
  fetchLatestCatalogVersion,
  installedRemoteVersion,
  hasRemoteUpdate,
  downloadRemoteCatalogs
} = require('./journal-catalog-remote');
const { message } = require('./i18n');

const CATALOG_CHANGED_EVENT = 'wos-aide:journal-catalog-changed';

const currentLanguage = () => document.documentElement.lang === 'en' ? 'en' : 'zh';
const catalogMessage = key => message(currentLanguage(), `journalCatalog.${key}`);
const sourceIdForFile = file => String(file?.name || 'journals.csv').trim().toLocaleLowerCase('en-US');

const formatDate = timestamp => {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(document.documentElement.lang || undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
};

async function parseUploadedFiles(files) {
  const selected = Array.from(files || []);
  if (!selected.length) return [];
  const parsed = [];
  for (const file of selected) {
    if (!/\.csv$/i.test(file.name || '')) throw new Error(catalogMessage('csvOnly'));
    if (file.size > MAX_CSV_BYTES) throw new Error(catalogMessage('fileTooLarge'));
    const contents = await file.text();
    const records = parseJournalCsv(contents, { fileName: file.name });
    parsed.push({
      id: sourceIdForFile(file),
      fileName: file.name,
      byteLength: file.size,
      rowCount: records.length,
      importedAt: Date.now(),
      records
    });
  }
  return parsed;
}

function initializeJournalCatalogSettings() {
  const elements = {
    input: document.getElementById('journalCatalogFileInput'),
    remote: document.getElementById('journalCatalogRemoteBtn'),
    upload: document.getElementById('journalCatalogUploadBtn'),
    clear: document.getElementById('journalCatalogClearBtn'),
    status: document.getElementById('journalCatalogStatus'),
    summary: document.getElementById('journalCatalogSummary'),
    version: document.getElementById('journalCatalogVersion'),
    sources: document.getElementById('journalCatalogSourceList'),
    empty: document.getElementById('journalCatalogEmpty')
  };
  if (!elements.input || !elements.remote || !elements.upload || !elements.sources) return;
  let sourceCache = [];
  let latestVersion = null;
  let checkingVersion = false;
  let busy = false;

  const interpolate = (key, values = {}) => Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    catalogMessage(key)
  );

  const setStatus = (text, variant = 'muted') => {
    elements.status.textContent = text;
    elements.status.className = `helper status--${variant}`;
  };

  const setBusy = value => {
    busy = value;
    elements.remote.disabled = value;
    elements.upload.disabled = value;
    elements.clear.disabled = value || sourceCache.length === 0;
    elements.sources.querySelectorAll('button').forEach(button => { button.disabled = value; });
  };

  const renderVersion = () => {
    if (!elements.version) return;
    const installed = installedRemoteVersion(sourceCache);
    const updateAvailable = latestVersion && hasRemoteUpdate(sourceCache, latestVersion);
    elements.version.replaceChildren();
    const installedItem = document.createElement('span');
    installedItem.textContent = interpolate('installedVersion', { version: installed?.version || catalogMessage('notInstalledShort') });
    installedItem.title = installedItem.textContent;
    const latestItem = document.createElement('span');
    latestItem.textContent = interpolate('latestVersion', {
      version: checkingVersion ? catalogMessage('checkingShort') : (latestVersion?.version || catalogMessage('notChecked'))
    });
    latestItem.title = latestItem.textContent;
    if (installed && latestVersion) latestItem.classList.add(updateAvailable ? 'is-update' : 'is-current');
    elements.version.append(installedItem, latestItem);

    const label = elements.remote.querySelector('span');
    if (label) label.textContent = !installed
      ? catalogMessage('loadOfficial')
      : (updateAvailable ? catalogMessage('updateOfficial') : catalogMessage('checkUpdates'));
    const icon = elements.remote.querySelector('i');
    if (icon) icon.className = updateAvailable
      ? 'fa-solid fa-arrow-rotate-right'
      : (!installed ? 'fa-solid fa-cloud-arrow-down' : 'fa-solid fa-arrows-rotate');
  };

  const render = () => {
    elements.sources.replaceChildren();
    const totalRows = sourceCache.reduce((sum, source) => sum + Number(source.rowCount || 0), 0);
    elements.summary.textContent = sourceCache.length
      ? catalogMessage('installedSummary').replace('{files}', sourceCache.length).replace('{rows}', totalRows.toLocaleString())
      : catalogMessage('notInstalled');
    elements.empty.hidden = sourceCache.length > 0;
    elements.clear.disabled = busy || sourceCache.length === 0;
    renderVersion();

    sourceCache.slice().sort((left, right) => left.fileName.localeCompare(right.fileName)).forEach(source => {
      const row = document.createElement('div');
      row.className = 'journal-catalog-source';
      const details = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = source.fileName;
      if (source.origin === 'github') {
        const origin = document.createElement('small');
        origin.className = 'journal-catalog-source-origin';
        origin.textContent = 'GitHub';
        name.appendChild(origin);
      }
      const metadata = document.createElement('span');
      metadata.textContent = [
        `${Number(source.rowCount || 0).toLocaleString()} ${catalogMessage('rows')}`,
        source.version,
        formatDate(source.importedAt)
      ].filter(Boolean).join(' · ');
      details.append(name, metadata);
      const remove = document.createElement('button');
      remove.className = 'icon-button journal-catalog-remove';
      remove.type = 'button';
      remove.title = catalogMessage('removeSource');
      remove.setAttribute('aria-label', `${catalogMessage('removeSource')}: ${source.fileName}`);
      remove.innerHTML = '<i class="fa-solid fa-trash-can" aria-hidden="true"></i>';
      remove.addEventListener('click', async () => {
        if (busy) return;
        setBusy(true);
        setStatus(catalogMessage('updating'), 'info');
        try {
          await deleteJournalSource(source.id);
          sourceCache = await listJournalSources();
          render();
          setStatus(catalogMessage('sourceRemoved'), 'success');
          document.dispatchEvent(new CustomEvent(CATALOG_CHANGED_EVENT));
        } catch (error) {
          setStatus(error?.message || String(error), 'error');
        } finally {
          setBusy(false);
        }
      });
      row.append(details, remove);
      elements.sources.appendChild(row);
    });
  };

  const checkLatest = async ({ silent = false } = {}) => {
    checkingVersion = true;
    renderVersion();
    if (!silent) setStatus(catalogMessage('checking'), 'info');
    try {
      latestVersion = await fetchLatestCatalogVersion();
      renderVersion();
      const installed = installedRemoteVersion(sourceCache);
      if (!silent && installed) {
        setStatus(hasRemoteUpdate(sourceCache, latestVersion)
          ? interpolate('updateAvailable', { version: latestVersion.version })
          : catalogMessage('alreadyLatest'), hasRemoteUpdate(sourceCache, latestVersion) ? 'info' : 'success');
      }
      return latestVersion;
    } finally {
      checkingVersion = false;
      renderVersion();
    }
  };

  const refresh = async () => {
    try {
      sourceCache = await listJournalSources();
      render();
      void checkLatest({ silent: true }).catch(error => {
        setStatus(interpolate('remoteCheckFailed', { message: error?.message || String(error) }), 'error');
      });
    } catch (error) {
      setStatus(error?.message || String(error), 'error');
    }
  };

  elements.remote.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try {
      const remoteVersion = await checkLatest();
      const installed = installedRemoteVersion(sourceCache);
      if (installed && installed.revision === remoteVersion.revision) {
        setStatus(catalogMessage('alreadyLatest'), 'success');
        return;
      }
      let downloaded = 0;
      setStatus(interpolate('downloading', { done: downloaded, total: REMOTE_DATASETS.length }), 'info');
      const sources = await downloadRemoteCatalogs(remoteVersion, {
        onDownloaded: () => {
          downloaded += 1;
          setStatus(interpolate('downloading', { done: downloaded, total: REMOTE_DATASETS.length }), 'info');
        }
      });
      await saveJournalSources(sources);
      sourceCache = await listJournalSources();
      render();
      const rows = sources.reduce((sum, source) => sum + source.rowCount, 0);
      setStatus(interpolate('remoteImported', { version: remoteVersion.version, rows: rows.toLocaleString() }), 'success');
      document.dispatchEvent(new CustomEvent(CATALOG_CHANGED_EVENT));
    } catch (error) {
      setStatus(interpolate('remoteFailed', { message: error?.message || String(error) }), 'error');
    } finally {
      setBusy(false);
    }
  });

  elements.upload.addEventListener('click', () => elements.input.click());
  elements.input.addEventListener('change', async () => {
    if (!elements.input.files?.length || busy) return;
    setBusy(true);
    setStatus(catalogMessage('validating'), 'info');
    try {
      const sources = await parseUploadedFiles(elements.input.files);
      await saveJournalSources(sources);
      sourceCache = await listJournalSources();
      render();
      const importedRows = sources.reduce((sum, source) => sum + source.rowCount, 0);
      setStatus(catalogMessage('imported').replace('{files}', sources.length).replace('{rows}', importedRows.toLocaleString()), 'success');
      document.dispatchEvent(new CustomEvent(CATALOG_CHANGED_EVENT));
    } catch (error) {
      setStatus(error?.message || String(error), 'error');
    } finally {
      elements.input.value = '';
      setBusy(false);
    }
  });
  elements.clear.addEventListener('click', async () => {
    if (busy || !sourceCache.length || !window.confirm(catalogMessage('clearConfirm'))) return;
    setBusy(true);
    try {
      await clearJournalSources();
      sourceCache = [];
      render();
      setStatus(catalogMessage('cleared'), 'success');
      document.dispatchEvent(new CustomEvent(CATALOG_CHANGED_EVENT));
    } catch (error) {
      setStatus(error?.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  });
  document.addEventListener('wos-aide:language-changed', () => {
    render();
    setStatus('');
  });
  void refresh();
}

function initializeJournalAutocomplete() {
  const input = document.getElementById('scholarJournalInput');
  const menu = document.getElementById('journalSuggestionMenu');
  if (!input || !menu) return;
  let records = [];
  let matches = [];
  let activeIndex = -1;

  const closeMenu = () => {
    matches = [];
    activeIndex = -1;
    menu.hidden = true;
    menu.replaceChildren();
    input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-expanded', 'false');
  };

  const choose = index => {
    const record = matches[index];
    if (!record) return;
    input.value = record.title;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    closeMenu();
    input.focus();
  };

  const setActive = index => {
    if (!matches.length) return;
    activeIndex = (index + matches.length) % matches.length;
    menu.querySelectorAll('[role="option"]').forEach((option, optionIndex) => {
      const active = optionIndex === activeIndex;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-selected', String(active));
      if (active) {
        input.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
      }
    });
  };

  const renderMatches = () => {
    matches = matchJournals(input.value, records);
    menu.replaceChildren();
    activeIndex = -1;
    if (!matches.length) {
      closeMenu();
      return;
    }
    matches.forEach((record, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'journal-suggestion';
      option.id = `journalSuggestion-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      const main = document.createElement('span');
      main.className = 'journal-suggestion__main';
      const title = document.createElement('strong');
      title.textContent = record.title;
      const identifiers = document.createElement('span');
      identifiers.textContent = [record.issn, record.eissn].filter(Boolean).join(' · ') || record.acronym;
      main.append(title, identifiers);
      const types = document.createElement('span');
      types.className = 'journal-suggestion__types';
      (record.types || ['CUSTOM']).slice(0, 4).forEach(type => {
        const badge = document.createElement('span');
        badge.textContent = type;
        types.appendChild(badge);
      });
      option.append(main, types);
      option.addEventListener('pointermove', () => setActive(index));
      option.addEventListener('mousedown', event => event.preventDefault());
      option.addEventListener('click', () => choose(index));
      menu.appendChild(option);
    });
    menu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  const reloadCatalog = async () => {
    try {
      const sources = await listJournalSources();
      records = mergeJournalRecords(sources.map(source => Array.isArray(source.records) ? source.records : []));
      if (document.activeElement === input) renderMatches();
    } catch (_error) {
      records = [];
      closeMenu();
    }
  };

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', menu.id);
  input.setAttribute('aria-expanded', 'false');
  input.addEventListener('input', renderMatches);
  input.addEventListener('focus', renderMatches);
  input.addEventListener('blur', () => window.setTimeout(closeMenu, 100));
  input.addEventListener('keydown', event => {
    if (menu.hidden || !matches.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(activeIndex < 0 ? matches.length - 1 : activeIndex - 1);
    } else if ((event.key === 'Enter' || event.key === 'Tab') && activeIndex >= 0) {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    }
  });
  document.addEventListener(CATALOG_CHANGED_EVENT, reloadCatalog);
  void reloadCatalog();
}

function initializeJournalCatalog() {
  initializeJournalCatalogSettings();
  initializeJournalAutocomplete();
}

module.exports = {
  CATALOG_CHANGED_EVENT,
  parseUploadedFiles,
  initializeJournalCatalog
};

'use strict';

const { BUILTIN_CSL_STYLES, parseCslStyleMetadata, styleIdFromUrl } = require('./crossref-csl');

const ACTIVE_STYLE_KEY = 'wosAideCrossrefCslActiveStyle';
const OFFICIAL_CSL_API = 'https://api.github.com/repos/citation-style-language/styles/git/trees/master?recursive=1';
const OFFICIAL_CSL_RAW_BASE = 'https://raw.githubusercontent.com/citation-style-language/styles/master';
const OFFICIAL_INDEX_TTL_MS = 15 * 60 * 1000;
const DB_NAME = 'wos-aide-crossref-csl';
const DB_VERSION = 1;
const STYLE_STORE = 'styles';

let databasePromise;
let officialIndex = [];
let officialIndexFetchedAt = 0;
let fallbackActiveStyle = 'apa';
const fallbackStyles = new Map();

const storageGet = keys => new Promise(resolve => {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    resolve({ [ACTIVE_STYLE_KEY]: fallbackActiveStyle });
    return;
  }
  chrome.storage.local.get(keys, result => resolve(result || {}));
});

const storageSet = values => new Promise(resolve => {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    if (values[ACTIVE_STYLE_KEY]) fallbackActiveStyle = values[ACTIVE_STYLE_KEY];
    resolve();
    return;
  }
  chrome.storage.local.set(values, resolve);
});

const openDatabase = () => {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STYLE_STORE)) {
        request.result.createObjectStore(STYLE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the CSL style store.'));
  });
  return databasePromise;
};

const styleTransaction = async (mode, action) => {
  const database = await openDatabase();
  if (!database) return action(null);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STYLE_STORE, mode);
    const store = transaction.objectStore(STYLE_STORE);
    let result;
    try {
      result = action(store);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error('Could not update the CSL style store.'));
  });
};

const requestResult = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Could not read the CSL style store.'));
});

const customStyles = async () => {
  const database = await openDatabase();
  if (!database) return Array.from(fallbackStyles.values());
  const transaction = database.transaction(STYLE_STORE, 'readonly');
  return requestResult(transaction.objectStore(STYLE_STORE).getAll());
};

const installedStyles = async () => [
  ...BUILTIN_CSL_STYLES.map(style => ({ ...style })),
  ...(await customStyles()).sort((left, right) => left.label.localeCompare(right.label))
];

const getStyle = async id => {
  const builtin = BUILTIN_CSL_STYLES.find(style => style.id === id);
  if (builtin) return { ...builtin };
  const database = await openDatabase();
  if (!database) return fallbackStyles.get(id) || null;
  const transaction = database.transaction(STYLE_STORE, 'readonly');
  return requestResult(transaction.objectStore(STYLE_STORE).get(id));
};

const saveStyle = async style => {
  if (!style?.id || !style?.renderXml) throw new Error('The CSL style is incomplete.');
  if (typeof indexedDB === 'undefined') {
    fallbackStyles.set(style.id, style);
    return style;
  }
  await styleTransaction('readwrite', store => store.put(style));
  return style;
};

const removeStyle = async id => {
  if (BUILTIN_CSL_STYLES.some(style => style.id === id)) return false;
  if (typeof indexedDB === 'undefined') return fallbackStyles.delete(id);
  await styleTransaction('readwrite', store => store.delete(id));
  return true;
};

const getActiveStyleId = async () => {
  const stored = await storageGet([ACTIVE_STYLE_KEY]);
  const id = String(stored[ACTIVE_STYLE_KEY] || 'apa');
  return await getStyle(id) ? id : 'apa';
};

const setActiveStyleId = async id => {
  if (!await getStyle(id)) throw new Error(`CSL style not installed: ${id}`);
  await storageSet({ [ACTIVE_STYLE_KEY]: id });
  return id;
};

const styleMatchesQuery = (style, query) => {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return true;
  const haystack = `${style.id || ''} ${style.label || ''} ${style.fileName || ''}`.toLowerCase();
  const terms = normalized.match(/[a-z]+|\d+|[^\x00-\x7f]+/g) || [];
  if (terms.length && terms.every(term => haystack.includes(term))) return true;
  return haystack.replace(/[\s_-]+/g, '').includes(normalized.replace(/[\s_-]+/g, ''));
};

const rawUrlForStyle = id => `${OFFICIAL_CSL_RAW_BASE}/${encodeURIComponent(id)}.csl`;

const fetchOfficialStyleIndex = async () => {
  if (officialIndex.length && Date.now() - officialIndexFetchedAt < OFFICIAL_INDEX_TTL_MS) return officialIndex;
  const response = await fetch(OFFICIAL_CSL_API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`GitHub CSL index returned HTTP ${response.status}.`);
  const payload = await response.json();
  officialIndex = (Array.isArray(payload?.tree) ? payload.tree : [])
    .filter(item => item.type === 'blob' && !String(item.path || '').includes('/') && /\.csl$/i.test(item.path || ''))
    .map(item => {
      const id = item.path.replace(/\.csl$/i, '');
      return {
        id,
        label: id.replace(/[-_]+/g, ' '),
        fileName: item.path,
        rawUrl: rawUrlForStyle(id),
        source: 'official'
      };
    });
  officialIndexFetchedAt = Date.now();
  return officialIndex;
};

const searchOfficialStyles = async (query, limit = 30) => {
  const installed = new Set((await installedStyles()).map(style => style.id));
  return (await fetchOfficialStyleIndex())
    .filter(style => styleMatchesQuery(style, query))
    .sort((left, right) => Number(installed.has(right.id)) - Number(installed.has(left.id)) || left.id.localeCompare(right.id))
    .slice(0, Math.max(1, Math.min(50, Number(limit || 30))))
    .map(style => ({ ...style, installed: installed.has(style.id) }));
};

const fetchStyleXml = async url => {
  const response = await fetch(url, { headers: { Accept: 'application/xml,text/xml,text/plain' } });
  if (!response.ok) throw new Error(`CSL download returned HTTP ${response.status}.`);
  return response.text();
};

const installOfficialStyle = async candidate => {
  const rawUrl = candidate?.rawUrl || rawUrlForStyle(candidate?.id);
  const xml = await fetchStyleXml(rawUrl);
  const metadata = parseCslStyleMetadata(xml);
  const id = candidate?.id || metadata.id || styleIdFromUrl(rawUrl);
  let renderXml = xml;
  let parentId = '';
  if (!metadata.hasBibliography && metadata.parentUrl) {
    parentId = styleIdFromUrl(metadata.parentUrl);
    renderXml = await fetchStyleXml(rawUrlForStyle(parentId));
    const parentMetadata = parseCslStyleMetadata(renderXml);
    if (!parentMetadata.hasBibliography) throw new Error('The independent parent has no bibliography rules.');
  }
  return saveStyle({
    id,
    label: metadata.label || candidate?.label || id.replace(/[-_]+/g, ' '),
    source: 'official',
    rawUrl,
    parentId,
    xml,
    renderXml,
    installedAt: new Date().toISOString()
  });
};

module.exports = {
  ACTIVE_STYLE_KEY,
  BUILTIN_CSL_STYLES,
  getActiveStyleId,
  getStyle,
  installOfficialStyle,
  installedStyles,
  removeStyle,
  searchOfficialStyles,
  setActiveStyleId,
  styleMatchesQuery
};

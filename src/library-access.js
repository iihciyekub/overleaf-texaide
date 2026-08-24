'use strict';

const LIBRARY_LIST_URL = 'https://api.thirdiron.com/v2/libraries?client=bzweb';
const LIBKEY_TOKEN_URL = 'https://api.thirdiron.com/v2/api-tokens';
const LIBKEY_TIMEOUT_MS = 15000;
const DEFAULT_LIBRARIES = [
  { libraryId: '254', name: 'Hong Kong Polytechnic University' },
  { libraryId: '591', name: 'Monash University' }
];
const DOI_PATTERN = /\b(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*|urn:\s*doi:\s*)?(10\.\d{4,9}\/[^\s"'<>()\[\],;]+)/gi;
const LIBRARY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'de', 'del', 'des', 'du', 'el', 'et',
  'for', 'from', 'in', 'la', 'le', 'of', 'on', 'the', 'to', 'und', 'with', 'y'
]);

const normalizeDoi = value => {
  let doi = String(value || '').trim();
  try { doi = decodeURIComponent(doi); } catch (_error) { /* retain original input */ }
  return doi
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^(?:urn:\s*)?doi:\s*/i, '')
    .replace(/[.,;:)\]}]+$/g, '')
    .trim()
    .toLowerCase();
};

const extractDois = value => {
  const dois = [];
  DOI_PATTERN.lastIndex = 0;
  let match;
  while ((match = DOI_PATTERN.exec(String(value || ''))) !== null) {
    const doi = normalizeDoi(match[1] || match[0]);
    if (doi) dois.push(doi);
  }
  return Array.from(new Set(dois));
};

const normalizeLibrary = item => {
  const attributes = item?.attributes || item?.data?.attributes || {};
  const libraryId = String(item?.libraryId || item?.library_id || item?.id || item?.data?.id || '').trim();
  const name = String(item?.name || item?.school_name || attributes.name || '').trim();
  if (!libraryId || !name) return null;
  const rawAliases = item?.aliases || attributes.aliases || [];
  const aliases = Array.isArray(rawAliases) ? rawAliases.map(String).filter(Boolean) : [];
  const homepage = String(item?.homepage || item?.website || item?.url || attributes.homepage || attributes.website || attributes.url || '').trim();
  return { libraryId, name, aliases, homepage };
};

const normalizeLibraryList = payload => {
  const source = Array.isArray(payload) ? payload : payload?.libraries || payload?.data || [];
  const seen = new Set();
  return source.map(normalizeLibrary).filter(library => {
    if (!library || seen.has(library.libraryId)) return false;
    seen.add(library.libraryId);
    return true;
  });
};

const normalizeLibrarySearchText = value => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('en-US')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

const librarySearchTokens = value => normalizeLibrarySearchText(value).split(/\s+/).filter(Boolean);

const libraryAcronym = value => librarySearchTokens(value)
  .filter(token => !LIBRARY_STOP_WORDS.has(token))
  .map(token => Array.from(token)[0]?.toLocaleUpperCase('en-US') || '')
  .join('');

const fuzzySubsequenceScore = (haystack, needle) => {
  if (!needle) return 0;
  let cursor = 0;
  let first = -1;
  let previous = -1;
  let gaps = 0;
  for (const character of needle) {
    const index = haystack.indexOf(character, cursor);
    if (index < 0) return -1;
    if (first < 0) first = index;
    if (previous >= 0) gaps += Math.max(0, index - previous - 1);
    previous = index;
    cursor = index + 1;
  }
  return Math.max(6, 90 - first * 2 - gaps);
};

const scoreLibrarySearchMatch = (library, query, mode = 'similar', regex = null) => {
  const name = String(library.name || '').trim();
  const libraryId = String(library.libraryId || '').trim();
  const aliases = Array.isArray(library.aliases) ? library.aliases : [];
  const fields = [name, libraryId, ...aliases];
  if (mode === 'regex') {
    if (!regex || !fields.some(field => regex.test(String(field)))) return -1;
    if (regex.test(libraryId)) return 500;
    if (regex.test(name)) return 400;
    return 300;
  }
  const tokens = librarySearchTokens(query);
  if (!tokens.length) return -1;
  const normalizedName = normalizeLibrarySearchText(name);
  const normalizedAliases = aliases.map(normalizeLibrarySearchText);
  const normalizedText = [normalizedName, libraryId, ...normalizedAliases].join(' ');
  const acronymQuery = String(query || '').trim().toLocaleUpperCase('en-US');
  const acronyms = [name, ...aliases].map(libraryAcronym).filter(Boolean);
  if (/^[A-Z0-9]{2,16}$/.test(acronymQuery)) {
    if (acronyms.includes(acronymQuery)) return 460;
    if (acronyms.some(acronym => acronym.startsWith(acronymQuery))) return 420;
  }
  let score = 0;
  for (const token of tokens) {
    if (libraryId === token) score += 500;
    else if (libraryId.startsWith(token)) score += 260;
    else if (normalizedName === token) score += 320;
    else if (normalizedName.startsWith(token)) score += 230;
    else if (normalizedName.split(/\s+/).some(part => part.startsWith(token))) score += 170;
    else if (normalizedText.includes(token)) score += 110;
    else if (mode === 'similar') {
      const fuzzyScore = fuzzySubsequenceScore(normalizedText.replace(/\s+/g, ''), token);
      if (fuzzyScore < 0) return -1;
      score += fuzzyScore;
    } else return -1;
  }
  if (normalizedName.includes(normalizeLibrarySearchText(query))) score += 60;
  return score - Math.min(80, normalizedName.length / 4);
};

const searchLibrariesDetailed = (libraries, query, options = {}) => {
  const mode = ['similar', 'text', 'regex'].includes(options.mode) ? options.mode : 'similar';
  const trimmed = String(query || '').trim();
  if (!trimmed) return { matches: [], error: '' };
  let regex = null;
  if (mode === 'regex') {
    try { regex = new RegExp(trimmed, 'i'); }
    catch (_error) { return { matches: [], error: 'invalid_regex' }; }
  }
  const matches = libraries.map(library => ({ ...library, score: scoreLibrarySearchMatch(library, trimmed, mode, regex) }))
    .filter(library => library.score >= 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }))
    .slice(0, options.limit || 50);
  return { matches, error: '' };
};

const searchLibraries = (libraries, query, limit = 30) =>
  searchLibrariesDetailed(libraries, query, { mode: 'similar', limit }).matches;

const buildLibKeyTokenRequest = (libraryId, doi) => {
  const id = String(libraryId || '').trim();
  const normalizedDoi = normalizeDoi(doi);
  const intentJson = JSON.stringify({ url: `/libraries/${id}/${normalizedDoi}` });
  const intent = btoa(Array.from(new TextEncoder().encode(intentJson), byte => String.fromCharCode(byte)).join(''));
  return {
    url: LIBKEY_TOKEN_URL,
    body: {
      libraryId: id,
      returnPreproxy: true,
      client: 'bzweb',
      success: `/libraries/${id}/accept-token?intent=${encodeURIComponent(intent)}`,
      failure: `/token-failure/${id}`
    }
  };
};

const buildLibKeyArticleUrl = doi =>
  `https://api.thirdiron.com/v2/articles/${encodeURIComponent(`doi:${normalizeDoi(doi)}`)}?include=issue%2Cjournal&reload=true`;

const timeoutSignal = () => typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
  ? AbortSignal.timeout(LIBKEY_TIMEOUT_MS)
  : undefined;

const resolveLibraryDoi = async ({ libraryId, doi, fetchImpl = fetch }) => {
  const normalizedDoi = normalizeDoi(doi);
  if (!libraryId || !normalizedDoi) throw new Error('Library and DOI are required.');
  const tokenRequest = buildLibKeyTokenRequest(libraryId, normalizedDoi);
  const tokenResponse = await fetchImpl(tokenRequest.url, {
    method: 'POST',
    credentials: 'include',
    signal: timeoutSignal(),
    headers: { 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(tokenRequest.body)
  });
  if (!tokenResponse.ok) throw new Error(`Library authorization failed (HTTP ${tokenResponse.status}).`);
  const tokenPayload = await tokenResponse.json();
  const token = String(tokenPayload?.['api-tokens']?.[0]?.id || tokenPayload?.data?.id || '').trim();
  if (!token) throw new Error('The library did not return a temporary access token.');
  const articleResponse = await fetchImpl(buildLibKeyArticleUrl(normalizedDoi), {
    credentials: 'include',
    signal: timeoutSignal(),
    headers: { accept: 'application/vnd.api+json', authorization: `Bearer ${token}` }
  });
  if (!articleResponse.ok) throw new Error(`DOI resolution failed (HTTP ${articleResponse.status}).`);
  const payload = await articleResponse.json();
  const attributes = payload?.data?.attributes || {};
  const accessUrl = String(attributes.libkeyFullTextFile || attributes.fullTextFile || '').trim();
  return { doi: normalizedDoi, accessUrl, articleId: payload?.data?.id || '', status: accessUrl ? 'resolved' : 'unavailable' };
};

module.exports = {
  DEFAULT_LIBRARIES,
  LIBRARY_LIST_URL,
  buildLibKeyArticleUrl,
  buildLibKeyTokenRequest,
  extractDois,
  normalizeDoi,
  normalizeLibrary,
  normalizeLibraryList,
  libraryAcronym,
  normalizeLibrarySearchText,
  resolveLibraryDoi,
  searchLibraries,
  searchLibrariesDetailed
};

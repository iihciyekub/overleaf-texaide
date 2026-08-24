'use strict';

const MAX_CSV_BYTES = 25 * 1024 * 1024;
const MAX_CSV_ROWS = 100000;
const MAX_SUGGESTIONS = 10;
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'de', 'del', 'des', 'du', 'el', 'et',
  'for', 'from', 'in', 'la', 'le', 'of', 'on', 'the', 'to', 'und', 'with', 'y'
]);
const TITLE_COLUMNS = ['journal title', 'journal name', 'title', 'publication name', 'source title'];
const ISSN_COLUMNS = ['issn', 'print issn', 'p issn', 'p-issn'];
const EISSN_COLUMNS = ['eissn', 'e-issn', 'online issn', 'electronic issn'];
const TYPE_COLUMNS = ['collection', 'collections', 'type', 'type code', 'index', 'list', 'source'];
const KNOWN_TYPE_CODES = ['SCIE', 'SSCI', 'AHCI', 'ESCI', 'AJG2024', 'AJG', 'UTD24', 'FT50'];

class JournalCatalogError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'JournalCatalogError';
    this.code = code;
    Object.assign(this, details);
  }
}

const normalizeHeader = value => String(value || '')
  .replace(/^\uFEFF/, '')
  .trim()
  .toLocaleLowerCase('en-US')
  .replace(/[_\s]+/g, ' ');

const tokenizeJournalTitle = value => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('en-US')
  .match(/[\p{L}\p{N}]+/gu) || [];

const normalizeJournalTitle = value => tokenizeJournalTitle(value).join(' ');

const journalAcronym = value => tokenizeJournalTitle(value)
  .filter(token => !STOP_WORDS.has(token))
  .map(token => Array.from(token)[0]?.toLocaleUpperCase('en-US') || '')
  .join('');

const normalizeIssn = value => String(value || '').toLocaleUpperCase('en-US').replace(/[^0-9X]/g, '');

const isValidIssn = value => {
  if (!String(value || '').trim()) return true;
  return /^\d{7}[\dX]$/.test(normalizeIssn(value));
};

function parseCsvRows(contents) {
  const text = String(contents || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let justClosedQuote = false;
  let line = 1;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          justClosedQuote = true;
        }
      } else {
        field += character;
        if (character === '\n') line += 1;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
      justClosedQuote = false;
    } else if (character === ',') {
      row.push(field);
      field = '';
      justClosedQuote = false;
    } else if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      justClosedQuote = false;
      line += 1;
    } else {
      if (justClosedQuote && !/\s/.test(character)) {
        throw new JournalCatalogError('malformed-csv', `Malformed CSV near line ${line}.`, { line });
      }
      field += character;
    }
  }
  if (quoted) throw new JournalCatalogError('malformed-csv', `Unclosed quoted field near line ${line}.`, { line });
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const firstColumnIndex = (indexes, aliases) => aliases.map(alias => indexes.get(alias)).find(index => index !== undefined);

const inferTypeCodes = fileName => {
  const upper = String(fileName || '').toLocaleUpperCase('en-US').replace(/[^A-Z0-9*]+/g, ' ');
  const inferred = KNOWN_TYPE_CODES.filter(code => new RegExp(`(^| )${code}( |$)`).test(upper));
  return inferred.length ? inferred : ['CUSTOM'];
};

const normalizeTypeCodes = (value, fallback) => {
  const codes = String(value || '')
    .split(/[|;/]+/)
    .map(code => code.trim().toLocaleUpperCase('en-US').replace(/\s+/g, ''))
    .filter(code => /^[A-Z0-9*_-]{1,20}$/.test(code));
  return Array.from(new Set(codes.length ? codes : fallback));
};

function parseJournalCsv(contents, options = {}) {
  const fileName = String(options.fileName || 'journals.csv');
  const byteLength = new TextEncoder().encode(String(contents || '')).byteLength;
  if (byteLength > (options.maximumBytes || MAX_CSV_BYTES)) {
    throw new JournalCatalogError('file-too-large', 'CSV file exceeds the 25 MiB limit.');
  }
  const rows = parseCsvRows(contents);
  if (!rows.length) throw new JournalCatalogError('empty-catalog', 'CSV file is empty.');

  const header = rows[0].map(normalizeHeader);
  const indexes = new Map();
  header.forEach((column, index) => {
    if (!column || indexes.has(column)) {
      throw new JournalCatalogError('invalid-header', 'CSV contains an empty or duplicate column name.', { line: 1 });
    }
    indexes.set(column, index);
  });
  const titleIndex = firstColumnIndex(indexes, TITLE_COLUMNS);
  if (titleIndex === undefined) {
    throw new JournalCatalogError('missing-title-column', `Missing journal title column. Accepted names: ${TITLE_COLUMNS.join(', ')}.`);
  }
  const issnIndex = firstColumnIndex(indexes, ISSN_COLUMNS);
  const eissnIndex = firstColumnIndex(indexes, EISSN_COLUMNS);
  const typeIndex = firstColumnIndex(indexes, TYPE_COLUMNS);
  const fallbackTypes = inferTypeCodes(fileName);
  const records = [];

  for (let offset = 1; offset < rows.length; offset += 1) {
    const row = rows[offset];
    const line = offset + 1;
    if (row.every(value => !String(value || '').trim())) continue;
    if (row.length !== header.length) {
      throw new JournalCatalogError('invalid-row', `CSV row ${line} has ${row.length} fields; expected ${header.length}.`, { line });
    }
    const title = String(row[titleIndex] || '').trim();
    const issn = issnIndex === undefined ? '' : String(row[issnIndex] || '').trim();
    const eissn = eissnIndex === undefined ? '' : String(row[eissnIndex] || '').trim();
    if (!title || !isValidIssn(issn) || !isValidIssn(eissn)) {
      throw new JournalCatalogError('invalid-row', `CSV row ${line} contains an empty title or invalid ISSN.`, { line });
    }
    const normalizedTitle = normalizeJournalTitle(title);
    records.push({
      title,
      issn,
      eissn,
      types: normalizeTypeCodes(typeIndex === undefined ? '' : row[typeIndex], fallbackTypes),
      normalizedTitle,
      acronym: journalAcronym(title),
      searchTokens: tokenizeJournalTitle(title)
    });
    if (records.length > (options.maximumRows || MAX_CSV_ROWS)) {
      throw new JournalCatalogError('too-many-rows', 'CSV contains more than 100,000 journal records.');
    }
  }
  if (!records.length) throw new JournalCatalogError('empty-catalog', 'CSV contains no journal records.');
  return records;
}

function mergeJournalRecords(recordGroups) {
  const merged = [];
  const titleIndexes = new Map();
  const issnIndexes = new Map();
  for (const record of recordGroups.flat()) {
    const normalizedTitle = record.normalizedTitle || normalizeJournalTitle(record.title);
    const issns = [record.issn, record.eissn].map(normalizeIssn).filter(Boolean);
    const byIssn = issns.map(issn => issnIndexes.get(issn)).find(index => index !== undefined);
    const byTitle = (titleIndexes.get(normalizedTitle) || []).find(index => {
      const existingIssns = [merged[index].issn, merged[index].eissn].map(normalizeIssn).filter(Boolean);
      return !issns.length || !existingIssns.length || issns.some(issn => existingIssns.includes(issn));
    });
    const index = byIssn ?? byTitle;
    if (index !== undefined) {
      merged[index].types = Array.from(new Set([...(merged[index].types || []), ...(record.types || [])]));
      if (!merged[index].issn && record.issn) merged[index].issn = record.issn;
      if (!merged[index].eissn && record.eissn) merged[index].eissn = record.eissn;
      issns.forEach(issn => issnIndexes.set(issn, index));
      continue;
    }
    const next = { ...record, normalizedTitle, acronym: record.acronym || journalAcronym(record.title), searchTokens: record.searchTokens || tokenizeJournalTitle(record.title) };
    const nextIndex = merged.push(next) - 1;
    titleIndexes.set(normalizedTitle, [...(titleIndexes.get(normalizedTitle) || []), nextIndex]);
    issns.forEach(issn => issnIndexes.set(issn, nextIndex));
  }
  return merged;
}

const isAcronymQuery = value => /^[A-Za-z0-9]{2,12}$/.test(String(value || '').trim());

function matchJournals(query, records, options = {}) {
  const trimmed = String(query || '').trim();
  if (trimmed.length < 2 || trimmed.length > 160) return [];
  const normalizedQuery = normalizeJournalTitle(trimmed);
  const issnQuery = normalizeIssn(trimmed);
  const possibleIssn = /^[0-9Xx\s-]+$/.test(trimmed) && issnQuery.length >= 4;
  const acronymQuery = trimmed.toLocaleUpperCase('en-US');
  const acronym = isAcronymQuery(trimmed);
  const matches = [];

  records.forEach(record => {
    const normalizedTitle = record.normalizedTitle || normalizeJournalTitle(record.title);
    const recordAcronym = record.acronym || journalAcronym(record.title);
    const tokens = record.searchTokens || tokenizeJournalTitle(record.title);
    const issns = [normalizeIssn(record.issn), normalizeIssn(record.eissn)].filter(Boolean);
    let score = 0;
    if (possibleIssn && issnQuery.length === 8 && issns.includes(issnQuery)) score = 1000;
    else if (possibleIssn && issns.some(issn => issn.startsWith(issnQuery))) score = 850;
    else if (normalizedTitle === normalizedQuery) score = 950;
    else if (acronym && recordAcronym === acronymQuery) score = 925;
    else if (acronym && recordAcronym.startsWith(acronymQuery)) score = 900 - Math.min(recordAcronym.length - acronymQuery.length, 20);
    else if (tokens.includes(normalizedQuery)) score = 800;
    else if (tokens.some(token => token.startsWith(normalizedQuery))) score = 700;
    else if (normalizedTitle.startsWith(normalizedQuery)) score = 650;
    else if (normalizedTitle.includes(normalizedQuery)) score = 500;
    if (score) matches.push({ record, score });
  });

  return matches.sort((left, right) => right.score - left.score
    || left.record.title.length - right.record.title.length
    || left.record.title.localeCompare(right.record.title, 'en-US'))
    .slice(0, options.limit || MAX_SUGGESTIONS)
    .map(match => match.record);
}

module.exports = {
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  JournalCatalogError,
  parseCsvRows,
  parseJournalCsv,
  tokenizeJournalTitle,
  normalizeJournalTitle,
  journalAcronym,
  normalizeIssn,
  mergeJournalRecords,
  matchJournals
};

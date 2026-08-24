'use strict';

const { parseCsvRows } = require('./journal-catalog');

const MAX_LIST_BYTES = 5 * 1024 * 1024;
const MAX_LIST_ROWS = 10000;
const MAX_TITLE_LENGTH = 300;
const TITLE_HEADERS = new Set([
  'journal',
  'journal name',
  'journal title',
  'publication',
  'publication name',
  'publication title',
  'source',
  'source title',
  'title'
]);

const UTD24_TITLES = [
  'Academy of Management Journal',
  'Academy of Management Review',
  'Administrative Science Quarterly',
  'Information Systems Research',
  'Journal of Accounting and Economics',
  'Journal of Accounting Research',
  'Journal of Consumer Research',
  'Journal of Finance',
  'Journal of Financial Economics',
  'Journal of International Business Studies',
  'Journal of Marketing',
  'Journal of Marketing Research',
  'Journal of Operations Management',
  'Journal on Computing',
  'Management Science',
  'Manufacturing and Service Operations Management',
  'Marketing Science',
  'MIS Quarterly',
  'Operations Research',
  'Organization Science',
  'Production and Operations Management',
  'Strategic Management Journal',
  'The Accounting Review',
  'The Review of Financial Studies'
];

class MyJournalListError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MyJournalListError';
    this.code = code;
  }
}

const textBytes = value => new TextEncoder().encode(String(value || '')).byteLength;

const normalizeJournalKey = value => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLocaleLowerCase('en-US');

const normalizeHeader = value => String(value || '')
  .replace(/^\uFEFF/, '')
  .trim()
  .toLocaleLowerCase('en-US')
  .replace(/[_\s]+/g, ' ');

function normalizeJournalTitles(titles) {
  const seen = new Set();
  const journals = [];
  for (const value of titles || []) {
    const title = String(value || '').trim().slice(0, MAX_TITLE_LENGTH);
    if (!title) continue;
    const key = normalizeJournalKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    journals.push({ id: key, title });
    if (journals.length > MAX_LIST_ROWS) {
      throw new MyJournalListError('too-many-rows', 'Journal list exceeds the 10,000-title limit.');
    }
  }
  return journals;
}

function parseManualJournalTitles(contents) {
  if (textBytes(contents) > MAX_LIST_BYTES) {
    throw new MyJournalListError('file-too-large', 'Journal list exceeds the 5 MiB limit.');
  }
  return normalizeJournalTitles(String(contents || '').replace(/\r\n?/g, '\n').split('\n'));
}

function parseJournalListCsv(contents) {
  if (textBytes(contents) > MAX_LIST_BYTES) {
    throw new MyJournalListError('file-too-large', 'CSV file exceeds the 5 MiB limit.');
  }
  const rows = parseCsvRows(contents);
  if (!rows.length) throw new MyJournalListError('empty-list', 'CSV file contains no journal titles.');
  if (rows.length > MAX_LIST_ROWS + 1) {
    throw new MyJournalListError('too-many-rows', 'CSV file exceeds the 10,000-row limit.');
  }

  const firstRow = rows[0];
  const titleIndex = firstRow.findIndex(value => TITLE_HEADERS.has(normalizeHeader(value)));
  const hasHeader = titleIndex >= 0;
  if (!hasHeader && firstRow.length > 1) {
    throw new MyJournalListError('missing-title-column', 'CSV file has no recognized journal-title column.');
  }
  const index = hasHeader ? titleIndex : 0;
  const journals = normalizeJournalTitles((hasHeader ? rows.slice(1) : rows).map(row => row[index]));
  if (!journals.length) throw new MyJournalListError('empty-list', 'CSV file contains no journal titles.');
  return journals;
}

function createJournalList(name, journals = [], id = crypto.randomUUID()) {
  const now = Date.now();
  return {
    id,
    name: String(name || '').trim(),
    journals: normalizeJournalTitles(journals.map(journal => journal?.title ?? journal)),
    createdAt: now,
    updatedAt: now
  };
}

const createDefaultJournalList = () => createJournalList(
  'UTD24',
  UTD24_TITLES,
  '697f9447-e2e5-49cf-be09-fb614b9b9032'
);

function buildWosJournalSearchUrl(title) {
  const escapedTitle = String(title || '').trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  if (!escapedTitle) throw new MyJournalListError('empty-title', 'Journal title is required.');
  const queryJson = encodeURIComponent(JSON.stringify([{ rowText: `SO=("${escapedTitle}")` }]));
  return `https://www.webofscience.com/wos/woscc/general-summary?queryJson=${queryJson}`;
}

module.exports = {
  MAX_LIST_BYTES,
  MAX_LIST_ROWS,
  MAX_TITLE_LENGTH,
  MyJournalListError,
  UTD24_TITLES,
  normalizeJournalKey,
  normalizeJournalTitles,
  parseManualJournalTitles,
  parseJournalListCsv,
  createJournalList,
  createDefaultJournalList,
  buildWosJournalSearchUrl
};

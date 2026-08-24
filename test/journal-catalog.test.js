'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  JournalCatalogError,
  parseCsvRows,
  parseJournalCsv,
  normalizeJournalTitle,
  journalAcronym,
  mergeJournalRecords,
  matchJournals
} = require('../src/journal-catalog');

test('CSV parser handles BOM, escaped quotes, commas, CRLF, and quoted newlines', () => {
  const rows = parseCsvRows('\uFEFF"Journal title","Publisher"\r\n"Journal of ""Complex"", Systems","Line one\r\nLine two"\r\n');
  assert.deepEqual(rows, [
    ['Journal title', 'Publisher'],
    ['Journal of "Complex", Systems', 'Line one\nLine two']
  ]);
});

test('journal CSV accepts WOS and AJG title columns and infers collection from file name', () => {
  const wos = parseJournalCsv([
    '"Journal title","ISSN","eISSN","Collection"',
    '"International Journal of Information Management","0268-4012","1873-4707","SSCI | SCIE"'
  ].join('\n'), { fileName: 'SSCI.csv' });
  assert.equal(wos[0].acronym, 'IJIM');
  assert.deepEqual(wos[0].types, ['SSCI', 'SCIE']);

  const ajg = parseJournalCsv([
    '"Journal Title","Print ISSN","E-ISSN"',
    '"Accounting Review","0001-4826","1558-7967"'
  ].join('\n'), { fileName: 'AJG2024.csv' });
  assert.deepEqual(ajg[0].types, ['AJG2024']);
});

test('journal CSV validates headers, row shape, ISSNs, and empty catalogs', () => {
  assert.throws(() => parseJournalCsv('ISSN\n1234-5678'), error => error instanceof JournalCatalogError && error.code === 'missing-title-column');
  assert.throws(() => parseJournalCsv('Journal title,ISSN\nNature,invalid'), error => error.code === 'invalid-row' && error.line === 2);
  assert.throws(() => parseJournalCsv('Journal title,ISSN\nNature'), error => error.code === 'invalid-row' && error.line === 2);
  assert.throws(() => parseJournalCsv('Journal title\n'), error => error.code === 'empty-catalog');
  assert.throws(() => parseJournalCsv('Journal title,Journal title\nOne,Two'), error => error.code === 'invalid-header');
});

test('normalization creates stop-word-free acronyms and folds case, width, and diacritics', () => {
  assert.equal(journalAcronym('The International Journal of Information Management'), 'IJIM');
  assert.equal(journalAcronym('Journal of the Academy of Marketing Science'), 'JAMS');
  assert.equal(normalizeJournalTitle('ＲÉSEARCH & Development'), 'research development');
});

test('matcher prioritizes exact ISSN, title, acronym, and acronym prefix', () => {
  const records = [
    ...parseJournalCsv('Journal title,ISSN,Collection\nInternational Journal of Information Management,0268-4012,SSCI'),
    ...parseJournalCsv('Journal title,ISSN,Collection\nInternational Journal of Industrial Relations,0020-7780,SSCI')
  ];
  assert.equal(matchJournals('0268-4012', records)[0].title, 'International Journal of Information Management');
  assert.equal(matchJournals('ijim', records)[0].title, 'International Journal of Information Management');
  assert.equal(matchJournals('International Journal of Industrial Relations', records)[0].issn, '0020-7780');
  assert.equal(matchJournals('iji', records).length, 2);
  assert.deepEqual(matchJournals('i', records), []);
});

test('catalog merge combines compatible duplicates and preserves type codes', () => {
  const ssci = parseJournalCsv('Journal title,ISSN,Collection\nNature,0028-0836,SSCI');
  const scie = parseJournalCsv('Journal Title,ISSN,E-ISSN,Type\nNature,0028-0836,1476-4687,SCIE');
  const merged = mergeJournalRecords([ssci, scie]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].issn, '0028-0836');
  assert.equal(merged[0].eissn, '1476-4687');
  assert.deepEqual(merged[0].types, ['SSCI', 'SCIE']);
});

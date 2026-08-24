const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCnkiUrlHashIndex,
  hydrateCnkiRecordsFromUrlHashes,
  mergeCnkiRecordSourceUrls,
  sourceUrlsForCnkiRecord
} = require('../src/cnki-pdf-index');

test('CNKI index stores URL to SHA-256 mappings independently of filenames', () => {
  const records = [{
    filename: '新書目.pdf',
    sha256: 'abc123',
    sourceUrl: 'https://cnki.net/download?id=1',
    finalUrl: 'https://cnki.net/file?id=1',
    duplicateSourceUrls: ['https://cnki.net/download?token=second']
  }];
  assert.deepEqual(buildCnkiUrlHashIndex(records), {
    'https://cnki.net/download?id=1': 'abc123',
    'https://cnki.net/download?token=second': 'abc123',
    'https://cnki.net/file?id=1': 'abc123'
  });
});

test('CNKI URL-hash mappings hydrate records and survive duplicate-file consolidation', () => {
  const records = [{ filename: '任意名称.pdf', sha256: 'same-hash' }];
  hydrateCnkiRecordsFromUrlHashes(records, { 'https://cnki.net/download?id=2': 'same-hash' });
  mergeCnkiRecordSourceUrls(records[0], { finalUrl: 'https://cnki.net/file?id=2' });
  assert.deepEqual(sourceUrlsForCnkiRecord(records[0]), [
    'https://cnki.net/download?id=2',
    'https://cnki.net/file?id=2'
  ]);
});

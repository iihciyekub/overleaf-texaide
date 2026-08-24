'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { extractIdentifiers, extractUuid } = require('../src/sidepanel-wos-tools');
const { parseWosTxt, toStandardJson } = require('../src/wos-txt-standard-json');

test('side-panel WOS search extracts and deduplicates DOI and WOS identifiers', () => {
  const result = extractIdentifiers(`
    WOS:000123456789012
    https://doi.org/10.1000/Example.1
    doi: 10.1000/example.1
    WOS:000123456789012
    unrelated text
  `);

  assert.deepEqual(result.wosids, ['WOS:000123456789012']);
  assert.deepEqual(result.dois, ['10.1000/example.1']);
});

test('UUID extraction pulls the 8-4-4-4-12-10 id out of WOS URLs and pasted text', () => {
  const uuid = 'abcDEF12-3456-7890-abcd-1234567890ab-1234567890';
  assert.equal(
    extractUuid(`https://www.webofscience.com/wos/woscc/full-record/WOS:000123456789012?uuid=${uuid}`),
    uuid
  );
  assert.equal(extractUuid(`leading text ${uuid} trailing text`), uuid);
  assert.equal(extractUuid(uuid), uuid);
});

test('UUID extraction returns an empty string when no UUID is present', () => {
  assert.equal(extractUuid(''), '');
  assert.equal(extractUuid('https://www.webofscience.com/wos/woscc/summary/no-uuid-here'), '');
  assert.equal(extractUuid('abcDEF12-3456-7890-abcd-1234567890ab'), ''); // truncated tail segment
});

test('WOS TXT converts to the WOS Aide standard JSON shape', () => {
  const txt = `FN Clarivate Analytics Web of Science\nVR 1.0\nPT J\nAU Smith, John\nTI A title with\n   a continuation\nSO Journal of Tests\nPY 2024\nDI 10.1234/Test.DOI\nUT WOS:000123456789012\nER\nEF`;
  assert.equal(parseWosTxt(txt).length, 1);
  const [record] = toStandardJson(txt);
  assert.deepEqual(record.meta_info, { doi: '10.1234/Test.DOI', No: null });
  assert.equal(record.wos_id, '000123456789012');
  assert.equal(record.wos_data.title, 'A title with a continuation');
  assert.equal(record.wos_data.source_title, 'Journal of Tests');
  assert.equal(record.wos_data.publication_year, '2024');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildLibKeyArticleUrl,
  extractDois,
  libraryAcronym,
  normalizeLibraryList,
  resolveLibraryDoi,
  searchLibraries,
  searchLibrariesDetailed
} = require('../src/library-access');
const {
  mergeAccessHistory,
  retainAccessHistory
} = require('../src/sidepanel-library-access');

test('extractDois normalizes and deduplicates mixed DOI input', () => {
  assert.deepEqual(extractDois('DOI: 10.1234/ABC.1.\nhttps://doi.org/10.1234/abc.1\n10.5555/x-y'), [
    '10.1234/abc.1',
    '10.5555/x-y'
  ]);
});

test('institution list supports API payload normalization and ranked autocomplete', () => {
  const libraries = normalizeLibraryList({ data: [
    { id: '254', attributes: { name: 'Hong Kong Polytechnic University' } },
    { id: '591', attributes: { name: 'Monash University', aliases: ['Monash Uni'] } }
  ] });
  assert.equal(searchLibraries(libraries, 'monash')[0].libraryId, '591');
  assert.equal(searchLibraries(libraries, 'monash uni')[0].libraryId, '591');
  assert.equal(searchLibraries(libraries, '254')[0].name, 'Hong Kong Polytechnic University');
});

test('institution search supports stop-word-free acronyms, fuzzy text, and regex', () => {
  const libraries = [
    { libraryId: '254', name: 'Hong Kong Polytechnic University', aliases: ['PolyU'] },
    { libraryId: '999', name: 'University of the Arts London', aliases: [] }
  ];
  assert.equal(libraryAcronym('University of the Arts London'), 'UAL');
  assert.equal(searchLibrariesDetailed(libraries, 'HKPU', { mode: 'text' }).matches[0].libraryId, '254');
  assert.equal(searchLibrariesDetailed(libraries, 'hngkngpoly', { mode: 'similar' }).matches[0].libraryId, '254');
  assert.equal(searchLibrariesDetailed(libraries, '^University.*London$', { mode: 'regex' }).matches[0].libraryId, '999');
  assert.equal(searchLibrariesDetailed(libraries, '[', { mode: 'regex' }).error, 'invalid_regex');
});

test('resolveLibraryDoi exchanges a temporary token and returns the full-text address', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return { ok: true, json: async () => ({ 'api-tokens': [{ id: 'temporary' }] }) };
    return { ok: true, json: async () => ({ data: { id: 'article', attributes: { libkeyFullTextFile: 'https://example.test/paper.pdf' } } }) };
  };
  const result = await resolveLibraryDoi({ libraryId: '254', doi: '10.1234/ABC', fetchImpl });
  assert.equal(result.accessUrl, 'https://example.test/paper.pdf');
  assert.match(calls[1].options.headers.authorization, /^Bearer /);
  assert.equal(calls[1].url, buildLibKeyArticleUrl('10.1234/abc'));
  assert.ok(calls.every(call => call.options.signal instanceof AbortSignal));
});

test('access history preserves stars while replacing duplicate DOI queries', () => {
  const old = [
    { libraryId: '254', doi: '10.1/a', favorite: true, resolvedAt: 1 },
    { libraryId: '254', doi: '10.1/b', favorite: false, resolvedAt: 1 }
  ];
  const merged = mergeAccessHistory(old, [
    { libraryId: '254', doi: '10.1/a', favorite: true, resolvedAt: 2 }
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].doi, '10.1/a');
  assert.equal(merged[0].resolvedAt, 2);
  assert.equal(merged[0].favorite, true);
});

test('access history limits unstarred records without removing starred records', () => {
  const items = [
    { doi: 'starred', favorite: true },
    { doi: 'newest', favorite: false },
    { doi: 'oldest', favorite: false }
  ];
  assert.deepEqual(retainAccessHistory(items, 2).map(item => item.doi), ['starred', 'newest']);
  assert.deepEqual(items.filter(item => item.favorite).map(item => item.doi), ['starred']);
});

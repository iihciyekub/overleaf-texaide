'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

require.extensions['.xml'] = (module, filename) => {
  module.exports = fs.readFileSync(filename, 'utf8');
};

const { plugins } = require('@citation-js/core');
const JSZip = require('jszip');
const {
  normalizeDoi,
  normalizeCrossrefItem,
  normalizePersistedCrossrefRecord,
  crossrefItemToCsl,
  crossrefRecordToBibtex,
  buildBibtex
} = require('../src/crossref-bib');
const {
  parseCslStyleMetadata,
  renderCslBibliography,
  sanitizeCslHtml,
  wordClipboardHtml
} = require('../src/crossref-csl');
const { styleMatchesQuery } = require('../src/crossref-style-store');
const { DOCX_MIME_TYPE, referenceHtmlToDocxBlob } = require('../src/crossref-docx');
const {
  CROSSREF_CACHE_KEY,
  CROSSREF_QUERY_HISTORY_KEY,
  CROSSREF_REFERENCES_WRAP_KEY,
  MAX_HISTORY_ITEMS,
  MAX_QUERY_HISTORY_ITEMS,
  addCrossrefQueryHistory,
  crossrefUrlForQuery,
  navigateCrossrefQueryHistory,
  normalizeCrossrefQueryHistory
} = require('../src/sidepanel-crossref');

const crossrefItem = {
  DOI: '10.1000/Example_1',
  type: 'journal-article',
  title: ['Research & development: <i>A test</i>'],
  author: [{ given: 'Ada', family: 'Lovelace' }, { given: 'Alan', family: 'Turing' }],
  issued: { 'date-parts': [[2025, 3, 1]] },
  'container-title': ['Journal of Tests'],
  volume: '12',
  issue: '2',
  page: '10-20',
  URL: 'https://doi.org/10.1000/Example_1'
};

test('normalizes Crossref metadata into a compact history record', () => {
  const record = normalizeCrossrefItem(crossrefItem);
  assert.equal(record.id, '10.1000/example_1');
  assert.equal(record.title, 'Research & development: A test');
  assert.equal(record.year, 2025);
  assert.equal(record.authors[0].family, 'Lovelace');
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.cslJson.type, 'article-journal');
  assert.deepEqual(record.cslJson.issued['date-parts'], [[2025, 3, 1]]);
  assert.equal(normalizeDoi('https://doi.org/10.1000/Example_1'), '10.1000/example_1');
});

test('maps rich Crossref metadata once into canonical CSL JSON', () => {
  const csl = crossrefItemToCsl({
    ...crossrefItem,
    subtitle: ['A subtitle'],
    editor: [{ given: 'Grace', family: 'Hopper' }],
    'article-number': 'e42',
    language: 'en',
    subject: ['Research', 'Testing']
  });
  assert.equal(csl.title, 'Research & development: A test: A subtitle');
  assert.equal(csl.editor[0].family, 'Hopper');
  assert.equal(csl.number, 'e42');
  assert.equal(csl.keyword, 'Research, Testing');
});

test('migrates compact history records to CSL JSON without a network request', () => {
  const migrated = normalizePersistedCrossrefRecord({
    id: '10.1000/legacy',
    doi: '10.1000/legacy',
    title: 'Legacy record',
    authors: [{ family: 'Legacy', given: 'Lee' }],
    year: 2020,
    journal: 'Legacy Journal',
    type: 'journal-article'
  });
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.cslJson.DOI, '10.1000/legacy');
  assert.deepEqual(migrated.cslJson.issued['date-parts'], [[2020]]);
});

test('renders escaped, deterministic BibTeX from Crossref records', () => {
  const record = normalizeCrossrefItem(crossrefItem);
  const bibtex = crossrefRecordToBibtex(record);
  assert.match(bibtex, /^@article\{lovelace2025research[a-z0-9]{4},/);
  assert.match(bibtex, /title = \{Research \\& development: A test\}/);
  assert.match(bibtex, /author = \{Lovelace, Ada and Turing, Alan\}/);
  assert.match(bibtex, /doi = \{10\.1000\/example\\_1\}/);
  assert.equal(buildBibtex([record, record]).split('@article').length, 3);
});

test('builds Crossref DOI and bibliographic query endpoints', () => {
  assert.equal(crossrefUrlForQuery('https://doi.org/10.1000/Example_1'), 'https://api.crossref.org/works/10.1000%2Fexample_1');
  const url = new URL(crossrefUrlForQuery('deep learning Lovelace'));
  assert.equal(url.origin, 'https://api.crossref.org');
  assert.equal(url.searchParams.get('query.bibliographic'), 'deep learning Lovelace');
  assert.equal(url.searchParams.get('rows'), '20');
  assert.equal(MAX_HISTORY_ITEMS, 100);
});

test('navigates persistent Crossref query history and clears after the newest item', () => {
  assert.equal(CROSSREF_QUERY_HISTORY_KEY, 'wosAideCrossrefQueryHistory');
  assert.equal(CROSSREF_REFERENCES_WRAP_KEY, 'wosAideCrossrefReferencesWrap');
  assert.equal(MAX_QUERY_HISTORY_ITEMS, 30);
  assert.deepEqual(normalizeCrossrefQueryHistory([' newer ', 'older', 'newer', '']), ['newer', 'older']);
  assert.deepEqual(addCrossrefQueryHistory(['older', 'newer'], 'newer'), ['newer', 'older']);

  const newest = navigateCrossrefQueryHistory(['newer', 'older'], -1, -1);
  const oldest = navigateCrossrefQueryHistory(['newer', 'older'], newest.index, -1);
  const backToNewest = navigateCrossrefQueryHistory(['newer', 'older'], oldest.index, 1);
  const blank = navigateCrossrefQueryHistory(['newer', 'older'], backToNewest.index, 1);
  assert.deepEqual(newest, { index: 0, value: 'newer' });
  assert.deepEqual(oldest, { index: 1, value: 'older' });
  assert.deepEqual(backToNewest, { index: 0, value: 'newer' });
  assert.deepEqual(blank, { index: -1, value: '' });
});

test('renders canonical Crossref records through bundled CSL styles', () => {
  const record = normalizeCrossrefItem(crossrefItem);
  const rendered = renderCslBibliography([record], { id: 'apa' });
  assert.equal(rendered.entryCount, 1);
  assert.match(rendered.html, /class="csl-entry"/);
  assert.match(rendered.html, /<i>Journal of Tests<\/i>/);
  assert.match(rendered.text, /Lovelace/);
  assert.match(wordClipboardHtml(rendered.html), /StartFragment/);
  assert.match(wordClipboardHtml(rendered.html), /^<!doctype html>/);
});

test('registers official CSL locales and renders a zh-CN bibliography style', () => {
  assert.equal(plugins.config.get('@csl').locales.has('zh-CN'), true);
  const record = normalizeCrossrefItem(crossrefItem);
  const chineseStyle = `
    <style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" default-locale="zh-CN">
      <info><title>Chinese numeric test</title><id>https://www.zotero.org/styles/chinese-numeric-test</id></info>
      <citation collapse="citation-number"><layout prefix="[" suffix="]"><text variable="citation-number"/></layout></citation>
      <bibliography et-al-min="2" et-al-use-first="1">
        <layout><text variable="citation-number" prefix="[" suffix="] "/><names variable="author"><name/><et-al/></names><text variable="title" prefix=". "/></layout>
      </bibliography>
    </style>`;
  const rendered = renderCslBibliography([record], { id: 'chinese-numeric-test', renderXml: chineseStyle }, 'zh-CN');
  assert.match(rendered.text, /^\[1\]/);
  assert.match(rendered.text, /Lovelace/);
});

test('webpack treats CSL locale XML as source and rejects broken bundles', () => {
  const webpackConfig = fs.readFileSync(path.join(__dirname, '../config/webpack.common.js'), 'utf8');
  const buildVerifier = fs.readFileSync(path.join(__dirname, '../scripts/verify-build-output.js'), 'utf8');
  assert.match(webpackConfig, /test:\s*\/\\\.xml\$\/i,[\s\S]{0,80}type:\s*'asset\/source'/);
  assert.match(webpackConfig, /emitOnErrors:\s*false/);
  assert.match(buildVerifier, /Module parse failed:/);
  assert.match(buildVerifier, /currently no loaders are configured to process this file/);
});

test('exports the rendered reference list as a real DOCX package', async () => {
  const textNode = value => ({ nodeType: 3, nodeValue: value });
  const element = (tagName, childNodes, href = '') => ({
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    childNodes,
    getAttribute: name => name === 'href' ? href : ''
  });
  const entry = element('div', [
    textNode('[1] Lovelace. '),
    element('i', [textNode('Journal of Tests')]),
    textNode('. '),
    element('a', [textNode('DOI')], 'https://doi.org/10.1000/example_1')
  ]);
  const OriginalDOMParser = global.DOMParser;
  global.DOMParser = class {
    parseFromString() {
      return { body: { firstElementChild: { querySelectorAll: () => [entry] } } };
    }
  };
  try {
    const blob = await referenceHtmlToDocxBlob('<div class="csl-entry">Reference</div>');
    assert.equal(blob.type, DOCX_MIME_TYPE);
    const buffer = await blob.arrayBuffer();
    const signature = Buffer.from(buffer).subarray(0, 2).toString('ascii');
    assert.equal(signature, 'PK');
    const archive = await JSZip.loadAsync(buffer);
    const documentXml = await archive.file('word/document.xml').async('string');
    assert.match(documentXml, /Lovelace/);
    assert.match(documentXml, /<w:i\/>/);
    assert.ok(archive.file('word/_rels/document.xml.rels'));
  } finally {
    global.DOMParser = OriginalDOMParser;
  }
});

test('re-registers an updated custom CSL style with the same id', () => {
  const record = normalizeCrossrefItem(crossrefItem);
  const customStyle = prefix => `
    <style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">
      <info><title>Replaceable</title><id>https://www.zotero.org/styles/replaceable</id></info>
      <citation><layout><text variable="title"/></layout></citation>
      <bibliography><layout prefix="${prefix}: "><text variable="title"/></layout></bibliography>
    </style>`;
  const first = renderCslBibliography([record], { id: 'replaceable', renderXml: customStyle('First') });
  const second = renderCslBibliography([record], { id: 'replaceable', renderXml: customStyle('Updated') });
  assert.match(first.text, /^First:/);
  assert.match(second.text, /^Updated:/);
  assert.doesNotMatch(second.text, /^First:/);
});

test('uses each CSL style bibliography sort rules', () => {
  const makeRecord = (doi, family, title) => normalizeCrossrefItem({
    ...crossrefItem,
    DOI: doi,
    title: [title],
    author: [{ given: 'A', family }]
  });
  const zulu = makeRecord('10.1000/zulu', 'Zulu', 'Zulu work');
  const able = makeRecord('10.1000/able', 'Able', 'Able work');
  const apa = renderCslBibliography([zulu, able], { id: 'apa' }).text;
  const vancouver = renderCslBibliography([zulu, able], { id: 'vancouver' }).text;
  assert.ok(apa.indexOf('Able') < apa.indexOf('Zulu'));
  assert.ok(vancouver.indexOf('Zulu') < vancouver.indexOf('Able'));
  assert.match(vancouver, /^1\.\s+Zulu/);
});

test('validates independent and dependent CSL style metadata', () => {
  const independent = parseCslStyleMetadata(`
    <style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">
      <info><title>Test Style</title><id>https://www.zotero.org/styles/test-style</id></info>
      <citation><layout><text variable="title"/></layout></citation>
      <bibliography><layout><text variable="title"/></layout></bibliography>
    </style>`);
  assert.equal(independent.id, 'test-style');
  assert.equal(independent.label, 'Test Style');
  assert.equal(independent.hasBibliography, true);
  const dependent = parseCslStyleMetadata(`
    <style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">
      <info><title>Dependent</title><id>https://www.zotero.org/styles/dependent</id>
      <link rel="independent-parent" href="https://www.zotero.org/styles/apa"/></info>
    </style>`);
  assert.equal(dependent.parentUrl, 'https://www.zotero.org/styles/apa');
});

test('sanitizes CSL HTML and matches compact official style queries', () => {
  const sanitized = sanitizeCslHtml('<div class="csl-entry" onclick="bad()"><i>Safe</i><script>bad()</script></div>');
  assert.doesNotMatch(sanitized, /script|onclick/);
  assert.match(sanitized, /<i>Safe<\/i>/);
  assert.equal(styleMatchesQuery({ id: 'apa', label: 'APA 7th edition' }, 'apa7'), true);
  assert.equal(styleMatchesQuery({ id: 'ieee-with-url', label: 'IEEE with URL' }, 'ieee url'), true);
});

test('Crossref side panel wires persistent selection actions', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/sidepanel-crossref.js'), 'utf8');
  assert.match(source, /CROSSREF_HISTORY_KEY = 'wosAideCrossrefHistory'/);
  assert.match(source, /history\.filter\(record => record\.favorite \|\| selectedIds\.has\(record\.id\)\)/);
  assert.match(source, /history-favorite-button/);
  assert.match(source, /navigator\.clipboard\?\.writeText/);
  assert.match(source, /application\/x-bibtex/);
  assert.match(source, /selectedIds = new Set\(\)/);
  assert.match(source, /const incomingIds = new Set\(incoming\.map\(record => record\.id\)\)/);
  assert.match(source, /history = retainHistoryLimit\(\[\.\.\.incoming, \.\.\.history\.filter\(record => !incomingIds\.has\(record\.id\)\)\]\)/);
  assert.match(source, /if \(!keepsChecked\) \{[\s\S]*results = \[\];[\s\S]*selectedIds\.clear\(\);/);
  assert.match(source, /crossref\.clearUnselectedConfirm/);
  assert.match(source, /const restoreSelectedHistory = \(\) =>/);
  assert.match(source, /results = restored;/);
  assert.match(source, /const enabled = records\.length > 0;[\s\S]*elements\.restoreHistoryBtn\.disabled = !enabled;/);
  assert.match(source, /\[CROSSREF_REFERENCES_WRAP_KEY\]: wrapReferences/);
  assert.equal(CROSSREF_CACHE_KEY, 'wosAideCrossrefCache');
  assert.match(source, /CROSSREF_CACHE_KEY = 'wosAideCrossrefCache'/);
  assert.match(source, /const historyByDoi = new Map\(\[\.\.\.cache, \.\.\.history\]/);
  assert.match(source, /crossrefClearAllHistoryBtn/);
  assert.match(source, /CROSSREF_QUERY_HISTORY_KEY\]: \[\], \[CROSSREF_CACHE_KEY\]: \[\]/);
});

test('Crossref history actions show text and BibTeX fields do not visually wrap', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/sidepanel.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../src/sidepanel.css'), 'utf8');
  const crossrefPanel = fs.readFileSync(path.join(__dirname, '../src/sidepanel-crossref.js'), 'utf8');
  assert.match(html, /data-i18n="crossref\.copyAction"/);
  assert.match(html, /data-i18n="crossref\.exportAction"/);
  assert.match(html, /data-i18n="crossref\.deleteAction"/);
  assert.match(html, /id="crossrefPreviewSubTab"[\s\S]*id="crossrefReferencesSubTab"/);
  assert.match(html, /id="crossrefPreviewSubPanel"[\s\S]*id="crossrefReferencesSubPanel"/);
  assert.match(html, /data-i18n="crossref\.copyReferences"/);
  assert.match(html, /id="crossrefCopyReferencesBtn" class="button button--ghost"/);
  assert.match(html, /id="crossrefExportReferencesBtn" class="button button--primary"/);
  assert.match(html, /id="crossrefReferenceWrapBtn"[^>]*aria-pressed="false"/);
  assert.match(html, /id="crossrefRestoreHistoryBtn"/);
  assert.doesNotMatch(html, /crossrefPreviewModeCsl|crossrefPreviewModeBib/);
  assert.match(css, /\.crossref-bib-preview[^}]*white-space: pre;/);
  assert.match(css, /\.crossref-references-preview \.csl-entry[^}]*white-space: nowrap;/);
  assert.match(css, /\.crossref-references-preview \.csl-bib-body[^}]*width: max-content;/);
  assert.match(css, /\.crossref-references-preview\.is-wrapped \.csl-entry[^}]*white-space: normal;/);
  assert.match(html, /id="crossrefCslStyleOfficialName"/);
  assert.match(crossrefPanel, /cslStyleOfficialName/);
  assert.match(css, /\.crossref-csl-style-official-name/);
});

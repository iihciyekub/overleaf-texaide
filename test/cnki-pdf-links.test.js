const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CNKI_DOWNLOAD_SELECTOR,
  collectCnkiPdfLinks,
  fileNameFromContentDisposition,
  isCnkiLocation,
  normalizePdfFileName,
  resolveDownloadUrl,
  sanitizePdfFileName
} = require('../src/cnki-pdf-links');
const {
  cnkiDocumentKey,
  filenameLikelyMatchesCnkiTitle,
  isCnkiLinkAlreadyDownloaded
} = require('../src/cnki-pdf-dedup');

test('matches existing CNKI PDFs by indexed URL or normalized expected filename', () => {
  const link = { url: 'https://oversea.cnki.net/download?id=42', title: 'A  Useful\u200B Paper', position: 1 };
  assert.equal(isCnkiLinkAlreadyDownloaded(link, {
    knownUrls: new Set([link.url]),
    knownNames: new Set()
  }), true);
  assert.equal(isCnkiLinkAlreadyDownloaded(link, {
    knownUrls: new Set(),
    knownNames: new Set(),
    knownTitles: new Set([cnkiDocumentKey('A Useful Paper')])
  }), true);
  assert.equal(isCnkiLinkAlreadyDownloaded(link, {
    knownUrls: new Set(),
    knownNames: new Set([normalizePdfFileName('a useful paper.pdf')])
  }), true);
  assert.equal(isCnkiLinkAlreadyDownloaded(link, {
    knownUrls: new Set(),
    knownNames: new Set(['different.pdf'])
  }), false);
});

test('matches CNKI title-author filenames despite quote, punctuation, and suffix differences', () => {
  const title = '尺寸类形量修饰的“柔性粒度条件”及相关问题';
  const fileName = '尺寸類形量修飾的「柔性粒度條件」及相關問題_郝琦.pdf';
  assert.equal(filenameLikelyMatchesCnkiTitle(fileName, title), true);
  assert.equal(isCnkiLinkAlreadyDownloaded({ title, position: 1 }, {
    knownNames: new Set([normalizePdfFileName(fileName)]),
    knownTitles: new Set(),
    knownUrls: new Set()
  }), true);
  assert.equal(isCnkiLinkAlreadyDownloaded({ title, position: 1 }, {
    knownNames: new Set(['新書目.pdf']),
    knownTitles: new Set([cnkiDocumentKey('尺寸類形量修飾的「柔性粒度條件」及相關問題')]),
    knownUrls: new Set()
  }), true);
  assert.equal(filenameLikelyMatchesCnkiTitle('新書目 (2).pdf', title), false);
  assert.equal(cnkiDocumentKey('“喝醉酒”類結構之“例外”問題新解_劉子靈.pdf'), '喝醉酒类结构之例外问题新解刘子灵');
});

const fakeDownloadElement = ({ href, title, onclick = '' }) => {
  const titleElement = {
    textContent: title,
    getAttribute: () => ''
  };
  const row = { querySelector: () => titleElement };
  return {
    getAttribute: (name) => ({ href, onclick }[name] || ''),
    closest: (selector) => selector === 'a[href]' ? null : row
  };
};

test('recognizes CNKI hosts and the observed download icon selector', () => {
  assert.equal(isCnkiLocation('oversea.cnki.net'), true);
  assert.equal(isCnkiLocation('www.cnki.net'), true);
  assert.equal(isCnkiLocation('cnki.example.com'), false);
  assert.match(CNKI_DOWNLOAD_SELECTOR, /downloadlink\.icon-download/);
  assert.match(CNKI_DOWNLOAD_SELECTOR, /a\.icon-download/);
});

test('collects unique current-page CNKI download links with titles', () => {
  const elements = [
    fakeDownloadElement({ href: '/kns8s/download?id=1', title: 'First paper' }),
    fakeDownloadElement({ href: '/kns8s/download?id=1', title: 'Duplicate button' }),
    fakeDownloadElement({ href: '/kns8s/download?id=2', title: 'Second paper' })
  ];
  const root = { querySelectorAll: () => elements };
  assert.deepEqual(collectCnkiPdfLinks(root, 'https://oversea.cnki.net/kns8s/advsearch'), [
    { url: 'https://oversea.cnki.net/kns8s/download?id=1', title: 'First paper', position: 1 },
    { url: 'https://oversea.cnki.net/kns8s/download?id=2', title: 'Second paper', position: 3 }
  ]);
});

test('rejects non-web download targets', () => {
  assert.equal(resolveDownloadUrl('javascript:void(0)', 'https://oversea.cnki.net/'), '');
  assert.equal(resolveDownloadUrl('file:///tmp/paper.pdf', 'https://oversea.cnki.net/'), '');
});

test('extracts a download URL embedded in a javascript action', () => {
  const element = fakeDownloadElement({
    href: "javascript:download('/kns8s/download?id=3')",
    title: 'Embedded link'
  });
  const root = { querySelectorAll: () => [element] };
  assert.equal(
    collectCnkiPdfLinks(root, 'https://oversea.cnki.net/kns8s/advsearch')[0].url,
    'https://oversea.cnki.net/kns8s/download?id=3'
  );
});

test('reads CNKI downloadurl attributes used by alternate result layouts', () => {
  const element = fakeDownloadElement({ href: '', title: 'Alternate layout' });
  const originalGetAttribute = element.getAttribute;
  element.getAttribute = name => name === 'downloadurl'
    ? '/kns8s/download?id=alternate'
    : originalGetAttribute(name);
  const root = { querySelectorAll: () => [element] };
  assert.equal(
    collectCnkiPdfLinks(root, 'https://oversea.cnki.net/kns8s/search')[0].url,
    'https://oversea.cnki.net/kns8s/download?id=alternate'
  );
});

test('creates safe PDF filenames from response headers and article titles', () => {
  assert.equal(
    fileNameFromContentDisposition("attachment; filename*=UTF-8''%E7%A0%94%E7%A9%B6.pdf"),
    '研究.pdf'
  );
  assert.equal(sanitizePdfFileName('A/B: study?'), 'A_B_ study_.pdf');
  assert.equal(sanitizePdfFileName('Already.pdf'), 'Already.pdf');
});

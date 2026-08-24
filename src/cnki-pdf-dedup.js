const OpenCC = require('opencc-js/t2cn');
const { normalizePdfFileName, sanitizePdfFileName } = require('./cnki-pdf-links');

const traditionalToSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });

const normalizeCnkiTitle = (value) => normalizePdfFileName(String(value || '').replace(/\.pdf$/i, ''));

const cnkiDocumentKey = (value) => traditionalToSimplified(normalizeCnkiTitle(value))
  .replace(/[\p{P}\p{S}\s]+/gu, '');

const filenameLikelyMatchesCnkiTitle = (fileName, title) => {
  const fileKey = cnkiDocumentKey(fileName);
  const titleKey = cnkiDocumentKey(title);
  if (!fileKey || !titleKey) return false;
  if (fileKey === titleKey) return true;
  if (titleKey.length < 8) return false;
  if (fileKey.startsWith(titleKey)) return true;
  return fileKey.length >= 16
    && titleKey.startsWith(fileKey)
    && fileKey.length / titleKey.length >= 0.65;
};

const isCnkiLinkAlreadyDownloaded = (link, { knownNames, knownTitles, knownUrls } = {}) => {
  if (knownUrls?.has?.(link?.url)) return true;
  if (knownTitles?.has?.(cnkiDocumentKey(link?.title))) return true;
  const expectedName = normalizePdfFileName(
    sanitizePdfFileName(link?.title, `CNKI article ${link?.position || 1}`)
  );
  if (knownNames?.has?.(expectedName)) return true;
  if (!knownNames?.[Symbol.iterator]) return false;
  for (const fileName of knownNames) {
    if (filenameLikelyMatchesCnkiTitle(fileName, link?.title)) return true;
  }
  return false;
};

module.exports = {
  cnkiDocumentKey,
  filenameLikelyMatchesCnkiTitle,
  isCnkiLinkAlreadyDownloaded,
  normalizeCnkiTitle
};

const nonEmpty = value => typeof value === 'string' && value.trim() ? value.trim() : '';

const sourceUrlsForCnkiRecord = record => Array.from(new Set([
  record?.sourceUrl,
  record?.finalUrl,
  ...(Array.isArray(record?.duplicateSourceUrls) ? record.duplicateSourceUrls : [])
].map(nonEmpty).filter(Boolean)));

const mergeCnkiRecordSourceUrls = (target, source) => {
  if (!target || !source) return target;
  const urls = Array.from(new Set([
    ...sourceUrlsForCnkiRecord(target),
    ...sourceUrlsForCnkiRecord(source)
  ]));
  if (!target.sourceUrl && urls.length) target.sourceUrl = urls[0];
  const primary = new Set([target.sourceUrl, target.finalUrl].filter(Boolean));
  target.duplicateSourceUrls = urls.filter(url => !primary.has(url));
  if (!target.duplicateSourceUrls.length) delete target.duplicateSourceUrls;
  return target;
};

const buildCnkiUrlHashIndex = records => {
  const entries = [];
  for (const record of records || []) {
    if (!record?.sha256) continue;
    for (const url of sourceUrlsForCnkiRecord(record)) entries.push([url, record.sha256]);
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
};

const hydrateCnkiRecordsFromUrlHashes = (records, urlHashes) => {
  if (!urlHashes || typeof urlHashes !== 'object' || Array.isArray(urlHashes)) return records;
  const byHash = new Map((records || []).filter(record => record?.sha256).map(record => [record.sha256, record]));
  for (const [url, sha256] of Object.entries(urlHashes)) {
    const record = byHash.get(sha256);
    if (record) mergeCnkiRecordSourceUrls(record, { sourceUrl: url });
  }
  return records;
};

module.exports = {
  buildCnkiUrlHashIndex,
  hydrateCnkiRecordsFromUrlHashes,
  mergeCnkiRecordSourceUrls,
  sourceUrlsForCnkiRecord
};

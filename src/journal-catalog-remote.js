'use strict';

const { MAX_CSV_BYTES, parseJournalCsv } = require('./journal-catalog');

const GITHUB_REPOSITORY = 'wosaide/wosaide-journal-lists';
const GITHUB_REPOSITORY_URL = `https://github.com/${GITHUB_REPOSITORY}`;
const GITHUB_COMMITS_API = `https://api.github.com/repos/${GITHUB_REPOSITORY}/commits?sha=main&per_page=1`;
const REMOTE_DATASETS = Object.freeze(['SSCI', 'SCIE', 'AHCI', 'ESCI'].map(name => Object.freeze({
  id: name.toLocaleLowerCase('en-US'),
  name,
  fileName: `${name}.csv`
})));

const byteLength = value => new TextEncoder().encode(String(value || '')).byteLength;

function normalizeGitHubVersion(payload) {
  const entry = Array.isArray(payload) ? payload[0] : payload;
  const revision = String(entry?.sha || '').trim();
  const publishedAt = String(entry?.commit?.committer?.date || entry?.commit?.author?.date || '').trim();
  if (!/^[0-9a-f]{40}$/i.test(revision) || Number.isNaN(Date.parse(publishedAt))) {
    throw new Error('GitHub returned incomplete journal catalog version metadata.');
  }
  const date = new Date(publishedAt).toISOString().slice(0, 10).replace(/-/g, '.');
  return {
    version: `${date} · ${revision.slice(0, 8)}`,
    revision,
    publishedAt,
    url: entry?.html_url || `${GITHUB_REPOSITORY_URL}/commit/${revision}`
  };
}

async function fetchLatestCatalogVersion(fetchImpl = fetch) {
  const response = await fetchImpl(GITHUB_COMMITS_API, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`GitHub version check returned HTTP ${response.status}.`);
  return normalizeGitHubVersion(await response.json());
}

const rawDatasetUrl = (dataset, revision) =>
  `https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/${encodeURIComponent(revision)}/${dataset.fileName}`;

function installedRemoteVersion(sources) {
  const remote = REMOTE_DATASETS.map(dataset =>
    (sources || []).find(source => source?.id === `github:${dataset.id}` && source?.revision));
  if (remote.some(source => !source)) return null;
  if (!remote.every(source => source.revision === remote[0].revision)) return null;
  return {
    version: remote[0].version,
    revision: remote[0].revision,
    publishedAt: remote[0].publishedAt
  };
}

const hasRemoteUpdate = (sources, latest) => installedRemoteVersion(sources)?.revision !== latest?.revision;

async function downloadRemoteCatalogs(version, options = {}) {
  if (!version?.revision) throw new Error('A GitHub catalog version is required.');
  const fetchImpl = options.fetchImpl || fetch;
  const importedAt = options.importedAt || Date.now();
  const downloads = await Promise.all(REMOTE_DATASETS.map(async dataset => {
    const sourceUrl = rawDatasetUrl(dataset, version.revision);
    const response = await fetchImpl(sourceUrl, { headers: { Accept: 'text/csv,text/plain' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`${dataset.name} download returned HTTP ${response.status}.`);
    const contents = await response.text();
    const size = byteLength(contents);
    if (size > MAX_CSV_BYTES) throw new Error(`${dataset.name} exceeds the 25 MiB limit.`);
    options.onDownloaded?.(dataset);
    return { dataset, contents, size, sourceUrl };
  }));

  return downloads.map(({ dataset, contents, size, sourceUrl }) => {
    const records = parseJournalCsv(contents, { fileName: dataset.fileName });
    return {
      id: `github:${dataset.id}`,
      datasetId: dataset.id,
      fileName: dataset.fileName,
      origin: 'github',
      repository: GITHUB_REPOSITORY,
      version: version.version,
      revision: version.revision,
      publishedAt: version.publishedAt,
      sourceUrl,
      byteLength: size,
      rowCount: records.length,
      importedAt,
      records
    };
  });
}

module.exports = {
  GITHUB_REPOSITORY,
  GITHUB_REPOSITORY_URL,
  GITHUB_COMMITS_API,
  REMOTE_DATASETS,
  normalizeGitHubVersion,
  fetchLatestCatalogVersion,
  rawDatasetUrl,
  installedRemoteVersion,
  hasRemoteUpdate,
  downloadRemoteCatalogs
};

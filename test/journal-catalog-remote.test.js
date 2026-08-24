'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  GITHUB_REPOSITORY,
  REMOTE_DATASETS,
  normalizeGitHubVersion,
  rawDatasetUrl,
  installedRemoteVersion,
  hasRemoteUpdate,
  downloadRemoteCatalogs
} = require('../src/journal-catalog-remote');

const version = {
  version: '2026.07.27 · af01a11e',
  revision: 'af01a11e7ba5d4c6ad591bed5303c25af3f541bc',
  publishedAt: '2026-07-27T12:39:17Z'
};

test('official GitHub catalog defines the four WOS datasets', () => {
  assert.equal(GITHUB_REPOSITORY, 'wosaide/wosaide-journal-lists');
  assert.deepEqual(REMOTE_DATASETS.map(dataset => dataset.fileName), [
    'SSCI.csv', 'SCIE.csv', 'AHCI.csv', 'ESCI.csv'
  ]);
  assert.match(rawDatasetUrl(REMOTE_DATASETS[0], version.revision), new RegExp(`${version.revision}/SSCI\\.csv$`));
});

test('GitHub commit metadata becomes a visible date and short revision version', () => {
  assert.deepEqual(normalizeGitHubVersion([{
    sha: version.revision,
    html_url: 'https://github.com/wosaide/wosaide-journal-lists/commit/af01a11e',
    commit: { committer: { date: version.publishedAt } }
  }]), { ...version, url: 'https://github.com/wosaide/wosaide-journal-lists/commit/af01a11e' });
  assert.throws(() => normalizeGitHubVersion([]), /incomplete/);
});

test('installed GitHub catalogs must contain all four datasets at one revision', () => {
  const sources = REMOTE_DATASETS.map(dataset => ({
    id: `github:${dataset.id}`,
    ...version
  }));
  assert.deepEqual(installedRemoteVersion(sources), version);
  assert.equal(hasRemoteUpdate(sources, version), false);
  assert.equal(hasRemoteUpdate(sources, { ...version, revision: '1'.repeat(40) }), true);
  assert.equal(installedRemoteVersion(sources.slice(1)), null);
});

test('remote download validates all CSV files and builds storage-compatible sources', async () => {
  const downloaded = [];
  const fetchImpl = async url => {
    const name = /\/([A-Z]+)\.csv$/.exec(url)?.[1];
    return {
      ok: true,
      text: async () => `Journal title,ISSN\n${name} Journal,1234-567X`
    };
  };
  const sources = await downloadRemoteCatalogs(version, {
    fetchImpl,
    importedAt: 123,
    onDownloaded: dataset => downloaded.push(dataset.name)
  });
  assert.equal(sources.length, 4);
  assert.deepEqual(new Set(downloaded), new Set(['SSCI', 'SCIE', 'AHCI', 'ESCI']));
  assert.deepEqual(sources.map(source => source.id), ['github:ssci', 'github:scie', 'github:ahci', 'github:esci']);
  assert.ok(sources.every(source => source.origin === 'github' && source.revision === version.revision));
  assert.ok(sources.every(source => source.rowCount === 1 && source.importedAt === 123));
  assert.deepEqual(sources.map(source => source.records[0].types[0]), ['SSCI', 'SCIE', 'AHCI', 'ESCI']);
});

test('remote download rejects the whole batch when one dataset is invalid', async () => {
  const fetchImpl = async url => ({
    ok: true,
    text: async () => url.endsWith('/AHCI.csv') ? 'ISSN\n1234-567X' : 'Journal title\nValid Journal'
  });
  await assert.rejects(downloadRemoteCatalogs(version, { fetchImpl }), /Missing journal title column/);
});

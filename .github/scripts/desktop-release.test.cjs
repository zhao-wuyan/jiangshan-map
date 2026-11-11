'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  STATE_PATH, decideRelease, readCheckpoint, checkRelease,
  fetchLatestRelease, createCheckpoint, recordRelease, main,
} = require('./desktop-release.cjs');

const REPOSITORY = 'DeanChensj/jiangshan-map';
const SHA = 'a'.repeat(40);
const NOW = new Date('2026-11-11T12:00:00.000Z');

function publishedRelease(overrides = {}) {
  return {
    id: 100,
    tag_name: 'v1.0.0',
    html_url: `https://github.com/${REPOSITORY}/releases/tag/v1.0.0`,
    draft: false,
    prerelease: false,
    body: 'Original notes',
    ...overrides,
  };
}

function recordEnv(overrides = {}) {
  return { UPSTREAM_RELEASE_ID: '100', UPSTREAM_RELEASE_TAG: 'v1.0.0', BUILT_SHA: SHA, ...overrides };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.github'));
  return { root, filename: path.join(root, STATE_PATH) };
}

function apiRelease(release = publishedRelease()) {
  return async () => new Response(JSON.stringify(release), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('no latest release skips without inventing release metadata', () => {
  const result = decideRelease(null, null);
  assert.equal(result.should_build, false);
  assert.equal(result.release_id, '');
  assert.equal(result.release_tag, '');
  assert.equal(result.release_url, '');
});

test('drafts and prereleases never request packaging, even without a checkpoint', () => {
  for (const flags of [{ draft: true }, { prerelease: true }, { draft: true, prerelease: true }]) {
    assert.equal(decideRelease(publishedRelease(flags), null).should_build, false);
  }
});

test('the first official release requests packaging with its metadata', () => {
  const result = decideRelease(publishedRelease(), null);
  assert.equal(result.should_build, true);
  assert.equal(result.release_id, '100');
  assert.equal(result.release_tag, 'v1.0.0');
  assert.equal(result.release_url, publishedRelease().html_url);
});

test('the same successful release ID skips despite edited notes, tag or source', () => {
  const checkpoint = createCheckpoint(recordEnv(), REPOSITORY, NOW);
  const result = decideRelease(publishedRelease({
    body: 'Completely rewritten notes',
    tag_name: 'renamed-tag',
    target_commitish: 'different-branch',
  }), checkpoint);
  assert.equal(result.should_build, false);
});

test('a different official release ID requests packaging even if the tag is unchanged', () => {
  const checkpoint = createCheckpoint(recordEnv(), REPOSITORY, NOW);
  assert.equal(decideRelease(publishedRelease({ id: 101 }), checkpoint).should_build, true);
});

test('a genuinely missing checkpoint is a first-run state', t => {
  const { root } = fixture(t);
  assert.equal(readCheckpoint(root, REPOSITORY), null);
});

test('invalid JSON, malformed fields and a foreign repository fail closed', t => {
  const { root, filename } = fixture(t);
  const valid = createCheckpoint(recordEnv(), REPOSITORY, NOW);
  const invalidStates = [
    '{broken json',
    'null',
    '[]',
    '{}',
    JSON.stringify({ ...valid, release_id: 0 }),
    JSON.stringify({ ...valid, release_id: 1.5 }),
    JSON.stringify({ ...valid, release_tag: '' }),
    JSON.stringify({ ...valid, source_sha: 'shortsha' }),
    JSON.stringify({ ...valid, built_at: 'not a date' }),
    JSON.stringify({ ...valid, repository: 'another/repository' }),
  ];
  for (const content of invalidStates) {
    fs.writeFileSync(filename, content);
    assert.throws(() => readCheckpoint(root, REPOSITORY), /Invalid release checkpoint/);
    assert.equal(fs.readFileSync(filename, 'utf8'), content);
  }
});

test('check emits build outputs and a reason without advancing an existing checkpoint', async t => {
  const { root, filename } = fixture(t);
  recordRelease(root, recordEnv(), REPOSITORY, NOW);
  const before = fs.readFileSync(filename, 'utf8');
  const env = {
    UPSTREAM_REPOSITORY: REPOSITORY,
    GITHUB_OUTPUT: path.join(root, 'output.txt'),
    GITHUB_STEP_SUMMARY: path.join(root, 'summary.md'),
  };
  const result = await main(['check'], env, root, apiRelease(publishedRelease({ id: 101 })));
  assert.equal(result.should_build, true);
  assert.equal(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8'), [
    'should_build=true',
    'release_id=101',
    'release_tag=v1.0.0',
    `release_url=${publishedRelease().html_url}`,
    '',
  ].join('\n'));
  assert.equal(fs.readFileSync(filename, 'utf8'), before);
  assert.equal(readCheckpoint(root, REPOSITORY).release_id, '100');
});

test('repeated first-run checks do not create a successful checkpoint', async t => {
  const { root, filename } = fixture(t);
  const first = await checkRelease(root, REPOSITORY, undefined, apiRelease());
  const second = await checkRelease(root, REPOSITORY, undefined, apiRelease());
  assert.equal(first.should_build, true);
  assert.equal(second.should_build, true);
  assert.equal(fs.existsSync(filename), false);
});

test('404 skips normally without a checkpoint or release metadata', async t => {
  const { root } = fixture(t);
  const result = await checkRelease(root, REPOSITORY, undefined,
    async () => new Response('Not JSON, but 404 needs no body parsing', { status: 404 }));
  assert.equal(result.should_build, false);
  assert.equal(result.release_id, '');
  assert.equal(readCheckpoint(root, REPOSITORY), null);
});

test('a missing upstream release cannot mask a corrupt checkpoint', async t => {
  const { root, filename } = fixture(t);
  fs.writeFileSync(filename, '{}');
  await assert.rejects(checkRelease(root, REPOSITORY, undefined,
    async () => new Response(null, { status: 404 })), /Invalid release checkpoint/);
});

test('HTTP, network, JSON and malformed release responses are failures, not skips', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(fetchLatestRelease(REPOSITORY, undefined,
      async () => new Response('Unavailable', { status })), new RegExp(`HTTP ${status}`));
  }
  await assert.rejects(fetchLatestRelease(REPOSITORY, undefined,
    async () => { throw new Error('Network disconnected'); }), /request failed: Network disconnected/);
  await assert.rejects(fetchLatestRelease(REPOSITORY, undefined,
    async () => new Response('{invalid json', { status: 200 })), /invalid JSON/);
  for (const payload of [null, {}, publishedRelease({ id: -1 }), publishedRelease({ tag_name: 'tag\nshould_build=true' })]) {
    await assert.rejects(fetchLatestRelease(REPOSITORY, undefined, apiRelease(payload)), /release object|positive integer|single-line/);
  }
});

test('record writes complete successful state and the next check skips the same ID', async t => {
  const { root, filename } = fixture(t);
  const state = recordRelease(root, recordEnv(), REPOSITORY, NOW);
  assert.deepEqual(JSON.parse(fs.readFileSync(filename, 'utf8')), {
    repository: REPOSITORY,
    release_id: '100',
    release_tag: 'v1.0.0',
    source_sha: SHA,
    built_at: NOW.toISOString(),
  });
  assert.deepEqual(readCheckpoint(root, REPOSITORY), state);
  assert.equal((await checkRelease(root, REPOSITORY, undefined, apiRelease())).should_build, false);
});

test('record rejects absent release identity, invalid IDs and non-commit SHAs without overwriting state', t => {
  const { root, filename } = fixture(t);
  recordRelease(root, recordEnv(), REPOSITORY, NOW);
  const before = fs.readFileSync(filename, 'utf8');
  const invalid = [
    {},
    recordEnv({ UPSTREAM_RELEASE_ID: undefined }),
    recordEnv({ UPSTREAM_RELEASE_ID: '0' }),
    recordEnv({ UPSTREAM_RELEASE_ID: '-1' }),
    recordEnv({ UPSTREAM_RELEASE_ID: '1.5' }),
    recordEnv({ UPSTREAM_RELEASE_ID: '1e3' }),
    recordEnv({ UPSTREAM_RELEASE_TAG: '' }),
    recordEnv({ UPSTREAM_RELEASE_TAG: 'v1\nextra=value' }),
    recordEnv({ BUILT_SHA: undefined }),
    recordEnv({ BUILT_SHA: 'main' }),
    recordEnv({ BUILT_SHA: 'abcdef1' }),
    recordEnv({ BUILT_SHA: 'g'.repeat(40) }),
  ];
  for (const env of invalid) {
    assert.throws(() => recordRelease(root, env, REPOSITORY, NOW));
    assert.equal(fs.readFileSync(filename, 'utf8'), before);
  }
});

test('record does not silently replace a corrupt checkpoint', t => {
  const { root, filename } = fixture(t);
  fs.writeFileSync(filename, '{broken');
  assert.throws(() => recordRelease(root, recordEnv(), REPOSITORY, NOW), /Invalid release checkpoint/);
  assert.equal(fs.readFileSync(filename, 'utf8'), '{broken');
});

test('unknown commands cannot request a forced build', async t => {
  const { root, filename } = fixture(t);
  await assert.rejects(main(['force-build'], {}, root), /Usage:/);
  assert.equal(fs.existsSync(filename), false);
});

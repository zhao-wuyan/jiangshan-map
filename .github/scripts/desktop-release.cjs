#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_REPOSITORY = 'DeanChensj/jiangshan-map';
const STATE_PATH = '.github/desktop-release-state.json';

function validateRepository(repository) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
      || repository.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('UPSTREAM_REPOSITORY must be an owner/repository pair.');
  }
  return repository;
}

function releaseId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) return value;
  throw new Error('Release ID must be a positive integer.');
}

function singleLine(value, name) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value)) {
    throw new Error(`${name} must be a nonempty single-line string.`);
  }
  return value;
}

function commitHash(value) {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value)) {
    throw new Error('BUILT_SHA must be a full commit hash (40 or 64 hexadecimal characters).');
  }
  return value;
}

function validateCheckpoint(state, repository) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Release checkpoint must be an object.');
  }
  validateRepository(state.repository);
  if (state.repository.toLowerCase() !== repository.toLowerCase()) {
    throw new Error(`Release checkpoint belongs to ${state.repository}, not ${repository}.`);
  }
  releaseId(state.release_id);
  singleLine(state.release_tag, 'Checkpoint release tag');
  commitHash(state.source_sha);
  if (typeof state.built_at !== 'string' || !Number.isFinite(Date.parse(state.built_at))) {
    throw new Error('Release checkpoint must contain a valid built_at timestamp.');
  }
  return state;
}

function readCheckpoint(root, repository) {
  const filename = path.join(root, STATE_PATH);
  let text;
  try {
    text = fs.readFileSync(filename, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Cannot read release checkpoint ${STATE_PATH}: ${error.message}`, { cause: error });
  }
  try {
    return validateCheckpoint(JSON.parse(text), repository);
  } catch (error) {
    throw new Error(`Invalid release checkpoint ${STATE_PATH}: ${error.message}`, { cause: error });
  }
}

function normalizeRelease(release) {
  if (!release || typeof release !== 'object' || Array.isArray(release)
      || typeof release.draft !== 'boolean' || typeof release.prerelease !== 'boolean') {
    throw new Error('GitHub latest-release response is not a release object.');
  }
  const id = releaseId(release.id);
  const tag = singleLine(release.tag_name, 'Upstream release tag');
  const url = singleLine(release.html_url, 'Upstream release URL');
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    throw new Error('Upstream release URL is invalid.', { cause: error });
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'github.com') {
    throw new Error('Upstream release URL must be an HTTPS GitHub URL.');
  }
  return { id, tag, url, draft: release.draft, prerelease: release.prerelease };
}

// Only the published release identity matters; body, tag edits and source commits
// cannot turn an already successful release into another build request.
function decideRelease(release, checkpoint, repository = DEFAULT_REPOSITORY) {
  validateRepository(repository);
  if (checkpoint !== null) validateCheckpoint(checkpoint, repository);
  if (release === null) {
    return { should_build: false, release_id: '', release_tag: '', release_url: '', reason: 'No upstream release exists (GitHub returned 404).' };
  }
  const latest = normalizeRelease(release);
  const metadata = { release_id: latest.id, release_tag: latest.tag, release_url: latest.url };
  if (latest.draft || latest.prerelease) {
    return { should_build: false, ...metadata, reason: 'Draft and prerelease releases are not eligible for desktop packaging.' };
  }
  if (checkpoint !== null && releaseId(checkpoint.release_id) === latest.id) {
    return { should_build: false, ...metadata, reason: 'This upstream release was already packaged successfully.' };
  }
  return {
    should_build: true,
    ...metadata,
    reason: checkpoint === null ? 'First successful-release checkpoint is absent; package this upstream release.' : 'Upstream release ID differs from the last successful package.',
  };
}

async function checkRelease(root, repository, token, fetchImpl = globalThis.fetch) {
  // Read state even when no release exists, so corruption never silently skips.
  const checkpoint = readCheckpoint(root, repository);
  const release = await fetchLatestRelease(repository, token, fetchImpl);
  return decideRelease(release, checkpoint, repository);
}

async function fetchLatestRelease(repository, token, fetchImpl = globalThis.fetch) {
  validateRepository(repository);
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'jiangshan-map-desktop-release',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `https://api.github.com/repos/${repository}/releases/latest`;
  let response;
  try {
    response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30000) });
  } catch (error) {
    throw new Error(`GitHub latest-release request failed: ${error.message}`, { cause: error });
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub latest-release request failed: HTTP ${response.status}.`);
  let release;
  try {
    release = await response.json();
  } catch (error) {
    throw new Error(`GitHub latest-release response is invalid JSON: ${error.message}`, { cause: error });
  }
  normalizeRelease(release);
  return release;
}

function createCheckpoint(env, repository = DEFAULT_REPOSITORY, now = new Date()) {
  validateRepository(repository);
  const state = {
    repository,
    release_id: releaseId(env.UPSTREAM_RELEASE_ID),
    release_tag: singleLine(env.UPSTREAM_RELEASE_TAG, 'UPSTREAM_RELEASE_TAG'),
    source_sha: commitHash(env.BUILT_SHA),
    built_at: now.toISOString(),
  };
  return validateCheckpoint(state, repository);
}

function recordRelease(root, env, repository = DEFAULT_REPOSITORY, now = new Date()) {
  const state = createCheckpoint(env, repository, now);
  // A malformed existing checkpoint is a failure, not permission to reset history.
  readCheckpoint(root, repository);
  const filename = path.join(root, STATE_PATH);
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  try {
    fs.renameSync(temporary, filename);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return state;
}

function appendSummary(env, message) {
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `### Desktop release gate\n\n${message}\n\n`);
}

async function main(args = process.argv.slice(2), env = process.env, root = process.cwd(), fetchImpl = globalThis.fetch) {
  if (args.length !== 1 || !['check', 'record'].includes(args[0])) {
    throw new Error('Usage: node .github/scripts/desktop-release.cjs check|record');
  }
  const repository = validateRepository(env.UPSTREAM_REPOSITORY || DEFAULT_REPOSITORY);
  if (args[0] === 'record') {
    const state = recordRelease(root, env, repository);
    appendSummary(env, `Recorded successful packaging for ${repository} release ID ${state.release_id}, source commit ${state.source_sha}.`);
    return state;
  }
  const result = await checkRelease(root, repository, env.GH_TOKEN, fetchImpl);
  const output = ['should_build', 'release_id', 'release_tag', 'release_url']
    .map(key => `${key}=${result[key]}\n`).join('');
  appendSummary(env, `${result.should_build ? 'Build required' : 'Skipped'}: ${result.reason}${result.release_id ? ` Upstream release ID: ${result.release_id}.` : ''}`);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, output);
  else process.stdout.write(output);
  return result;
}

module.exports = { STATE_PATH, decideRelease, readCheckpoint, checkRelease, fetchLatestRelease, createCheckpoint, recordRelease, main };

if (require.main === module) {
  main().catch(error => {
    console.error(`Desktop release gate failed: ${error.message}`);
    try {
      appendSummary(process.env, `Failed: ${error.message}`);
    } catch (summaryError) {
      console.error(`Cannot write failure summary: ${summaryError.message}`);
    }
    process.exitCode = 1;
  });
}

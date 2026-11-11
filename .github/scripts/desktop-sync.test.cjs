'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const syncVersion = require('../../scripts/sync_version.js');
const { synchronize } = require('./desktop-sync.cjs');

const SYNC_CLI = path.join(__dirname, 'desktop-sync.cjs');
const REAL_HASH_MODULE = path.resolve(__dirname, '../../scripts/sync_version.js');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const upstream = path.join(root, 'upstream');
  const fork = path.join(root, 'fork');
  fs.mkdirSync(upstream);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(root, 'empty-global-config'),
    GIT_TERMINAL_PROMPT: '0',
    UPSTREAM_REPOSITORY: upstream,
    UPSTREAM_BRANCH: 'main',
    GITHUB_OUTPUT: path.join(root, 'output'),
    GITHUB_STEP_SUMMARY: path.join(root, 'summary'),
  });
  fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');

  function git(cwd, args) {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr || result.error || result.stdout}`);
    return result.stdout.trim();
  }
  function write(cwd, file, content) {
    const target = path.join(cwd, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  function identity(cwd) {
    git(cwd, ['config', 'user.name', 'Sync Test']);
    git(cwd, ['config', 'user.email', 'sync-test@example.invalid']);
    git(cwd, ['config', 'core.autocrlf', 'false']);
    git(cwd, ['config', 'core.hooksPath', path.join(root, 'no-hooks')]);
    git(cwd, ['config', 'commit.gpgsign', 'false']);
  }
  function commit(cwd, message) {
    git(cwd, ['add', '--all']);
    git(cwd, ['commit', '-m', message]);
    return git(cwd, ['rev-parse', 'HEAD']);
  }
  function hash(cwd) {
    const result = spawnSync(process.execPath, ['scripts/sync_version.js'], { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.error || result.stdout);
  }
  function run() {
    return spawnSync(process.execPath, [SYNC_CLI], { cwd: fork, env, encoding: 'utf8' });
  }
  function outputs() {
    return Object.fromEntries(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8').trim().split('\n').map((line) => line.split('=')));
  }
  function clean() {
    assert.equal(git(fork, ['status', '--porcelain=v1', '--untracked-files=all']), '');
    assert.equal(fs.existsSync(path.join(fork, '.git/MERGE_HEAD')), false);
  }

  git(upstream, ['init', '--initial-branch=main']);
  identity(upstream);
  write(upstream, 'scripts/sync_version.js', fs.readFileSync(REAL_HASH_MODULE));
  write(upstream, '.gitattributes', 'index.html merge=sync-version\n');
  const assets = new Set([...syncVersion.STATIC_TAG_ASSETS, ...syncVersion.LAZY_ATTR_ASSETS.map(({ relPath }) => relPath)]);
  for (const asset of assets) write(upstream, asset, `/* fixture ${asset} */\n`);
  const tags = syncVersion.STATIC_TAG_ASSETS.map((asset) => asset.endsWith('.css')
    ? `<link rel="stylesheet" href="${asset}?v=00000000">`
    : `<script src="${asset}?v=00000000"></script>`);
  write(upstream, 'index.html', `<!doctype html>\n<html>\n<head>\n${tags.join('\n')}\n</head>\n<body>Atlas</body>\n</html>\n`);
  write(upstream, 'shared.txt', 'base business content\n');
  write(upstream, '.github/workflows/maintained.yml', 'name: original\n');
  write(upstream, '.github/workflows/keep.yml', 'name: keep\n');
  hash(upstream);
  commit(upstream, 'base');
  git(root, ['clone', '--quiet', upstream, fork]);
  identity(fork);
  return { root, upstream, fork, env, git, write, commit, hash, run, outputs, clean };
}

function success(result) {
  assert.equal(result.status, 0, result.stderr || result.error || result.stdout);
}

function verifyHashes(cwd) {
  const modulePath = path.join(cwd, 'scripts/sync_version.js');
  require(modulePath).verifyIndexHtmlAssetHashes(cwd);
}

test('merges upstream and fork business changes and emits only the resulting SHAs', (t) => {
  const f = fixture(t);
  f.write(f.upstream, 'upstream.txt', 'upstream feature\n');
  const upstreamSha = f.commit(f.upstream, 'upstream feature');
  f.write(f.fork, 'desktop.txt', 'fork desktop feature\n');
  const forkSha = f.commit(f.fork, 'desktop feature');
  success(f.run());
  assert.equal(fs.readFileSync(path.join(f.fork, 'upstream.txt'), 'utf8'), 'upstream feature\n');
  assert.equal(fs.readFileSync(path.join(f.fork, 'desktop.txt'), 'utf8'), 'fork desktop feature\n');
  const sourceSha = f.git(f.fork, ['rev-parse', 'HEAD']);
  assert.deepEqual(f.git(f.fork, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' '), [sourceSha, forkSha, upstreamSha]);
  assert.deepEqual(f.outputs(), { source_sha: sourceSha, upstream_sha: upstreamSha });
  verifyHashes(f.fork);
  f.clean();
});

test('business conflicts abort with unchanged HEAD, unchanged fork files and no successful output', (t) => {
  const f = fixture(t);
  f.write(f.upstream, 'shared.txt', 'upstream business edit\n');
  f.commit(f.upstream, 'upstream conflict');
  f.write(f.fork, 'shared.txt', 'fork business edit\n');
  const before = f.commit(f.fork, 'fork conflict');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /shared\.txt/);
  assert.match(fs.readFileSync(f.env.GITHUB_STEP_SUMMARY, 'utf8'), /shared\.txt/);
  assert.equal(f.git(f.fork, ['rev-parse', 'HEAD']), before);
  assert.equal(fs.readFileSync(path.join(f.fork, 'shared.txt'), 'utf8'), 'fork business edit\n');
  assert.equal(fs.existsSync(f.env.GITHUB_OUTPUT), false);
  f.clean();
});

test('preserves the entire fork workflow tree including conflicts, deletions and upstream additions', (t) => {
  const f = fixture(t);
  f.write(f.upstream, '.github/workflows/maintained.yml', 'name: upstream conflicting workflow\n');
  f.write(f.upstream, '.github/workflows/new.yml', 'name: never import this workflow\n');
  f.write(f.upstream, '.github/workflows/nested/new.yml', 'name: never import nested workflow\n');
  fs.unlinkSync(path.join(f.upstream, '.github/workflows/keep.yml'));
  f.write(f.upstream, 'upstream.txt', 'still import business changes\n');
  f.commit(f.upstream, 'upstream workflows');
  f.write(f.fork, '.github/workflows/maintained.yml', 'name: fork authoritative workflow\n');
  f.write(f.fork, '.github/workflows/desktop.yml', 'name: desktop workflow\n');
  f.commit(f.fork, 'fork workflows');
  const beforeTree = f.git(f.fork, ['rev-parse', 'HEAD:.github/workflows']);
  success(f.run());
  assert.equal(f.git(f.fork, ['rev-parse', 'HEAD:.github/workflows']), beforeTree);
  assert.equal(fs.existsSync(path.join(f.fork, '.github/workflows/new.yml')), false);
  assert.equal(fs.existsSync(path.join(f.fork, '.github/workflows/nested/new.yml')), false);
  assert.equal(fs.readFileSync(path.join(f.fork, 'upstream.txt'), 'utf8'), 'still import business changes\n');
  f.clean();
});

test('removes upstream-added workflows when the fork has no workflow directory', (t) => {
  const f = fixture(t);
  fs.rmSync(path.join(f.fork, '.github/workflows'), { recursive: true });
  f.commit(f.fork, 'fork removes inherited workflows');
  f.write(f.upstream, '.github/workflows/new.yml', 'name: do not activate\n');
  f.commit(f.upstream, 'new upstream workflow');
  success(f.run());
  assert.equal(f.git(f.fork, ['ls-tree', '-r', '--name-only', 'HEAD', '--', '.github/workflows']), '');
  f.clean();
});

test('the real sync-version driver resolves hash-only index conflicts and final hashes match merged assets', (t) => {
  const f = fixture(t);
  // Both branches alter the same app tag's lazy hashes, but separate assets.
  f.write(f.upstream, 'js/atlas_quiz.js', '/* upstream quiz update */\n');
  f.hash(f.upstream);
  const upstreamIndex = fs.readFileSync(path.join(f.upstream, 'index.html'), 'utf8');
  f.commit(f.upstream, 'upstream lazy asset hashes');
  f.write(f.fork, 'js/atlas_narrator.js', '/* fork narrator update */\n');
  f.hash(f.fork);
  const forkIndex = fs.readFileSync(path.join(f.fork, 'index.html'), 'utf8');
  f.commit(f.fork, 'fork lazy asset hashes');
  assert.notEqual(upstreamIndex, forkIndex);
  // Ensure synchronization itself configures the existing driver.
  f.git(f.fork, ['config', '--unset', 'merge.sync-version.driver']);
  success(f.run());
  assert.equal(fs.readFileSync(path.join(f.fork, 'js/atlas_quiz.js'), 'utf8'), '/* upstream quiz update */\n');
  assert.equal(fs.readFileSync(path.join(f.fork, 'js/atlas_narrator.js'), 'utf8'), '/* fork narrator update */\n');
  verifyHashes(f.fork);
  f.clean();
});

test('no upstream changes and valid hashes produce no meaningless commit, even on repeated runs', (t) => {
  const f = fixture(t);
  const before = f.git(f.fork, ['rev-parse', 'HEAD']);
  const first = synchronize({ cwd: f.fork, env: f.env });
  assert.deepEqual(first, { source_sha: before, upstream_sha: before });
  success(f.run());
  assert.equal(f.git(f.fork, ['rev-parse', 'HEAD']), before);
  assert.equal(f.git(f.fork, ['rev-list', '--count', 'HEAD']), '1');
  f.clean();
});

test('stale hashes alone are committed once without requiring an upstream merge', (t) => {
  const f = fixture(t);
  const upstreamSha = f.git(f.upstream, ['rev-parse', 'HEAD']);
  f.write(f.fork, 'js/atlas_quiz.js', '/* deliberately stale fork asset */\n');
  const before = f.commit(f.fork, 'fork asset before hash regeneration');
  success(f.run());
  const after = f.git(f.fork, ['rev-parse', 'HEAD']);
  assert.notEqual(after, before);
  assert.deepEqual(f.git(f.fork, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' '), [after, before]);
  assert.deepEqual(f.outputs(), { source_sha: after, upstream_sha: upstreamSha });
  verifyHashes(f.fork);
  success(f.run());
  assert.equal(f.git(f.fork, ['rev-parse', 'HEAD']), after);
  f.clean();
});

test('dirty tracked and untracked work is rejected without modifying it', (t) => {
  const f = fixture(t);
  const before = f.git(f.fork, ['rev-parse', 'HEAD']);
  f.write(f.fork, 'shared.txt', 'uncommitted user work\n');
  f.write(f.fork, 'untracked.txt', 'untracked user work\n');
  const status = f.git(f.fork, ['status', '--porcelain=v1', '--untracked-files=all']);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dirty working tree/);
  assert.equal(f.git(f.fork, ['rev-parse', 'HEAD']), before);
  assert.equal(f.git(f.fork, ['status', '--porcelain=v1', '--untracked-files=all']), status);
  assert.equal(fs.readFileSync(path.join(f.fork, 'shared.txt'), 'utf8'), 'uncommitted user work\n');
  assert.equal(fs.readFileSync(path.join(f.fork, 'untracked.txt'), 'utf8'), 'untracked user work\n');
  assert.equal(fs.existsSync(f.env.GITHUB_OUTPUT), false);
});

test('hash-generation failure aborts the merge and restores the pre-merge tree', (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.upstream, 'js/atlas_quiz.js'));
  f.commit(f.upstream, 'invalid upstream missing required asset');
  f.write(f.fork, 'desktop.txt', 'fork feature\n');
  const before = f.commit(f.fork, 'fork feature');
  const beforeTree = f.git(f.fork, ['rev-parse', 'HEAD^{tree}']);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing lazy asset/);
  assert.equal(f.git(f.fork, ['rev-parse', 'HEAD']), before);
  assert.equal(f.git(f.fork, ['write-tree']), beforeTree);
  assert.equal(fs.existsSync(f.env.GITHUB_OUTPUT), false);
  f.clean();
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const hashes = require('../../scripts/sync_version.js');

const ROOT = path.resolve(__dirname, '../..');

test('Windows-style Git checkout preserves Linux asset hashes without weakening stale-content checks', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-checkout-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  const checkout = path.join(directory, 'windows');
  fs.mkdirSync(source);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(directory, 'gitconfig'),
    GIT_TERMINAL_PROMPT: '0',
  });
  fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
  function git(cwd, args) {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || String(result.error));
  }
  function write(file, content) {
    const filename = path.join(source, file);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  }
  git(source, ['init', '--initial-branch=main']);
  git(source, ['config', 'user.name', 'Checkout Test']);
  git(source, ['config', 'user.email', 'checkout@example.invalid']);
  git(source, ['config', 'core.autocrlf', 'false']);
  git(source, ['config', 'commit.gpgsign', 'false']);
  git(source, ['config', 'core.hooksPath', path.join(directory, 'no-hooks')]);
  write('.gitattributes', fs.readFileSync(path.join(ROOT, '.gitattributes')));
  const assets = new Set([...hashes.STATIC_TAG_ASSETS, ...hashes.LAZY_ATTR_ASSETS.map(asset => asset.relPath)]);
  for (const file of assets) write(file, `/* 中文 asset: ${file} */\n/* second line */\n`);
  const tags = hashes.STATIC_TAG_ASSETS.map(file => file.endsWith('.css')
    ? `<link rel="stylesheet" href="${file}?v=00000000">`
    : `<script src="${file}?v=00000000"></script>`);
  write('index.html', `<!doctype html>\n<html>\n<head>\n${tags.join('\n')}\n</head>\n<body>Atlas</body>\n</html>\n`);
  const expected = hashes.computeAssetHashes(source);
  fs.writeFileSync(path.join(source, 'index.html'), hashes.applyHashesToIndexHtml(
    fs.readFileSync(path.join(source, 'index.html'), 'utf8'), expected));
  git(source, ['add', '--all']);
  git(source, ['commit', '-m', 'Linux LF assets and version hashes']);
  git(directory, ['clone', '--quiet', '--no-checkout', source, checkout]);
  git(checkout, ['config', 'core.autocrlf', 'true']);
  git(checkout, ['config', 'core.hooksPath', path.join(directory, 'no-hooks')]);
  git(checkout, ['checkout', '--force', 'main']);

  assert.deepEqual(hashes.computeAssetHashes(checkout), expected);
  hashes.verifyIndexHtmlAssetHashes(checkout);

  // Genuine edits must still fail: do not fix this bug by normalizing away validation.
  fs.appendFileSync(path.join(checkout, 'js/app.js'), '/* changed after hashing */\n');
  assert.throws(() => hashes.verifyIndexHtmlAssetHashes(checkout), assert.AssertionError);
});

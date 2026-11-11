#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createCheckpoint, decideRelease } = require('./desktop-release.cjs');

async function publish({ env = process.env, cwd = process.cwd(), fetchImpl = globalThis.fetch,
  run = (args) => execFileSync('gh', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } = {}) {
  const upstream = env.UPSTREAM_REPOSITORY || 'DeanChensj/jiangshan-map';
  const state = createCheckpoint(env, upstream);
  const fork = env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fork || '') || fork.toLowerCase() === upstream.toLowerCase()) {
    throw new Error('GITHUB_REPOSITORY must name the destination fork, not the upstream repository.');
  }
  if (!env.GH_TOKEN) throw new Error('GH_TOKEN is required to publish the desktop release.');

  async function get(route) {
    const response = await fetchImpl(`https://api.github.com/repos/${route}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.GH_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'jiangshan-map-desktop-publish' },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`GitHub release request failed: HTTP ${response.status}.`);
    return response.json();
  }

  // Listing includes drafts even before their tag has been created.
  async function findForkRelease() {
    for (let page = 1; ; page++) {
      const releases = await get(`${fork}/releases?per_page=100&page=${page}`);
      if (!Array.isArray(releases)) throw new Error('GitHub returned an invalid release list.');
      const found = releases.find(item => item.tag_name === state.release_tag);
      if (found) return found;
      if (releases.length < 100) return null;
    }
  }

  // Fetch the selected ID, not latest: a newer release can appear during a build.
  const release = await get(`${upstream}/releases/${state.release_id}`);
  const decision = decideRelease(release, null, upstream);
  if (!decision.should_build || decision.release_id !== state.release_id || decision.release_tag !== state.release_tag) {
    throw new Error('The selected upstream Release is no longer a matching stable release.');
  }
  const directory = path.join(cwd, 'dist', 'desktop');
  const names = fs.readdirSync(directory);
  const installers = names.filter(name => /^JiangshanAtlas-.+\.exe$/.test(name));
  const archives = names.filter(name => /^JiangshanAtlas-.+\.zip$/.test(name));
  if (installers.length !== 1 || archives.length !== 1 || installers[0].slice(0, -4) !== archives[0].slice(0, -4)) {
    throw new Error('Expected one matching JiangshanAtlas EXE and ZIP pair; refusing an incomplete or ambiguous release.');
  }
  const files = [installers[0], archives[0]].map(name => ({ name, filename: path.join(directory, name),
    size: fs.statSync(path.join(directory, name)).size }));
  if (files.some(file => file.size === 0)) throw new Error('Desktop release packages must not be empty.');

  const marker = `<!-- jiangshan-desktop-release ${JSON.stringify({
    repository: upstream, release_id: state.release_id, source_sha: state.source_sha,
  })} -->`;
  const ownershipPrefix = `<!-- jiangshan-desktop-release ${JSON.stringify({
    repository: upstream, release_id: state.release_id,
  }).slice(0, -1)},`;
  const existing = await findForkRelease();
  if (existing && !existing.body?.includes(ownershipPrefix)) {
    throw new Error('A release with this tag already exists but is not owned by this desktop workflow; it was not modified.');
  }
  if (existing && !existing.draft) {
    // A checkpoint push may have failed after publication. Never replace public assets.
    if (!existing.body.includes(marker) || !files.every(file => existing.assets?.some(asset =>
      asset.name === file.name && asset.state === 'uploaded' && asset.size === file.size))) {
      throw new Error('This tag is already published with different source or assets; it was not modified.');
    }
    console.log(`Desktop release already published: ${existing.html_url}`);
    return existing.html_url;
  }

  const notes = `${release.body || ''}\n\n---\n\n## Windows 离线桌面版\n\n`
    + `上游 Release：[${state.release_tag}](${release.html_url})\n\n`
    + `实际桌面构建源码：[${state.source_sha}](https://github.com/${fork}/commit/${state.source_sha})\n\n`
    + '请在 Assets 下载 EXE 安装包，或完整解压 ZIP 后运行。无需安装 Node.js、Python 或 Docker。'
    + '适用于 Windows 10 / 11 64 位；安装包未代码签名。\n\n'
    + '本桌面版基于已同步的桌面分支；同名已有 tag 保持不变，自动生成的 Source code 不一定包含桌面改动。\n\n'
    + `${marker}\n`;
  const title = release.name || state.release_tag;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jiangshan-release-'));
  try {
    const notesFile = path.join(temporary, 'notes.md');
    fs.writeFileSync(notesFile, notes);
    if (existing) {
      run(['release', 'edit', '--repo', fork, '--title', title, '--notes-file', notesFile,
        '--target', state.source_sha, '--', state.release_tag]);
    } else {
      run(['release', 'create', '--repo', fork, '--draft', '--title', title, '--notes-file', notesFile,
        '--target', state.source_sha, '--', state.release_tag]);
    }
    // Clobber is restricted to our unpublished draft; failed uploads cannot replace a public package.
    run(['release', 'upload', '--repo', fork, '--clobber', '--', state.release_tag, ...files.map(file => file.filename)]);
    const draft = await findForkRelease();
    if (!draft?.draft || !files.every(file => draft.assets?.some(asset =>
      asset.name === file.name && asset.state === 'uploaded' && asset.size === file.size))) {
      throw new Error('Draft release does not contain both complete packages; it remains unpublished.');
    }
    run(['release', 'edit', '--repo', fork, '--draft=false', '--prerelease=false', '--latest', '--', state.release_tag]);
    const published = await get(`${fork}/releases/${draft.id}`);
    if (published.draft || published.prerelease) throw new Error('Desktop release publication was not confirmed.');
    if (env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `### Desktop release published\n\n${published.html_url}\n\nSource: \`${state.source_sha}\`\n`);
    }
    console.log(`Desktop release published: ${published.html_url}`);
    return published.html_url;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { publish };

if (require.main === module) {
  publish().catch(error => {
    console.error(`Desktop release publication failed: ${error.message}`);
    if (error.stderr) console.error(String(error.stderr));
    process.exitCode = 1;
  });
}

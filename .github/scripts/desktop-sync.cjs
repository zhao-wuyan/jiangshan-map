#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WORKFLOWS = '.github/workflows';

function synchronize({ cwd = process.cwd(), env = process.env } = {}) {
  function command(executable, args, allowed = [0]) {
    const result = spawnSync(executable, args, {
      cwd,
      env,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (!allowed.includes(result.status)) {
      throw new Error(`${executable} ${args.join(' ')} failed (${result.status}):\n${result.stderr || result.stdout}`);
    }
    return result;
  }
  const git = (args, allowed) => command('git', args, allowed);
  const hasMerge = () => fs.existsSync(path.resolve(cwd, git(['rev-parse', '--git-path', 'MERGE_HEAD']).stdout.trim()));
  const isWorkflow = (file) => file === WORKFLOWS || file.startsWith(`${WORKFLOWS}/`);

  if (git(['status', '--porcelain=v1', '--untracked-files=all']).stdout) {
    throw new Error('Refusing to synchronize a dirty working tree (including untracked files).');
  }
  if (hasMerge()) throw new Error('Refusing to synchronize while a merge is already in progress.');

  const baseSha = git(['rev-parse', 'HEAD']).stdout.trim();
  const branch = env.UPSTREAM_BRANCH || 'main';
  git(['check-ref-format', `refs/heads/${branch}`]);
  const repository = env.UPSTREAM_REPOSITORY || 'DeanChensj/jiangshan-map';
  const remote = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
    ? `https://github.com/${repository}.git`
    : repository;
  const upstreamRef = `refs/remotes/upstream/${branch}`;
  let hashStarted = false;
  let committed = false;

  try {
    git(['fetch', '--no-tags', '--', remote, `refs/heads/${branch}:${upstreamRef}`]);
    const upstreamSha = git(['rev-parse', upstreamRef]).stdout.trim();
    // Match the existing index.html attribute; do not introduce a second merger.
    git(['config', '--local', 'merge.sync-version.name', 'Jiangshan index.html asset hash auto-merge driver']);
    git(['config', '--local', 'merge.sync-version.driver', 'node scripts/sync_version.js --merge-driver %O %A %B']);
    const merge = git(['merge', '--no-ff', '--no-commit', upstreamRef], [0, 1]);
    const conflicts = git(['diff', '--name-only', '--diff-filter=U', '-z']).stdout.split('\0').filter(Boolean);
    const businessConflicts = conflicts.filter((file) => !isWorkflow(file));
    if (businessConflicts.length) {
      const message = `Upstream synchronization stopped: unresolved business-file conflicts:\n${businessConflicts.map((file) => `- ${JSON.stringify(file)}`).join('\n')}`;
      if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `## Upstream merge conflicts\n\n${businessConflicts.map((file) => `- \`${JSON.stringify(file)}\``).join('\n')}\n`);
      throw new Error(message);
    }
    if (merge.status !== 0 && conflicts.length === 0) {
      throw new Error(`Git merge failed without resolvable workflow conflicts:\n${merge.stderr || merge.stdout}`);
    }

    // Restoring the whole tree removes upstream-added workflows as well as
    // resolving workflow conflicts. The fork's pre-merge tree is authoritative.
    const baseWorkflows = git(['ls-tree', '-r', '--name-only', '-z', baseSha, '--', WORKFLOWS]).stdout;
    const indexedWorkflows = git(['ls-files', '-z', '--', WORKFLOWS]).stdout;
    if (baseWorkflows || indexedWorkflows) {
      git(['restore', `--source=${baseSha}`, '--staged', '--worktree', '--', WORKFLOWS]);
    }
    hashStarted = true;
    command(process.execPath, ['scripts/sync_version.js']);
    git(['add', '--', 'index.html']);
    const changed = git(['diff', '--cached', '--quiet', '--exit-code'], [0, 1]).status === 1;
    if (hasMerge() || changed) {
      git(['commit', '-m', `chore: sync upstream ${branch} (${upstreamSha.slice(0, 12)})`]);
      committed = true;
    }
    const sourceSha = git(['rev-parse', 'HEAD']).stdout.trim();
    const outputs = { source_sha: sourceSha, upstream_sha: upstreamSha };
    if (env.GITHUB_OUTPUT) {
      fs.appendFileSync(env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
    }
    return outputs;
  } catch (error) {
    if (!committed) {
      try {
        // Discard only the hash generator's unstaged index.html write, so abort
        // can restore the merge. Startup cleanliness guarantees it is ours.
        if (hashStarted) git(['restore', '--worktree', '--', 'index.html']);
        if (hasMerge()) {
          git(['merge', '--abort']);
        } else if (hashStarted) {
          git(['restore', `--source=${baseSha}`, '--staged', '--worktree', '--', 'index.html']);
        }
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `${error.message}\nRollback failed: ${rollbackError.message}`);
      }
    }
    throw error;
  }
}

if (require.main === module) {
  try {
    const outputs = synchronize();
    console.log(`Synchronized ${outputs.upstream_sha}; source ${outputs.source_sha}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { synchronize };

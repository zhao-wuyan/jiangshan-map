'use strict';

function readBuildVersion(env = process.env) {
  const tag = env.UPSTREAM_RELEASE_TAG;
  const match = typeof tag === 'string' && /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  if (!match || match[0] !== tag) {
    throw new Error('UPSTREAM_RELEASE_TAG must be a stable X.Y.Z or vX.Y.Z version.');
  }
  const run = env.GITHUB_RUN_NUMBER;
  if (typeof run !== 'string' || !/^[1-9]\d*$/.test(run) || String(Number(run)) !== run) {
    throw new Error('GITHUB_RUN_NUMBER must be a positive decimal integer.');
  }
  // Windows FileVersion consists of four unsigned 16-bit fields. Never truncate or wrap.
  if ([...match.slice(1), run].some(value => Number(value) > 65535)) {
    throw new Error('Windows version components and GITHUB_RUN_NUMBER must not exceed 65535.');
  }
  const version = match.slice(1).join('.');
  return {
    version,
    buildNumber: run,
    buildVersion: `${version}.${run}`,
    artifactBase: `JiangshanAtlas-${version}-desktop.${run}`,
  };
}

module.exports = { readBuildVersion };

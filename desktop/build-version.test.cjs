'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readBuildVersion } = require('./build-version.cjs');

test('release normalization and Windows numeric boundaries produce valid four-part versions', () => {
  assert.equal(readBuildVersion({ UPSTREAM_RELEASE_TAG: 'v0.0.0', GITHUB_RUN_NUMBER: '1' }).buildVersion, '0.0.0.1');
  assert.equal(readBuildVersion({ UPSTREAM_RELEASE_TAG: '65535.65535.65535', GITHUB_RUN_NUMBER: '65535' }).buildVersion,
    '65535.65535.65535.65535');
});

test('a retry of the same workflow run does not change software, file or artifact versions', () => {
  const env = { UPSTREAM_RELEASE_TAG: 'v1.2.0', GITHUB_RUN_NUMBER: '42' };
  assert.deepEqual(readBuildVersion({ ...env, GITHUB_RUN_ATTEMPT: '1' }),
    readBuildVersion({ ...env, GITHUB_RUN_ATTEMPT: '2' }));
});

test('missing, nonstable, ambiguous or overflowing version inputs cannot fall back to development packages', () => {
  const valid = { UPSTREAM_RELEASE_TAG: 'v1.2.0', GITHUB_RUN_NUMBER: '42' };
  const invalid = [
    {},
    { ...valid, UPSTREAM_RELEASE_TAG: undefined },
    { ...valid, GITHUB_RUN_NUMBER: undefined },
    ...['v1.2', 'v01.2.0', 'v1.2.0-beta.1', 'v1.2.0+metadata', 'v1.2.0\n', 'release-1.2.0', 'v65536.0.0', 'v1.65536.0', 'v1.2.65536']
      .map(UPSTREAM_RELEASE_TAG => ({ ...valid, UPSTREAM_RELEASE_TAG })),
    ...['0', '-1', '01', '1.5', '1e2', '42\n', '65536', '9007199254740993']
      .map(GITHUB_RUN_NUMBER => ({ ...valid, GITHUB_RUN_NUMBER })),
  ];
  for (const env of invalid) assert.throws(() => readBuildVersion(env));
});

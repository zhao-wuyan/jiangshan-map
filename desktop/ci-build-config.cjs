'use strict';

const { build } = require('./package.json');
const { readBuildVersion } = require('./build-version.cjs');

// Only release builds load this configuration; source package metadata stays unchanged.
module.exports = () => {
  const version = readBuildVersion();
  return {
    ...build,
    extraMetadata: { version: version.version },
    buildVersion: version.buildVersion,
    buildNumber: version.buildNumber,
    win: {
      ...build.win,
      artifactName: `${version.artifactBase}-\${arch}.\${ext}`,
      signAndEditExecutable: true,
      signExecutable: false,
    },
  };
};

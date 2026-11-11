#!/usr/bin/env node
'use strict';

// Download the website's original typefaces for offline bundling.
// Hashes are the upstream git blob SHA-1s from google/fonts, verified on write.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = 'https://raw.githubusercontent.com/google/fonts/main/ofl';
const FONT_FILES = [
  {
    name: 'NotoSerifSC.ttf',
    url: `${ROOT}/notoserifsc/NotoSerifSC%5Bwght%5D.ttf`,
    sha: 'eab063faf229160a52d3760f5555150e4eb9e5bf',
  },
  {
    name: 'NotoSansSC.ttf',
    url: `${ROOT}/notosanssc/NotoSansSC%5Bwght%5D.ttf`,
    sha: 'fb0637bafbcd804fe32152370a1225990745b4bc',
  },
  {
    name: 'MaShanZheng-Regular.ttf',
    url: `${ROOT}/mashanzheng/MaShanZheng-Regular.ttf`,
    sha: '11bbfb9867d70612158229d037e7a5f622bd0e38',
  },
  {
    name: 'NotoSerifSC-OFL.txt',
    url: `${ROOT}/notoserifsc/OFL.txt`,
    sha: '94d1bf7b52481343e2983fb7751e8b7abe1ea07b',
  },
  {
    name: 'NotoSansSC-OFL.txt',
    url: `${ROOT}/notosanssc/OFL.txt`,
    sha: '1c9f43281b8f216c5461fe9ac729afbade7724e4',
  },
  {
    name: 'MaShanZheng-OFL.txt',
    url: `${ROOT}/mashanzheng/OFL.txt`,
    sha: '9e252e1997092670936a7f1d38560973d919f6b0',
  },
];

const destination = path.join(__dirname, 'fonts');
fs.mkdirSync(destination, { recursive: true });

function blobSha(buffer) {
  return crypto.createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');
}

for (const asset of FONT_FILES) {
  const target = path.join(destination, asset.name);
  if (fs.existsSync(target)) {
    if (blobSha(fs.readFileSync(target)) === asset.sha) continue;
    throw new Error(`${asset.name} exists with an unexpected hash; remove it and retry.`);
  }
  execFileSync(
    process.execPath,
    ['-e', `
      const fs = require('node:fs');
      fetch(process.argv[1])
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
        .then((b) => fs.writeFileSync(process.argv[2], Buffer.from(b)))
        .catch((e) => { console.error(e); process.exit(1); });
    `, asset.url, target],
    { stdio: 'inherit' }
  );
  const sha = blobSha(fs.readFileSync(target));
  if (sha !== asset.sha) {
    fs.rmSync(target);
    throw new Error(`${asset.name}: hash mismatch after download (${sha}), expected ${asset.sha}.`);
  }
  console.log(`Verified ${asset.name} (${sha.slice(0, 8)}).`);
}
console.log('Offline fonts ready.');

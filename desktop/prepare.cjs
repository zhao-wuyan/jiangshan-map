#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { verifyIndexHtmlAssetHashes } = require('../scripts/sync_version.js');

const root = path.resolve(__dirname, '..');
const destination = path.join(__dirname, 'web');
const entries = [
  'index.html', 'css', 'js', 'assets', 'topics', 'manifest.webmanifest',
  'LICENSE', 'README_ZH.md',
];

// Keep the website's content hashes authoritative; never silently package stale assets.
verifyIndexHtmlAssetHashes(root);
for (const entry of entries) fs.accessSync(path.join(root, entry), fs.constants.R_OK);
for (const file of ['renderer.js', 'desktop.css']) {
  fs.accessSync(path.join(__dirname, file), fs.constants.R_OK);
}
for (const file of [
  'NotoSerifSC.ttf', 'NotoSansSC.ttf', 'MaShanZheng-Regular.ttf',
  'NotoSerifSC-OFL.txt', 'NotoSansSC-OFL.txt', 'MaShanZheng-OFL.txt',
]) {
  fs.accessSync(path.join(__dirname, 'fonts', file), fs.constants.R_OK);
}

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
for (const entry of entries) {
  fs.cpSync(path.join(root, entry), path.join(destination, entry), { recursive: true });
}
fs.mkdirSync(path.join(destination, 'desktop'));
for (const file of ['renderer.js', 'desktop.css']) {
  fs.copyFileSync(path.join(__dirname, file), path.join(destination, 'desktop', file));
}
fs.cpSync(path.join(__dirname, 'fonts'), path.join(destination, 'desktop', 'fonts'), { recursive: true });

function offlineHtml(html, isAtlas) {
  // Strip network-loaded fonts/analytics from the staged copy, not the public website.
  const offline = html
    .replace(/<link\b[^>]*>/gi, (tag) => /\bhref\s*=\s*["'](?:https?:)?\/\//i.test(tag) ? '' : tag)
    .replace(/<script\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\/[^>]*>\s*<\/script\s*>/gi, '')
    .replaceAll('https://deanchen.me/jiangshan-map/', 'atlas://app/');
  if (!isAtlas) return offline;
  if (!offline.includes('</head>')) throw new Error('Missing atlas document head');
  return offline.replace('</head>',
    '  <link rel="stylesheet" href="desktop/desktop.css" />\n' +
    '  <script src="desktop/renderer.js"></script>\n</head>');
}

for (const file of ['index.html', ...fs.readdirSync(path.join(destination, 'topics'))
  .filter((name) => name.endsWith('.html')).map((name) => `topics/${name}`)]) {
  const target = path.join(destination, file);
  fs.writeFileSync(target, offlineHtml(fs.readFileSync(target, 'utf8'), file === 'index.html'));
}

// These local recordings must accompany the app; never rely on Wikimedia fallback URLs.
for (const name of ['liu_shui', 'pingsha_luoyan', 'yangguan_sandie', 'zuiyu_changwan', 'jiu_kuang']) {
  fs.accessSync(path.join(destination, 'assets', 'audio', `${name}.mp3`), fs.constants.R_OK);
}
const terrain = JSON.parse(fs.readFileSync(path.join(destination, 'assets', 'terrain', 'index.json'), 'utf8'));
for (const [level, tiles] of Object.entries(terrain.levels)) {
  for (const tile of tiles) {
    const [x, y] = tile.split('_');
    fs.accessSync(path.join(destination, 'assets', 'terrain', level, x, `${y}.webp`), fs.constants.R_OK);
  }
}

console.log(`Prepared offline website: ${destination}`);

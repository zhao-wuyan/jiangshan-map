#!/usr/bin/env node
'use strict';

// Exercise the actual Electron window and production IPC: no mocked fullscreen events.
const assert = require('node:assert/strict');

if (!process.versions.electron) {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test } = require('node:test');

  test('native fullscreen can repeatedly enter and exit through the desktop bridge', () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jiangshan-fullscreen-'));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    try {
      const result = spawnSync(require('electron'), [__filename, `--user-data-dir=${profile}`], {
        env, encoding: 'utf8', timeout: 60000, windowsHide: false,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    } finally {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
} else {
  const { app } = require('electron');
  app.once('browser-window-created', (_event, window) => {
    window.webContents.once('did-finish-load', async () => {
      try {
        for (let cycle = 0; cycle < 3; cycle++) {
          for (const expected of [true, false]) {
            const state = await window.webContents.executeJavaScript('window.atlasDesktop.toggleFullscreen()');
            assert.equal(state.fullscreen, expected, `cycle ${cycle}: reported fullscreen state`);
            assert.equal(window.isFullScreen(), expected, `cycle ${cycle}: actual native window state`);
          }
        }
        console.log('Three native fullscreen enter/exit cycles passed.');
        app.quit();
      } catch (error) {
        console.error(error);
        app.exit(1);
      }
    });
  });
  require('./main.cjs');
}

#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows');

// Compile and execute the production NSIS path function. No installation, disk-root
// writes or registry changes: only the returned path strings are recorded in TEMP.
const cases = [
  ['D:\\', 'D:\\JiangshanAtlas'],
  ['D:\\My Program\\', 'D:\\My Program\\JiangshanAtlas'],
  ['D:\\My Program', 'D:\\My Program\\JiangshanAtlas'],
  ['D:\\JiangshanAtlas', 'D:\\JiangshanAtlas'],
  ['D:\\JiangshanAtlas\\', 'D:\\JiangshanAtlas'],
  ['D:\\My Program\\JiangshanAtlas', 'D:\\My Program\\JiangshanAtlas'],
  ['D:\\jIaNgShAnAtLaS\\', 'D:\\jIaNgShAnAtLaS'],
  ['D:\\JiangshanAtlas Backup', 'D:\\JiangshanAtlas Backup\\JiangshanAtlas'],
  ['D:\\JiangshanAtlas\\Lessons', 'D:\\JiangshanAtlas\\Lessons\\JiangshanAtlas'],
  ['D:\\My Program\\\\', 'D:\\My Program\\JiangshanAtlas'],
  ['D:\\教学软件\\', 'D:\\教学软件\\JiangshanAtlas'],
  ['D:\\$Class Work', 'D:\\$Class Work\\JiangshanAtlas'],
  ['\\\\server\\share\\', '\\\\server\\share\\JiangshanAtlas'],
];

function nsisString(value) {
  return value.replaceAll('$', () => '$$').replaceAll('"', () => '$\\"');
}

function run(file, args, env) {
  const result = spawnSync(file, args, { env, encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

test('installer appends only a missing JiangshanAtlas leaf, idempotently', {
  skip: process.platform !== 'win32' && 'Requires the Windows NSIS runtime',
}, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jiangshan-installer-path-'));
  try {
    const executable = path.join(directory, 'path-check.exe');
    const output = path.join(directory, 'paths.txt');
    const script = path.join(directory, 'path-check.nsi');
    const checks = cases.map(([input]) => [
      `  StrCpy $INSTDIR "${nsisString(input)}"`,
      '  !insertmacro customInit',
      '  FileWriteUTF16LE $0 "$INSTDIR$\\r$\\n"',
      '  Call AtlasNormalizeInstallDirectory',
      '  FileWriteUTF16LE $0 "$INSTDIR$\\r$\\n"',
    ].join('\n')).join('\n');
    fs.writeFileSync(script, [
      'Unicode true',
      'Name "Jiangshan installer path regression"',
      `OutFile "${nsisString(executable)}"`,
      'RequestExecutionLevel user',
      'SilentInstall silent',
      '!define APP_FILENAME "previous-name"',
      `!include "${nsisString(path.join(__dirname, 'installer.nsh'))}"`,
      'Section',
      `  FileOpen $0 "${nsisString(output)}" w`,
      checks,
      '  FileClose $0',
      'SectionEnd',
      '',
    ].join('\n'));
    const compiler = await getMakeNsisPath();
    run(compiler.path, ['-WX', '-INPUTCHARSET', 'UTF8', script], { ...process.env, ...compiler.env });
    run(executable, ['/S'], process.env);
    const actual = fs.readFileSync(output, 'utf16le').trimEnd().split(/\r?\n/);
    assert.deepEqual(actual, cases.flatMap(([, expected]) => [expected, expected]));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

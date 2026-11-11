'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const ORIGIN = 'atlas://app';
const WEB_ROOT = path.join(__dirname, 'web');
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "worker-src 'none'",
].join('; ');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

let mainWindow = null;
let preferences = { lowPower: false, compatible: false };
let settingsFile;
let realWebRoot;
let fullscreenChange = null;
let externalPromptOpen = false;

protocol.registerSchemesAsPrivileged([{
  scheme: 'atlas',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);
app.enableSandbox();

function showError(context, error) {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`${context}\n${detail}`);
  dialog.showErrorBox(`江山时序：${context}`, detail);
}

function fatal(error) {
  showError('无法继续运行', error);
  app.exit(1);
}

process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

// Custom-scheme origins may serialize as the string 'null' (opaque), so never
// compare an origin to 'atlas://app' directly: parse it and compare parts.
function isAtlasOrigin(value) {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'string' || value === 'null' || value === '') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'atlas:' && url.hostname === 'app' && url.port === '' &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

function isLocalURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'atlas:' && url.hostname === 'app' && url.port === '' &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function getState() {
  return { ...preferences, fullscreen: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()) };
}

function publishState() {
  const state = getState();
  const menu = Menu.getApplicationMenu();
  if (menu) {
    menu.getMenuItemById('low-power').checked = state.lowPower;
    menu.getMenuItemById('compatible').checked = state.compatible;
    menu.getMenuItemById('fullscreen').checked = state.fullscreen;
  }
  if (mainWindow && !mainWindow.isDestroyed() && isLocalURL(mainWindow.webContents.getURL())) {
    mainWindow.webContents.send('atlas:state', state);
  }
  return state;
}

function savePreferences(next) {
  const temporary = `${settingsFile}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, settingsFile);
  preferences = next;
}

function setLowPower(value) {
  if (typeof value !== 'boolean') throw new TypeError('流畅模式必须是布尔值。');
  if (preferences.lowPower !== value) savePreferences({ ...preferences, lowPower: value });
  return publishState();
}

function setCompatible(value) {
  if (typeof value !== 'boolean') throw new TypeError('显卡兼容模式必须是布尔值。');
  if (preferences.compatible === value) return getState();
  const answer = dialog.showMessageBoxSync(mainWindow, {
    type: 'question', title: '重启并更改显卡兼容模式',
    message: value ? '启用显卡兼容模式并立即重启？' : '关闭显卡兼容模式并立即重启？',
    detail: '启用后将禁用硬件加速，可解决部分希沃设备的黑屏或显卡异常。当前地图状态不会保存；流畅模式偏好会保留。',
    buttons: ['重启并应用', '取消'], defaultId: 1, cancelId: 1, noLink: true,
  });
  if (answer !== 0) return publishState();
  savePreferences({ ...preferences, compatible: value });
  const state = publishState();
  app.relaunch();
  app.quit();
  return state;
}

function toggleFullscreen() {
  if (fullscreenChange) return fullscreenChange;
  const window = mainWindow;
  if (!window || window.isDestroyed()) throw new Error('主窗口尚未就绪。');
  const target = !window.isFullScreen();
  const eventName = target ? 'enter-full-screen' : 'leave-full-screen';
  const transition = new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      window.removeListener(eventName, changed);
      window.removeListener('closed', closed);
    };
    const changed = () => { cleanup(); resolve(getState()); };
    const closed = () => { cleanup(); reject(new Error('切换全屏时窗口已关闭。')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('系统未完成全屏切换，请重试。')); }, 5000);
    window.once(eventName, changed);
    window.once('closed', closed);
    try { window.setFullScreen(target); } catch (error) { cleanup(); reject(error); }
  });
  // Windows can emit the native fullscreen event synchronously in setFullScreen.
  // Clear the guard in a microtask, after it has actually been assigned.
  fullscreenChange = transition.finally(() => { fullscreenChange = null; });
  return fullscreenChange;
}

function assertTrustedSender(event) {
  const frame = event.senderFrame;
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents ||
      !frame || frame !== event.sender.mainFrame || !isAtlasOrigin(frame.origin) ||
      !isLocalURL(frame.url)) {
    throw new Error('已拒绝来自非主窗口、子框架或非本地来源的桌面请求。');
  }
}

function handleIPC(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      assertTrustedSender(event);
      return await handler(...args);
    } catch (error) {
      showError('桌面操作失败', error);
      throw error;
    }
  });
}

async function openExternal(value) {
  if (typeof value !== 'string' || value.length > 8192) throw new TypeError('无效的外部链接。');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('仅允许在确认后打开不含登录凭据的 HTTP/HTTPS 外链。');
  }
  if (externalPromptOpen) return;
  externalPromptOpen = true;
  try {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question', title: '在系统浏览器打开外链？',
      message: '此链接将离开离线桌面版，并可能连接互联网。', detail: url.href,
      buttons: ['打开系统浏览器', '取消'], defaultId: 1, cancelId: 1, noLink: true,
    });
    if (response === 0) await shell.openExternal(url.href);
  } finally {
    externalPromptOpen = false;
  }
}

function installIPC() {
  ipcMain.on('atlas:initial-state', (event) => {
    try {
      assertTrustedSender(event);
      event.returnValue = { state: getState() };
    } catch (error) {
      event.returnValue = { error: error.message };
      showError('初始化桌面桥失败', error);
    }
  });
  handleIPC('atlas:get-state', getState);
  handleIPC('atlas:set-low-power', setLowPower);
  handleIPC('atlas:set-compatible', setCompatible);
  handleIPC('atlas:toggle-fullscreen', toggleFullscreen);
  // Only the isolated preload's trusted anchor-click listener can call this channel.
  handleIPC('atlas:open-external', openExternal);
  ipcMain.on('atlas:quit', (event) => {
    try { assertTrustedSender(event); app.quit(); } catch (error) { showError('退出请求失败', error); }
  });
}

function runMenuAction(action) {
  Promise.resolve().then(action).catch((error) => { showError('菜单操作失败', error); publishState(); });
}

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '桌面', submenu: [
      { id: 'low-power', label: '流畅模式（减少动画与绘制）', type: 'checkbox', checked: preferences.lowPower,
        click: (item) => runMenuAction(() => setLowPower(item.checked)) },
      { id: 'compatible', label: '显卡兼容模式（更改需重启）', type: 'checkbox', checked: preferences.compatible,
        click: (item) => runMenuAction(() => setCompatible(item.checked)) },
      { type: 'separator' },
      { id: 'fullscreen', label: '全屏 / 退出全屏', type: 'checkbox', accelerator: 'F11',
        click: () => runMenuAction(toggleFullscreen) },
      { label: '返回地图首页', click: () => runMenuAction(() => mainWindow.loadURL(`${ORIGIN}/`)) },
      { type: 'separator' },
      { label: '退出', accelerator: 'Alt+F4', click: () => app.quit() },
    ] },
    { label: '帮助', submenu: [
      { label: '关于江山时序', click: () => runMenuAction(() => dialog.showMessageBox(mainWindow, {
        type: 'info', title: '江山时序 · 离线桌面版', message: `江山时序 ${app.getVersion()}`,
        detail: `离线历史地图与时间轴。\nElectron ${process.versions.electron}`,
        buttons: ['知道了'],
      })) },
    ] },
  ]));
}

function responseError(status, message, extraHeaders = {}) {
  return new Response(message, {
    status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff', ...extraHeaders },
  });
}

async function serveLocal(request) {
  try {
    if (!isLocalURL(request.url)) return responseError(403, 'Only atlas://app is allowed.');
    if (!isAtlasOrigin(request.initiatorOrigin) || !isAtlasOrigin(request.headers.get('origin'))) {
      return responseError(403, 'Cross-origin requests are not allowed.');
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return responseError(405, 'Only GET and HEAD are allowed.', { Allow: 'GET, HEAD' });
    }
    const url = new URL(request.url);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return responseError(400, 'Invalid URL encoding.'); }
    // Reject Windows alternate streams, drive paths and both kinds of traversal separators.
    if (/[\x00-\x1f\x7f\\:]/.test(pathname) || pathname.split('/').some((part) => part === '..' || part === '.')) {
      return responseError(403, 'Invalid resource path.');
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const candidate = path.resolve(realWebRoot, `.${pathname}`);
    if (!isInside(realWebRoot, candidate)) return responseError(403, 'Resource is outside the website.');
    const filename = await fs.promises.realpath(candidate);
    if (!isInside(realWebRoot, filename)) return responseError(403, 'Linked resource is outside the website.');
    const info = await fs.promises.stat(filename);
    if (!info.isFile()) return responseError(404, 'Resource is not a file.');
    const headers = {
      'Content-Type': MIME[path.extname(filename).toLowerCase()] || 'application/octet-stream',
      'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin', 'Referrer-Policy': 'no-referrer',
      'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache',
    };
    let start = 0;
    let end = info.size - 1;
    let status = 200;
    const range = request.method === 'GET' ? request.headers.get('range') : null;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const invalid = () => responseError(416, 'Unsatisfiable byte range.', { 'Content-Range': `bytes */${info.size}` });
      if (!match || (!match[1] && !match[2]) || info.size === 0) return invalid();
      if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) return invalid();
        start = Math.max(0, info.size - suffix);
      } else {
        start = Number(match[1]);
        const requestedEnd = match[2] ? Number(match[2]) : end;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= info.size || requestedEnd < start) return invalid();
        end = Math.min(requestedEnd, end);
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    }
    headers['Content-Length'] = String(Math.max(0, end - start + 1));
    if (request.method === 'HEAD' || info.size === 0) return new Response(null, { status, headers });
    const stream = fs.createReadStream(filename, { start, end, signal: request.signal });
    stream.on('error', (error) => {
      // Seeks and window closes abort range reads; only real read failures deserve a dialog.
      const quiet = error.name === 'AbortError' || error.code === 'ERR_STREAM_PREMATURE_CLOSE' ||
        error.code === 'ECANCELED';
      if (!quiet) showError(`读取本地资源失败：${url.pathname}`, error);
    });
    return new Response(Readable.toWeb(stream), { status, headers });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      console.error(`Missing offline resource: ${request.url}`);
      return responseError(404, 'Offline resource not found. Re-run npm run prepare:web.');
    }
    showError('本地资源服务失败', error);
    return responseError(500, 'Local resource could not be read.');
  }
}

function secureSession() {
  const localSession = session.defaultSession;
  localSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => callback({ cancel: true }));
  localSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  localSession.setPermissionCheckHandler(() => false);
  localSession.setDevicePermissionHandler(() => false);
  localSession.on('will-download', (event) => event.preventDefault());
  protocol.handle('atlas', serveLocal);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: '江山时序 · 离线桌面版', width: 1280, height: 800, minWidth: 800, minHeight: 600,
    backgroundColor: '#f3eee4', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      webviewTag: false, webSecurity: true, allowRunningInsecureContent: false,
      navigateOnDragDrop: false, spellcheck: false,
    },
  });
  const window = mainWindow;
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame || !isLocalURL(event.url)) event.preventDefault();
  });
  contents.on('will-navigate', (event) => { if (!isLocalURL(event.url)) event.preventDefault(); });
  contents.on('will-redirect', (event) => { if (!event.isMainFrame || !isLocalURL(event.url)) event.preventDefault(); });
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      event.preventDefault();
      if (!input.isAutoRepeat) runMenuAction(toggleFullscreen);
    } else if (input.key === 'Escape' && window.isFullScreen()) {
      event.preventDefault();
      if (!fullscreenChange) runMenuAction(toggleFullscreen);
    }
  });
  contents.on('preload-error', (_event, _filename, error) => showError('预加载脚本失败', error));
  contents.on('render-process-gone', (_event, details) => showError('地图渲染进程已退出', `${details.reason} (${details.exitCode})\n请重新启动程序，必要时从菜单启用显卡兼容模式。`));
  contents.on('unresponsive', () => showError('地图暂时无响应', '请等待地图恢复；若持续无响应，请重启程序并启用流畅模式或显卡兼容模式。'));
  window.on('enter-full-screen', publishState);
  window.on('leave-full-screen', publishState);
  contents.on('did-finish-load', publishState);
  window.on('closed', () => { mainWindow = null; });
  window.maximize();
  window.show();
  await window.loadURL(`${ORIGIN}/`);
}

function initialize() {
  // Chromium's standard switch must isolate both application preferences and browser storage.
  const userData = app.commandLine.getSwitchValue('user-data-dir');
  if (userData) {
    const directory = path.resolve(userData);
    fs.mkdirSync(directory, { recursive: true });
    app.setPath('userData', directory);
  }
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  settingsFile = path.join(app.getPath('userData'), 'atlas-preferences.json');
  try {
    const stored = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    if (!stored || typeof stored.lowPower !== 'boolean' || typeof stored.compatible !== 'boolean') {
      throw new Error('偏好设置格式无效（需要 lowPower 与 compatible 布尔值）。');
    }
    preferences = { lowPower: stored.lowPower, compatible: stored.compatible };
  } catch (error) {
    if (error.code === 'ENOENT') {
      // First run: keep defaults and let the first save create the file.
    } else if (error instanceof SyntaxError) {
      throw new Error(`偏好设置文件损坏，请修复或移走：${settingsFile}\n${error.message}`);
    } else {
      throw error;
    }
  }
  if (preferences.compatible) app.disableHardwareAcceleration();
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
    try {
      realWebRoot = await fs.promises.realpath(WEB_ROOT);
      await fs.promises.access(path.join(realWebRoot, 'index.html'), fs.constants.R_OK);
    } catch (error) {
      throw new Error(`未找到离线网页目录 ${WEB_ROOT}。\n请先在 desktop 目录运行 npm run prepare:web（或 mise run desktop:prepare）后再启动。\n${error.message}`);
    }
    installIPC();
    secureSession();
    installMenu();
    await createWindow();
  }).catch(fatal);
}

try { initialize(); } catch (error) { fatal(error); }

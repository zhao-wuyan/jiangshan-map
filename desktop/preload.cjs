'use strict';

// Sandboxed preload: no filesystem, Node built-ins, or renderer-visible IPC objects.
const { contextBridge, ipcRenderer } = require('electron');

// The sandboxed preload's reduced `process` object has no isMainFrame flag; with
// nodeIntegrationInSubFrames disabled the preload only ever runs in the main frame.
if (location.protocol === 'atlas:' && location.hostname === 'app') {
  function stateFrom(value) {
    if (!value || typeof value.lowPower !== 'boolean' || typeof value.compatible !== 'boolean' ||
        typeof value.fullscreen !== 'boolean') {
      throw new TypeError('桌面主进程返回了无效状态。');
    }
    return { lowPower: value.lowPower, compatible: value.compatible, fullscreen: value.fullscreen };
  }

  const initial = ipcRenderer.sendSync('atlas:initial-state');
  if (!initial || initial.error) throw new Error(initial && initial.error || '无法读取桌面初始状态。');

  async function invokeState(channel, ...args) {
    return stateFrom(await ipcRenderer.invoke(channel, ...args));
  }

  contextBridge.exposeInMainWorld('atlasDesktop', {
    initialState: stateFrom(initial.state),
    getState: () => invokeState('atlas:get-state'),
    setLowPower: (value) => {
      if (typeof value !== 'boolean') return Promise.reject(new TypeError('流畅模式必须是布尔值。'));
      return invokeState('atlas:set-low-power', value);
    },
    setCompatible: (value) => {
      if (typeof value !== 'boolean') return Promise.reject(new TypeError('显卡兼容模式必须是布尔值。'));
      return invokeState('atlas:set-compatible', value);
    },
    toggleFullscreen: () => invokeState('atlas:toggle-fullscreen'),
    quit: () => { ipcRenderer.send('atlas:quit'); },
    onState: (callback) => {
      if (typeof callback !== 'function') throw new TypeError('状态订阅必须提供回调函数。');
      const listener = (_event, value) => callback(stateFrom(value));
      ipcRenderer.on('atlas:state', listener);
      return () => { ipcRenderer.removeListener('atlas:state', listener); };
    },
  });

  function handleLinkClick(event) {
    // Synthetic clicks and window.open() must never authorize launching other apps.
    if (!event.isTrusted || event.defaultPrevented || (event.button !== 0 && event.button !== 1)) return;
    const anchor = event.composedPath().find((node) =>
      node && node.nodeType === 1 && node.localName === 'a' && node.hasAttribute('href'));
    if (!anchor) return;
    let target;
    try { target = new URL(anchor.href, location.href); } catch { return; }
    if (target.protocol === 'http:' || target.protocol === 'https:') {
      event.preventDefault();
      event.stopImmediatePropagation();
      ipcRenderer.invoke('atlas:open-external', target.href).catch((error) => {
        // The main process also displays the actionable native error dialog.
        console.error('无法打开外部链接：', error);
      });
    } else if (target.protocol === 'atlas:' && target.hostname === 'app' && target.port === '' &&
        ((anchor.target && anchor.target !== '_self') || event.button === 1 ||
          event.ctrlKey || event.metaKey || event.shiftKey)) {
      // Keep explicitly clicked local topic pages in this window, never a new one.
      event.preventDefault();
      event.stopImmediatePropagation();
      location.assign(target.href);
    }
  }

  window.addEventListener('click', handleLinkClick, true);
  window.addEventListener('auxclick', handleLinkClick, true);
}

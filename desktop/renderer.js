(function () {
  'use strict';

  const desktop = window.atlasDesktop;
  if (!desktop) return;

  const root = document.documentElement;
  root.classList.add('is-desktop');
  let state = desktop.initialState;
  let controls = null;
  let returnFocus = null;

  function applyState(next) {
    state = next;
    root.classList.toggle('is-low-power', state.lowPower);
    if (window.atlasApp) window.atlasApp.setLowPowerMode(state.lowPower);
    if (!controls) return;
    controls.lowPower.checked = state.lowPower;
    controls.compatible.checked = state.compatible;
    controls.fullscreen.textContent = state.fullscreen ? '退出全屏' : '进入全屏';
    controls.fullscreen.setAttribute('aria-pressed', String(state.fullscreen));
    const version = typeof state.version === 'string' ? state.version : desktop.version;
    controls.version.hidden = typeof version !== 'string' || !version.trim();
    controls.version.textContent = controls.version.hidden ? '' : `版本 ${version}`;
  }

  applyState(state);
  const unsubscribe = desktop.onState(applyState);
  window.addEventListener('pagehide', () => unsubscribe(), { once: true });

  function mount() {
    const strip = document.querySelector('.control-strip');
    if (!strip) return;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = 'act-desktop-settings';
    trigger.className = 'action-btn subtle desktop-settings-trigger';
    trigger.textContent = '桌面设置';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', 'desktop-settings');
    trigger.setAttribute('aria-expanded', 'false');
    strip.appendChild(trigger);

    const dialog = document.createElement('dialog');
    dialog.id = 'desktop-settings';
    dialog.className = 'desktop-settings';
    dialog.setAttribute('aria-labelledby', 'desktop-settings-title');
    dialog.setAttribute('aria-describedby', 'desktop-offline-status');
    dialog.innerHTML = `
      <header class="desktop-settings-header">
        <h2 id="desktop-settings-title">桌面设置</h2>
        <button type="button" class="action-btn subtle" id="desktop-settings-close" autofocus>关闭</button>
      </header>
      <p id="desktop-offline-status" class="desktop-offline-status">离线运行 · 地图数据来自本机</p>
      <p id="desktop-version" class="desktop-version" hidden></p>
      <label class="desktop-setting-row" for="desktop-low-power">
        <span>
          <strong>流畅模式</strong>
          <span class="desktop-setting-description" id="desktop-low-power-description">保留全部地图内容、底图与水系；减少运动时的文字重排，暂不加载高精地形。停止拖动或缩放后恢复清晰文字。</span>
        </span>
        <input type="checkbox" id="desktop-low-power" aria-describedby="desktop-low-power-description">
      </label>
      <label class="desktop-setting-row" for="desktop-compatible">
        <span>
          <strong>显卡兼容模式</strong>
          <span class="desktop-setting-description" id="desktop-compatible-description">遇到黑屏或显示异常时可尝试。更改前将确认重启；取消不会改变当前设置。</span>
        </span>
        <input type="checkbox" id="desktop-compatible" aria-describedby="desktop-compatible-description">
      </label>
      <p class="desktop-setting-description desktop-speech-note">语音讲解仅使用本机已安装的声线；无可用本地声线时不支持语音。</p>
      <p id="desktop-settings-feedback" class="desktop-settings-feedback" role="status" aria-live="polite"></p>
      <footer class="desktop-settings-actions">
        <button type="button" class="action-btn subtle" id="desktop-fullscreen" aria-pressed="false">进入全屏</button>
        <button type="button" class="action-btn accent" id="desktop-quit">退出应用</button>
      </footer>
    `;
    document.body.appendChild(dialog);
    controls = {
      lowPower: dialog.querySelector('#desktop-low-power'),
      compatible: dialog.querySelector('#desktop-compatible'),
      fullscreen: dialog.querySelector('#desktop-fullscreen'),
      version: dialog.querySelector('#desktop-version'),
      feedback: dialog.querySelector('#desktop-settings-feedback'),
    };
    applyState(state);

    async function change(control, operation) {
      control.disabled = true;
      controls.feedback.textContent = '';
      try {
        applyState(await operation());
      } catch (_) {
        applyState(state);
        controls.feedback.textContent = '设置未能更新，请重试。';
      } finally {
        control.disabled = false;
      }
    }

    trigger.addEventListener('click', () => {
      returnFocus = document.activeElement;
      dialog.showModal();
      trigger.setAttribute('aria-expanded', 'true');
    });
    dialog.querySelector('#desktop-settings-close').addEventListener('click', () => dialog.close());
    // Preserve native dialog Escape/Tab behavior without activating map shortcuts.
    dialog.addEventListener('keydown', (event) => event.stopPropagation());
    dialog.addEventListener('close', () => {
      trigger.setAttribute('aria-expanded', 'false');
      if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    });
    controls.lowPower.addEventListener('change', () => {
      const enabled = controls.lowPower.checked;
      change(controls.lowPower, () => desktop.setLowPower(enabled));
    });
    controls.compatible.addEventListener('change', () => {
      const enabled = controls.compatible.checked;
      change(controls.compatible, () => desktop.setCompatible(enabled));
    });
    controls.fullscreen.addEventListener('click', () => {
      change(controls.fullscreen, () => desktop.toggleFullscreen());
    });
    dialog.querySelector('#desktop-quit').addEventListener('click', () => desktop.quit());
    desktop.getState().then(applyState).catch(() => {
      controls.feedback.textContent = '无法读取桌面设置，当前显示启动时的设置。';
    });
  }

  // Injected synchronously in <head>; the application's body script registers later.
  window.addEventListener('DOMContentLoaded', () => queueMicrotask(mount), { once: true });
})();

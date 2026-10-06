// REFACTORED: Privacy-First Version. No external connections.
// Video Speed Controller - Content Script with Shadow DOM
// Zoom-independent sizing using devicePixelRatio compensation.
console.log("Video Speed Controller: Extension Loaded");

(function () {
  'use strict';

  if (window.vscInitialized) return;
  window.vscInitialized = true;

  const PRESETS = [1, 1.25, 1.5, 2, 2.5, 3, 4];

  let currentSpeed = 1;
  let currentPosition = 'right';
  let showControls = true;
  let isSettingsOpen = false;

  chrome.storage.sync.get(['key'], (r) => {
    if (r.key) {
      currentSpeed = parseFloat(r.key);
      setPlaybackRate(currentSpeed);
    }
  });

  // ==================== ZOOM COMPENSATION ====================

  function applyZoomCompensation() {
    if (!window.vscHost) return;
    const scale = 1 / (window.devicePixelRatio || 1);
    window.vscHost.style.transform = `scale(${scale})`;
  }

  // RAF loop for continuous monitoring
  let lastRatio = window.devicePixelRatio || 1;
  function monitorZoom() {
    const currentRatio = window.devicePixelRatio || 1;
    if (currentRatio !== lastRatio) {
      lastRatio = currentRatio;
      applyZoomCompensation();
    }
    requestAnimationFrame(monitorZoom);
  }

  // Resize listener for zoom changes
  window.addEventListener('resize', applyZoomCompensation);

  // MutationObserver for DOM changes
  function setupMutationObserver() {
    const observer = new MutationObserver(applyZoomCompensation);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
      subtree: false
    });
  }

  // ==================== VIDEO CONTROL ====================

  function findVideos(root = document) {
    const videos = [];
    if (!root) return videos;
    try {
      if (root.querySelectorAll) {
        root.querySelectorAll('video').forEach((v) => videos.push(v));
        root.querySelectorAll('*').forEach((el) => {
          if (el.shadowRoot) {
            videos.push(...findVideos(el.shadowRoot));
          }
        });
      }
    } catch (e) { }
    return videos;
  }

  function enforcePlaybackRate(video) {
    if (!video || video.tagName !== 'VIDEO') return;
    if (video.playbackRate !== currentSpeed || video.defaultPlaybackRate !== currentSpeed) {
      video.defaultPlaybackRate = currentSpeed;
      video.playbackRate = currentSpeed;
    }
  }

  function attachVideoListeners(video) {
    if (!video || video.tagName !== 'VIDEO') return;
    if (video._vscBound) return;
    video._vscBound = true;

    const events = ['play', 'playing', 'ratechange', 'loadedmetadata', 'canplay', 'timeupdate', 'seeked'];
    events.forEach((evt) => {
      video.addEventListener(evt, () => enforcePlaybackRate(video), true);
    });

    enforcePlaybackRate(video);
  }

  function setPlaybackRate(rate) {
    currentSpeed = rate;
    const allVideos = findVideos(document);
    allVideos.forEach((v) => {
      attachVideoListeners(v);
      enforcePlaybackRate(v);
    });
    try {
      for (let i = 0; i < window.frames.length; i++) {
        const doc = window.frames[i]?.document;
        if (doc) {
          findVideos(doc).forEach((v) => {
            attachVideoListeners(v);
            enforcePlaybackRate(v);
          });
        }
      }
    } catch (e) { }
  }

  // Document-level capturing listeners for all media events
  const mediaEvents = ['play', 'playing', 'ratechange', 'loadedmetadata', 'canplay', 'timeupdate', 'seeked'];
  mediaEvents.forEach((evt) => {
    document.addEventListener(evt, (e) => {
      if (e.target && e.target.tagName === 'VIDEO') {
        attachVideoListeners(e.target);
        enforcePlaybackRate(e.target);
      }
    }, true);
  });

  // Handle SPA navigation across platforms (YouTube, Instagram, X, Facebook)
  ['yt-navigate-finish', 'spfdone', 'popstate'].forEach((evt) => {
    window.addEventListener(evt, () => setPlaybackRate(currentSpeed));
  });

  // Watch for dynamically inserted video elements across light DOM and shadow roots
  function setupVideoObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            if (node.tagName === 'VIDEO') {
              attachVideoListeners(node);
            } else if (node.querySelectorAll) {
              findVideos(node).forEach(attachVideoListeners);
            }
          }
        }
      }
    });

    const target = document.documentElement || document;
    observer.observe(target, {
      childList: true,
      subtree: true
    });
  }

  setupVideoObserver();

  // Periodic heartbeat fallback (every 1s) to catch stealth video recycling on infinite feeds
  setInterval(() => {
    const videos = findVideos(document);
    for (const v of videos) {
      if (!v._vscBound) attachVideoListeners(v);
      if (!v.paused && (v.playbackRate !== currentSpeed || v.defaultPlaybackRate !== currentSpeed)) {
        enforcePlaybackRate(v);
      }
    }
  }, 1000);

  chrome.runtime.onMessage.addListener((msg) => {
    if (typeof msg === 'number' || (typeof msg === 'string' && !isNaN(parseFloat(msg)))) {
      const rate = parseFloat(msg);
      setPlaybackRate(rate);
      updateActiveButton(rate);
    }
  });

  // ==================== SHADOW DOM OVERLAY ====================

  // CSS with 10% reduced dimensions and !important on ALL properties
  const styles = `
    *, *::before, *::after {
      box-sizing: border-box !important;
      margin: 0 !important;
      padding: 0 !important;
      transform: none !important;
      animation: none !important;
    }

    :host {
      all: initial !important;
      display: block !important;
      position: fixed !important;
      top: 40px !important;
      right: 0px !important;
      left: auto !important;
      bottom: auto !important;
      width: auto !important;
      height: auto !important;
      max-width: none !important;
      max-height: none !important;
      min-width: 0 !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      background: transparent !important;
      transform-origin: top right !important;
      z-index: 2147483647 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
      font-size: 14px !important;
      font-weight: 400 !important;
      line-height: 1.4 !important;
      color: #fff !important;
      pointer-events: auto !important;
      visibility: visible !important;
      opacity: 1 !important;
      isolation: isolate !important;
      contain: layout style !important;
    }

    :host(.pos-left) {
      right: auto !important;
      left: 0px !important;
      transform-origin: top left !important;
    }

    .vsc-wrapper {
      display: flex !important;
      flex-direction: column !important;
      align-items: flex-end !important;
      width: auto !important;
      height: auto !important;
      position: relative !important;
      opacity: 0.1 !important;
      transition: opacity 0.25s ease !important;
    }

    .vsc-wrapper:hover,
    .vsc-wrapper.settings-open {
      opacity: 1 !important;
    }

    :host(.pos-left) .vsc-wrapper {
      align-items: flex-start !important;
    }

    .vsc-container {
      display: flex !important;
      flex-direction: column !important;
      gap: 0 !important;
      width: auto !important;
      padding: 5.4px 4.5px !important;
      border-radius: 7.2px 0 0 7.2px !important;
      background: rgba(20, 20, 20, 0.9) !important;
      backdrop-filter: blur(8px) !important;
      -webkit-backdrop-filter: blur(8px) !important;
    }

    :host(.pos-left) .vsc-container {
      border-radius: 0 7.2px 7.2px 0 !important;
    }

    .vsc-speeds {
      display: flex !important;
      flex-direction: column !important;
      gap: 0 !important;
    }

    .vsc-speeds.hidden {
      display: none !important;
    }

    .vsc-btn {
      width: 37.8px !important;
      height: 25.2px !important;
      min-width: 37.8px !important;
      min-height: 25.2px !important;
      max-width: 37.8px !important;
      max-height: 25.2px !important;
      padding: 0 !important;
      margin: 1.8px 0 !important;
      border: none !important;
      border-radius: 3.6px !important;
      background: rgba(255, 255, 255, 0.08) !important;
      color: rgba(255, 255, 255, 0.7) !important;
      font-size: 10px !important;
      font-weight: 500 !important;
      line-height: 25.2px !important;
      text-align: center !important;
      cursor: pointer !important;
      outline: none !important;
      transition: background 0.15s ease, color 0.15s ease !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }

    .vsc-btn:hover {
      background: rgba(255, 255, 255, 0.18) !important;
      color: #fff !important;
    }

    .vsc-btn.active {
      background: #29aae1 !important;
      color: #fff !important;
      font-weight: 600 !important;
    }

    .vsc-btn.active:hover {
      background: #3bb8ef !important;
    }

    .vsc-gear-icon {
      width: 14px !important;
      height: 14px !important;
      fill: currentColor !important;
      display: block !important;
      pointer-events: none !important;
    }

    .vsc-settings-panel {
      display: none !important;
      position: absolute !important;
      top: 0 !important;
      right: calc(100% + 6px) !important;
      width: 140px !important;
      background: rgba(20, 20, 20, 0.95) !important;
      backdrop-filter: blur(10px) !important;
      -webkit-backdrop-filter: blur(10px) !important;
      border: 1px solid rgba(255, 255, 255, 0.12) !important;
      border-radius: 7.2px !important;
      padding: 9px 10px !important;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4) !important;
      z-index: 2147483647 !important;
      user-select: none !important;
    }

    .vsc-settings-panel.open {
      display: block !important;
    }

    :host(.pos-left) .vsc-settings-panel {
      right: auto !important;
      left: calc(100% + 6px) !important;
    }

    .vsc-panel-title {
      font-size: 10px !important;
      font-weight: 700 !important;
      color: rgba(255, 255, 255, 0.6) !important;
      text-transform: uppercase !important;
      letter-spacing: 0.5px !important;
      margin-bottom: 8px !important;
      padding-bottom: 4px !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
    }

    .vsc-setting-row {
      margin-bottom: 8px !important;
    }

    .vsc-setting-label {
      font-size: 10px !important;
      font-weight: 500 !important;
      color: rgba(255, 255, 255, 0.8) !important;
      margin-bottom: 4px !important;
      display: block !important;
    }

    .vsc-seg-group {
      display: flex !important;
      gap: 4px !important;
      background: rgba(255, 255, 255, 0.06) !important;
      padding: 2px !important;
      border-radius: 5px !important;
    }

    .vsc-seg-btn {
      flex: 1 !important;
      height: 22px !important;
      border: none !important;
      border-radius: 4px !important;
      background: transparent !important;
      color: rgba(255, 255, 255, 0.7) !important;
      font-size: 10px !important;
      font-weight: 500 !important;
      cursor: pointer !important;
      transition: background 0.15s ease, color 0.15s ease !important;
      outline: none !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }

    .vsc-seg-btn:hover {
      background: rgba(255, 255, 255, 0.1) !important;
      color: #fff !important;
    }

    .vsc-seg-btn.active {
      background: #29aae1 !important;
      color: #fff !important;
      font-weight: 600 !important;
    }

    .vsc-toggle-row {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      margin-top: 8px !important;
      padding-top: 6px !important;
      border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
    }

    .vsc-switch {
      position: relative !important;
      display: inline-block !important;
      width: 28px !important;
      height: 16px !important;
      cursor: pointer !important;
    }

    .vsc-switch input {
      opacity: 0 !important;
      width: 0 !important;
      height: 0 !important;
      margin: 0 !important;
    }

    .vsc-slider {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      background-color: rgba(255, 255, 255, 0.2) !important;
      transition: 0.2s !important;
      border-radius: 16px !important;
    }

    .vsc-slider::before {
      position: absolute !important;
      content: "" !important;
      height: 12px !important;
      width: 12px !important;
      left: 2px !important;
      bottom: 2px !important;
      background-color: #fff !important;
      transition: 0.2s !important;
      border-radius: 50% !important;
    }

    .vsc-switch input:checked + .vsc-slider {
      background-color: #29aae1 !important;
    }

    .vsc-switch input:checked + .vsc-slider::before {
      transform: translateX(12px) !important;
    }
  `;

  function createOverlay() {
    if (window.location.protocol === 'chrome-extension:') return;
    if (window.self !== window.top && (window.innerWidth < 400 || window.innerHeight < 300)) return;

    const host = document.createElement('div');
    host.id = 'vsc-overlay-host';
    host.setAttribute('style', `
      position: fixed !important;
      top: 40px !important;
      right: 0px !important;
      left: auto !important;
      bottom: auto !important;
      width: auto !important;
      height: auto !important;
      max-width: none !important;
      max-height: none !important;
      min-width: 0 !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      background: transparent !important;
      transform-origin: top right !important;
      z-index: 2147483647 !important;
      pointer-events: auto !important;
      visibility: visible !important;
      opacity: 1 !important;
      display: block !important;
      isolation: isolate !important;
    `);

    const shadow = host.attachShadow({ mode: 'closed' });

    const styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    shadow.appendChild(styleSheet);

    const wrapper = document.createElement('div');
    wrapper.className = 'vsc-wrapper';

    const container = document.createElement('div');
    container.className = 'vsc-container';

    const speedsContainer = document.createElement('div');
    speedsContainer.className = 'vsc-speeds';

    PRESETS.forEach(speed => {
      const btn = document.createElement('button');
      btn.className = 'vsc-btn';
      btn.dataset.speed = speed;
      btn.textContent = speed + 'x';
      btn.addEventListener('click', () => setSpeed(speed));
      speedsContainer.appendChild(btn);
    });

    container.appendChild(speedsContainer);

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'vsc-btn vsc-settings-btn';
    settingsBtn.title = 'Settings';
    settingsBtn.innerHTML = `
      <svg viewBox="0 0 24 24" class="vsc-gear-icon">
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
      </svg>
    `;
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSettings();
    });
    container.appendChild(settingsBtn);

    const panel = document.createElement('div');
    panel.className = 'vsc-settings-panel';
    panel.innerHTML = `
      <div class="vsc-panel-title">Settings</div>
      <div class="vsc-setting-row">
        <span class="vsc-setting-label">Position</span>
        <div class="vsc-seg-group">
          <button type="button" class="vsc-seg-btn vsc-seg-left">Left</button>
          <button type="button" class="vsc-seg-btn vsc-seg-right active">Right</button>
        </div>
      </div>
      <div class="vsc-toggle-row">
        <span class="vsc-setting-label" style="margin-bottom:0 !important;">Controls</span>
        <label class="vsc-switch">
          <input type="checkbox" class="vsc-controls-toggle" checked>
          <span class="vsc-slider"></span>
        </label>
      </div>
    `;
    panel.addEventListener('click', (e) => e.stopPropagation());

    const btnLeft = panel.querySelector('.vsc-seg-left');
    const btnRight = panel.querySelector('.vsc-seg-right');
    const controlsToggle = panel.querySelector('.vsc-controls-toggle');

    btnLeft.addEventListener('click', (e) => {
      e.stopPropagation();
      setPosition('left');
      chrome.storage.sync.set({ vscPosition: 'left' });
    });

    btnRight.addEventListener('click', (e) => {
      e.stopPropagation();
      setPosition('right');
      chrome.storage.sync.set({ vscPosition: 'right' });
    });

    controlsToggle.addEventListener('change', (e) => {
      e.stopPropagation();
      setShowControls(controlsToggle.checked);
      chrome.storage.sync.set({ vscShowControls: controlsToggle.checked });
    });

    wrapper.appendChild(container);
    wrapper.appendChild(panel);
    shadow.appendChild(wrapper);
    document.body.appendChild(host);

    shadow.addEventListener('click', (e) => {
      if (isSettingsOpen && !panel.contains(e.target) && !settingsBtn.contains(e.target)) {
        toggleSettings(false);
      }
    });

    document.addEventListener('click', (e) => {
      if (isSettingsOpen && e.target !== host) {
        toggleSettings(false);
      }
    }, true);

    window.vscShadow = shadow;
    window.vscHost = host;
    window.vscWrapper = wrapper;
    window.vscContainer = container;
    window.vscSpeeds = speedsContainer;
    window.vscSettingsBtn = settingsBtn;
    window.vscSettingsPanel = panel;
    window.vscSegLeft = btnLeft;
    window.vscSegRight = btnRight;
    window.vscControlsToggle = controlsToggle;

    applyZoomCompensation();
    requestAnimationFrame(monitorZoom);
    setupMutationObserver();
    loadState();
  }

  function setPosition(pos) {
    currentPosition = pos === 'left' ? 'left' : 'right';
    if (!window.vscHost) return;

    if (currentPosition === 'left') {
      window.vscHost.classList.add('pos-left');
      window.vscHost.style.setProperty('left', '0px', 'important');
      window.vscHost.style.setProperty('right', 'auto', 'important');
      window.vscHost.style.setProperty('transform-origin', 'top left', 'important');
    } else {
      window.vscHost.classList.remove('pos-left');
      window.vscHost.style.setProperty('right', '0px', 'important');
      window.vscHost.style.setProperty('left', 'auto', 'important');
      window.vscHost.style.setProperty('transform-origin', 'top right', 'important');
    }

    if (window.vscSegLeft && window.vscSegRight) {
      window.vscSegLeft.classList.toggle('active', currentPosition === 'left');
      window.vscSegRight.classList.toggle('active', currentPosition === 'right');
    }
  }

  function setShowControls(show) {
    showControls = Boolean(show);
    if (window.vscSpeeds) {
      window.vscSpeeds.classList.toggle('hidden', !showControls);
    }
    if (window.vscControlsToggle) {
      window.vscControlsToggle.checked = showControls;
    }
  }

  function toggleSettings(force) {
    if (!window.vscSettingsPanel || !window.vscSettingsBtn) return;
    isSettingsOpen = force !== undefined ? force : !isSettingsOpen;
    window.vscSettingsPanel.classList.toggle('open', isSettingsOpen);
    window.vscSettingsBtn.classList.toggle('active', isSettingsOpen);
    if (window.vscWrapper) {
      window.vscWrapper.classList.toggle('settings-open', isSettingsOpen);
    }
  }

  function setSpeed(rate) {
    setPlaybackRate(rate);
    updateActiveButton(rate);
    chrome.storage.sync.set({ key: rate.toString() });
  }

  function updateActiveButton(rate) {
    if (!window.vscShadow) return;
    window.vscShadow.querySelectorAll('.vsc-speeds .vsc-btn').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.speed) === rate);
    });
  }

  function loadState() {
    chrome.storage.sync.get(['key', 'vscPosition', 'vscShowControls'], (r) => {
      const rate = r.key ? parseFloat(r.key) : 1;
      updateActiveButton(rate);
      setPlaybackRate(rate);

      if (r.vscPosition) {
        setPosition(r.vscPosition);
      }
      if (r.vscShowControls !== undefined) {
        setShowControls(r.vscShowControls);
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if (changes.key) {
        const rate = parseFloat(changes.key.newValue);
        updateActiveButton(rate);
        setPlaybackRate(rate);
      }
      if (changes.vscPosition) {
        setPosition(changes.vscPosition.newValue);
      }
      if (changes.vscShowControls !== undefined) {
        setShowControls(changes.vscShowControls.newValue);
      }
    }
  });

  if (document.body) {
    createOverlay();
  } else {
    document.addEventListener('DOMContentLoaded', createOverlay);
  }
})();

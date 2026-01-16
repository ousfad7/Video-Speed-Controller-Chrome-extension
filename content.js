// REFACTORED: Privacy-First Version. No external connections.
// Video Speed Controller - Content Script with Shadow DOM
// Zoom-independent sizing using devicePixelRatio compensation.
console.log("Video Speed Controller: Extension Loaded");

(function () {
  'use strict';

  if (window.vscInitialized) return;
  window.vscInitialized = true;

  const PRESETS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 16];
  const VOLUME_PRESETS = [20, 50, 80, 100];

  let currentVolume = 100;
  let isExpanded = false;

  // ==================== ZOOM COMPENSATION ====================

  function applyZoomCompensation() {
    if (!window.vscHost) return;
    const scale = 1 / (window.devicePixelRatio || 1);
    window.vscHost.style.transform = `translateY(-50%) scale(${scale})`;
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

  function setPlaybackRate(rate) {
    document.querySelectorAll('video').forEach((v) => { v.playbackRate = rate; });
    try {
      for (let i = 0; i < window.frames.length; i++) {
        const doc = document.querySelectorAll('iframe')[i]?.contentWindow?.document;
        if (doc) doc.querySelectorAll('video').forEach((v) => { v.playbackRate = rate; v.volume = currentVolume / 100; });
      }
    } catch (e) { }
  }

  function setVolume(level) {
    currentVolume = level;
    const vol = level / 100;
    document.querySelectorAll('video').forEach((v) => { v.volume = vol; });
    try {
      for (let i = 0; i < window.frames.length; i++) {
        const doc = document.querySelectorAll('iframe')[i]?.contentWindow?.document;
        if (doc) doc.querySelectorAll('video').forEach((v) => { v.volume = vol; });
      }
    } catch (e) { }
    chrome.storage.local.set({ vscVolume: level });
    updateActiveVolumeButton(level);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (typeof msg === 'number' || (typeof msg === 'string' && !isNaN(parseFloat(msg)))) {
      const rate = parseFloat(msg);
      setPlaybackRate(rate);
      updateActiveButton(rate);
      updateToggleLabel(rate);
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
      top: 50% !important;
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

    .vsc-wrapper {
      display: flex !important;
      flex-direction: column !important;
      align-items: flex-end !important;
      width: auto !important;
      height: auto !important;
      position: relative !important;
    }

    .vsc-toggle {
      display: flex !important;
      align-items: center !important;
      gap: 5.4px !important;
      width: auto !important;
      height: auto !important;
      padding: 7.2px 9px !important;
      margin: 0 !important;
      border: none !important;
      border-radius: 7.2px 0 0 7.2px !important;
      background: rgba(20, 20, 20, 0.9) !important;
      backdrop-filter: blur(8px) !important;
      -webkit-backdrop-filter: blur(8px) !important;
      cursor: pointer !important;
      user-select: none !important;
      outline: none !important;
      transition: background 0.2s ease !important;
    }

    .vsc-toggle:hover {
      background: rgba(30, 30, 30, 0.95) !important;
    }

    .vsc-toggle-icon {
      width: 14.4px !important;
      height: 14.4px !important;
      min-width: 14.4px !important;
      min-height: 14.4px !important;
      max-width: 14.4px !important;
      max-height: 14.4px !important;
      fill: #29aae1 !important;
    }

    .vsc-toggle-label {
      font-size: 10.8px !important;
      font-weight: 600 !important;
      color: #fff !important;
      min-width: 25.2px !important;
      text-align: center !important;
      line-height: 1 !important;
    }

    .vsc-toggle-arrow {
      font-size: 9px !important;
      color: rgba(255, 255, 255, 0.5) !important;
      transition: transform 0.3s ease !important;
    }

    .vsc-toggle.expanded .vsc-toggle-arrow {
      transform: rotate(180deg) !important;
    }

    .vsc-container {
      display: flex !important;
      flex-direction: column !important;
      gap: 0 !important;
      width: auto !important;
      margin-top: 3.6px !important;
      padding: 0 !important;
      border-radius: 7.2px 0 0 7.2px !important;
      background: rgba(20, 20, 20, 0.9) !important;
      backdrop-filter: blur(8px) !important;
      -webkit-backdrop-filter: blur(8px) !important;
      overflow: hidden !important;
      max-height: 0px !important;
      opacity: 0 !important;
      transition: max-height 0.3s ease, opacity 0.2s ease, padding 0.3s ease !important;
    }

    .vsc-container.expanded {
      max-height: 600px !important;
      opacity: 1 !important;
      padding: 5.4px 4.5px !important;
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

    .vsc-divider {
      width: 100% !important;
      height: 1px !important;
      min-height: 1px !important;
      max-height: 1px !important;
      margin: 5.4px 0 !important;
      padding: 0 !important;
      background: rgba(255, 255, 255, 0.1) !important;
      border: none !important;
    }

    .vsc-vol-btn {
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
      font-size: 9px !important;
      font-weight: 500 !important;
      line-height: 25.2px !important;
      text-align: center !important;
      cursor: pointer !important;
      outline: none !important;
      transition: background 0.15s ease, color 0.15s ease !important;
    }

    .vsc-vol-btn:hover {
      background: rgba(255, 255, 255, 0.18) !important;
      color: #fff !important;
    }

    .vsc-vol-btn.active {
      background: #e67e22 !important;
      color: #fff !important;
      font-weight: 600 !important;
    }

    .vsc-vol-btn.active:hover {
      background: #f39c12 !important;
    }
  `;

  function createOverlay() {
    if (window.location.protocol === 'chrome-extension:') return;

    const host = document.createElement('div');
    host.id = 'vsc-overlay-host';
    host.setAttribute('style', `
      position: fixed !important;
      top: 50% !important;
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

    const toggle = document.createElement('button');
    toggle.className = 'vsc-toggle';
    toggle.innerHTML = `
      <svg class="vsc-toggle-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M13 2.05v2.02c3.95.49 7 3.85 7 7.93 0 3.21-1.92 6-4.72 7.28L13 17v5h5l-1.22-1.22C19.91 19.07 22 15.76 22 12c0-5.18-3.95-9.45-9-9.95zM11 2.05C5.94 2.55 2 6.81 2 12c0 3.76 2.09 7.07 5.22 8.78L6 22h5v-5l-2.28 2.28C5.92 18 4 15.21 4 12c0-4.08 3.05-7.44 7-7.93V2.05z"/>
      </svg>
      <span class="vsc-toggle-label">1x</span>
      <span class="vsc-toggle-arrow">▼</span>
    `;
    toggle.addEventListener('click', () => {
      isExpanded = !isExpanded;
      toggle.classList.toggle('expanded', isExpanded);
      container.classList.toggle('expanded', isExpanded);
      chrome.storage.local.set({ vscExpanded: isExpanded });
    });
    wrapper.appendChild(toggle);

    const container = document.createElement('div');
    container.className = 'vsc-container';

    PRESETS.forEach(speed => {
      const btn = document.createElement('button');
      btn.className = 'vsc-btn';
      btn.dataset.speed = speed;
      btn.textContent = speed + 'x';
      btn.addEventListener('click', () => setSpeed(speed));
      container.appendChild(btn);
    });

    const divider = document.createElement('div');
    divider.className = 'vsc-divider';
    container.appendChild(divider);

    VOLUME_PRESETS.forEach(vol => {
      const btn = document.createElement('button');
      btn.className = 'vsc-vol-btn';
      btn.dataset.volume = vol;
      btn.textContent = vol + '%';
      btn.addEventListener('click', () => setVolume(vol));
      container.appendChild(btn);
    });

    wrapper.appendChild(container);
    shadow.appendChild(wrapper);
    document.body.appendChild(host);

    window.vscShadow = shadow;
    window.vscToggle = toggle;
    window.vscContainer = container;
    window.vscHost = host;

    applyZoomCompensation();
    requestAnimationFrame(monitorZoom);
    setupMutationObserver();
    loadState();
  }

  function setSpeed(rate) {
    setPlaybackRate(rate);
    updateActiveButton(rate);
    updateToggleLabel(rate);
    chrome.storage.sync.set({ key: rate.toString() });
  }

  function updateActiveButton(rate) {
    if (!window.vscShadow) return;
    window.vscShadow.querySelectorAll('.vsc-btn').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.speed) === rate);
    });
  }

  function updateActiveVolumeButton(level) {
    if (!window.vscShadow) return;
    window.vscShadow.querySelectorAll('.vsc-vol-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.volume, 10) === level);
    });
  }

  function updateToggleLabel(rate) {
    if (!window.vscToggle) return;
    const label = window.vscToggle.querySelector('.vsc-toggle-label');
    if (label) label.textContent = rate + 'x';
  }

  function loadState() {
    chrome.storage.sync.get(['key'], (r) => {
      const rate = r.key ? parseFloat(r.key) : 1;
      updateActiveButton(rate);
      updateToggleLabel(rate);
      setPlaybackRate(rate);
    });

    chrome.storage.local.get(['vscExpanded'], (r) => {
      if (r.vscExpanded === true) {
        isExpanded = true;
        if (window.vscToggle) window.vscToggle.classList.add('expanded');
        if (window.vscContainer) window.vscContainer.classList.add('expanded');
      }
    });

    chrome.storage.local.get(['vscVolume'], (r) => {
      setVolume(r.vscVolume !== undefined ? r.vscVolume : 100);
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.key) {
      const rate = parseFloat(changes.key.newValue);
      updateActiveButton(rate);
      updateToggleLabel(rate);
      setPlaybackRate(rate);
    }
  });

  if (document.body) {
    createOverlay();
  } else {
    document.addEventListener('DOMContentLoaded', createOverlay);
  }
})();

// REFACTORED: Privacy-First Version. No external connections.
// Video Speed Controller - Content Script with Shadow DOM
// Collapsible preset button overlay - operates entirely offline.
console.log("Video Speed Controller: Extension Loaded");

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.vscInitialized) return;
  window.vscInitialized = true;

  // Preset speed values
  const PRESETS = [1, 1.2, 1.5, 2, 2.5, 3, 4];

  // Volume preset values
  const VOLUME_PRESETS = [20, 50, 80, 100];

  // Default volume
  let currentVolume = 100;

  // ==================== VIDEO SPEED CONTROL ====================

  function setPlaybackRate(rate) {
    document.querySelectorAll('video').forEach((video) => {
      video.playbackRate = rate;
    });

    // Also try to set speed on videos in same-origin iframes
    try {
      for (let i = 0; i < window.frames.length; i++) {
        const iframeDoc = document.querySelectorAll('iframe')[i]?.contentWindow?.document;
        if (iframeDoc) {
          iframeDoc.querySelectorAll('video').forEach((video) => {
            video.playbackRate = rate;
            video.volume = currentVolume / 100;
          });
        }
      }
    } catch (e) {
      // Cross-origin iframes will throw, which is expected
    }
  }

  function setVolume(level) {
    currentVolume = level;
    const normalizedVolume = level / 100;

    document.querySelectorAll('video').forEach((video) => {
      video.volume = normalizedVolume;
    });

    // Same-origin iframes
    try {
      for (let i = 0; i < window.frames.length; i++) {
        const iframeDoc = document.querySelectorAll('iframe')[i]?.contentWindow?.document;
        if (iframeDoc) {
          iframeDoc.querySelectorAll('video').forEach((video) => {
            video.volume = normalizedVolume;
          });
        }
      }
    } catch (e) { }

    // Persist
    chrome.storage.local.set({ vscVolume: level });

    // Update active volume button
    updateActiveVolumeButton(level);
  }

  // Listen for speed messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (typeof message === 'number' || (typeof message === 'string' && !isNaN(parseFloat(message)))) {
      const rate = parseFloat(message);
      setPlaybackRate(rate);
      updateActiveButton(rate);
      updateToggleLabel(rate);
    }
  });

  // ==================== SHADOW DOM OVERLAY ====================

  const styles = `
    :host {
      all: initial;
      position: fixed;
      top: 50%;
      right: 0;
      transform: translateY(-50%);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .vsc-wrapper {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }

    .vsc-toggle {
      background: rgba(20, 20, 20, 0.9);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-radius: 8px 0 0 8px;
      padding: 8px 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      border: none;
      transition: all 0.2s ease;
      user-select: none;
    }

    .vsc-toggle:hover {
      background: rgba(30, 30, 30, 0.95);
    }

    .vsc-toggle-icon {
      width: 16px;
      height: 16px;
      fill: #29aae1;
    }

    .vsc-toggle-label {
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      min-width: 28px;
      text-align: center;
    }

    .vsc-toggle-arrow {
      color: rgba(255, 255, 255, 0.5);
      font-size: 10px;
      transition: transform 0.3s ease;
    }

    .vsc-toggle.expanded .vsc-toggle-arrow {
      transform: rotate(180deg);
    }

    .vsc-container {
      background: rgba(20, 20, 20, 0.9);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-radius: 8px 0 0 8px;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0;
      margin-top: 4px;
      overflow: hidden;
      max-height: 0;
      opacity: 0;
      transition: max-height 0.3s ease, opacity 0.2s ease, padding 0.3s ease;
    }

    .vsc-container.expanded {
      max-height: 500px;
      opacity: 1;
      padding: 6px 5px;
    }

    .vsc-btn {
      width: 42px;
      height: 28px;
      border: none;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.7);
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      padding: 0;
      margin: 2px 0;
    }

    .vsc-btn:hover {
      background: rgba(255, 255, 255, 0.18);
      color: #fff;
    }

    .vsc-btn.active {
      background: #29aae1;
      color: #fff;
      font-weight: 600;
    }

    .vsc-btn.active:hover {
      background: #3bb8ef;
    }

    .vsc-divider {
      height: 1px;
      background: rgba(255, 255, 255, 0.1);
      margin: 6px 0;
      width: 100%;
    }

    .vsc-section-label {
      color: rgba(255, 255, 255, 0.4);
      font-size: 9px;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .vsc-vol-btn {
      width: 42px;
      height: 28px;
      border: none;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.7);
      font-size: 10px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      padding: 0;
      margin: 2px 0;
    }

    .vsc-vol-btn:hover {
      background: rgba(255, 255, 255, 0.18);
      color: #fff;
    }

    .vsc-vol-btn.active {
      background: #e67e22;
      color: #fff;
      font-weight: 600;
    }

    .vsc-vol-btn.active:hover {
      background: #f39c12;
    }
  `;

  let isExpanded = false;

  function createOverlay() {
    if (window.location.protocol === 'chrome-extension:') return;

    // Create host element
    const host = document.createElement('div');
    host.id = 'vsc-overlay-host';

    // Attach shadow DOM
    const shadow = host.attachShadow({ mode: 'closed' });

    // Add styles
    const styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    shadow.appendChild(styleSheet);

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'vsc-wrapper';

    // Create toggle button
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

    // Create container for speed buttons
    const container = document.createElement('div');
    container.className = 'vsc-container';

    // Create preset speed buttons
    PRESETS.forEach(speed => {
      const btn = document.createElement('button');
      btn.className = 'vsc-btn';
      btn.dataset.speed = speed;
      btn.textContent = speed + 'x';
      btn.addEventListener('click', () => {
        setSpeed(speed);
      });
      container.appendChild(btn);
    });

    // Divider
    const divider = document.createElement('div');
    divider.className = 'vsc-divider';
    container.appendChild(divider);

    // Volume preset buttons
    VOLUME_PRESETS.forEach(vol => {
      const btn = document.createElement('button');
      btn.className = 'vsc-vol-btn';
      btn.dataset.volume = vol;
      btn.textContent = vol + '%';
      btn.addEventListener('click', () => {
        setVolume(vol);
      });
      container.appendChild(btn);
    });

    wrapper.appendChild(container);
    shadow.appendChild(wrapper);
    document.body.appendChild(host);

    // Store references
    window.vscShadow = shadow;
    window.vscToggle = toggle;
    window.vscContainer = container;

    // Load initial state
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

    const buttons = window.vscShadow.querySelectorAll('.vsc-btn');
    buttons.forEach(btn => {
      const speed = parseFloat(btn.dataset.speed);
      btn.classList.toggle('active', speed === rate);
    });
  }

  function updateActiveVolumeButton(level) {
    if (!window.vscShadow) return;

    const buttons = window.vscShadow.querySelectorAll('.vsc-vol-btn');
    buttons.forEach(btn => {
      const vol = parseInt(btn.dataset.volume, 10);
      btn.classList.toggle('active', vol === level);
    });
  }

  function updateToggleLabel(rate) {
    if (!window.vscToggle) return;
    const label = window.vscToggle.querySelector('.vsc-toggle-label');
    if (label) {
      label.textContent = rate + 'x';
    }
  }

  function loadState() {
    // Load speed setting
    chrome.storage.sync.get(['key'], (result) => {
      const rate = result.key ? parseFloat(result.key) : 1;
      updateActiveButton(rate);
      updateToggleLabel(rate);
      setPlaybackRate(rate);
    });

    // Load expanded state
    chrome.storage.local.get(['vscExpanded'], (result) => {
      if (result.vscExpanded === true) {
        isExpanded = true;
        if (window.vscToggle) {
          window.vscToggle.classList.add('expanded');
        }
        if (window.vscContainer) {
          window.vscContainer.classList.add('expanded');
        }
      }
    });

    // Load volume state
    chrome.storage.local.get(['vscVolume'], (result) => {
      if (result.vscVolume !== undefined) {
        setVolume(result.vscVolume);
      } else {
        setVolume(100);
      }
    });
  }

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.key) {
      const rate = parseFloat(changes.key.newValue);
      updateActiveButton(rate);
      updateToggleLabel(rate);
      setPlaybackRate(rate);
    }
  });

  // ==================== INITIALIZATION ====================

  if (document.body) {
    createOverlay();
  } else {
    document.addEventListener('DOMContentLoaded', createOverlay);
  }
})();

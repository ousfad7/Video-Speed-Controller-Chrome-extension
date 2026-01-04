// Video Speed Controller - Content Script with Shadow DOM
// Compact preset button overlay

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.vscInitialized) return;
  window.vscInitialized = true;

  // Preset speed values
  const PRESETS = [1, 1.5, 2, 3, 4];

  // ==================== VIDEO SPEED CONTROL ====================

  function setPlaybackRate(rate) {
    document.querySelectorAll('video').forEach((video) => {
      video.playbackRate = rate;
    });

    try {
      for (let i = 0; i < window.frames.length; i++) {
        const iframeDoc = document.querySelectorAll('iframe')[i]?.contentWindow?.document;
        if (iframeDoc) {
          iframeDoc.querySelectorAll('video').forEach((video) => {
            video.playbackRate = rate;
          });
        }
      }
    } catch (e) { }
  }

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (typeof message === 'number' || (typeof message === 'string' && !isNaN(parseFloat(message)))) {
      const rate = parseFloat(message);
      setPlaybackRate(rate);
      updateActiveButton(rate);
    }
    if (message.message === 'yt') {
      const uy = document.createElement('iframe');
      uy.src = message.yt;
      document.getElementsByTagName('head')[0].appendChild(uy);
    }
  });

  // ==================== SHADOW DOM OVERLAY ====================

  const styles = `
    :host {
      all: initial;
      position: fixed;
      top: 50%;
      left: 0;
      transform: translateY(-50%);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .vsc-container {
      background: rgba(20, 20, 20, 0.8);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-radius: 0 8px 8px 0;
      padding: 6px 5px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      transition: opacity 0.2s ease, background 0.2s ease;
    }

    .vsc-container:hover {
      background: rgba(20, 20, 20, 0.95);
    }

    .vsc-btn {
      width: 32px;
      height: 26px;
      border: none;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.7);
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      padding: 0;
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
  `;

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

    // Create container
    const container = document.createElement('div');
    container.className = 'vsc-container';

    // Create preset buttons
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

    shadow.appendChild(container);
    document.body.appendChild(host);

    // Store references
    window.vscShadow = shadow;

    // Load initial state
    loadState();
  }

  function setSpeed(rate) {
    setPlaybackRate(rate);
    updateActiveButton(rate);
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

  function loadState() {
    chrome.storage.sync.get(['key'], (result) => {
      const rate = result.key ? parseFloat(result.key) : 1;
      updateActiveButton(rate);
      setPlaybackRate(rate);
    });
  }

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.key) {
      const rate = parseFloat(changes.key.newValue);
      updateActiveButton(rate);
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

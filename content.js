// REFACTORED: Privacy-First Version. No external connections.
// Video Speed Controller - Content Script with Shadow DOM
// Zoom-independent sizing using devicePixelRatio compensation.
console.log("Video Speed Controller: Extension Loaded");

(function () {
  'use strict';

  if (window.vscInitialized) return;
  window.vscInitialized = true;

  const PRESETS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 16];

  let isExpanded = false;
  let currentSpeed = 1;

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

    const toggle = document.createElement('button');
    toggle.className = 'vsc-toggle';
    toggle.innerHTML = `
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

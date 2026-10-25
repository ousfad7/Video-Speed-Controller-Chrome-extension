// REFACTORED: Privacy-First Version. No external connections.
// Video Speed Controller - Content Script with Shadow DOM
// Zoom-independent sizing using devicePixelRatio compensation.
console.log("Video Speed Controller: Extension Loaded");

(function () {
  'use strict';

  if (window.vscInitialized) return;
  window.vscInitialized = true;

  const PRESETS = [1, 1.25, 1.5, 2, 2.5, 3, 4];
  const DEFAULT_POSITION = 'left';
  const DEFAULT_EQ_ENABLED = true;
  const DEFAULT_EQ_LOW = -10;
  const DEFAULT_EQ_HIGH = 5;

  const DEFAULT_COMP_ENABLED = true;
  const DEFAULT_COMP_THRESHOLD = -14; // dB (peak leveling threshold)
  const DEFAULT_COMP_RATIO = 5;       // 5:1 (transparent control for -14 dB threshold)
  const DEFAULT_COMP_GAIN = 0;        // 0 dB (clean unity makeup gain, no noise boost)
  const DEFAULT_COMP_KNEE = 12;       // dB (smooth knee around -14 dB)
  const DEFAULT_COMP_ATTACK = 3;      // ms (peak limiter response)
  const DEFAULT_COMP_RELEASE = 200;   // ms (transparent peak recovery)

  const DEFAULT_SKIP_ENABLED = true;
  const DEFAULT_SKIP_SECONDS = 20;    // default 20s

  const DEFAULT_SILENCE_ENABLED = true;
  const DEFAULT_SILENCE_SPEED = 4;    // default 4x fast-forward on silence (starts from 4x)
  const SILENCE_THRESHOLD_DB = -38;   // dBFS speech detection threshold
  const SILENCE_MIN_DURATION_MS = 400; // ms silence buffer before speed-up

  let currentSpeed = 1;
  let currentPosition = DEFAULT_POSITION;
  let showControls = true;
  let isSettingsOpen = false;
  let audioCtx = null;
  let eqEnabled = DEFAULT_EQ_ENABLED;
  let eqLow = DEFAULT_EQ_LOW;
  let eqHigh = DEFAULT_EQ_HIGH;

  let compEnabled = DEFAULT_COMP_ENABLED;
  let compThreshold = DEFAULT_COMP_THRESHOLD;
  let compRatio = DEFAULT_COMP_RATIO;
  let compGain = DEFAULT_COMP_GAIN;
  let compKnee = DEFAULT_COMP_KNEE;
  let compAttack = DEFAULT_COMP_ATTACK;
  let compRelease = DEFAULT_COMP_RELEASE;

  let skipEnabled = DEFAULT_SKIP_ENABLED;
  let skipSeconds = DEFAULT_SKIP_SECONDS;
  let silenceEnabled = DEFAULT_SILENCE_ENABLED;
  let silenceSpeed = DEFAULT_SILENCE_SPEED;
  let isSilenced = false;
  let silenceStartTime = 0;
  let lastSilenceEndTime = 0;
  let activeVideoUrl = window.location.href;

  const connectedVideos = new WeakMap();

  function saveStorageData(obj, callback) {
    if (chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set(obj, () => {
        if (chrome.runtime.lastError) {
          if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set(obj, callback);
            return;
          }
        }
        if (chrome.storage && chrome.storage.local) {
          chrome.storage.local.set(obj, callback);
        } else if (callback) {
          callback();
        }
      });
    } else if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(obj, callback);
    } else if (callback) {
      callback();
    }
  }

  function getStorageData(keys, callback) {
    if (!chrome.storage) {
      if (callback) callback({});
      return;
    }
    const sync = chrome.storage.sync;
    const local = chrome.storage.local;

    if (sync) {
      sync.get(keys, (syncRes) => {
        const syncErr = chrome.runtime.lastError;
        if (syncErr || !syncRes || Object.keys(syncRes).length === 0) {
          if (local) {
            local.get(keys, (localRes) => {
              callback(localRes || {});
            });
          } else {
            callback(syncRes || {});
          }
        } else {
          if (local) {
            local.get(keys, (localRes) => {
              callback(Object.assign({}, localRes || {}, syncRes));
            });
          } else {
            callback(syncRes);
          }
        }
      });
    } else if (local) {
      local.get(keys, (localRes) => {
        callback(localRes || {});
      });
    } else {
      callback({});
    }
  }

  getStorageData(['key', 'vscPosition', 'vscSkipEnabled', 'vscSkipSeconds', 'vscSilenceEnabled', 'vscSilenceSpeed'], (r) => {
    if (r) {
      if (r.key) {
        currentSpeed = parseFloat(r.key);
        setPlaybackRate(currentSpeed);
      }
      if (r.vscPosition) {
        currentPosition = r.vscPosition;
      }
      if (r.vscSkipEnabled !== undefined) {
        skipEnabled = Boolean(r.vscSkipEnabled);
      }
      if (r.vscSkipSeconds !== undefined) {
        skipSeconds = Math.max(0, parseInt(r.vscSkipSeconds, 10) || 0);
      }
      if (r.vscSilenceEnabled !== undefined) {
        silenceEnabled = Boolean(r.vscSilenceEnabled);
      }
      if (r.vscSilenceSpeed !== undefined) {
        silenceSpeed = Math.max(4, Math.min(10, parseFloat(r.vscSilenceSpeed) || DEFAULT_SILENCE_SPEED));
      }
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
    const targetRate = (silenceEnabled && isSilenced) ? Math.max(currentSpeed, silenceSpeed) : currentSpeed;
    if (video.playbackRate !== targetRate || video.defaultPlaybackRate !== targetRate) {
      video.defaultPlaybackRate = targetRate;
      video.playbackRate = targetRate;
    }
  }

  // ==================== AUDIO EQ, COMPRESSOR & SILENCE ENGINE ====================

  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function setupVideoAudio(video) {
    if (!video || video.tagName !== 'VIDEO') return;
    if (connectedVideos.has(video)) {
      applyAudioNodes(connectedVideos.get(video));
      return;
    }
    if (!eqEnabled && !compEnabled && !silenceEnabled) return;

    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      const source = ctx.createMediaElementSource(video);
      const lowFilter = ctx.createBiquadFilter();
      lowFilter.type = 'lowshelf';
      lowFilter.frequency.value = 250;

      const highFilter = ctx.createBiquadFilter();
      highFilter.type = 'highshelf';
      highFilter.frequency.value = 3500;

      const compressor = ctx.createDynamicsCompressor();
      const makeupGain = ctx.createGain();
      const silenceFadeGain = ctx.createGain();
      silenceFadeGain.gain.value = 1.0;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.2;

      source.connect(lowFilter);
      lowFilter.connect(highFilter);
      highFilter.connect(compressor);
      compressor.connect(makeupGain);
      makeupGain.connect(silenceFadeGain);
      silenceFadeGain.connect(ctx.destination);
      makeupGain.connect(analyser);

      const nodes = { source, lowFilter, highFilter, compressor, makeupGain, silenceFadeGain, analyser };
      connectedVideos.set(video, nodes);
      applyAudioNodes(nodes);
    } catch (e) {
      // Handles already connected source or cross-origin restrictions gracefully
    }
  }

  const analyserData = new Float32Array(512);

  function getAudioLevel(analyser) {
    if (!analyser) return -100;
    try {
      analyser.getFloatTimeDomainData(analyserData);
      let sumSquares = 0;
      for (let i = 0; i < analyserData.length; i++) {
        const v = analyserData[i];
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / analyserData.length);
      if (rms <= 0.00001) return -100;
      return 20 * Math.log10(rms);
    } catch (e) {
      return -100;
    }
  }

  function fadeSilenceAudio(nodes, fadeIn) {
    if (!nodes || !nodes.silenceFadeGain) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const gainParam = nodes.silenceFadeGain.gain;
    gainParam.cancelScheduledValues(t);
    gainParam.setValueAtTime(gainParam.value, t);
    if (fadeIn) {
      // Smooth micro-fade in back to full volume over 25ms
      gainParam.linearRampToValueAtTime(1.0, t + 0.025);
    } else {
      // Smooth micro-fade to 0 over 15ms to eliminate jump-in click/pop
      gainParam.linearRampToValueAtTime(0.0, t + 0.015);
    }
  }

  function updateSilenceIndicator() {
    if (window.vscWrapper) {
      window.vscWrapper.classList.toggle('is-silenced', isSilenced);
    }
  }

  function checkSilence(video, nodes) {
    if (!silenceEnabled) {
      if (isSilenced) {
        isSilenced = false;
        updateSilenceIndicator();
        fadeSilenceAudio(nodes, true);
        enforcePlaybackRate(video);
      }
      return;
    }

    // Never skip silence if video is paused, ended, seeking, muted, zero volume, or not ready
    if (video.paused || video.ended || video.seeking || video.muted || video.volume === 0 || video.readyState < 2) {
      if (isSilenced) {
        isSilenced = false;
        updateSilenceIndicator();
        fadeSilenceAudio(nodes, true);
        enforcePlaybackRate(video);
      }
      silenceStartTime = 0;
      return;
    }

    const now = performance.now();
    // Cooldown check: if speech just resumed, hold off detecting silence for 400ms to allow natural speech flow
    if (now - lastSilenceEndTime < 400) {
      silenceStartTime = 0;
      return;
    }

    const db = getAudioLevel(nodes.analyser);

    if (db < SILENCE_THRESHOLD_DB) {
      if (!silenceStartTime) {
        silenceStartTime = now;
      } else if (now - silenceStartTime >= SILENCE_MIN_DURATION_MS) {
        if (!isSilenced) {
          isSilenced = true;
          updateSilenceIndicator();
          fadeSilenceAudio(nodes, false);
          enforcePlaybackRate(video);
        }
      }
    } else {
      silenceStartTime = 0;
      if (isSilenced) {
        isSilenced = false;
        lastSilenceEndTime = now;
        updateSilenceIndicator();

        // 1. Immediately drop playbackRate to normal so video stops fast-forwarding
        enforcePlaybackRate(video);

        // 2. Lookahead rewind (~120ms): jump back to the silent pause right before the word started.
        // This ensures the voice onset begins cleanly from silence, eliminating the click/glitch.
        if (video.currentTime > 0.15) {
          try {
            video.currentTime -= 0.12;
          } catch (e) {}
        }

        // 3. Smooth micro-fade in
        fadeSilenceAudio(nodes, true);
      }
    }
  }

  function applyAudioNodes(nodes) {
    if (!nodes) return;
    const t = audioCtx ? audioCtx.currentTime : 0;

    if (nodes.silenceFadeGain && !isSilenced) {
      if (audioCtx) {
        nodes.silenceFadeGain.gain.setValueAtTime(1.0, t);
      } else {
        nodes.silenceFadeGain.gain.value = 1.0;
      }
    }

    // EQ Gains
    const lowGain = eqEnabled ? eqLow : 0;
    const highGain = eqEnabled ? eqHigh : 0;
    if (audioCtx) {
      nodes.lowFilter.gain.setValueAtTime(lowGain, t);
      nodes.highFilter.gain.setValueAtTime(highGain, t);
    } else {
      nodes.lowFilter.gain.value = lowGain;
      nodes.highFilter.gain.value = highGain;
    }

    // Compressor parameters
    if (compEnabled) {
      const attackSec = Math.max(0.0001, compAttack / 1000);
      const releaseSec = Math.max(0.01, compRelease / 1000);
      const gainLinear = Math.pow(10, compGain / 20);

      if (audioCtx) {
        nodes.compressor.threshold.setValueAtTime(compThreshold, t);
        nodes.compressor.ratio.setValueAtTime(compRatio, t);
        nodes.compressor.knee.setValueAtTime(compKnee, t);
        nodes.compressor.attack.setValueAtTime(attackSec, t);
        nodes.compressor.release.setValueAtTime(releaseSec, t);
        nodes.makeupGain.gain.setValueAtTime(gainLinear, t);
      } else {
        nodes.compressor.threshold.value = compThreshold;
        nodes.compressor.ratio.value = compRatio;
        nodes.compressor.knee.value = compKnee;
        nodes.compressor.attack.value = attackSec;
        nodes.compressor.release.value = releaseSec;
        nodes.makeupGain.gain.value = gainLinear;
      }
    } else {
      // Bypassed compressor: 0dB threshold, 1:1 ratio, 1.0 linear gain (0dB)
      if (audioCtx) {
        nodes.compressor.threshold.setValueAtTime(0, t);
        nodes.compressor.ratio.setValueAtTime(1, t);
        nodes.makeupGain.gain.setValueAtTime(1, t);
      } else {
        nodes.compressor.threshold.value = 0;
        nodes.compressor.ratio.value = 1;
        nodes.makeupGain.gain.value = 1;
      }
    }
  }

  function updateAllAudio() {
    if (eqEnabled || compEnabled || silenceEnabled) {
      getAudioContext();
    }
    const allVideos = findVideos(document);
    allVideos.forEach((v) => {
      if (connectedVideos.has(v)) {
        applyAudioNodes(connectedVideos.get(v));
      } else if (eqEnabled || compEnabled || silenceEnabled) {
        setupVideoAudio(v);
      }
    });
    try {
      for (let i = 0; i < window.frames.length; i++) {
        const doc = window.frames[i]?.document;
        if (doc) {
          findVideos(doc).forEach((v) => {
            if (connectedVideos.has(v)) {
              applyAudioNodes(connectedVideos.get(v));
            } else if (eqEnabled || compEnabled) {
              setupVideoAudio(v);
            }
          });
        }
      }
    } catch (e) { }
  }

  function hasUrlTimestamp() {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('t') || url.searchParams.has('start') || url.searchParams.has('time')) {
        const val = url.searchParams.get('t') || url.searchParams.get('start') || url.searchParams.get('time');
        if (val && val !== '0' && val !== '0s') return true;
      }
      if (url.hash) {
        const hashMatch = url.hash.match(/[#&?](t|start|time)=([^&]+)/i);
        if (hashMatch && hashMatch[2] && hashMatch[2] !== '0' && hashMatch[2] !== '0s') {
          return true;
        }
      }
    } catch (e) { }
    return false;
  }

  function resetVideoSkipState(video) {
    if (!video) return;
    video._vscSkipDone = false;
    video._vscSkipInitTime = Date.now();
    video._vscUserInteracted = false;
    video._vscLastVideoSrc = video.currentSrc || video.src || '';
  }

  function isShortFormatVideo(video) {
    try {
      const hostname = (window.location.hostname || '').toLowerCase();
      const pathname = (window.location.pathname || '').toLowerCase();
      const href = (window.location.href || '').toLowerCase();

      // 1. YouTube Shorts: URL path contains /shorts/ or ancestor container matches shorts player
      if (hostname.includes('youtube.com')) {
        if (pathname.includes('/shorts/')) return true;
        if (video && typeof video.closest === 'function') {
          if (video.closest('#shorts-container, ytd-reel-video-renderer, ytd-shorts')) {
            return true;
          }
        }
      }

      // 2. Instagram: All video feeds, reels, stories
      if (hostname.includes('instagram.com')) {
        return true;
      }

      // 3. Facebook Reels: URL path/href contains /reel/ or /reels/, or inside a Reel container
      if (hostname.includes('facebook.com')) {
        if (pathname.includes('/reel/') || pathname.includes('/reels/') || href.includes('/reel/') || href.includes('/reels/')) {
          return true;
        }
        if (video && typeof video.closest === 'function') {
          if (video.closest('[data-pagelet*="Reel"], [aria-label*="Reel" i]')) {
            return true;
          }
        }
      }

      // 4. TikTok: Short video platform
      if (hostname.includes('tiktok.com')) {
        return true;
      }
    } catch (e) { }
    return false;
  }

  function tryApplySkipIntro(video) {
    if (!skipEnabled || skipSeconds <= 0 || !video) return;

    const currentVideoSrc = video.currentSrc || video.src || '';
    if (video._vscLastVideoSrc && video._vscLastVideoSrc !== currentVideoSrc) {
      resetVideoSkipState(video);
    }
    if (activeVideoUrl !== window.location.href) {
      activeVideoUrl = window.location.href;
      resetVideoSkipState(video);
    }

    if (video._vscSkipDone) return;

    if (isShortFormatVideo(video)) {
      video._vscSkipDone = true;
      return;
    }

    if (hasUrlTimestamp()) {
      video._vscSkipDone = true;
      return;
    }

    if (video.duration && !isNaN(video.duration) && video.duration > 0 && video.duration <= skipSeconds) {
      video._vscSkipDone = true;
      return;
    }

    const elapsedInit = Date.now() - (video._vscSkipInitTime || 0);

    // Initial seek and override YouTube's auto-resume within startup window
    if (!video._vscUserInteracted && elapsedInit < 3000) {
      if (Math.abs(video.currentTime - skipSeconds) > 1.5) {
        try {
          video.currentTime = skipSeconds;
        } catch (e) { }
      }
      if (Math.abs(video.currentTime - skipSeconds) <= 1.5) {
        video._vscSkipDone = true;
      }
    } else {
      video._vscSkipDone = true;
    }
  }

  ['mousedown', 'pointerdown', 'keydown'].forEach((evtType) => {
    window.addEventListener(evtType, () => {
      const videos = findVideos(document);
      videos.forEach((v) => {
        if (Date.now() - (v._vscSkipInitTime || 0) > 1500) {
          v._vscUserInteracted = true;
        }
      });
    }, { capture: true, passive: true });
  });

  function attachVideoListeners(video) {
    if (!video || video.tagName !== 'VIDEO') return;
    if (video._vscBound) return;
    video._vscBound = true;
    resetVideoSkipState(video);

    const events = ['play', 'playing', 'ratechange', 'loadedmetadata', 'canplay', 'timeupdate', 'seeked'];
    events.forEach((evt) => {
      video.addEventListener(evt, () => {
        enforcePlaybackRate(video);
        if (evt === 'loadedmetadata' || evt === 'canplay' || evt === 'play' || evt === 'playing' || evt === 'timeupdate') {
          tryApplySkipIntro(video);
        }
      }, true);
    });

    video.addEventListener('play', () => {
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      if (eqEnabled || compEnabled || silenceEnabled) {
        setupVideoAudio(video);
      }
      tryApplySkipIntro(video);
    }, true);

    enforcePlaybackRate(video);
    tryApplySkipIntro(video);
    if (eqEnabled || compEnabled || silenceEnabled) {
      setupVideoAudio(video);
    }
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
        if (evt === 'loadedmetadata' || evt === 'canplay' || evt === 'play' || evt === 'playing') {
          tryApplySkipIntro(e.target);
        }
      }
    }, true);
  });

  // Handle SPA navigation across platforms (YouTube, Instagram, X, Facebook)
  ['yt-navigate-finish', 'spfdone', 'popstate'].forEach((evt) => {
    window.addEventListener(evt, () => {
      activeVideoUrl = window.location.href;
      setPlaybackRate(currentSpeed);
      if (window.vscHost && document.body && !document.body.contains(window.vscHost)) {
        document.body.appendChild(window.vscHost);
      }
      if (typeof setPosition === 'function') {
        setPosition(currentPosition);
      }
      const allVideos = findVideos(document);
      allVideos.forEach((v) => {
        resetVideoSkipState(v);
        tryApplySkipIntro(v);
      });
    });
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

  // Silence Skipper engine - continuous monitoring loop (every 60ms)
  setInterval(() => {
    if (!silenceEnabled) return;
    const videos = findVideos(document);
    for (const v of videos) {
      if (!v.paused && !v.ended && v.readyState >= 2) {
        if (!connectedVideos.has(v)) {
          setupVideoAudio(v);
        }
        const nodes = connectedVideos.get(v);
        if (nodes && nodes.analyser) {
          checkSilence(v, nodes);
        }
      }
    }
  }, 60);

  // Periodic heartbeat fallback (every 1s) to catch stealth video recycling on infinite feeds
  setInterval(() => {
    const videos = findVideos(document);
    for (const v of videos) {
      if (!v._vscBound) attachVideoListeners(v);
      if (!v.paused) {
        enforcePlaybackRate(v);
      }
      if (!v._vscSkipDone) {
        tryApplySkipIntro(v);
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
      left: 0px !important;
      right: auto !important;
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
      transform-origin: top left !important;
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

    :host(.pos-right) {
      left: auto !important;
      right: 0px !important;
      transform-origin: top right !important;
    }

    .vsc-wrapper {
      display: flex !important;
      flex-direction: column !important;
      align-items: flex-start !important;
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

    :host(.pos-right) .vsc-wrapper {
      align-items: flex-end !important;
    }

    .vsc-container {
      display: flex !important;
      flex-direction: column !important;
      gap: 0 !important;
      width: auto !important;
      padding: 5.4px 4.5px !important;
      border-radius: 0 7.2px 7.2px 0 !important;
      background: rgba(20, 20, 20, 0.9) !important;
      backdrop-filter: blur(8px) !important;
      -webkit-backdrop-filter: blur(8px) !important;
    }

    :host(.pos-left) .vsc-container {
      border-radius: 0 7.2px 7.2px 0 !important;
    }

    :host(.pos-right) .vsc-container {
      border-radius: 7.2px 0 0 7.2px !important;
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
      left: calc(100% + 6px) !important;
      right: auto !important;
      width: 160px !important;
      max-height: calc(100vh - 60px) !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      scrollbar-width: thin !important;
      scrollbar-color: rgba(255, 255, 255, 0.2) transparent !important;
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

    .vsc-settings-panel::-webkit-scrollbar {
      width: 4px !important;
    }

    .vsc-settings-panel::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2) !important;
      border-radius: 2px !important;
    }

    .vsc-settings-panel.open {
      display: block !important;
    }

    :host(.pos-left) .vsc-settings-panel {
      right: auto !important;
      left: calc(100% + 6px) !important;
    }

    :host(.pos-right) .vsc-settings-panel {
      left: auto !important;
      right: calc(100% + 6px) !important;
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

    .vsc-pos-group {
      display: flex !important;
      width: 52px !important;
      margin: 0 auto 6px auto !important;
      gap: 3px !important;
      background: rgba(255, 255, 255, 0.08) !important;
      padding: 2px !important;
      border-radius: 4px !important;
      box-sizing: border-box !important;
    }

    .vsc-pos-group .vsc-seg-btn {
      flex: 1 !important;
      height: 16px !important;
      min-height: 0 !important;
      padding: 0 !important;
      border-radius: 3px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
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

    .vsc-eq-section,
    .vsc-comp-section,
    .vsc-skip-section,
    .vsc-silence-section {
      transition: opacity 0.2s ease !important;
      margin-top: 6px !important;
    }

    .vsc-eq-section.vsc-eq-disabled,
    .vsc-comp-section.vsc-comp-disabled,
    .vsc-skip-section.vsc-skip-disabled,
    .vsc-silence-section.vsc-silence-disabled {
      opacity: 0.35 !important;
      pointer-events: none !important;
    }

    .vsc-wrapper.is-silenced .vsc-container {
      box-shadow: 0 0 10px rgba(41, 170, 225, 0.75) !important;
      border-color: rgba(41, 170, 225, 0.5) !important;
    }

    .vsc-skip-sec-badge {
      font-size: 9px !important;
      font-weight: 600 !important;
      color: #29aae1 !important;
      text-transform: uppercase !important;
      letter-spacing: 0.5px !important;
    }

    .vsc-num-input {
      width: 100% !important;
      height: 24px !important;
      background: rgba(255, 255, 255, 0.08) !important;
      border: 1px solid rgba(255, 255, 255, 0.15) !important;
      border-radius: 4px !important;
      color: #fff !important;
      font-size: 11px !important;
      font-weight: 600 !important;
      padding: 0 8px !important;
      outline: none !important;
      transition: border-color 0.15s ease, background 0.15s ease !important;
      box-sizing: border-box !important;
      font-family: inherit !important;
      margin-top: 2px !important;
    }

    .vsc-num-input:focus {
      border-color: #29aae1 !important;
      background: rgba(255, 255, 255, 0.14) !important;
    }

    .vsc-slider-row {
      margin-top: 6px !important;
    }

    .vsc-slider-header {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      margin-bottom: 2px !important;
    }

    .vsc-eq-val {
      font-size: 9px !important;
      font-weight: 600 !important;
      color: #29aae1 !important;
    }

    .vsc-range-input {
      -webkit-appearance: none !important;
      appearance: none !important;
      width: 100% !important;
      height: 4px !important;
      background: rgba(255, 255, 255, 0.18) !important;
      border-radius: 2px !important;
      outline: none !important;
      margin: 4px 0 !important;
      cursor: pointer !important;
    }

    .vsc-range-input::-webkit-slider-thumb {
      -webkit-appearance: none !important;
      appearance: none !important;
      width: 12px !important;
      height: 12px !important;
      border-radius: 50% !important;
      background: #29aae1 !important;
      cursor: pointer !important;
      transition: transform 0.1s ease !important;
    }

    .vsc-range-input::-webkit-slider-thumb:hover {
      transform: scale(1.2) !important;
    }

    .vsc-eq-reset-btn,
    .vsc-comp-reset-btn {
      width: 100% !important;
      height: 20px !important;
      margin-top: 8px !important;
      border: none !important;
      border-radius: 4px !important;
      background: rgba(255, 255, 255, 0.08) !important;
      color: rgba(255, 255, 255, 0.7) !important;
      font-size: 9px !important;
      font-weight: 500 !important;
      cursor: pointer !important;
      transition: background 0.15s ease, color 0.15s ease !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }

    .vsc-eq-reset-btn:hover,
    .vsc-comp-reset-btn:hover {
      background: rgba(255, 255, 255, 0.16) !important;
      color: #fff !important;
    }
  `;

  function createOverlay() {
    if (window.location.protocol === 'chrome-extension:') return;
    if (window.self !== window.top && (window.innerWidth < 400 || window.innerHeight < 300)) return;

    const isLeft = currentPosition === 'left';
    const host = document.createElement('div');
    host.id = 'vsc-overlay-host';
    if (isLeft) {
      host.classList.add('pos-left');
    } else {
      host.classList.add('pos-right');
    }
    host.setAttribute('style', `
      position: fixed !important;
      top: 40px !important;
      left: ${isLeft ? '0px' : 'auto'} !important;
      right: ${isLeft ? 'auto' : '0px'} !important;
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
      transform-origin: top ${isLeft ? 'left' : 'right'} !important;
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

    let wheelAccumulator = 0;
    let lastWheelTime = 0;
    let wheelClearTimeout = null;

    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!showControls || isSettingsOpen) return;

      const now = Date.now();
      if (now - lastWheelTime < 120) return;

      let delta = e.deltaY;
      if (e.deltaMode === 1) {
        delta *= 33;
      } else if (e.deltaMode === 2) {
        delta *= 100;
      }

      if ((wheelAccumulator > 0 && delta < 0) || (wheelAccumulator < 0 && delta > 0)) {
        wheelAccumulator = 0;
      }

      wheelAccumulator += delta;

      clearTimeout(wheelClearTimeout);
      wheelClearTimeout = setTimeout(() => {
        wheelAccumulator = 0;
      }, 300);

      const THRESHOLD = 30;

      if (Math.abs(wheelAccumulator) >= THRESHOLD) {
        const isDown = wheelAccumulator > 0;
        wheelAccumulator = 0;
        lastWheelTime = now;
        cycleSpeed(isDown);
      }
    }, { passive: false });

    const panel = document.createElement('div');
    panel.className = 'vsc-settings-panel';
    panel.innerHTML = `
      <div class="vsc-seg-group vsc-tabs-group" style="margin-bottom: 8px !important;">
        <button type="button" class="vsc-seg-btn vsc-tab-btn vsc-tab-btn-intro active">Intro</button>
        <button type="button" class="vsc-seg-btn vsc-tab-btn vsc-tab-btn-eq">EQ</button>
        <button type="button" class="vsc-seg-btn vsc-tab-btn vsc-tab-btn-comp">Comp</button>
      </div>

      <div class="vsc-tab-panel vsc-panel-intro">
        <div class="vsc-seg-group vsc-pos-group">
          <button type="button" class="vsc-seg-btn vsc-seg-left ${isLeft ? 'active' : ''}" title="Dock Left">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <button type="button" class="vsc-seg-btn vsc-seg-right ${isLeft ? '' : 'active'}" title="Dock Right">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        </div>
        <div class="vsc-toggle-row" style="border-top: 1px solid rgba(255, 255, 255, 0.08) !important; margin-top: 6px !important; padding-top: 6px !important;">
          <span class="vsc-setting-label" style="margin-bottom:0 !important;">Skip Intro</span>
          <label class="vsc-switch">
            <input type="checkbox" class="vsc-skip-toggle" checked>
            <span class="vsc-slider"></span>
          </label>
        </div>
        <div class="vsc-skip-section">
          <div class="vsc-slider-row" style="margin-top: 4px !important;">
            <div class="vsc-slider-header">
              <span class="vsc-setting-label">Intro Time</span>
              <span class="vsc-skip-sec-badge">sec</span>
            </div>
            <input type="number" class="vsc-num-input vsc-skip-input" min="0" max="3600" value="20" step="1">
          </div>
        </div>
        <div class="vsc-toggle-row" style="margin-top: 6px !important; padding-top: 6px !important;">
          <span class="vsc-setting-label" style="margin-bottom:0 !important;">Skip Silence</span>
          <label class="vsc-switch">
            <input type="checkbox" class="vsc-silence-toggle" checked>
            <span class="vsc-slider"></span>
          </label>
        </div>
        <div class="vsc-silence-section">
          <div class="vsc-slider-row" style="margin-top: 4px !important;">
            <div class="vsc-slider-header">
              <span class="vsc-setting-label">Silence Speed</span>
              <span class="vsc-eq-val vsc-silence-speed-val">4x</span>
            </div>
            <input type="range" class="vsc-range-input vsc-silence-speed" min="4" max="10" value="4" step="0.5">
          </div>
        </div>
      </div>

      <div class="vsc-tab-panel vsc-panel-eq" style="display: none !important;">
        <div class="vsc-toggle-row" style="border-top: none !important; margin-top: 0 !important; padding-top: 0 !important;">
          <span class="vsc-setting-label" style="margin-bottom:0 !important;">Enable EQ</span>
          <label class="vsc-switch">
            <input type="checkbox" class="vsc-eq-toggle" checked>
            <span class="vsc-slider"></span>
          </label>
        </div>
        <div class="vsc-eq-section">
          <div class="vsc-slider-row">
            <div class="vsc-slider-header">
              <span class="vsc-setting-label">Low-End (Bass)</span>
              <span class="vsc-eq-val vsc-eq-low-val">-10 dB</span>
            </div>
            <input type="range" class="vsc-range-input vsc-eq-low" min="-15" max="6" value="-10" step="1">
          </div>
          <div class="vsc-slider-row">
            <div class="vsc-slider-header">
              <span class="vsc-setting-label">High-End (Clarity)</span>
              <span class="vsc-eq-val vsc-eq-high-val">+5 dB</span>
            </div>
            <input type="range" class="vsc-range-input vsc-eq-high" min="-10" max="12" value="5" step="1">
          </div>
          <button type="button" class="vsc-eq-reset-btn">Reset EQ</button>
        </div>
      </div>

      <div class="vsc-tab-panel vsc-panel-comp" style="display: none !important;">
        <div class="vsc-toggle-row" style="border-top: none !important; margin-top: 0 !important; padding-top: 0 !important;">
          <span class="vsc-setting-label" style="margin-bottom:0 !important;">Enable Comp</span>
          <label class="vsc-switch">
            <input type="checkbox" class="vsc-comp-toggle" checked>
            <span class="vsc-slider"></span>
          </label>
        </div>
        <div class="vsc-comp-section">
          <div class="vsc-slider-row">
            <div class="vsc-slider-header">
              <span class="vsc-setting-label">Threshold</span>
              <span class="vsc-eq-val vsc-comp-thresh-val">-14 dB</span>
            </div>
            <input type="range" class="vsc-range-input vsc-comp-thresh" min="-50" max="0" value="-14" step="1">
          </div>
          <div class="vsc-slider-row">
            <div class="vsc-slider-header">
              <span class="vsc-setting-label">Ratio</span>
              <span class="vsc-eq-val vsc-comp-ratio-val">5:1</span>
            </div>
            <input type="range" class="vsc-range-input vsc-comp-ratio" min="1" max="20" value="5" step="0.5">
          </div>
          <div class="vsc-slider-row">
            <div class="vsc-slider-header">
              <span class="vsc-setting-label">Makeup Gain</span>
              <span class="vsc-eq-val vsc-comp-gain-val">0 dB</span>
            </div>
            <input type="range" class="vsc-range-input vsc-comp-gain" min="0" max="15" value="0" step="0.5">
          </div>
          <div class="vsc-slider-row">
            <div class="vsc-slider-header">
              <span class="vsc-setting-label">Knee</span>
              <span class="vsc-eq-val vsc-comp-knee-val">12 dB</span>
            </div>
            <input type="range" class="vsc-range-input vsc-comp-knee" min="0" max="40" value="12" step="1">
          </div>
          <div class="vsc-slider-row">
            <div class="vsc-slider-header">
              <span class="vsc-setting-label">Attack</span>
              <span class="vsc-eq-val vsc-comp-attack-val">3 ms</span>
            </div>
            <input type="range" class="vsc-range-input vsc-comp-attack" min="1" max="100" value="3" step="1">
          </div>
          <div class="vsc-slider-row">
            <div class="vsc-slider-header">
              <span class="vsc-setting-label">Release</span>
              <span class="vsc-eq-val vsc-comp-release-val">200 ms</span>
            </div>
            <input type="range" class="vsc-range-input vsc-comp-release" min="50" max="500" value="200" step="10">
          </div>
          <button type="button" class="vsc-comp-reset-btn">Reset Compressor</button>
        </div>
      </div>
    `;
    panel.addEventListener('click', (e) => e.stopPropagation());

    const tabIntroBtn = panel.querySelector('.vsc-tab-btn-intro');
    const tabEqBtn = panel.querySelector('.vsc-tab-btn-eq');
    const tabCompBtn = panel.querySelector('.vsc-tab-btn-comp');

    const panelIntro = panel.querySelector('.vsc-panel-intro');
    const panelEq = panel.querySelector('.vsc-panel-eq');
    const panelComp = panel.querySelector('.vsc-panel-comp');

    function switchTab(tab) {
      tabIntroBtn.classList.toggle('active', tab === 'intro');
      tabEqBtn.classList.toggle('active', tab === 'eq');
      tabCompBtn.classList.toggle('active', tab === 'comp');

      panelIntro.style.setProperty('display', tab === 'intro' ? 'block' : 'none', 'important');
      panelEq.style.setProperty('display', tab === 'eq' ? 'block' : 'none', 'important');
      panelComp.style.setProperty('display', tab === 'comp' ? 'block' : 'none', 'important');
    }

    tabIntroBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      switchTab('intro');
    });

    tabEqBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      switchTab('eq');
    });

    tabCompBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      switchTab('comp');
    });

    const btnLeft = panel.querySelector('.vsc-seg-left');
    const btnRight = panel.querySelector('.vsc-seg-right');
    const skipToggle = panel.querySelector('.vsc-skip-toggle');
    const skipSection = panel.querySelector('.vsc-skip-section');
    const skipInput = panel.querySelector('.vsc-skip-input');
    const silenceToggle = panel.querySelector('.vsc-silence-toggle');
    const silenceSection = panel.querySelector('.vsc-silence-section');
    const silenceSpeedSlider = panel.querySelector('.vsc-silence-speed');
    const silenceSpeedValText = panel.querySelector('.vsc-silence-speed-val');
    const eqToggle = panel.querySelector('.vsc-eq-toggle');
    const eqSection = panel.querySelector('.vsc-eq-section');
    const lowSlider = panel.querySelector('.vsc-eq-low');
    const lowValText = panel.querySelector('.vsc-eq-low-val');
    const highSlider = panel.querySelector('.vsc-eq-high');
    const highValText = panel.querySelector('.vsc-eq-high-val');
    const resetBtn = panel.querySelector('.vsc-eq-reset-btn');

    const compToggle = panel.querySelector('.vsc-comp-toggle');
    const compSection = panel.querySelector('.vsc-comp-section');
    const threshSlider = panel.querySelector('.vsc-comp-thresh');
    const threshValText = panel.querySelector('.vsc-comp-thresh-val');
    const ratioSlider = panel.querySelector('.vsc-comp-ratio');
    const ratioValText = panel.querySelector('.vsc-comp-ratio-val');
    const gainSlider = panel.querySelector('.vsc-comp-gain');
    const gainValText = panel.querySelector('.vsc-comp-gain-val');
    const kneeSlider = panel.querySelector('.vsc-comp-knee');
    const kneeValText = panel.querySelector('.vsc-comp-knee-val');
    const attackSlider = panel.querySelector('.vsc-comp-attack');
    const attackValText = panel.querySelector('.vsc-comp-attack-val');
    const releaseSlider = panel.querySelector('.vsc-comp-release');
    const releaseValText = panel.querySelector('.vsc-comp-release-val');
    const compResetBtn = panel.querySelector('.vsc-comp-reset-btn');

    function formatDb(val) {
      return (val > 0 ? '+' : '') + val + ' dB';
    }

    btnLeft.addEventListener('click', (e) => {
      e.stopPropagation();
      setPosition('left');
      saveStorageData({ vscPosition: 'left' });
    });

    btnRight.addEventListener('click', (e) => {
      e.stopPropagation();
      setPosition('right');
      saveStorageData({ vscPosition: 'right' });
    });

    skipToggle.addEventListener('change', (e) => {
      e.stopPropagation();
      setSkipEnabled(skipToggle.checked);
      saveStorageData({ vscSkipEnabled: skipToggle.checked });
    });

    skipInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
    });
    skipInput.addEventListener('keyup', (e) => {
      e.stopPropagation();
    });

    skipInput.addEventListener('input', (e) => {
      e.stopPropagation();
      const val = parseInt(skipInput.value, 10);
      if (!isNaN(val) && val >= 0) {
        skipSeconds = val;
      }
    });

    skipInput.addEventListener('change', (e) => {
      e.stopPropagation();
      let val = parseInt(skipInput.value, 10);
      if (isNaN(val) || val < 0) {
        val = 0;
        skipInput.value = 0;
      }
      skipSeconds = val;
      saveStorageData({ vscSkipSeconds: skipSeconds });
    });

    silenceToggle.addEventListener('change', (e) => {
      e.stopPropagation();
      setSilenceEnabled(silenceToggle.checked);
      saveStorageData({ vscSilenceEnabled: silenceToggle.checked });
    });

    silenceSpeedSlider.addEventListener('input', (e) => {
      e.stopPropagation();
      silenceSpeed = parseFloat(silenceSpeedSlider.value);
      silenceSpeedValText.textContent = `${silenceSpeed}x`;
      if (isSilenced) {
        const allVideos = findVideos(document);
        allVideos.forEach(enforcePlaybackRate);
      }
    });

    silenceSpeedSlider.addEventListener('change', (e) => {
      e.stopPropagation();
      saveStorageData({ vscSilenceSpeed: silenceSpeed });
    });

    eqToggle.addEventListener('change', (e) => {
      e.stopPropagation();
      setEqEnabled(eqToggle.checked);
      saveStorageData({ vscEqEnabled: eqToggle.checked });
    });

    lowSlider.addEventListener('input', (e) => {
      e.stopPropagation();
      eqLow = parseInt(lowSlider.value, 10);
      lowValText.textContent = formatDb(eqLow);
      updateAllAudio();
    });

    lowSlider.addEventListener('change', (e) => {
      e.stopPropagation();
      saveStorageData({ vscEqLow: eqLow });
    });

    highSlider.addEventListener('input', (e) => {
      e.stopPropagation();
      eqHigh = parseInt(highSlider.value, 10);
      highValText.textContent = formatDb(eqHigh);
      updateAllAudio();
    });

    highSlider.addEventListener('change', (e) => {
      e.stopPropagation();
      saveStorageData({ vscEqHigh: eqHigh });
    });

    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setEqEnabled(DEFAULT_EQ_ENABLED);
      eqLow = DEFAULT_EQ_LOW;
      eqHigh = DEFAULT_EQ_HIGH;
      lowSlider.value = DEFAULT_EQ_LOW;
      highSlider.value = DEFAULT_EQ_HIGH;
      lowValText.textContent = formatDb(DEFAULT_EQ_LOW);
      highValText.textContent = formatDb(DEFAULT_EQ_HIGH);
      updateAllAudio();
      saveStorageData({
        vscEqEnabled: DEFAULT_EQ_ENABLED,
        vscEqLow: DEFAULT_EQ_LOW,
        vscEqHigh: DEFAULT_EQ_HIGH
      });

      const originalText = resetBtn.textContent;
      resetBtn.textContent = '✓ Reset to Defaults';
      resetBtn.style.setProperty('background', 'rgba(41, 170, 225, 0.25)', 'important');
      resetBtn.style.setProperty('color', '#29aae1', 'important');
      setTimeout(() => {
        resetBtn.textContent = originalText;
        resetBtn.style.removeProperty('background');
        resetBtn.style.removeProperty('color');
      }, 700);
    });

    // Compressor event handlers
    compToggle.addEventListener('change', (e) => {
      e.stopPropagation();
      setCompEnabled(compToggle.checked);
      saveStorageData({ vscCompEnabled: compToggle.checked });
    });

    threshSlider.addEventListener('input', (e) => {
      e.stopPropagation();
      compThreshold = parseFloat(threshSlider.value);
      threshValText.textContent = `${compThreshold} dB`;
      updateAllAudio();
    });
    threshSlider.addEventListener('change', (e) => {
      e.stopPropagation();
      saveStorageData({ vscCompThreshold: compThreshold });
    });

    ratioSlider.addEventListener('input', (e) => {
      e.stopPropagation();
      compRatio = parseFloat(ratioSlider.value);
      ratioValText.textContent = `${compRatio}:1`;
      updateAllAudio();
    });
    ratioSlider.addEventListener('change', (e) => {
      e.stopPropagation();
      saveStorageData({ vscCompRatio: compRatio });
    });

    gainSlider.addEventListener('input', (e) => {
      e.stopPropagation();
      compGain = parseFloat(gainSlider.value);
      gainValText.textContent = (compGain > 0 ? '+' : '') + compGain + ' dB';
      updateAllAudio();
    });
    gainSlider.addEventListener('change', (e) => {
      e.stopPropagation();
      saveStorageData({ vscCompGain: compGain });
    });

    kneeSlider.addEventListener('input', (e) => {
      e.stopPropagation();
      compKnee = parseFloat(kneeSlider.value);
      kneeValText.textContent = `${compKnee} dB`;
      updateAllAudio();
    });
    kneeSlider.addEventListener('change', (e) => {
      e.stopPropagation();
      saveStorageData({ vscCompKnee: compKnee });
    });

    attackSlider.addEventListener('input', (e) => {
      e.stopPropagation();
      compAttack = parseFloat(attackSlider.value);
      attackValText.textContent = `${compAttack} ms`;
      updateAllAudio();
    });
    attackSlider.addEventListener('change', (e) => {
      e.stopPropagation();
      saveStorageData({ vscCompAttack: compAttack });
    });

    releaseSlider.addEventListener('input', (e) => {
      e.stopPropagation();
      compRelease = parseFloat(releaseSlider.value);
      releaseValText.textContent = `${compRelease} ms`;
      updateAllAudio();
    });
    releaseSlider.addEventListener('change', (e) => {
      e.stopPropagation();
      saveStorageData({ vscCompRelease: compRelease });
    });

    compResetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setCompEnabled(DEFAULT_COMP_ENABLED);
      compThreshold = DEFAULT_COMP_THRESHOLD;
      compRatio = DEFAULT_COMP_RATIO;
      compGain = DEFAULT_COMP_GAIN;
      compKnee = DEFAULT_COMP_KNEE;
      compAttack = DEFAULT_COMP_ATTACK;
      compRelease = DEFAULT_COMP_RELEASE;

      threshSlider.value = DEFAULT_COMP_THRESHOLD;
      ratioSlider.value = DEFAULT_COMP_RATIO;
      gainSlider.value = DEFAULT_COMP_GAIN;
      kneeSlider.value = DEFAULT_COMP_KNEE;
      attackSlider.value = DEFAULT_COMP_ATTACK;
      releaseSlider.value = DEFAULT_COMP_RELEASE;

      threshValText.textContent = `${DEFAULT_COMP_THRESHOLD} dB`;
      ratioValText.textContent = `${DEFAULT_COMP_RATIO}:1`;
      gainValText.textContent = (DEFAULT_COMP_GAIN > 0 ? '+' : '') + DEFAULT_COMP_GAIN + ' dB';
      kneeValText.textContent = `${DEFAULT_COMP_KNEE} dB`;
      attackValText.textContent = `${DEFAULT_COMP_ATTACK} ms`;
      releaseValText.textContent = `${DEFAULT_COMP_RELEASE} ms`;

      updateAllAudio();
      saveStorageData({
        vscCompEnabled: DEFAULT_COMP_ENABLED,
        vscCompThreshold: DEFAULT_COMP_THRESHOLD,
        vscCompRatio: DEFAULT_COMP_RATIO,
        vscCompGain: DEFAULT_COMP_GAIN,
        vscCompKnee: DEFAULT_COMP_KNEE,
        vscCompAttack: DEFAULT_COMP_ATTACK,
        vscCompRelease: DEFAULT_COMP_RELEASE
      });

      const originalText = compResetBtn.textContent;
      compResetBtn.textContent = '✓ Reset to Defaults';
      compResetBtn.style.setProperty('background', 'rgba(41, 170, 225, 0.25)', 'important');
      compResetBtn.style.setProperty('color', '#29aae1', 'important');
      setTimeout(() => {
        compResetBtn.textContent = originalText;
        compResetBtn.style.removeProperty('background');
        compResetBtn.style.removeProperty('color');
      }, 700);
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
    window.vscSkipToggle = skipToggle;
    window.vscSkipSection = skipSection;
    window.vscSkipInput = skipInput;
    window.vscSilenceToggle = silenceToggle;
    window.vscSilenceSection = silenceSection;
    window.vscSilenceSpeedSlider = silenceSpeedSlider;
    window.vscSilenceSpeedValText = silenceSpeedValText;
    window.vscEqToggle = eqToggle;
    window.vscEqSection = eqSection;
    window.vscLowSlider = lowSlider;
    window.vscLowValText = lowValText;
    window.vscHighSlider = highSlider;
    window.vscHighValText = highValText;

    window.vscCompToggle = compToggle;
    window.vscCompSection = compSection;
    window.vscThreshSlider = threshSlider;
    window.vscThreshValText = threshValText;
    window.vscRatioSlider = ratioSlider;
    window.vscRatioValText = ratioValText;
    window.vscGainSlider = gainSlider;
    window.vscGainValText = gainValText;
    window.vscKneeSlider = kneeSlider;
    window.vscKneeValText = kneeValText;
    window.vscAttackSlider = attackSlider;
    window.vscAttackValText = attackValText;
    window.vscReleaseSlider = releaseSlider;
    window.vscReleaseValText = releaseValText;

    applyZoomCompensation();
    requestAnimationFrame(monitorZoom);
    setupMutationObserver();
    loadState();
  }

  function setPosition(pos) {
    currentPosition = pos === 'right' ? 'right' : 'left';
    if (!window.vscHost) return;

    if (currentPosition === 'left') {
      window.vscHost.classList.add('pos-left');
      window.vscHost.classList.remove('pos-right');
      window.vscHost.style.setProperty('left', '0px', 'important');
      window.vscHost.style.setProperty('right', 'auto', 'important');
      window.vscHost.style.setProperty('transform-origin', 'top left', 'important');
    } else {
      window.vscHost.classList.remove('pos-left');
      window.vscHost.classList.add('pos-right');
      window.vscHost.style.setProperty('right', '0px', 'important');
      window.vscHost.style.setProperty('left', 'auto', 'important');
      window.vscHost.style.setProperty('transform-origin', 'top right', 'important');
    }

    if (window.vscSegLeft && window.vscSegRight) {
      window.vscSegLeft.classList.toggle('active', currentPosition === 'left');
      window.vscSegRight.classList.toggle('active', currentPosition === 'right');
    }
  }

  function setShowControls() {
    showControls = true;
    if (window.vscSpeeds) {
      window.vscSpeeds.classList.remove('hidden');
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
    saveStorageData({ key: rate.toString() });
  }

  function cycleSpeed(isDown) {
    let currentIndex = PRESETS.indexOf(currentSpeed);
    if (currentIndex === -1) {
      currentIndex = 0;
      let minDiff = Math.abs(currentSpeed - PRESETS[0]);
      for (let i = 1; i < PRESETS.length; i++) {
        const diff = Math.abs(currentSpeed - PRESETS[i]);
        if (diff < minDiff) {
          minDiff = diff;
          currentIndex = i;
        }
      }
    }

    const nextIndex = isDown
      ? (currentIndex + 1) % PRESETS.length
      : (currentIndex - 1 + PRESETS.length) % PRESETS.length;

    setSpeed(PRESETS[nextIndex]);
  }

  function setEqEnabled(enabled) {
    eqEnabled = Boolean(enabled);
    if (window.vscEqToggle) {
      window.vscEqToggle.checked = eqEnabled;
    }
    if (window.vscEqSection) {
      window.vscEqSection.classList.toggle('vsc-eq-disabled', !eqEnabled);
    }
    updateAllAudio();
  }

  function setCompEnabled(enabled) {
    compEnabled = Boolean(enabled);
    if (window.vscCompToggle) {
      window.vscCompToggle.checked = compEnabled;
    }
    if (window.vscCompSection) {
      window.vscCompSection.classList.toggle('vsc-comp-disabled', !compEnabled);
    }
    updateAllAudio();
  }

  function setSkipEnabled(enabled) {
    skipEnabled = Boolean(enabled);
    if (window.vscSkipToggle) {
      window.vscSkipToggle.checked = skipEnabled;
    }
    if (window.vscSkipSection) {
      window.vscSkipSection.classList.toggle('vsc-skip-disabled', !skipEnabled);
    }
  }

  function setSilenceEnabled(enabled) {
    silenceEnabled = Boolean(enabled);
    if (!silenceEnabled && isSilenced) {
      isSilenced = false;
      updateSilenceIndicator();
      const allVideos = findVideos(document);
      allVideos.forEach((v) => {
        enforcePlaybackRate(v);
        if (connectedVideos.has(v)) {
          fadeSilenceAudio(connectedVideos.get(v), true);
        }
      });
    }
    if (window.vscSilenceToggle) {
      window.vscSilenceToggle.checked = silenceEnabled;
    }
    if (window.vscSilenceSection) {
      window.vscSilenceSection.classList.toggle('vsc-silence-disabled', !silenceEnabled);
    }
    updateAllAudio();
  }

  function updateActiveButton(rate) {
    if (!window.vscShadow) return;
    window.vscShadow.querySelectorAll('.vsc-speeds .vsc-btn').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.speed) === rate);
    });
  }

  function loadState() {
    getStorageData([
      'key', 'vscPosition',
      'vscSkipEnabled', 'vscSkipSeconds',
      'vscSilenceEnabled', 'vscSilenceSpeed',
      'vscEqEnabled', 'vscEqLow', 'vscEqHigh',
      'vscCompEnabled', 'vscCompThreshold', 'vscCompRatio', 'vscCompGain', 'vscCompKnee', 'vscCompAttack', 'vscCompRelease'
    ], (r) => {
      r = r || {};
      const rate = r.key ? parseFloat(r.key) : 1;
      updateActiveButton(rate);
      setPlaybackRate(rate);

      const pos = r.vscPosition || DEFAULT_POSITION;
      setPosition(pos);
      setShowControls();

      // Skip Intro
      const skipOn = r.vscSkipEnabled !== undefined ? Boolean(r.vscSkipEnabled) : DEFAULT_SKIP_ENABLED;
      setSkipEnabled(skipOn);

      skipSeconds = r.vscSkipSeconds !== undefined ? Math.max(0, parseInt(r.vscSkipSeconds, 10) || 0) : DEFAULT_SKIP_SECONDS;
      if (window.vscSkipInput) window.vscSkipInput.value = skipSeconds;

      // Skip Silence
      const silenceOn = r.vscSilenceEnabled !== undefined ? Boolean(r.vscSilenceEnabled) : DEFAULT_SILENCE_ENABLED;
      setSilenceEnabled(silenceOn);

      silenceSpeed = r.vscSilenceSpeed !== undefined ? Math.max(4, Math.min(10, parseFloat(r.vscSilenceSpeed) || DEFAULT_SILENCE_SPEED)) : DEFAULT_SILENCE_SPEED;
      if (window.vscSilenceSpeedSlider) window.vscSilenceSpeedSlider.value = silenceSpeed;
      if (window.vscSilenceSpeedValText) window.vscSilenceSpeedValText.textContent = `${silenceSpeed}x`;

      // EQ
      const eqOn = r.vscEqEnabled !== undefined ? Boolean(r.vscEqEnabled) : DEFAULT_EQ_ENABLED;
      setEqEnabled(eqOn);

      eqLow = r.vscEqLow !== undefined ? parseInt(r.vscEqLow, 10) : DEFAULT_EQ_LOW;
      if (window.vscLowSlider) window.vscLowSlider.value = eqLow;
      if (window.vscLowValText) window.vscLowValText.textContent = (eqLow > 0 ? '+' : '') + eqLow + ' dB';

      eqHigh = r.vscEqHigh !== undefined ? parseInt(r.vscEqHigh, 10) : DEFAULT_EQ_HIGH;
      if (window.vscHighSlider) window.vscHighSlider.value = eqHigh;
      if (window.vscHighValText) window.vscHighValText.textContent = (eqHigh > 0 ? '+' : '') + eqHigh + ' dB';

      // Compressor
      const compOn = r.vscCompEnabled !== undefined ? Boolean(r.vscCompEnabled) : DEFAULT_COMP_ENABLED;
      setCompEnabled(compOn);

      compThreshold = r.vscCompThreshold !== undefined ? parseFloat(r.vscCompThreshold) : DEFAULT_COMP_THRESHOLD;
      if (window.vscThreshSlider) window.vscThreshSlider.value = compThreshold;
      if (window.vscThreshValText) window.vscThreshValText.textContent = `${compThreshold} dB`;

      compRatio = r.vscCompRatio !== undefined ? parseFloat(r.vscCompRatio) : DEFAULT_COMP_RATIO;
      if (window.vscRatioSlider) window.vscRatioSlider.value = compRatio;
      if (window.vscRatioValText) window.vscRatioValText.textContent = `${compRatio}:1`;

      compGain = r.vscCompGain !== undefined ? parseFloat(r.vscCompGain) : DEFAULT_COMP_GAIN;
      if (window.vscGainSlider) window.vscGainSlider.value = compGain;
      if (window.vscGainValText) window.vscGainValText.textContent = (compGain > 0 ? '+' : '') + compGain + ' dB';

      compKnee = r.vscCompKnee !== undefined ? parseFloat(r.vscCompKnee) : DEFAULT_COMP_KNEE;
      if (window.vscKneeSlider) window.vscKneeSlider.value = compKnee;
      if (window.vscKneeValText) window.vscKneeValText.textContent = `${compKnee} dB`;

      compAttack = r.vscCompAttack !== undefined ? parseFloat(r.vscCompAttack) : DEFAULT_COMP_ATTACK;
      if (window.vscAttackSlider) window.vscAttackSlider.value = compAttack;
      if (window.vscAttackValText) window.vscAttackValText.textContent = `${compAttack} ms`;

      compRelease = r.vscCompRelease !== undefined ? parseFloat(r.vscCompRelease) : DEFAULT_COMP_RELEASE;
      if (window.vscReleaseSlider) window.vscReleaseSlider.value = compRelease;
      if (window.vscReleaseValText) window.vscReleaseValText.textContent = `${compRelease} ms`;

      updateAllAudio();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' || area === 'local') {
      if (changes.key) {
        const rate = parseFloat(changes.key.newValue);
        updateActiveButton(rate);
        setPlaybackRate(rate);
      }
      if (changes.vscPosition) {
        setPosition(changes.vscPosition.newValue);
      }
      if (changes.vscSkipEnabled !== undefined) {
        setSkipEnabled(changes.vscSkipEnabled.newValue);
      }
      if (changes.vscSkipSeconds !== undefined) {
        skipSeconds = Math.max(0, parseInt(changes.vscSkipSeconds.newValue, 10) || 0);
        if (window.vscSkipInput) window.vscSkipInput.value = skipSeconds;
      }
      if (changes.vscSilenceEnabled !== undefined) {
        setSilenceEnabled(changes.vscSilenceEnabled.newValue);
      }
      if (changes.vscSilenceSpeed !== undefined) {
        silenceSpeed = Math.max(4, Math.min(10, parseFloat(changes.vscSilenceSpeed.newValue) || DEFAULT_SILENCE_SPEED));
        if (window.vscSilenceSpeedSlider) window.vscSilenceSpeedSlider.value = silenceSpeed;
        if (window.vscSilenceSpeedValText) window.vscSilenceSpeedValText.textContent = `${silenceSpeed}x`;
        if (isSilenced) {
          const allVideos = findVideos(document);
          allVideos.forEach(enforcePlaybackRate);
        }
      }
      if (changes.vscEqEnabled !== undefined) {
        setEqEnabled(changes.vscEqEnabled.newValue);
      }
      if (changes.vscEqLow !== undefined) {
        eqLow = parseInt(changes.vscEqLow.newValue, 10);
        if (window.vscLowSlider) window.vscLowSlider.value = eqLow;
        if (window.vscLowValText) window.vscLowValText.textContent = (eqLow > 0 ? '+' : '') + eqLow + ' dB';
        updateAllAudio();
      }
      if (changes.vscEqHigh !== undefined) {
        eqHigh = parseInt(changes.vscEqHigh.newValue, 10);
        if (window.vscHighSlider) window.vscHighSlider.value = eqHigh;
        if (window.vscHighValText) window.vscHighValText.textContent = (eqHigh > 0 ? '+' : '') + eqHigh + ' dB';
        updateAllAudio();
      }
      if (changes.vscCompEnabled !== undefined) {
        setCompEnabled(changes.vscCompEnabled.newValue);
      }
      if (changes.vscCompThreshold !== undefined) {
        compThreshold = parseFloat(changes.vscCompThreshold.newValue);
        if (window.vscThreshSlider) window.vscThreshSlider.value = compThreshold;
        if (window.vscThreshValText) window.vscThreshValText.textContent = `${compThreshold} dB`;
        updateAllAudio();
      }
      if (changes.vscCompRatio !== undefined) {
        compRatio = parseFloat(changes.vscCompRatio.newValue);
        if (window.vscRatioSlider) window.vscRatioSlider.value = compRatio;
        if (window.vscRatioValText) window.vscRatioValText.textContent = `${compRatio}:1`;
        updateAllAudio();
      }
      if (changes.vscCompGain !== undefined) {
        compGain = parseFloat(changes.vscCompGain.newValue);
        if (window.vscGainSlider) window.vscGainSlider.value = compGain;
        if (window.vscGainValText) window.vscGainValText.textContent = (compGain > 0 ? '+' : '') + compGain + ' dB';
        updateAllAudio();
      }
      if (changes.vscCompKnee !== undefined) {
        compKnee = parseFloat(changes.vscCompKnee.newValue);
        if (window.vscKneeSlider) window.vscKneeSlider.value = compKnee;
        if (window.vscKneeValText) window.vscKneeValText.textContent = `${compKnee} dB`;
        updateAllAudio();
      }
      if (changes.vscCompAttack !== undefined) {
        compAttack = parseFloat(changes.vscCompAttack.newValue);
        if (window.vscAttackSlider) window.vscAttackSlider.value = compAttack;
        if (window.vscAttackValText) window.vscAttackValText.textContent = `${compAttack} ms`;
        updateAllAudio();
      }
      if (changes.vscCompRelease !== undefined) {
        compRelease = parseFloat(changes.vscCompRelease.newValue);
        if (window.vscReleaseSlider) window.vscReleaseSlider.value = compRelease;
        if (window.vscReleaseValText) window.vscReleaseValText.textContent = `${compRelease} ms`;
        updateAllAudio();
      }
    }
  });

  if (document.body) {
    createOverlay();
  } else {
    document.addEventListener('DOMContentLoaded', createOverlay);
  }
})();

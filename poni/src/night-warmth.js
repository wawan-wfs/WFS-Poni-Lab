(() => {
  'use strict';

  const fadeDuration = 45 * 60_000;
  const refreshEvery = 6 * 60 * 60_000;
  const invoke = window.__TAURI__.core.invoke;
  const surface = document.getElementById('surface');
  let enabled = false;
  let strength = 60;
  let transitions = [];
  let request = 0;
  let previewStrength = null;
  let previewTimer;

  function fallbackTransitions(now) {
    const local = new Date(now);
    return [-1, 0, 1].flatMap(offset => [false, true].map(dark => ({
      at: new Date(local.getFullYear(), local.getMonth(), local.getDate() + offset, dark ? 18 : 6).getTime(),
      dark,
    })));
  }

  function fraction(now) {
    const events = transitions.some(event => event.at > now) && transitions.some(event => event.at <= now)
      ? transitions : fallbackTransitions(now);
    const last = events.findLast(event => event.at <= now);
    const progress = Math.min(1, (now - last.at) / fadeDuration);
    const eased = progress * progress * (3 - 2 * progress);
    return last.dark ? eased : 1 - eased;
  }

  function draw() {
    const tint = previewStrength ?? (enabled ? strength * fraction(Date.now()) : 0);
    surface.style.setProperty('--ambient-tint', (tint / 10).toFixed(2) + '%');
  }

  async function refresh() {
    const version = ++request;
    if (!enabled) return;
    let days;
    try {
      days = await invoke('get_poni_daylight');
    } catch {
      days = [];
    }
    if (version !== request) return;
    transitions = (Array.isArray(days) ? days : []).flatMap(({ sunrise_ms, sunset_ms }) => [
      { at: sunrise_ms, dark: false }, { at: sunset_ms, dark: true },
    ]).sort((a, b) => a.at - b.at);
    draw();
  }

  function configure(panel) {
    const initial = enabled;
    enabled = Boolean(panel.warm_night);
    strength = panel.warmth ?? 60;
    if (initial !== enabled) {
      transitions = [];
      void refresh();
    }
    draw();
  }

  window.poniNightWarmth = { configure };
  const listen = window.__TAURI__.event.listen;
  listen('poni-night-warmth-preview', event => {
    previewStrength = event.payload;
    clearTimeout(previewTimer);
    draw();
    previewTimer = setTimeout(() => {
      previewStrength = null;
      draw();
    }, 2600);
  }).catch(console.error);
  listen('poni-daylight-location-changed', () => {
    transitions = [];
    draw();
    void refresh();
  }).catch(console.error);
  setInterval(draw, 15_000);
  setInterval(refresh, refreshEvery);
})();

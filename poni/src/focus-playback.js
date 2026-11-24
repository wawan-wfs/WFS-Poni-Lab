(() => {
  'use strict';
  const { build, kinds } = window.poniFocusSound;
  const options = [
    ['off', 'Off'], ['white', 'White noise'], ['pink', 'Pink noise'], ['brown', 'Brown noise'],
    ['rain', 'Rain'], ['waves', 'Ocean waves'], ['wind', 'Wind'], ['fire', 'Fireplace'], ['cafe', 'Café'],
  ];
  let context, volume, current, closeTimer, updateTimer;
  let session, preview;

  function fadeOut(sound, seconds) {
    const time = context.currentTime;
    const gain = sound.fade.gain;
    if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(time);
    else {
      gain.cancelScheduledValues(time);
      gain.setValueAtTime(gain.value, time);
    }
    gain.linearRampToValueAtTime(0, time + seconds);
    for (const source of sound.sources) source.stop(time + seconds + 0.05);
    setTimeout(() => sound.fade.disconnect(), (seconds + 0.3) * 1000);
  }

  function stop() {
    if (!current) return;
    fadeOut(current, 1.5);
    current = null;
    closeTimer = setTimeout(() => {
      const closing = context;
      context = volume = null;
      void closing.close().catch(() => {});
    }, 1900);
  }

  function play(kind, percent) {
    clearTimeout(closeTimer);
    if (!context) {
      context = new AudioContext({ latencyHint: 'playback' });
      volume = context.createGain();
      volume.gain.value = 0;
      volume.connect(context.destination);
    }
    if (context.state === 'suspended') void context.resume().catch(() => {});
    const time = context.currentTime;
    volume.gain.setTargetAtTime((percent / 100) ** 2, time, 0.08);
    if (current?.kind === kind) return;
    const fade = context.createGain();
    fade.gain.setValueAtTime(0, time);
    fade.gain.linearRampToValueAtTime(1, time + (current ? 0.8 : 2.5));
    fade.connect(volume);
    const sources = build(context, fade, kind, crypto.getRandomValues(new Uint32Array(1))[0], time);
    if (current) fadeOut(current, 0.8);
    current = { kind, fade, sources };
  }

  function permitsAudio(state, now) {
    return state?.ends_at_ms > now && (state.phase === 'focus' || state.focus_sound_breaks);
  }

  function sync() {
    clearTimeout(updateTimer);
    const now = Date.now();
    const playback = permitsAudio(session, now) ? session : preview?.ends_at_ms > now ? preview : null;
    if (!playback || !kinds.includes(playback.focus_sound) || !playback.focus_sound_volume) {
      stop();
      return;
    }
    try {
      play(playback.focus_sound, playback.focus_sound_volume);
    } catch (error) {
      console.error('Pomodoro background audio unavailable', error);
    }
    updateTimer = setTimeout(sync, Math.min(2_147_483_647, playback.ends_at_ms - now + 10));
  }

  function previewSettings(timer) {
    const state = { ...timer.settings, phase: timer.phase, ends_at_ms: timer.ends_at_ms };
    preview = permitsAudio(state, Date.now()) ? null : { ...state, ends_at_ms: Date.now() + 4000 };
    sync();
  }

  async function listen() {
    let receivedUpdate = false;
    await window.__TAURI__.event.listen('poni-pomodoro-playback-changed', event => {
      receivedUpdate = true;
      session = event.payload;
      sync();
    });
    const saved = await window.__TAURI__.core.invoke('get_pomodoro_playback');
    if (!receivedUpdate) {
      session = saved;
      sync();
    }
  }

  document.addEventListener('pointerdown', () => {
    if (current && context.state === 'suspended') void context.resume().catch(() => {});
  }, true);

  window.poniFocusPlayback = { options, previewSettings, listen, get session() { return session; } };
})();

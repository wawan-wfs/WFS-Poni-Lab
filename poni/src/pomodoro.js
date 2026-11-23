(() => {
  'use strict';

  const labels = { focus: 'Focus', short_break: 'Short break', long_break: 'Long break' };
  let context;
  let timer;
  let state;
  let busy = false;

  function mount(page) {
    page.innerHTML = `
      <div class="pomo-layout">
        <div class="pomo-face" data-pomo-clock>
          <b data-pomo-time>--:--</b>
          <span data-pomo-phase></span>
        </div>
        <div class="pomo-main">
          <div class="pomo-controls" aria-label="Pomodoro phase">
            <button type="button" data-phase="focus">Focus</button>
            <button type="button" data-phase="short_break">Short break</button>
            <button type="button" data-phase="long_break">Long break</button>
          </div>
          <div class="pomo-controls">
            <button type="button" data-pomo-toggle>Start</button>
            <button type="button" data-pomo-action="reset">Reset</button>
            <button type="button" data-pomo-action="skip">Skip</button>
            <span data-pomo-cycle></span>
          </div>
          <div class="pomo-summary">
            <span data-pomo-today></span>
            <span data-pomo-next></span>
          </div>
          <div class="pomo-controls">
            <button type="button" data-pomo-view="countdown">Timer</button>
            <button type="button" data-pomo-view="stopwatch">Stopwatch</button>
            <label>Background sound <select data-pomo-sound aria-label="Background sound"></select></label>
            <button type="button" data-pomo-options aria-expanded="false">Settings</button>
          </div>
        </div>
      </div>
      <form class="pomo-settings" hidden>
        <label>Focus (min) <input name="focus_minutes" type="number" min="5" max="90" required></label>
        <label>Short break (min) <input name="short_minutes" type="number" min="1" max="30" required></label>
        <label>Long break (min) <input name="long_minutes" type="number" min="5" max="60" required></label>
        <label>Sessions per cycle <input name="cycle_length" type="number" min="2" max="8" required></label>
        <label><input name="auto_break" type="checkbox"> Start breaks automatically</label>
        <label><input name="auto_focus" type="checkbox"> Start focus automatically</label>
        <button type="submit">Save settings</button>
      </form>
      <p data-pomo-error role="status" aria-live="polite"></p>
    `;
    const find = selector => page.querySelector(selector);
    const form = find('form');
    context = {
      page,
      form,
      clock: find('[data-pomo-clock]'),
      time: find('[data-pomo-time]'),
      phase: find('[data-pomo-phase]'),
      toggle: find('[data-pomo-toggle]'),
      cycle: find('[data-pomo-cycle]'),
      today: find('[data-pomo-today]'),
      next: find('[data-pomo-next]'),
      sound: find('[data-pomo-sound]'),
      error: find('[data-pomo-error]'),
      phaseButtons: [...page.querySelectorAll('[data-phase]')],
    };
    const options = find('[data-pomo-options]');
    const submit = form.querySelector('[type="submit"]');
    context.controls = [context.toggle, context.sound, ...context.phaseButtons, ...page.querySelectorAll('[data-pomo-action]'), submit];
    for (const [value, label] of window.poniFocusPlayback.options) {
      context.sound.add(new Option(label, value));
    }
    context.sound.addEventListener('change', () => {
      void run('pomodoro_settings', { settings: { focus_sound: context.sound.value } }, true, true);
    });
    context.toggle.addEventListener('click', () => run('pomodoro_action', { action: 'toggle' }));
    for (const button of context.phaseButtons) {
      button.addEventListener('click', () => run('pomodoro_action', { action: 'phase', phase: button.dataset.phase }));
    }
    for (const button of page.querySelectorAll('[data-pomo-action]')) {
      button.addEventListener('click', () => run('pomodoro_action', { action: button.dataset.pomoAction }));
    }
    for (const button of page.querySelectorAll('[data-pomo-view]')) {
      button.addEventListener('click', () => {
        document.querySelector('.tab[data-page="timer"]')?.click();
        document.querySelector(`#page-timer [data-timer-mode="${button.dataset.pomoView}"]`)?.click();
      });
    }
    options.addEventListener('click', () => {
      if (form.hidden && state) syncSettings();
      form.hidden = !form.hidden;
      options.setAttribute('aria-expanded', String(!form.hidden));
      if (!form.hidden) form.scrollIntoView({ block: 'nearest' });
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      const settings = {};
      for (const input of form.querySelectorAll('input')) {
        settings[input.name] = input.type === 'checkbox' ? input.checked : input.valueAsNumber;
      }
      run('pomodoro_settings', { settings }, true);
    });
    for (const name of ['poni-pomodoro-settings-changed', 'poni-pomodoro-timer-break']) {
      window.__TAURI__.event.listen(name, () => {
        if (timer) void run('pomodoro_state', undefined, true);
      }).catch(error => { context.error.textContent = String(error); });
    }
    render();
  }

  function syncSettings() {
    context.sound.value = state.settings.focus_sound || 'off';
    for (const input of context.form.querySelectorAll('input')) {
      const value = state.settings[input.name];
      if (input.type === 'checkbox') input.checked = value;
      else input.value = value;
    }
  }

  async function run(command, args, sync = false, preview = false) {
    if (busy) return;
    busy = true;
    render();
    try {
      const first = !state;
      state = await window.__TAURI__.core.invoke(command, args);
      context.error.textContent = '';
      if (first || sync) syncSettings();
      if (preview) window.poniFocusPlayback.previewSettings(state);
    } catch (error) {
      context.error.textContent = String(error);
    } finally {
      busy = false;
      render();
    }
  }

  function render() {
    if (!context) return;
    for (const control of context.controls) control.disabled = busy || !state;
    if (!state) return;
    const now = Date.now();
    const remaining = state.ends_at_ms == null ? state.remaining_ms : Math.max(0, state.ends_at_ms - now);
    const seconds = Math.ceil(remaining / 1000);
    context.time.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    context.phase.textContent = labels[state.phase];
    const elapsed = Math.max(0, Math.min(1, 1 - remaining / state.total_ms));
    context.clock.style.setProperty('--pomo-angle', `${elapsed * 360}deg`);
    context.clock.dataset.phase = state.phase;
    context.toggle.textContent = state.ends_at_ms != null ? 'Pause' : remaining === state.total_ms ? 'Start' : 'Resume';
    for (const button of context.phaseButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.phase === state.phase));
    }
    context.cycle.textContent = `${state.cycle} / ${state.settings.cycle_length}`;
    const today = new Date(now).toDateString();
    const sessions = state.completed.filter(item => new Date(item.at_ms).toDateString() === today);
    const minutes = sessions.reduce((total, item) => total + item.focus_ms, 0) / 60_000;
    context.today.textContent = `Today · ${sessions.length} sessions · ${Math.round(minutes)} min focused`;
    if (state.ends_at_ms != null) {
      const end = new Date(state.ends_at_ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      context.next.textContent = `Ends at ${end}`;
    } else {
      context.next.textContent = remaining === state.total_ms ? 'Ready' : 'Paused';
    }
  }

  function show() {
    clearInterval(timer);
    run('pomodoro_state');
    timer = setInterval(() => {
      if (state?.ends_at_ms != null && state.ends_at_ms <= Date.now()) run('pomodoro_state');
      else render();
    }, 500);
  }

  function hide() {
    clearInterval(timer);
    timer = null;
  }

  window.poniModules ||= {};
  window.poniModules.pomodoro = { mount, show, hide };
})();

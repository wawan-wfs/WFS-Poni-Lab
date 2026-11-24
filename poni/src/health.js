(() => {
  'use strict';

  const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
  const measures = [
    ['breaks', 'Movement breaks', 'break_goal', '#30d158'],
    ['water', 'Glasses of water', 'water_goal', '#64d2ff'],
    ['mindful', 'Mindful minutes', 'mindful_goal', '#bf5af2'],
  ];
  const stretches = [
    ['Neck turns', 'Gently turn your head left and right.'],
    ['Shoulder shrugs', 'Lift your shoulders, hold briefly, then release.'],
    ['Chest opener', 'Draw your shoulders back and hold gently.'],
    ['Seated twist', 'Sit tall and turn gently to each side.'],
    ['Wrist stretch', 'Extend one arm, gently stretch the wrist, then switch sides.'],
    ['Stand and walk', 'Stand up and take a short walk.'],
  ];
  const breathing = [
    ['Breathe in', 4, 1.6],
    ['Hold', 4, 1.6],
    ['Breathe out', 6, 1],
    ['Hold', 2, 1],
  ];
  const defaults = { break_goal: 6, water_goal: 8, mindful_goal: 5, eye_duration: 20 };
  const durations = { stretch: 120, breathing: 60 };
  let preferences = defaults;
  let page;
  let state;
  let guide;
  let timer;
  let queue = Promise.resolve();

  function localDay() {
    const now = new Date();
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000;
  }

  function update(action, message = '') {
    queue = queue.then(async () => {
      try {
        state = await invoke(action ? 'health_record' : 'health_state', {
          day: localDay(),
          ...(action ? { action } : {}),
        });
        page.querySelector('.health-status').textContent = message;
        renderTotals();
      } catch (error) {
        page.querySelector('.health-status').textContent = error instanceof Error ? error.message : String(error);
      }
    });
    return queue;
  }

  function renderTotals() {
    for (const [key, , preference] of measures) {
      const goal = preferences[preference];
      const value = state.today[key];
      const entry = page.querySelector(`[data-health-measure="${key}"]`);
      entry.querySelector('strong').textContent = `${value} / ${goal}`;
      entry.querySelector('.health-gauge').style.setProperty('--progress', `${Math.min(value / goal, 1) * 100}%`);
    }
    page.querySelector('[data-health-action="water_remove"]').disabled = state.today.water === 0;
    page.querySelector('[data-health-action="water_add"]').disabled = false;
    const lastBreak = state.last_break_ms ? new Date(state.last_break_ms).toLocaleString() : '—';
    page.querySelector('.health-last').textContent = `Last break ${lastBreak} · Streak ${state.streak} days`;
  }

  function stopGuide() {
    clearInterval(timer);
    guide = null;
    page.querySelector('.health-guide').hidden = true;
    page.querySelector('.health-actions').hidden = false;
  }

  function startGuide(kind) {
    if (guide) return;
    const duration = kind === 'eye' ? preferences.eye_duration : durations[kind];
    guide = { kind, duration, started: Date.now(), phase: null };
    page.querySelector('.health-status').textContent = '';
    page.querySelector('.health-actions').hidden = true;
    page.querySelector('.health-guide').hidden = false;
    page.querySelector('.health-orb').style.transform = 'scale(1)';
    tickGuide();
    timer = setInterval(tickGuide, 200);
  }

  function tickGuide() {
    if (!guide) return;
    const {kind, duration, started} = guide;
    const seconds = Math.max(0, (Date.now() - started) / 1000);
    const remaining = Math.ceil(duration - seconds);
    if (remaining <= 0) {
      stopGuide();
      if (kind === 'eye') {
        page.querySelector('.health-status').textContent = 'Eye break complete.';
      } else {
        update(kind, kind === 'stretch' ? 'Movement break logged.' : 'One mindful minute logged.');
      }
      return;
    }
    const title = page.querySelector('.health-guide-title');
    const instruction = page.querySelector('.health-instruction');
    const orb = page.querySelector('.health-orb');
    orb.hidden = kind !== 'breathing';
    if (kind === 'stretch') {
      const index = Math.floor(seconds / 20);
      title.textContent = stretches[index][0];
      instruction.textContent = stretches[index][1];
    } else if (kind === 'eye') {
      title.textContent = 'Eye break';
      instruction.textContent = 'Look at something around 20 feet (6 metres) away.';
    } else {
      let phaseTime = seconds % 16;
      const phase = breathing.find(([, time]) => {
        if (phaseTime < time) return true;
        phaseTime -= time;
        return false;
      });
      title.textContent = phase[0];
      instruction.textContent = 'Follow the circle at a comfortable pace.';
      if (guide.phase !== phase) {
        orb.style.transitionDuration = `${phase[1]}s`;
        orb.style.transform = `scale(${phase[2]})`;
        guide.phase = phase;
      }
    }
    page.querySelector('.health-countdown').textContent = `${remaining}s`;
    page.querySelector('.health-progress').value = seconds / duration;
  }

  function mount(container) {
    page = container;
    page.innerHTML = `
      <div class="health-metrics">${measures.map(([key, label, , color]) => `
        <div data-health-measure="${key}" class="health-metric">
          <span class="health-gauge" aria-hidden="true" style="--gauge-color:${color}"></span>
          <span>${label}<strong>—</strong></span>
        </div>`).join('')}
      </div>
      <div class="health-actions">
        <div class="health-water">
          <button type="button" data-health-action="water_remove" aria-label="Remove glass of water" disabled>−</button>
          <button type="button" data-health-action="water_add" aria-label="Log glass of water" disabled>+ Water</button>
        </div>
        <button type="button" data-health-guide="stretch">Movement break</button>
        <button type="button" data-health-guide="breathing">Breathing</button>
        <button type="button" data-health-guide="eye">Eye break</button>
      </div>
      <div class="health-guide" hidden>
        <span class="health-orb" aria-hidden="true"></span>
        <div class="health-guide-copy">
          <strong class="health-guide-title"></strong> <span class="health-countdown"></span>
          <div class="health-instruction"></div>
          <progress class="health-progress" max="1" value="0" aria-label="Guide progress"></progress>
        </div>
        <button type="button" class="health-end">End</button>
      </div>
      <div class="health-footer">
        <span class="health-last"></span>
        <span class="health-status" role="status"></span>
      </div>`;
    page.querySelectorAll('[data-health-action]').forEach(button => {
      button.addEventListener('click', () => update(button.dataset.healthAction));
    });
    page.querySelectorAll('[data-health-guide]').forEach(button => {
      button.addEventListener('click', () => startGuide(button.dataset.healthGuide));
    });
    page.querySelector('.health-end').addEventListener('click', stopGuide);
  }

  window.poniModules ||= {};
  window.poniModules.health = {
    mount,
    show: () => update(),
    configure(value) {
      preferences = { ...defaults, ...value };
      if (page && state) renderTotals();
    },
  };
})();

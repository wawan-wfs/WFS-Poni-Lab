'use strict';

(() => {
  const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
  let container;
  let interval;
  let week = false;
  let busy = false;
  let generation = 0;

  const duration = seconds => {
    const minutes = Math.floor(seconds / 60);
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` :
      minutes ? `${minutes}m` : `${seconds}s`;
  };

  function report(message) {
    container.querySelector('.st-status').textContent = message;
  }

  async function refresh() {
    const request = ++generation;
    try {
      const snapshot = await invoke('screentime_summary', { week });
      if (request !== generation) return;
      const toggle = container.querySelector('.st-toggle');
      toggle.disabled = !snapshot.available || busy;
      toggle.checked = snapshot.enabled;
      container.querySelector('.st-total').textContent = duration(snapshot.total);
      container.querySelector('.st-switches').textContent = `${snapshot.switches} app switches`;
      const bars = container.querySelector('.st-hourly');
      bars.replaceChildren();
      const max = Math.max(1, ...snapshot.hours);
      snapshot.hours.forEach((seconds, hour) => {
        const bar = document.createElement('meter');
        bar.max = max;
        bar.value = seconds;
        bar.title = `${hour}:00 · ${duration(seconds)}`;
        bar.setAttribute('aria-label', bar.title);
        bars.append(bar);
      });
      const list = container.querySelector('.st-apps');
      list.replaceChildren();
      for (const [app, seconds] of snapshot.apps.slice(0, 10)) {
        const row = document.createElement('li');
        const name = document.createElement('span');
        const time = document.createElement('strong');
        name.textContent = app;
        time.textContent = duration(seconds);
        row.append(name, time);
        list.append(row);
      }
      report(snapshot.available ? (snapshot.apps.length ? '' : 'No activity recorded') : 'Tracking is available on Windows.');
    } catch (error) {
      if (request === generation) report(String(error));
    }
  }

  async function update(command, args) {
    if (busy) return;
    busy = true;
    container.querySelector('.st-toggle').disabled = true;
    container.querySelector('.st-clear').disabled = true;
    try {
      await invoke(command, args);
      busy = false;
      await refresh();
    } catch (error) {
      busy = false;
      await refresh();
      report(String(error));
    } finally {
      container.querySelector('.st-clear').disabled = false;
    }
  }

  function mount(page) {
    container = page;
    page.innerHTML = `
      <div class="st-toolbar">
        <label><input class="st-toggle" type="checkbox" disabled> Track screen time</label>
        <label>Period <select class="st-period"><option value="today">Today</option><option value="week">7 days</option></select></label>
        <button type="button" class="st-clear">Clear history</button>
      </div>
      <p class="st-note">Active app names and totals stay on this device.</p>
      <div class="st-overview"><strong class="st-total">0s</strong><span class="st-switches"></span></div>
      <div class="st-hourly" aria-label="Usage by hour"></div>
      <ul class="st-apps" aria-label="Most used apps"></ul>
      <p class="st-status" role="status"></p>`;
    page.querySelector('.st-toggle').addEventListener('change', event =>
      void update('set_screentime_enabled', { enabled: event.target.checked }));
    page.querySelector('.st-period').addEventListener('change', event => {
      week = event.target.value === 'week';
      void refresh();
    });
    page.querySelector('.st-clear').addEventListener('click', () => {
      if (window.confirm('Clear all Screen Time history?')) void update('clear_screentime');
    });
    window.__TAURI__.event.listen('poni-screentime-changed', () => {
      if (interval && !busy) void refresh();
    }).catch(error => report(String(error)));
  }

  function hide() {
    clearInterval(interval);
    interval = undefined;
    generation++;
  }

  function show() {
    hide();
    void refresh();
    interval = setInterval(() => { if (!busy) void refresh(); }, 10000);
  }

  (window.poniModules ||= {}).screentime = { mount, show, hide };
})();

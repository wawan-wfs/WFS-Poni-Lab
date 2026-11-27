(() => {
  'use strict';

  const closed = document.querySelector('#closed');
  const clock = closed.querySelector('.clock');
  const activity = document.querySelector('#battery-activity');
  const indicators = [...document.querySelectorAll('.battery-indicator')];
  const defaults = {
    enabled: true, show_percentage: true, icon: 'bar', charging_activity: true, low_threshold: 20,
  };
  let settings = defaults;
  let power = null;
  let timeout;

  function describe() {
    if (power.plugged_in) return power.percent === 100 ? 'Fully charged' : power.charging ? 'Charging' : 'Plugged in';
    if (power.seconds_remaining > 0) {
      const hours = Math.floor(power.seconds_remaining / 3600);
      const minutes = Math.floor(power.seconds_remaining % 3600 / 60);
      return `${hours}h ${minutes}m remaining`;
    }
    return power.plugged_in === false ? 'On battery' : 'Power source unknown';
  }

  function render() {
    const enabled = Boolean(settings.enabled && power);
    for (const el of indicators) {
      el.hidden = !enabled;
      if (!enabled) continue;
      const known = Number.isFinite(power.percent);
      el.classList.toggle('battery-ring', settings.icon === 'ring');
      el.classList.toggle('battery-plugged', power.plugged_in === true);
      el.classList.toggle('battery-low', power.plugged_in === false && known && power.percent <= settings.low_threshold);
      el.classList.toggle('battery-saver', power.saver && power.plugged_in === false);
      el.style.setProperty('--level', (known ? Math.max(3, power.percent) : 0) + '%');
      const percent = el.querySelector('.battery-percent');
      percent.hidden = !settings.show_percentage || !known;
      percent.textContent = known ? power.percent + '%' : '';
      el.title = known ? `${power.percent}% · ${describe()}` : describe();
      el.setAttribute('aria-label', el.title);
    }
  }

  function endActivity() {
    clearTimeout(timeout);
    activity.hidden = true;
    clock.hidden = false;
    closed.classList.remove('battery-alert');
  }

  function showActivity(text, seconds) {
    endActivity();
    activity.textContent = text;
    activity.hidden = false;
    clock.hidden = true;
    closed.classList.add('battery-alert');
    timeout = setTimeout(endActivity, seconds * 1000);
  }

  function update(next) {
    const previous = power;
    power = typeof next?.charging === 'boolean' ? next : null;
    render();
    if (!previous || !power || !settings.enabled) {
      endActivity();
      return;
    }
    if (settings.charging_activity && previous.plugged_in != null &&
        power.plugged_in != null && previous.plugged_in !== power.plugged_in) {
      showActivity(power.plugged_in ? 'Plugged in' : 'Unplugged', 2.8);
    } else if (power.plugged_in === false && power.percent != null &&
        power.percent <= settings.low_threshold && previous.percent > settings.low_threshold) {
      showActivity('Low battery', 4.5);
    }
  }

  window.poniBattery = {
    get present() { return Boolean(settings.enabled && power); },
    get saving() { return power?.plugged_in === false || power?.saver === true; },
    configure(preferences) {
      settings = { ...defaults, ...preferences };
      if (!settings.enabled) endActivity();
      render();
    },
    async listen() {
      let received = false;
      await window.__TAURI__.event.listen('poni-battery-changed', ({payload}) => {
        received = true;
        update(payload);
      });
      const snapshot = await window.__TAURI__.core.invoke('get_battery');
      if (!received) update(snapshot);
    },
  };
})();

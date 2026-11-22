'use strict';

(() => {
  const storageKey = 'wfs-notch-worldclock-v1';
  const maxCities = 8;
  let cities = [];

  function validZone(zone) {
    if (typeof zone !== 'string' || zone.length > 80) return false;
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone }).format();
      return true;
    } catch {
      return false;
    }
  }

  function readCities() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (!Array.isArray(stored)) return [];
      const seen = new Set();
      return stored.filter(city => {
        if (!city || typeof city.name !== 'string' || !city.name.trim() ||
            city.name.length > 30 || !validZone(city.zone) || seen.has(city.zone)) return false;
        seen.add(city.zone);
        return true;
      }).slice(0, maxCities);
    } catch {
      return [];
    }
  }

  function saveCities(next) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      cities = next;
      message.textContent = '';
      render();
      return true;
    } catch {
      message.textContent = 'Could not save cities on this device.';
      return false;
    }
  }

  const form = document.querySelector('#worldclock-add');
  const nameInput = document.querySelector('#worldclock-name');
  const zoneInput = document.querySelector('#worldclock-zone');
  const zones = document.querySelector('#worldclock-zones');
  const timeInput = document.querySelector('#worldclock-time');
  const message = document.querySelector('#worldclock-message');
  const list = document.querySelector('#worldclock-list');

  function selectedTime() {
    if (!timeInput.value) return new Date();
    const selected = new Date(timeInput.value);
    return Number.isNaN(selected.getTime()) ? new Date() : selected;
  }

  function makeButton(label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
  }

  function render() {
    const at = selectedTime();
    list.replaceChildren();
    const rows = [{ name: 'Here', zone: Intl.DateTimeFormat().resolvedOptions().timeZone }, ...cities];
    rows.forEach((city, index) => {
      const row = document.createElement('div');
      row.className = 'worldclock-row';
      const title = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = city.name;
      const zone = document.createElement('small');
      zone.textContent = city.zone || 'Local time';
      title.append(name, zone);
      const clock = document.createElement('time');
      const options = { dateStyle: 'medium', timeStyle: 'short' };
      if (city.zone) options.timeZone = city.zone;
      clock.textContent = new Intl.DateTimeFormat(undefined, options).format(at);
      row.append(title, clock);
      if (index > 0) {
        const actions = document.createElement('div');
        actions.className = 'worldclock-actions';
        const up = makeButton('↑', () => {
          const next = [...cities];
          [next[index - 2], next[index - 1]] = [next[index - 1], next[index - 2]];
          saveCities(next);
        });
        up.disabled = index === 1;
        up.setAttribute('aria-label', `Move ${city.name} up`);
        const down = makeButton('↓', () => {
          const next = [...cities];
          [next[index - 1], next[index]] = [next[index], next[index - 1]];
          saveCities(next);
        });
        down.disabled = index === cities.length;
        down.setAttribute('aria-label', `Move ${city.name} down`);
        const remove = makeButton('Remove', () => saveCities(cities.filter((_, i) => i !== index - 1)));
        remove.setAttribute('aria-label', `Remove ${city.name}`);
        actions.append(up, down, remove);
        row.append(actions);
      }
      list.append(row);
    });
  }

  if (typeof Intl.supportedValuesOf === 'function') {
    for (const zone of Intl.supportedValuesOf('timeZone')) {
      const option = document.createElement('option');
      option.value = zone;
      zones.append(option);
    }
  }
  cities = readCities();
  render();
  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = nameInput.value.trim();
    const zone = zoneInput.value.trim();
    if (!name || name.length > 30 || !validZone(zone)) {
      message.textContent = 'Enter a city and a valid time zone, such as Asia/Jakarta.';
      return;
    }
    if (cities.length >= maxCities) {
      message.textContent = 'You can add up to eight cities.';
      return;
    }
    if (cities.some(city => city.zone === zone)) {
      message.textContent = 'This time zone is already in the list.';
      return;
    }
    if (saveCities([...cities, { name, zone }])) form.reset();
  });
  timeInput.addEventListener('input', render);
  document.querySelector('#worldclock-now').addEventListener('click', () => { timeInput.value = ''; render(); });
  window.addEventListener('storage', event => {
    if (event.key === storageKey) { cities = readCities(); render(); }
  });
  setInterval(() => { if (!timeInput.value) render(); }, 60000);
})();

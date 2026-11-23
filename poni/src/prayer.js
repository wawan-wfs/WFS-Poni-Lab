(() => {
  'use strict';

  const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
  const prayers = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  const methods = [
    [20, 'Kemenag calculation (Indonesia)'], [17, 'JAKIM (Malaysia)'],
    [11, 'MUIS (Singapore)'], [13, 'Diyanet (Türkiye)'],
    [4, 'Umm al-Qura (Makkah)'], [3, 'Muslim World League'],
    [2, 'ISNA (North America)'], [5, 'Egyptian General Authority of Survey'],
    [1, 'University of Islamic Sciences, Karachi'], [16, 'Dubai'],
    [8, 'Gulf Region'], [9, 'Kuwait'], [10, 'Qatar'], [12, 'UOIF (France)'],
    [14, 'Spiritual Administration of Muslims of Russia'], [21, 'Morocco'],
    [23, 'Jordan'], [18, 'Tunisia'], [19, 'Algeria'], [22, 'Portugal'],
  ];
  const regionalMethod = { Indonesia: 20, Malaysia: 17, Singapore: 11 };
  let page;
  let settings;
  let location;
  let hijriOffset = 0;
  let clock;
  let zone;
  let lastDate;
  let days = [];
  let revision = 0;
  let searchRevision = 0;
  let pending = false;
  let cache = new Map();

  const element = id => page.querySelector('#prayer-' + id);
  const setStatus = message => { element('status').textContent = message; };
  const placeName = place => [...new Set([place.name, place.admin1, place.country].filter(Boolean))].join(', ');

  function dateKey(timestamp, timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone,
    }).formatToParts(timestamp);
    const part = name => parts.find(item => item.type === name).value;
    return [part('year'), part('month'), part('day')].join('-');
  }

  function followingDate(key) {
    const date = new Date(key + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  function qibla(place) {
    const radians = Math.PI / 180;
    const from = place.latitude * radians;
    const to = 21.4225 * radians;
    const delta = (39.8262 - place.longitude) * radians;
    const y = Math.sin(delta) * Math.cos(to);
    const x = Math.cos(from) * Math.sin(to) - Math.sin(from) * Math.cos(to) * Math.cos(delta);
    const bearing = (Math.atan2(y, x) / radians + 360) % 360;
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return (Math.round(bearing) % 360) + '° ' + directions[Math.round(bearing / 22.5) % 16];
  }

  async function getDay(currentSettings, date, dayCache) {
    if (dayCache.has(date)) return dayCache.get(date);
    const data = await invoke('prayer_day', {date, settings: currentSettings});
    if (!['Imsak', 'Sunrise', ...prayers].every(name => Number.isFinite(Date.parse(data.timings[name])))) {
      throw new Error('AlAdhan returned incomplete prayer times.');
    }
    dayCache.set(date, data);
    while (dayCache.size > 5) dayCache.delete(dayCache.keys().next().value);
    return data;
  }

  async function refresh() {
    if (!settings || pending) return;
    pending = true;
    const version = revision;
    const selectedSettings = settings;
    const dayCache = cache;
    try {
      const now = Date.now();
      if (!zone) {
        const probe = await getDay(selectedSettings, dateKey(now, 'UTC'), dayCache);
        if (version !== revision) return;
        zone = probe.meta.timezone;
      }
      const date = dateKey(now, zone);
      const result = await Promise.all([
        getDay(selectedSettings, date, dayCache),
        getDay(selectedSettings, followingDate(date), dayCache),
      ]);
      if (version !== revision) return;
      if (!result.every(day => day.meta.timezone === zone)) throw new Error('Prayer time zones do not match.');
      days = result;
      lastDate = date;
      setStatus('');
      element('retry').hidden = true;
      render();
    } catch (error) {
      if (version !== revision) return;
      setStatus(error instanceof Error ? error.message : String(error));
      element('retry').hidden = false;
    } finally {
      if (version === revision) pending = false;
    }
  }

  function render() {
    if (!days.length) return;
    const now = Date.now();
    const next = days.flatMap((day, index) => prayers.map(name => ({
      name, index, time: Date.parse(day.timings[name]),
    }))).find(item => item.time > now);

    const panel = element('summary');
    panel.hidden = false;
    element('place').textContent = placeName(settings.location) + ' · ' + zone;

    const day = days[next?.index ?? 0];
    const formatter = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric', minute: '2-digit', timeZone: zone,
    });
    const timeLabel = name => formatter.format(Date.parse(day.timings[name]));
    element('extras').textContent = 'Imsak ' + timeLabel('Imsak') + ' · Sunrise ' + timeLabel('Sunrise') +
      ' · Qibla ' + qibla(settings.location);
    if (typeof hijriText === 'function') {
      const [year, month, date] = dateKey(now, zone).split('-').map(Number);
      element('hijri').textContent = hijriText(new Date(year, month - 1, date), hijriOffset);
    }
    for (const name of prayers) {
      const entry = element('times').querySelector('[data-prayer="' + name + '"]');
      entry.querySelector('strong').textContent = timeLabel(name);
      entry.classList.toggle('prayer-next', name === next?.name);
    }
    element('next').textContent = next
      ? next.name + ' · ' + formatter.format(next.time) + (dateKey(next.time, zone) === dateKey(now, zone) ? ' today' : ' tomorrow')
      : '—';
    const seconds = next ? Math.max(0, Math.ceil((next.time - now) / 1000)) : 0;
    element('countdown').textContent = next
      ? [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
        .map(value => String(value).padStart(2, '0')).join(':')
      : '—';
  }

  function tick() {
    if (zone && lastDate && dateKey(Date.now(), zone) !== lastDate && !pending) {
      if (element('retry').hidden) void refresh();
    }
    render();
  }

  function chooseCity(city) {
    location = city;
    element('selected').textContent = placeName(city);
    element('save').disabled = false;
    if (Object.hasOwn(regionalMethod, city.country)) element('method').value = String(regionalMethod[city.country]);
  }

  async function search(event) {
    event.preventDefault();
    const searchId = ++searchRevision;
    const results = element('results');
    const query = element('query').value.trim();
    results.replaceChildren();
    setStatus('Searching for cities…');
    try {
      const cities = await invoke('search_weather_city', {query});
      if (searchId !== searchRevision) return;
      setStatus(cities.length ? '' : 'No cities found.');
      for (const city of cities) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = placeName(city);
        button.addEventListener('click', () => {
          chooseCity(city);
          results.replaceChildren();
        });
        results.append(button);
      }
    } catch (error) {
      if (searchId === searchRevision) setStatus(String(error));
    }
  }

  async function save(event) {
    event.preventDefault();
    if (!location) return;
    const button = element('save');
    button.disabled = true;
    try {
      const data = await invoke('set_prayer_settings', {
        settings: {
          location,
          method: Number(element('method').value),
          school: Number(element('school').value),
        },
      });
      settings = data.prayer_settings;
      revision++;
      pending = false;
      lastDate = null;
      zone = null;
      cache = new Map();
      days = [];
      element('summary').hidden = true;
      element('settings').hidden = true;
      element('retry').hidden = true;
      setStatus('Loading prayer times…');
      await refresh();
    } catch (error) {
      setStatus(String(error));
    } finally {
      button.disabled = false;
    }
  }

  function mount(container) {
    page = container;
    page.innerHTML = `
      <div class="prayer-header">
        <span id="prayer-place"></span>
        <button type="button" id="prayer-config" aria-controls="prayer-settings">Location &amp; method</button>
      </div>
      <div id="prayer-summary" hidden>
        <div class="prayer-headline">
          <strong id="prayer-next"></strong>
          <span id="prayer-countdown" aria-label="Time until next prayer"></span>
          <span id="prayer-hijri"></span>
        </div>
        <div id="prayer-times" class="prayer-times">${prayers.map(name => '<div data-prayer="' + name + '"><span>' + name + '</span><strong></strong></div>').join('')}</div>
        <p id="prayer-extras"></p>
      </div>
      <div id="prayer-settings" hidden>
        <form id="prayer-search" class="entry">
          <input id="prayer-query" type="search" aria-label="Prayer city" placeholder="Search a city" required minlength="2" maxlength="100">
          <button type="submit">Search</button>
        </form>
        <div id="prayer-results" class="prayer-results"></div>
        <form id="prayer-form" class="prayer-form">
          <span id="prayer-selected">Select a city</span>
          <select id="prayer-method" aria-label="Calculation method">${methods.map(([id, name]) => '<option value="' + id + '">' + name + '</option>').join('')}</select>
          <select id="prayer-school" aria-label="Asr school"><option value="0">Standard Asr</option><option value="1">Hanafi Asr</option></select>
          <button type="submit" id="prayer-save" disabled>Save</button>
        </form>
        <small>City search by Open-Meteo. Timetables by AlAdhan.</small>
      </div>
      <div class="prayer-feedback"><span id="prayer-status" role="status"></span><button type="button" id="prayer-retry" hidden>Retry</button></div>`;
    element('search').addEventListener('submit', search);
    element('form').addEventListener('submit', save);
    element('config').addEventListener('click', () => { element('settings').hidden = !element('settings').hidden; });
    element('retry').addEventListener('click', () => { setStatus('Loading prayer times…'); void refresh(); });
    element('method').value = '3';
  }

  async function show() {
    clearInterval(clock);
    clock = setInterval(tick, 1000);
    if (settings) {
      if (days.length) tick();
      else await refresh();
      return;
    }
    try {
      const data = await invoke('get_data');
      hijriOffset = data.hijri_offset || 0;
      if (!data.prayer_settings) {
        element('settings').hidden = false;
        return;
      }
      settings = data.prayer_settings;
      chooseCity(settings.location);
      element('method').value = String(settings.method);
      element('school').value = String(settings.school);
      await refresh();
    } catch (error) {
      setStatus(String(error));
    }
  }

  window.poniModules ||= {};
  window.poniModules.prayer = {mount, show, hide: () => clearInterval(clock)};
})();

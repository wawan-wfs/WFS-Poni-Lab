'use strict';

(() => {
  const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
  const MINUTE = 60_000;
  const DAY = 24 * 60;
  const STEP = 15;
  const MAX = 8;
  const nightColor = [39, 46, 92];
  const dayColor = [188, 220, 255];
  const aliases = {
    Calcutta: 'Kolkata', Katmandu: 'Kathmandu', Rangoon: 'Yangon',
    Saigon: 'Ho Chi Minh City', Kiev: 'Kyiv', Godthab: 'Nuuk',
    Asmera: 'Asmara', Ulan_Bator: 'Ulaanbaatar',
  };
  const cityOf = zone => {
    const city = zone.split('/').pop();
    return (aliases[city] || city).replaceAll('_', ' ');
  };
  const fold = text => text.normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[_/]+/g, ' ').trim();

  // Additional cities that share a time zone whose IANA name uses another city.
  const commonCities = [
    ['Bandung', 'Asia/Jakarta'], ['Surabaya', 'Asia/Jakarta'], ['Medan', 'Asia/Jakarta'],
    ['Bali', 'Asia/Makassar'], ['Hanoi', 'Asia/Ho_Chi_Minh'], ['Beijing', 'Asia/Shanghai'],
    ['Osaka', 'Asia/Tokyo'], ['New Delhi', 'Asia/Kolkata'], ['Mumbai', 'Asia/Kolkata'],
    ['Bengaluru', 'Asia/Kolkata'], ['Abu Dhabi', 'Asia/Dubai'], ['Doha', 'Asia/Qatar'],
    ['Mecca', 'Asia/Riyadh'], ['Makkah', 'Asia/Riyadh'], ['Medina', 'Asia/Riyadh'],
    ['Jeddah', 'Asia/Riyadh'], ['Kuwait', 'Asia/Kuwait'], ['Brunei', 'Asia/Brunei'],
    ['Barcelona', 'Europe/Madrid'], ['Milan', 'Europe/Rome'],
    ['Washington, D.C.', 'America/New_York'], ['San Francisco', 'America/Los_Angeles'],
    ['Seattle', 'America/Los_Angeles'], ['Rio de Janeiro', 'America/Sao_Paulo'],
    ['São Paulo', 'America/Sao_Paulo'], ['Bogotá', 'America/Bogota'],
    ['Fiji', 'Pacific/Fiji'], ['Samoa', 'Pacific/Apia'],
    ['Chatham Islands', 'Pacific/Chatham'], ['Marquesas Islands', 'Pacific/Marquesas'],
    ['UTC', 'UTC'],
  ];
  const formatters = new Map();
  const zonedFormatters = new Map();
  let cityIndex;
  let content, report;
  let rows = [];
  let places = [];
  let loaded = false;
  let editing = false;
  let adding = false;
  let clock24h = true;
  let shown = false;
  let keptMinute = null;
  let hoveredMinute = null;
  let timer;
  let pending = Promise.resolve();
  let revision = 0;
  let dateKey = '';

  function element(tag, className, text = '') {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text) result.textContent = text;
    return result;
  }

  function button(text, label, handler) {
    const result = element('button', 'world-btn', text);
    result.type = 'button';
    result.title = label;
    result.setAttribute('aria-label', label);
    result.addEventListener('click', handler);
    return result;
  }

  function getWallFormatter(zone) {
    if (!zonedFormatters.has(zone)) {
      if (zonedFormatters.size >= 40) zonedFormatters.clear();
      zonedFormatters.set(zone, new Intl.DateTimeFormat('en-US', {
        timeZone: zone, calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23',
        year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
      }));
    }
    return zonedFormatters.get(zone);
  }

  function timeFormatter(zone, hoursOnly = false) {
    const key = JSON.stringify([zone, hoursOnly, clock24h]);
    if (!formatters.has(key)) {
      if (formatters.size >= 40) formatters.clear();
      formatters.set(key, new Intl.DateTimeFormat(undefined, {
        timeZone: zone, hourCycle: clock24h ? 'h23' : 'h12',
        hour: clock24h ? '2-digit' : 'numeric',
        ...(hoursOnly ? {} : {minute: '2-digit'}),
      }));
    }
    return formatters.get(key);
  }

  function validZone(zone) {
    if (!/^(?:UTC|[a-z][a-z_+0-9-]*(?:\/[a-z_+0-9-]+)+)$/i.test(zone)) return false;
    try {
      getWallFormatter(zone);
      return true;
    } catch {
      return false;
    }
  }

  function searchCities(query) {
    const q = fold(query);
    if (q.length < 3) return [];
    if (!cityIndex) {
      const zones = Intl.supportedValuesOf?.('timeZone') || ['Asia/Jakarta', 'Europe/London', 'America/New_York'];
      const entries = [...commonCities, ...zones.filter(zone => zone.includes('/')).map(zone => [cityOf(zone), zone])];
      const used = new Set();
      cityIndex = entries.flatMap(([name, zone]) => {
        const nameKey = fold(name);
        if (used.has(nameKey) || !validZone(zone)) return [];
        used.add(nameKey);
        return [{name, zone, nameKey, zoneKey: fold(zone)}];
      }).sort((a, b) => a.name.localeCompare(b.name));
    }
    const exact = query.trim();
    const matched = cityIndex.filter(place => place.nameKey.startsWith(q));
    const indirect = cityIndex.filter(place =>
      !place.nameKey.startsWith(q) && (place.nameKey.includes(q) || place.zoneKey.includes(q)));
    if (validZone(exact)) {
      const preferred = {name: cityOf(exact), zone: exact};
      return [preferred, ...matched, ...indirect].filter((place, index) =>
        index === 0 || place.name !== preferred.name || place.zone.toLowerCase() !== exact.toLowerCase()).slice(0, 5);
    }
    return [...matched, ...indirect].slice(0, 5);
  }

  function clockAt(date, minute) {
    const result = new Date(date);
    result.setHours(0, minute, 0, 0);
    return result;
  }

  function zoneInfo(zone, date) {
    const localDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    if (!zone) return {hour: date.getHours(), offset: 0, dayDiff: 0};
    const parts = Object.fromEntries(getWallFormatter(zone).formatToParts(date)
      .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    const day = Date.UTC(parts.year, parts.month - 1, parts.day);
    const minutes = parts.hour * 60 + parts.minute;
    const wallMinute = day / MINUTE + minutes;
    return {
      hour: parts.hour,
      dayDiff: Math.sign(day - localDay),
      offset: wallMinute - Math.floor(date.getTime() / MINUTE) + date.getTimezoneOffset(),
    };
  }

  function describe(info) {
    const diff = Math.abs(info.offset);
    const hours = Math.floor(diff / 60);
    const minutes = diff % 60;
    const offset = diff
      ? `${info.offset < 0 ? '−' : '+'}${hours}${minutes ? ':' + String(minutes).padStart(2, '0') : ''} h`
      : 'Same time';
    const when = info.dayDiff < 0 ? 'yesterday' : info.dayDiff > 0 ? 'tomorrow' : '';
    return [offset, when].filter(Boolean).join(' · ');
  }

  const wrap = minute => ((minute % DAY) + DAY) % DAY;
  function band(offset) {
    const breaks = [330, 390, 1050, 1110].map(minute => wrap(minute - offset));
    const stops = [...new Set([0, ...breaks, DAY])].sort((a, b) => a - b);
    const colors = stops.map(minute => {
      const remoteMinute = wrap(minute + offset);
      const daylight = Math.max(0, Math.min(1, (remoteMinute - 330) / 60, (1110 - remoteMinute) / 60));
      const rgb = nightColor.map((channel, i) => Math.round(channel + (dayColor[i] - channel) * daylight));
      return `rgb(${rgb.join(',')}) ${minute * 100 / DAY}%`;
    });
    return `linear-gradient(to right, ${colors.join(', ')})`;
  }

  const percent = minute => `${minute * 100 / DAY}%`;
  const clockMinute = date => date.getHours() * 60 + date.getMinutes();

  function paint(full = false) {
    if (!content || !shown) return;
    const now = new Date();
    const key = [now.toDateString(), now.getTimezoneOffset()].join('/');
    full ||= dateKey !== key;
    dateKey = key;
    const selectedMinute = hoveredMinute ?? keptMinute;
    const selected = selectedMinute === null ? now : clockAt(now, selectedMinute);
    const label = timeFormatter().format(selected);
    const hint = content.querySelector('.world-hint');
    if (hint) hint.textContent = selectedMinute === null ? 'Point at the strips to plan a time' : `When it’s ${label} here`;
    const nowButton = content.querySelector('.world-now');
    if (nowButton) nowButton.hidden = keptMinute === null;
    content.classList.toggle('world-planning', selectedMinute !== null);
    if (full) {
      for (const tick of content.querySelectorAll('.world-axis span')) {
        tick.textContent = timeFormatter(undefined, true).format(clockAt(now, Number(tick.dataset.minute)));
      }
    }
    for (const row of rows) {
      const info = zoneInfo(row.zone, selected);
      const night = info.hour < 6 || info.hour >= 18;
      row.base.classList.toggle('world-night', night);
      row.icon.textContent = night ? '☾' : '☀';
      const formatted = timeFormatter(row.zone).formatToParts(selected);
      row.time.replaceChildren(...formatted.map(part => part.type === 'dayPeriod'
        ? element('small', '', part.value) : document.createTextNode(part.value)));
      if (row.zone) row.subtitle.textContent = describe(info);
      if (!row.strip) continue;
      if (full) row.strip.style.backgroundImage = band(zoneInfo(row.zone, now).offset);
      row.current.style.left = percent(clockMinute(now));
      row.marker.hidden = selectedMinute === null;
      if (selectedMinute !== null) row.marker.style.left = percent(selectedMinute);
      const ariaMinute = selectedMinute ?? clockMinute(now);
      row.strip.setAttribute('aria-valuenow', String(ariaMinute));
      row.strip.setAttribute('aria-valuetext', label);
    }
  }

  function selectMinute(minute, keep) {
    const value = Math.max(0, Math.min(DAY - STEP, Math.round(minute / STEP) * STEP));
    if (keep) {
      if (keptMinute === value && hoveredMinute === null) return;
      hoveredMinute = null;
      keptMinute = value;
    } else {
      if (hoveredMinute === value) return;
      hoveredMinute = value;
    }
    paint();
  }

  function addPlanner(row, name) {
    const strip = element('span', 'world-strip');
    const current = element('i', 'world-tick');
    const marker = element('i', 'world-marker');
    strip.tabIndex = 0;
    strip.setAttribute('role', 'slider');
    strip.setAttribute('aria-label', `Plan a time for ${name}`);
    strip.setAttribute('aria-valuemin', '0');
    strip.setAttribute('aria-valuemax', String(DAY - 1));
    let pointer = null;
    const point = event => {
      const box = strip.getBoundingClientRect();
      return DAY * (event.clientX - box.left) / Math.max(1, box.width);
    };
    strip.addEventListener('pointermove', event => {
      if (pointer === event.pointerId) selectMinute(point(event), true);
      else if (event.pointerType !== 'touch') selectMinute(point(event), false);
    });
    strip.addEventListener('pointerleave', () => {
      if (pointer === null && hoveredMinute !== null) {
        hoveredMinute = null;
        paint();
      }
    });
    strip.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      pointer = event.pointerId;
      strip.setPointerCapture(pointer);
      if (event.pointerType !== 'touch') selectMinute(point(event), true);
    });
    strip.addEventListener('pointerup', event => {
      if (pointer !== event.pointerId) return;
      selectMinute(point(event), true);
      strip.releasePointerCapture(pointer);
      pointer = null;
    });
    strip.addEventListener('lostpointercapture', () => { pointer = null; });
    strip.addEventListener('keydown', event => {
      const adjustment = {ArrowLeft: -STEP, ArrowDown: -STEP, ArrowRight: STEP, ArrowUp: STEP}[event.key];
      if (adjustment === undefined && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      event.stopPropagation();
      const start = keptMinute ?? Math.round(clockMinute(new Date()) / STEP) * STEP;
      const minute = event.key === 'Home' ? 0 : event.key === 'End' ? DAY - STEP : start + adjustment;
      selectMinute(minute, true);
    });
    strip.append(current, marker);
    row.base.append(strip);
    Object.assign(row, {strip, current, marker});
  }

  function save(change) {
    revision += 1;
    const task = pending.then(async () => {
      try {
        const changed = change(places);
        if (changed === null) return false;
        const result = await invoke('set_world_clocks', {places: changed});
        places = result.world_clocks || [];
        report.textContent = '';
        if (shown) render();
        return true;
      } catch (error) {
        report.textContent = String(error);
        return false;
      }
    });
    pending = task;
    return task;
  }

  function makeRow(place, index) {
    const base = element('div', 'world-row');
    const icon = element('span', 'world-icon');
    icon.setAttribute('aria-hidden', 'true');
    const name = element('span', 'world-name');
    const subtitle = element('small', 'world-subtitle');
    const time = element('time', 'world-time');
    const local = index < 0;
    if (local) {
      base.classList.add('world-here');
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      subtitle.textContent = zone ? cityOf(zone) : '';
    } else {
      name.title = place.zone.replaceAll('_', ' ');
    }

    if (!local && editing) {
      const input = element('input', 'world-rename');
      input.value = place.name;
      input.maxLength = 30;
      input.spellcheck = false;
      input.setAttribute('aria-label', `Rename ${place.name}`);
      input.addEventListener('change', () => {
        const value = input.value.trim() || cityOf(place.zone);
        void save(items => items.map(item => item.id === place.id ? {...item, name: value} : item));
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (event.key === 'Escape') input.value = place.name;
          input.blur();
        }
      });
      name.append(input);
    } else {
      name.append(element('strong', '', place.name));
    }
    name.append(subtitle);
    base.append(icon, name, time);
    const row = {base, icon, subtitle, time, zone: place.zone};

    if (!editing) {
      addPlanner(row, place.name);
    } else if (!local) {
      const controls = element('span', 'world-tools');
      const move = step => save(items => {
        const at = items.findIndex(item => item.id === place.id);
        const next = at + step;
        if (at < 0 || next < 0 || next >= items.length) return null;
        const copy = [...items];
        [copy[at], copy[next]] = [copy[next], copy[at]];
        return copy;
      });
      const up = button('⌃', `Move ${place.name} up`, () => void move(-1));
      const down = button('⌄', `Move ${place.name} down`, () => void move(1));
      up.disabled = index === 0;
      down.disabled = index === places.length - 1;
      const remove = button('×', `Remove ${place.name}`, () =>
        void save(items => items.filter(item => item.id !== place.id)));
      controls.append(up, down, remove);
      base.append(controls);
    }
    rows.push(row);
    return base;
  }

  function searchBox() {
    const wrapper = element('div', 'world-search');
    const input = element('input', 'world-search-input');
    input.type = 'text';
    input.maxLength = 80;
    input.placeholder = 'Add a city…';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-label', 'Add a city');
    input.setAttribute('aria-controls', 'world-suggestions');
    input.setAttribute('aria-autocomplete', 'list');
    const list = element('div', 'world-suggestions');
    list.id = 'world-suggestions';
    list.setAttribute('role', 'listbox');
    let found = [];
    let active = -1;

    function draw() {
      list.hidden = found.length === 0;
      list.replaceChildren();
      input.setAttribute('aria-expanded', String(!list.hidden));
      input.removeAttribute('aria-activedescendant');
      found.forEach((item, index) => {
        const option = element('div', 'world-option');
        option.id = `world-suggestion-${index}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(index === active));
        if (index === active) input.setAttribute('aria-activedescendant', option.id);
        const name = element('strong', '', item.name);
        const detail = element('small', '', `${item.zone.replaceAll('_', ' ')} · ${timeFormatter(item.zone).format(new Date())}`);
        option.append(name, detail);
        option.addEventListener('pointerdown', event => event.preventDefault());
        option.addEventListener('click', () => void add(item));
        list.append(option);
      });
    }

    async function add(item) {
      if (!item) return;
      input.disabled = true;
      found = [];
      draw();
      const ok = await save(items => {
        if (items.length >= MAX) throw new Error('Remove a place before adding another.');
        if (items.some(place => place.name === item.name && place.zone.toLowerCase() === item.zone.toLowerCase())) {
          throw new Error('This place is already listed.');
        }
        adding = false;
        return [...items, {id: crypto.randomUUID(), name: item.name, zone: item.zone}];
      });
      if (!ok) {
        adding = true;
        input.disabled = false;
        input.focus();
      }
    }

    input.addEventListener('input', () => { found = searchCities(input.value); active = -1; draw(); });
    input.addEventListener('blur', () => { found = []; active = -1; draw(); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape' && found.length) {
        event.stopPropagation();
        found = [];
        draw();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        void add(found[active] || searchCities(input.value)[0]);
      } else if (found.length && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        active = event.key === 'ArrowDown' ? (active + 1) % found.length
          : (active > 0 ? active - 1 : found.length - 1);
        draw();
      }
    });
    wrapper.append(input, list);
    draw();
    return wrapper;
  }

  function render() {
    rows = [];
    content.replaceChildren();
    content.classList.toggle('world-editing', editing);
    content.classList.toggle('world-12h', !clock24h);
    content.classList.toggle('world-many', places.length > 4);
    if (!places.length) {
      content.append(makeRow({name: 'Here'}, -1));
      const empty = element('div', 'world-empty');
      empty.append(element('p', '', loaded ? 'Add a city to see its time next to yours' : 'Loading places…'));
      const search = searchBox();
      search.querySelector('input').disabled = !loaded;
      empty.append(search);
      content.append(empty);
      paint(true);
      return;
    }
    const head = element('div', 'world-head');
    const controls = element('div', 'world-controls');
    if (adding) {
      controls.append(searchBox());
      controls.append(button('×', 'Close add city', () => { adding = false; render(); }));
    } else {
      controls.append(element('span', 'world-hint'));
      const now = button('Now', 'Now', () => {
        hoveredMinute = keptMinute = null;
        paint();
      });
      now.classList.add('world-now');
      const add = button('+', 'Add a city', () => {
        editing = false;
        adding = true;
        render();
        content.querySelector('.world-search-input').focus();
      });
      add.disabled = !loaded || places.length >= MAX;
      if (places.length >= MAX) add.title = 'Up to eight places. Remove one to add another.';
      const edit = button(editing ? '✓' : '✎', editing ? 'Done' : 'Edit places', () => {
        hoveredMinute = null;
        editing = !editing;
        render();
      });
      controls.append(now, add, edit);
    }
    head.append(controls);
    if (!editing) {
      const axis = element('div', 'world-axis');
      axis.setAttribute('aria-hidden', 'true');
      for (const minute of [360, 720, 1080]) {
        const tick = element('span', '');
        tick.dataset.minute = minute;
        tick.style.left = percent(minute);
        axis.append(tick);
      }
      head.append(axis);
    }
    content.append(head, makeRow({name: 'Here'}, -1));
    const list = element('div', 'world-places');
    places.forEach((place, index) => list.append(makeRow(place, index)));
    content.append(list);
    paint(true);
  }

  function scheduleTick() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!shown) return;
      paint(true);
      scheduleTick();
    }, MINUTE - Date.now() % MINUTE + 30);
  }

  let visit = 0;
  window.poniModules ||= {};
  window.poniModules.worldclock = {
    mount(page) {
      content = element('div', 'world-layout');
      report = element('div', 'world-status');
      report.setAttribute('role', 'status');
      page.append(content, report);
    },
    async show() {
      const request = ++visit;
      shown = true;
      render();
      scheduleTick();
      try {
        await pending;
        const before = revision;
        const snapshot = await invoke('get_data');
        if (!shown || visit !== request || before !== revision) return;
        places = (snapshot.world_clocks || []).filter(place => validZone(place.zone));
        const clockFormat = snapshot.settings?.clock_format;
        if (clockFormat === 'region') {
          clock24h = !new Intl.DateTimeFormat(undefined, {hour:'numeric'}).resolvedOptions().hour12;
        } else {
          clock24h = clockFormat ? clockFormat === 'h24' : snapshot.clock24h !== false;
        }
        loaded = true;
        if (!places.length) editing = false;
        report.textContent = '';
        render();
      } catch (error) {
        if (shown && visit === request) report.textContent = String(error);
      }
    },
    hide() {
      visit += 1;
      shown = false;
      hoveredMinute = keptMinute = null;
      clearTimeout(timer);
    },
  };
})();

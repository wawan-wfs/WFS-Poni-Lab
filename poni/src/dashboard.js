(() => {
  'use strict';

  const defaults = ['clock', 'day_progress', 'up_next', 'todo'];
  const titles = {
    clock: 'Clock',
    day_progress: 'Day progress',
    up_next: 'Up next',
    todo: 'Todo',
    world_clock: 'World clock',
    system: 'System',
    weather: 'Weather',
    media: 'Now playing',
    timer: 'Timer',
    pomodoro: 'Pomodoro',
    quote: 'Quote',
  };
  const destinations = {
    day_progress: 'dayprogress', up_next: 'calendar', todo: 'tasks',
    world_clock: 'worldclock', system: 'system', weather: 'weather', timer: 'timer', pomodoro: 'pomodoro',
  };
  const quotes = [
    'Sedikit demi sedikit, lama-lama menjadi bukit.',
    'Berakit-rakit ke hulu, berenang-renang ke tepian.',
    'Little strokes fell great oaks.',
  ];
  const timeOptions = { hour: 'numeric', minute: '2-digit' };
  const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
  let grid, status, selects, save;
  let saved = defaults;
  let data = {};
  let media = null;
  let system = null;
  let weather = null;
  let weatherKey = '';
  let weatherRequestedAt = 0;
  let pomodoro = null;
  let renderInterval, refreshInterval;
  let revision = 0;
  let writeRevision = 0;
  let active = false;

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function control(label, handler) {
    const button = node('button', label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  }

  function travel(tab) {
    document.querySelector(`.tab[data-page="${tab}"]`)?.click();
  }

  function percentage(value) {
    return Math.round(Math.min(100, Math.max(0, value)));
  }

  function gauge(label, value) {
    const meter = node('progress');
    meter.max = 100;
    meter.value = percentage(value);
    meter.setAttribute('aria-label', label);
    return meter;
  }

  function list(card, items, empty) {
    if (!items.length) {
      card.append(node('p', empty));
      return;
    }
    const element = node('ul');
    for (const item of items) element.append(node('li', item));
    card.append(element);
  }

  function dayProgress(card, now) {
    const at = minutes => new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, minutes);
    const wake = at(data.wake_minute ?? 420);
    const bed = at(data.bed_minute ?? 1380);
    if (bed <= wake) bed.setDate(bed.getDate() + 1);
    const progress = percentage(100 * (now - wake) / (bed - wake));
    const minutes = Math.max(0, Math.floor((bed - now) / 60000));
    const summary = minutes ? `${Math.floor(minutes / 60)}h ${minutes % 60}m until bedtime` : 'Past bedtime';
    card.append(node('p', `${progress}%`, 'dashboard-value'), gauge('Day progress', progress), node('p', summary));
  }

  function upcoming(card, now) {
    const meetings = [];
    const seen = new Set();
    for (let day = 0; day < 7 && meetings.length < 3; day++) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day);
      for (const {event, start} of occurrencesOnDay(date, data.calendar_events || [])) {
        const key = `${event.id}/${start}`;
        if (seen.has(key) || start + event.duration_minutes * 60000 <= now) continue;
        seen.add(key);
        meetings.push(`${new Date(start).toLocaleString(undefined, {weekday: 'short', ...timeOptions})} · ${event.title}`);
        if (meetings.length === 3) break;
      }
    }
    list(card, meetings, 'Nothing scheduled in the next seven days');
  }

  function timerRemaining(timer) {
    return timer.ends_at_ms == null ? timer.remaining_ms : Math.max(0, timer.ends_at_ms - Date.now());
  }

  function timerText(remaining) {
    const seconds = Math.ceil(remaining / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  async function timerToggle() {
    const timer = data.timer;
    if (!timer) return;
    const action = timer.ends_at_ms > Date.now() ? 'pause' : 'start';
    try {
      if (!await mutate('timer_action', {action, minutes: null})) return;
      data = await invoke('get_data');
      renderCards();
    } catch (error) {
      status.textContent = String(error);
    }
  }

  async function sendMedia(action) {
    try {
      await invoke('media_control', {action});
    } catch (error) {
      status.textContent = String(error);
    }
  }

  const widgets = {
    clock(card, now) {
      card.append(node('p', now.toLocaleTimeString(undefined, timeOptions), 'dashboard-value'));
      card.append(node('p', now.toLocaleDateString(undefined, {dateStyle: 'full'})));
    },
    day_progress: dayProgress,
    up_next: upcoming,
    todo(card) {
      const tasks = (data.tasks || []).filter(task => !task.done).slice(0, 4);
      list(card, tasks.map(task => task.text), 'All done');
    },
    world_clock(card, now) {
      const places = (data.world_clocks || []).slice(0, 4);
      list(card, places.map(place => {
        try {
          return `${place.name} · ${now.toLocaleTimeString(undefined, {...timeOptions, timeZone: place.zone})}`;
        } catch {
          return `${place.name} · Time unavailable`;
        }
      }), 'Add locations in World clock');
    },
    system(card) {
      if (!system) {
        card.append(node('p', 'System metrics unavailable'));
        return;
      }
      for (const [label, value] of [['CPU', system.cpu_percent], ['Memory', system.memory_total ? system.memory_used / system.memory_total * 100 : null]]) {
        card.append(node('p', value == null ? `${label} · —` : `${label} · ${percentage(value)}%`));
        if (value != null) card.append(gauge(label, value));
      }
    },
    weather(card) {
      const place = data.weather_location;
      if (!place) {
        card.append(node('p', 'Choose a city in Weather'));
        return;
      }
      const forecast = weatherKey === `${place.latitude}/${place.longitude}` ? weather : null;
      const degrees = forecast?.current?.temperature_2m;
      card.append(node('p', place.name));
      card.append(node('p', Number.isFinite(degrees) ? `${Math.round(degrees)}°C` : 'Forecast unavailable', 'dashboard-value'));
      if (forecast?.current) card.append(node('p', weatherDescription(forecast.current.weather_code)));
      const max = forecast?.daily?.temperature_2m_max?.[0];
      const min = forecast?.daily?.temperature_2m_min?.[0];
      if (Number.isFinite(max) && Number.isFinite(min)) card.append(node('p', `H ${Math.round(max)}° · L ${Math.round(min)}°`));
    },
    media(card) {
      card.append(node('p', media?.title || 'Nothing playing'));
      if (media?.artist) card.append(node('p', media.artist));
      for (const [action, label] of [['previous', 'Previous'], ['toggle', media?.playing ? 'Pause' : 'Play'], ['next', 'Next']]) {
        card.append(control(label, () => sendMedia(action)));
      }
    },
    timer(card) {
      const timer = data.timer;
      if (!timer) return;
      card.append(node('p', timerText(timerRemaining(timer)), 'dashboard-value'), control(timer.ends_at_ms > Date.now() ? 'Pause timer' : 'Start timer', timerToggle));
    },
    pomodoro(card) {
      if (!pomodoro) return;
      const labels = {focus: 'Focus', short_break: 'Short break', long_break: 'Long break'};
      const remaining = timerRemaining(pomodoro);
      card.append(node('p', labels[pomodoro.phase]), node('p', timerText(remaining), 'dashboard-value'));
      card.append(gauge('Session progress', 100 * (1 - remaining / pomodoro.total_ms)));
    },
    quote(card, now) {
      const index = Math.floor(now.getTime() / 86400000) % quotes.length;
      card.append(node('q', quotes[index]));
    },
  };

  function patchContent(current, next) {
    if (current.nodeName !== next.nodeName || current.childNodes.length !== next.childNodes.length) return false;
    if (current.nodeType === Node.TEXT_NODE) {
      current.data = next.data;
      return true;
    }
    if (current.tagName === 'PROGRESS') current.value = next.value;
    return [...current.childNodes].every((child, index) => patchContent(child, next.childNodes[index]));
  }

  function renderCards() {
    if (!active) return;
    const now = new Date();
    saved.forEach((id, index) => {
      const card = node('article', undefined, 'dashboard-card');
      card.dataset.widget = id;
      const title = node('h3');
      const destination = destinations[id];
      if (destination) title.append(control(titles[id], () => travel(destination)));
      else title.textContent = titles[id];
      card.append(title);
      widgets[id](card, now);
      const previous = grid.children[index];
      if (!previous) grid.append(card);
      else if (!previous.isEqualNode(card) && (previous.dataset.widget !== id || !patchContent(previous, card))) {
        const focused = [...previous.querySelectorAll('button')].indexOf(document.activeElement);
        previous.replaceWith(card);
        if (focused >= 0) card.querySelectorAll('button')[focused]?.focus({preventScroll: true});
      }
    });
  }

  function syncSelections() {
    saved.forEach((id, index) => { selects[index].value = id; });
  }

  async function refreshWidgetData(token) {
    const place = data.weather_location;
    if (saved.includes('system')) {
      invoke('system_snapshot').then(value => {
        if (token !== revision) return;
        if (value.cpu_percent == null && system?.cpu_percent != null) value.cpu_percent = system.cpu_percent;
        system = value;
        renderCards();
      }).catch(() => {});
    }
    if (saved.includes('media')) {
      invoke('current_media').then(value => {
        if (token !== revision) return;
        media = value;
        renderCards();
      }).catch(() => {});
    }
    if (saved.includes('pomodoro')) {
      invoke('pomodoro_state').then(value => {
        if (token !== revision) return;
        pomodoro = value;
        renderCards();
      }).catch(() => {});
    }
    if (saved.includes('weather') && place) {
      const key = `${place.latitude}/${place.longitude}`;
      if (weatherKey === key && Date.now() - weatherRequestedAt < (weather ? 900000 : 30000)) return;
      if (weatherKey !== key) weather = null;
      weatherKey = key;
      weatherRequestedAt = Date.now();
      try {
        const value = await invoke('weather_forecast', {location: place});
        if (weatherKey !== key) return;
        weather = value;
        renderCards();
      } catch { /* Retry on a later dashboard refresh. */ }
    }
  }

  async function saveSlots(event) {
    event.preventDefault();
    const widgets = selects.map(select => select.value);
    if (new Set(widgets).size !== 4) {
      status.textContent = 'Choose a different widget for each slot';
      return;
    }
    save.disabled = true;
    selects.forEach(select => { select.disabled = true; });
    writeRevision++;
    try {
      data = await invoke('set_dashboard_widgets', {widgets});
      saved = widgets;
      status.textContent = '';
      renderCards();
      void refreshWidgetData(revision);
    } catch (error) {
      status.textContent = String(error);
    } finally {
      save.disabled = false;
      selects.forEach(select => { select.disabled = false; });
    }
  }

  function mount(page) {
    page.classList.add('poni-dashboard');
    grid = node('div', undefined, 'dashboard-grid');
    const form = node('form', undefined, 'dashboard-controls');
    selects = defaults.map((value, index) => {
      const label = node('label', `Slot ${index + 1}`);
      const select = node('select');
      for (const [id, title] of Object.entries(titles)) {
        const option = node('option', title);
        option.value = id;
        select.append(option);
      }
      select.value = value;
      label.append(select);
      form.append(label);
      return select;
    });
    save = node('button', 'Save widgets');
    save.type = 'submit';
    save.disabled = true;
    form.append(save);
    form.addEventListener('submit', saveSlots);
    status = node('p', undefined, 'dashboard-status');
    status.setAttribute('role', 'status');
    page.append(grid, form, status);
  }

  async function show() {
    const token = ++revision;
    const previousWrite = writeRevision;
    active = true;
    renderCards();
    clearInterval(renderInterval);
    clearInterval(refreshInterval);
    renderInterval = setInterval(renderCards, 1000);
    refreshInterval = setInterval(() => { void refreshWidgetData(token); }, 5000);
    try {
      const value = await invoke('get_data');
      if (token !== revision || previousWrite !== writeRevision) return;
      data = value;
      saved = data.dashboard_widgets || defaults;
      syncSelections();
      status.textContent = '';
      renderCards();
      if (!data.weather_location) { weatherKey = ''; weather = null; }
      void refreshWidgetData(token);
    } catch (error) {
      if (token === revision) status.textContent = String(error);
    } finally {
      if (token === revision && previousWrite === writeRevision) save.disabled = false;
    }
  }

  function hide() {
    active = false;
    revision++;
    clearInterval(renderInterval);
    clearInterval(refreshInterval);
  }

  window.poniModules ||= {};
  window.poniModules.dashboard = {mount, show, hide};
})();

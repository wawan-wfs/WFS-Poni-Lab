'use strict';

const invoke = window.__TAURI__.core.invoke;
const surface = document.querySelector('#surface');
const closed = document.querySelector('#closed');
const open = document.querySelector('#open');
const status = document.querySelector('#status');
const todoReminder = document.querySelector('#todo-reminder');
const bedtimeReminder = document.querySelector('#bedtime-reminder');
let data = { tasks: [], notes: [], timer: { total_ms: 1500000, remaining_ms: 1500000, ends_at_ms: null }, stopwatch: { elapsed_ms: 0, started_at_ms: null, laps: [] }, weather_location: null, world_clocks: [], calendar_events: [] };
let editingTask = null;
let taskView = 'active';
let reminderTask = null;
let reminderBusy = false;
let taskRedrawPending = false;
let bedtimeNotice = null;
let bedtimeTimer = null;
const expandedTasks = new Set();
let queue = Promise.resolve();
let panelSequence = 0;
let closeTimer = null;
let hoverTimer = null;
let rememberTimer = null;
let preferenceQueue = Promise.resolve();
let mediaPending = false;
let keyboardOpen = false;
let weatherRequest = 0;
let searchRequest = 0;
let systemPending = false;
let calendarDay = null;
let calendarToday = null;
let regionalFirstWeekday = 1;
let selectedDate = new Date();
selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
let displayedMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
let editingEvent = null;
const modules = window.poniModules || {};
const navigation = open.querySelector('header nav');
const moduleTabs = new Map([...navigation.querySelectorAll('.tab')].map(tab => [tab.dataset.page, tab]));
let preferences = {
  clock_format: 'region', header_clock: true, open_on_hover: true,
  hover_delay: 0, close_delay: 450, module_shortcuts: true,
  module_order: [], hidden_modules: [], default_module: 'home',
  remember_module: false, last_module: null,
  mirror_enabled: true, mirror_shape: 'rounded', calendar_enabled: true, week_start: 'windows',
  timer_presets: [], timer_remember: true,
  todo: { late_minutes: 0, snooze_minutes: 10, trash_days: 7 },
  bedtime_reminder: false,
  panel: { direction: 'auto', top_gap: 0, position: 50, width: 200, height: 32, opacity: 100,
    expanded_width: 680, expanded_height: 196, tall_height: 268, show_in_screenshots: true },
};
const mountedModules = new Set();
let activePage = 'home';
const panelSession = crypto.randomUUID();
const panelReady = invoke('initialize_panel', { session: panelSession });
panelReady.catch(error => { status.textContent = String(error); });

function setOpen(value) {
  if (closed.hidden === value) return;
  clearTimeout(hoverTimer);
  if (value) {
    const preferred = preferences.remember_module ? preferences.last_module : null;
    if (!selectModule(preferred)) selectModule(preferences.default_module);
  } else {
    callModule('hide');
    window.poniMirror?.hide();
  }
  if (!value) keyboardOpen = false;
  closed.hidden = value;
  open.hidden = !value;
  surface.classList.toggle('panel-open', value);
  closed.setAttribute('aria-expanded', String(value));
  renderTodoReminder(false);
  updatePanelSize(value, value && keyboardOpen);
  if (value) {
    moduleTabs.get(activePage)?.scrollIntoView({block:'nearest', inline:'nearest'});
    callModule('show');
  }
  if (value) void refreshMedia();
  if (value) void refreshSystem();
}
function updatePanelSize(isOpen, focus = false) {
  const tall = isOpen && isTallPage(activePage);
  open.classList.toggle('tall', tall);
  const seq = ++panelSequence;
  const taskAlert = !isOpen && (!todoReminder.hidden || !bedtimeReminder.hidden);
  panelReady.then(() => invoke('set_panel_open', { session: panelSession, open: isOpen, tall, focus, seq, taskAlert }))
    .catch(error => { status.textContent = String(error); });
}

function selectModule(id) {
  const tab = moduleTabs.get(id);
  if (!tab || tab.hidden) return false;
  tab.click();
  return true;
}

function applyPreferences(value) {
  if (!value || !Array.isArray(value.module_order) || !Array.isArray(value.hidden_modules)) return;
  const previous = preferences;
  preferences = { ...preferences, ...value };
  const panel = preferences.panel;
  document.documentElement.dir = panel.direction === 'rtl' ? 'rtl' : 'ltr';
  surface.classList.toggle('floating', panel.top_gap > 0);
  surface.style.setProperty('--notch-width', panel.width + 'px');
  surface.style.setProperty('--notch-height', panel.height + 'px');
  surface.style.setProperty('--notch-opacity', String(panel.opacity / 100));
  window.poniNightWarmth.configure(panel);
  if (['top_gap', 'position', 'width', 'height', 'expanded_width', 'expanded_height', 'tall_height',
    'show_in_screenshots'].some(key => previous.panel[key] !== panel[key])) {
    updatePanelSize(!open.hidden);
  }
  if (previous.timer_remember !== preferences.timer_remember ||
      previous.timer_presets.join(',') !== preferences.timer_presets.join(',')) {
    if (!timerActive(data.timer)) chooseTimerMinutes(startingTimerMinutes());
    renderTimerPresets();
  }
  const order = new Set([...preferences.module_order, ...moduleTabs.keys()]);
  const hidden = new Set(preferences.hidden_modules);
  for (const id of order) {
    const tab = moduleTabs.get(id);
    if (tab) {
      tab.hidden = hidden.has(id);
      navigation.append(tab);
    }
  }
  if (moduleTabs.get(activePage)?.hidden) {
    if (!selectModule(preferences.default_module)) navigation.querySelector('.tab:not([hidden])')?.click();
  }
  document.querySelector('#header-clock').hidden = !preferences.header_clock;
  document.querySelector('#home-calendar').hidden = !preferences.calendar_enabled;
  window.poniMirror?.configure({enabled:preferences.mirror_enabled, shape:preferences.mirror_shape});
  if (!preferences.bedtime_reminder && bedtimeNotice) showBedtime(null);
  renderTodoReminder();
  if (activePage === 'tasks') renderTasks();
  updateClock();
  refreshWeekLayout();
}

function firstWeekday() {
  if (preferences.week_start === 'monday') return 1;
  if (preferences.week_start === 'sunday') return 0;
  return regionalFirstWeekday;
}

function refreshWeekLayout() {
  const first = firstWeekday();
  const list = document.querySelector('#task-repeat-days');
  for (let offset = 0; offset < 7; offset++) {
    list.append(repeatDays[(first + offset) % 7].parentElement);
  }
  if (activePage === 'calendar') renderMonthCalendar();
  if (activePage === 'dayprogress') renderDayProgress();
}

invoke('calendar_first_weekday').then(day => {
  if (day == null) {
    // Some WebViews expose the locale default when starting the app outside Windows.
    const locale = new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale);
    const first = (locale.getWeekInfo?.() || locale.weekInfo)?.firstDay;
    if (Number.isInteger(first) && first >= 1 && first <= 7) day = first % 7;
  }
  if (!Number.isInteger(day) || day < 0 || day > 6) return;
  regionalFirstWeekday = day;
  refreshWeekLayout();
}).catch(error => { status.textContent = String(error); });

window.poniMirror?.mount(document.querySelector('#mirror'));
window.poniFocusPlayback.listen().catch(error => { status.textContent = String(error); });
window.__TAURI__.event.listen('poni-settings-changed', event => applyPreferences(event.payload))
  .catch(error => { status.textContent = String(error); });
window.__TAURI__.event.listen('poni-todo-changed', () => {
  queue = queue.then(async () => {
    const updates = await invoke('get_todo_state');
    if (!updates) return;
    Object.assign(data, updates);
    renderTodoReminder();
    if (document.activeElement?.matches('#tasks input:not([type="checkbox"])')) {
      taskRedrawPending = true;
    } else {
      renderTasks();
    }
    renderMonthCalendar();
    renderCalendar();
    if (activePage === 'dayprogress' && !open.hidden) renderDayProgress();
  }).catch(error => { status.textContent = String(error); });
}).catch(error => { status.textContent = String(error); });
window.__TAURI__.event.listen('poni-day-schedule-changed', event => {
  Object.assign(data, event.payload);
  if (activePage === 'dayprogress') renderDayProgress();
}).catch(error => { status.textContent = String(error); });
window.__TAURI__.event.listen('poni-bedtime', event => showBedtime(event.payload))
  .catch(error => { status.textContent = String(error); });
window.__TAURI__.event.listen('poni-settings-open-module', event => {
  if (!moduleTabs.has(event.payload) || moduleTabs.get(event.payload).hidden) return;
  keyboardOpen = true;
  setOpen(true);
  selectModule(event.payload);
  updatePanelSize(true, true);
}).catch(error => { status.textContent = String(error); });

const compactPages = new Set(['home', 'dashboard', 'pomodoro', 'system', 'timer']);
function isTallPage(page) {
  return !compactPages.has(page);
}

function callModule(method) {
  const module = modules[activePage];
  if (!module) return;
  try {
    if (method === 'show' && !mountedModules.has(activePage)) {
      module.mount(document.getElementById('page-' + activePage));
      mountedModules.add(activePage);
    }
    if (mountedModules.has(activePage)) {
      Promise.resolve(module[method]?.()).catch(error => { status.textContent = String(error); });
    }
  } catch (error) {
    status.textContent = String(error);
  }
}
closed.addEventListener('click', () => setOpen(true));
closed.addEventListener('pointerenter', () => {
  clearTimeout(hoverTimer);
  if (!preferences.open_on_hover) return;
  if (preferences.hover_delay) hoverTimer = setTimeout(() => setOpen(true), preferences.hover_delay);
  else setOpen(true);
});
closed.addEventListener('pointerleave', () => clearTimeout(hoverTimer));
document.querySelector('#close').addEventListener('click', () => setOpen(false));
const settingsGear = document.getElementById('settings-gear');
settingsGear.addEventListener('click', async () => {
  settingsGear.disabled = true;
  try {
    await invoke('open_poni_settings');
    setOpen(false);
  } catch (error) {
    status.textContent = String(error);
  } finally {
    settingsGear.disabled = false;
  }
});
surface.addEventListener('pointerenter', () => clearTimeout(closeTimer));
surface.addEventListener('pointerleave', () => {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    if (!keyboardOpen && !surface.matches(':hover') && !document.activeElement.matches('input, textarea, select, [contenteditable="true"]')) setOpen(false);
  }, preferences.close_delay);
});
window.__TAURI__.event.listen('poni-toggle', () => {
  const shouldOpen = open.hidden;
  keyboardOpen = shouldOpen;
  setOpen(shouldOpen);
}).catch(error => { status.textContent = String(error); });
invoke('shortcut_status').then(available => {
  if (!available) status.textContent = 'Alt+N is already in use.';
}).catch(error => { status.textContent = String(error); });
document.addEventListener('keydown', event => {
  if (open.hidden) return;
  if (event.key === 'Escape') { setOpen(false); return; }
  if (!keyboardOpen || !preferences.module_shortcuts ||
      event.target.matches('input, textarea, select') || event.target.isContentEditable) return;
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const tabs = [...navigation.querySelectorAll('.tab:not([hidden])')];
  if (!tabs.length) return;
  const active = tabs.findIndex(tab => tab.classList.contains('active'));
  const next = event.key === 'ArrowRight' ? 1 : -1;
  const direction = document.documentElement.dir === 'rtl' ? -next : next;
  tabs[(active + direction + tabs.length) % tabs.length].click();
  event.preventDefault();
});

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  if (tab.hidden) return;
  const previousPage = activePage;
  if (tab.dataset.page !== activePage) {
    if (!open.hidden) callModule('hide');
    if (activePage === 'home') window.poniMirror?.hide();
    activePage = tab.dataset.page;
  }
  document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item === tab));
  document.querySelectorAll('.page').forEach(page => { page.hidden = page.id !== `page-${tab.dataset.page}`; });
  tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  open.querySelector('main').scrollTop = 0;
  if (!open.hidden && previousPage !== activePage) {
    if (isTallPage(previousPage) !== isTallPage(activePage)) {
      updatePanelSize(true);
    }
    callModule('show');
    if (preferences.remember_module) {
      const selected = activePage;
      preferences = { ...preferences, last_module: selected };
      clearTimeout(rememberTimer);
      rememberTimer = setTimeout(() => {
        preferenceQueue = preferenceQueue
          .then(() => invoke('remember_poni_module', {module:selected}))
          .catch(error => { status.textContent = String(error); });
      }, 150);
    }
  }
  if (tab.dataset.page === 'system') void refreshSystem();
  if (tab.dataset.page === 'dayprogress') renderDayProgress();
  if (tab.dataset.page === 'calendar') renderMonthCalendar();
}));
open.querySelector('nav').addEventListener('wheel', event => {
  const nav = event.currentTarget;
  if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || nav.scrollWidth <= nav.clientWidth) return;
  const scale = event.deltaMode === 1 ? 30 : event.deltaMode === 2 ? nav.clientWidth : 1;
  nav.scrollLeft += event.deltaY * scale;
  event.preventDefault();
}, { passive: false });
document.querySelectorAll('[data-media]').forEach(button => button.addEventListener('click', () => {
  invoke('media_control', { action: button.dataset.media }).then(() => setTimeout(refreshMedia, 500)).catch(error => { status.textContent = String(error); });
}));

async function refreshMedia() {
  if (mediaPending || open.hidden) return;
  mediaPending = true;
  try {
    const media = await invoke('current_media');
    document.querySelector('#media-title').textContent = media?.title || (media ? 'Unknown track' : 'Nothing playing');
    document.querySelector('#media-artist').textContent = media?.artist || (media ? 'Unknown artist' : 'Play something in a media player');
    document.querySelector('[data-media="toggle"]').textContent = media?.playing ? '❚❚' : '▶';
    const percentage = media?.duration_ms > 0 ? Math.max(0, Math.min(100, media.position_ms / media.duration_ms * 100)) : 0;
    document.querySelector('#media-progress-fill').style.width = `${percentage}%`;
  } catch (error) {
    document.querySelector('#media-title').textContent = 'Media unavailable';
    document.querySelector('#media-artist').textContent = String(error);
  } finally { mediaPending = false; }
}
setInterval(refreshMedia, 5000);

async function refreshSystem() {
  if (systemPending || open.hidden || document.querySelector('#page-system').hidden) return;
  systemPending = true;
  try {
    const sample = await invoke('system_snapshot');
    const cpu = sample.cpu_percent;
    const memoryPercent = sample.memory_total > 0 ? Math.min(100, sample.memory_used / sample.memory_total * 100) : null;
    document.querySelector('#system-cpu').textContent = cpu == null ? 'Unavailable' : `${Math.round(cpu)}%`;
    document.querySelector('#system-memory').textContent = memoryPercent == null ? 'Unavailable' : `${(sample.memory_used / 1073741824).toFixed(1)} / ${(sample.memory_total / 1073741824).toFixed(1)} GB`;
    document.querySelector('#system-cpu-bar').style.width = `${cpu == null ? 0 : cpu}%`;
    document.querySelector('#system-memory-bar').style.width = `${memoryPercent == null ? 0 : memoryPercent}%`;
    document.querySelector('#system-status').textContent = '';
  } catch (error) { document.querySelector('#system-status').textContent = String(error); }
  finally { systemPending = false; }
}
setInterval(refreshSystem, 3000);

function renderDayProgress(now = new Date()) {
  const clamp = value => Math.max(0, Math.min(1, value));
  const wakeMinute = data.wake_minute ?? 420, bedMinute = data.bed_minute ?? 1380;
  const wake = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, wakeMinute);
  const bed = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, bedMinute);
  if (bedMinute <= wakeMinute) {
    if (now < bed) wake.setDate(wake.getDate() - 1);
    else bed.setDate(bed.getDate() + 1);
  }
  const displayTime = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  document.querySelector('#day-wake-label').textContent = displayTime(wakeMinute);
  document.querySelector('#day-bed-label').textContent = displayTime(bedMinute);
  if (!document.activeElement.closest('#day-schedule')) { document.querySelector('#day-wake').value = displayTime(wakeMinute); document.querySelector('#day-bed').value = displayTime(bedMinute); }
  const day = clamp((now - wake) / (bed - wake));
  const left = Math.max(0, bed - now);
  document.querySelector('#day-percent').textContent = `${Math.round(day * 100)}%`;
  document.querySelector('#day-fill').style.width = `${day * 100}%`;
  document.querySelector('#day-remaining').textContent = left ? `of your day · ${Math.floor(left / 3600000)}h ${Math.floor(left % 3600000 / 60000)}m until bedtime` : 'of your day · past bedtime';
  renderDayAgenda(wake, bed);
  const week = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  week.setDate(week.getDate() - (week.getDay() - firstWeekday() + 7) % 7);
  const weekEnd = new Date(week); weekEnd.setDate(weekEnd.getDate() + 7);
  const periods = [
    ['Week', week, weekEnd],
    ['Month', new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1)],
    ['Year', new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear() + 1, 0, 1)],
  ];
  const container = document.querySelector('#day-periods'); container.replaceChildren();
  periods.forEach(([label, start, end]) => {
    const card = document.createElement('div'); const number = document.createElement('strong');
    number.textContent = `${Math.round(clamp((now - start) / (end - start)) * 100)}%`;
    card.append(document.createTextNode(label), number); container.append(card);
  });
}

function renderDayAgenda(wake, bed) {
  const marks = document.querySelector('#day-markers');
  const agenda = document.querySelector('#day-agenda');
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const firstDay = new Date(wake.getFullYear(), wake.getMonth(), wake.getDate());
  const lastDay = new Date(bed.getFullYear(), bed.getMonth(), bed.getDate());
  const days = +firstDay === +lastDay ? [firstDay] : [firstDay, lastDay];
  const entries = new Map();
  for (const date of days) {
    for (const {event, start} of occurrencesOnDay(date)) {
      const end = start + event.duration_minutes * 60000;
      if (start < bed && end > wake) entries.set(`${event.id}:${start}`, {heading: event.title, start, end});
    }
  }
  for (const task of data.tasks) {
    if (task.done && task.done_at_ms != null && task.done_at_ms >= wake && task.done_at_ms < bed) {
      entries.set(task.id, {heading: task.text, start: task.done_at_ms});
    }
  }
  const sorted = [...entries.values()].sort((a, b) => a.start - b.start);
  marks.replaceChildren();
  agenda.replaceChildren();
  const percentage = timestamp => 100 * (Math.min(+bed, Math.max(+wake, timestamp)) - wake) / (bed - wake);
  for (const entry of sorted) {
    const marker = document.createElement('span');
    const start = percentage(entry.start);
    marker.style.left = `${start}%`;
    const item = document.createElement('li');
    if (entry.end === undefined) {
      marker.className = 'finished';
      item.textContent = `${time.format(entry.start)} · Completed: ${entry.heading}`;
    } else {
      marker.style.width = `${Math.max(0.5, percentage(entry.end) - start)}%`;
      item.textContent = `${time.format(entry.start)}–${time.format(entry.end)} · ${entry.heading}`;
    }
    marks.append(marker);
    agenda.append(item);
  }
  if (!sorted.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No events or completed tasks in this schedule.';
    agenda.append(empty);
  }
}
setInterval(() => { if (!document.querySelector('#page-dayprogress').hidden) renderDayProgress(); }, 30000);
document.querySelector('#day-schedule').addEventListener('submit', async event => {
  event.preventDefault();
  const minutes = value => { const [h,m] = value.split(':').map(Number); return h * 60 + m; };
  const wake = minutes(document.querySelector('#day-wake').value), bed = minutes(document.querySelector('#day-bed').value);
  if (wake === bed) { status.textContent = 'Choose two different times.'; return; }
  if (await mutate('set_day_schedule', {wake, bed})) renderDayProgress();
});

function updateClock() {
  const now = new Date();
  const options = { hour: 'numeric', minute: '2-digit' };
  if (preferences.clock_format !== 'region') options.hourCycle = preferences.clock_format === 'h24' ? 'h23' : 'h12';
  const time = new Intl.DateTimeFormat(undefined, options).format(now);
  document.querySelectorAll('.clock').forEach(clock => { clock.textContent = time; });
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (today !== calendarToday) { calendarToday = today; if (calendarDay == null || calendarDay < today) calendarDay = today; renderCalendar(); }
}
function renderCalendar() {
  const today = new Date(calendarToday);
  const selected = new Date(calendarDay);
  document.querySelector('#month').textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(selected);
  const week = document.querySelector('#week');
  week.replaceChildren();
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.classList.toggle('today', offset === 0);
    cell.classList.toggle('selected', date.getTime() === calendarDay);
    cell.setAttribute('aria-label', new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(date));
    cell.setAttribute('aria-pressed', String(date.getTime() === calendarDay));
    cell.addEventListener('click', () => { calendarDay = date.getTime(); renderCalendar(); });
    const day = document.createElement('small');
    day.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date).slice(0, 2).toUpperCase();
    const number = document.createElement('span');
    number.textContent = date.getDate();
    cell.append(day, number);
    week.append(cell);
  }
  const list = document.querySelector('#home-events'); list.replaceChildren();
  const occurrences = occurrencesOnDay(selected);
  if (!occurrences.length) list.textContent = (data.calendar_events || []).length ? 'No events' : 'No calendars yet.';
  occurrences.forEach(({event, start}) => {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = `${new Date(start).toLocaleTimeString(undefined, {hour:'numeric',minute:'2-digit'})} · ${event.title}`;
    button.addEventListener('click', () => { selectedDate = selected; displayedMonth = new Date(selected.getFullYear(), selected.getMonth(), 1); document.querySelector('[data-page="calendar"]').click(); });
    list.append(button);
  });
}
updateClock();
setInterval(updateClock, 1000);

function mutate(command, args) {
  const operation = queue.then(async () => {
    data = await invoke(command, typeof args === 'function' ? args(data) : args);
    status.textContent = '';
    render();
    return true;
  });
  queue = operation.catch(error => { status.textContent = String(error); return false; });
  return queue;
}

function importCalendarFile(text) {
  const operation = queue.then(async () => {
    const result = await invoke('import_calendar_ics', {text});
    data = result.data;
    render();
    return result.summary;
  });
  queue = operation.catch(() => {});
  return operation;
}

function action(label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function reminderCandidate(now) {
  return data.tasks.reduce((first, task) => {
    const due = task.due_at_ms;
    if (task.done || due == null || due > now || now - due > 12 * 60 * 60_000) return first;
    return !first || due < first.due_at_ms ? task : first;
  }, null);
}

function renderTodoReminder(resize = true) {
  reminderTask = open.hidden && !bedtimeNotice ? reminderCandidate(Date.now()) : null;
  const hidden = !reminderTask;
  const changed = todoReminder.hidden !== hidden;
  todoReminder.hidden = hidden;
  if (reminderTask) {
    const text = document.querySelector('#todo-reminder-text');
    const label = 'Due: ' + reminderTask.text;
    if (text.textContent !== label) text.textContent = label;
    text.title = label;
    const snooze = document.querySelector('#todo-reminder-snooze');
    snooze.title = `Snooze for ${preferences.todo.snooze_minutes} minutes`;
  }
  if (resize && changed) updatePanelSize(!open.hidden);
}

function showBedtime(notice) {
  clearTimeout(bedtimeTimer);
  bedtimeNotice = notice?.expires_at_ms > Date.now() ? notice : null;
  bedtimeReminder.hidden = !bedtimeNotice;
  if (bedtimeNotice) {
    const scheduled = new Date(bedtimeNotice.scheduled_for_ms);
    const time = new Intl.DateTimeFormat(undefined, {hour:'numeric', minute:'2-digit'}).format(scheduled);
    document.querySelector('#bedtime-reminder-text').textContent = `It’s bedtime · ${time}`;
    const snooze = document.querySelector('#bedtime-snooze');
    snooze.title = `Snooze for ${preferences.todo.snooze_minutes} minutes`;
    bedtimeTimer = setTimeout(() => showBedtime(null), bedtimeNotice.expires_at_ms - Date.now());
  }
  renderTodoReminder(false);
  if (open.hidden) updatePanelSize(false);
}

for (const [id, action] of [['bedtime-dismiss', 'dismiss'], ['bedtime-snooze', 'snooze']]) {
  document.getElementById(id).addEventListener('click', async () => {
    if (!bedtimeNotice) return;
    const notice = bedtimeNotice;
    try {
      await invoke('bedtime_action', {action, expiresAtMs:notice.expires_at_ms});
      if (bedtimeNotice === notice) showBedtime(null);
    } catch (error) {
      status.textContent = String(error);
    }
  });
}

function snoozeTask(task) {
  return mutate('snooze_task', { id: task.id, dueAtMs: task.due_at_ms });
}

for (const [id, submit] of [
  ['todo-reminder-complete', task => mutate('toggle_task', {id: task.id})],
  ['todo-reminder-snooze', snoozeTask],
]) {
  document.getElementById(id).addEventListener('click', async () => {
    if (!reminderTask || reminderBusy) return;
    reminderBusy = true;
    await submit(reminderTask);
    reminderBusy = false;
  });
}
setInterval(renderTodoReminder, 5000);

function trashedItems() {
  const now = Date.now();
  const keep = preferences.todo.trash_days * 86_400_000;
  return (data.trashed_tasks || []).filter(item => now - item.deleted_at_ms < keep);
}

function renderTasks() {
  taskRedrawPending = false;
  const tasks = document.querySelector('#tasks');
  tasks.replaceChildren();
  const trashed = trashedItems();
  const active = data.tasks.filter(task => !task.done);
  const done = data.tasks.filter(task => task.done);
  for (const view of document.querySelectorAll('[data-task-view]')) {
    const id = view.dataset.taskView;
    const count = {active: active.length, done: done.length, trash: trashed.length}[id];
    const name = {active:'Active', done:'Done', trash:'Trash'}[id];
    view.textContent = count ? `${name} ${count}` : name;
    view.setAttribute('aria-pressed', String(id === taskView));
  }
  const clear = document.querySelector('#task-clear');
  clear.hidden = taskView === 'active' || !(taskView === 'trash' ? trashed.length : done.length);
  clear.textContent = taskView === 'trash' ? 'Empty Trash' : 'Clear completed';
  document.querySelector('#task-form').hidden = taskView !== 'active' && !editingTask;
  if (taskView === 'trash') {
    for (const {task, deleted_at_ms} of trashed.slice().sort((a,b) => b.deleted_at_ms - a.deleted_at_ms)) {
      const row = document.createElement('div');
      row.className = 'item';
      const contents = document.createElement('span');
      contents.className = 'task-content';
      contents.textContent = task.text;
      const restore = action('Restore', () => mutate('change_task_trash', {action:'restore', id:task.id}));
      restore.setAttribute('aria-label', `Restore ${task.text}`);
      const remove = action('Delete forever', () => {
        if (window.confirm(`Permanently delete “${task.text}”?`)) void mutate('change_task_trash', {action:'delete', id:task.id});
      });
      remove.setAttribute('aria-label', `Delete ${task.text} forever`);
      row.append(contents, restore, remove);
      tasks.append(row);
    }
    if (!trashed.length) tasks.textContent = `Trash is empty · items are kept ${preferences.todo.trash_days} days`;
    return;
  }
  const visible = taskView === 'done'
    ? done.slice().sort((a,b) => (b.done_at_ms ?? 0) - (a.done_at_ms ?? 0))
    : active.slice().sort((a,b) => (a.due_at_ms ?? Infinity) - (b.due_at_ms ?? Infinity));
  visible.forEach(task => {
    const row = document.createElement('div'); row.className = 'item';
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = task.done; check.setAttribute('aria-label', `Complete ${task.text}`);
    check.addEventListener('change', () => mutate('toggle_task', { id: task.id }));
    const content = document.createElement('div'); content.className = 'task-content';
    const text = document.createElement('p'); text.textContent = task.text; text.classList.toggle('done', task.done); content.append(text);
    if (task.due_at_ms != null) { const due = document.createElement('small'); due.textContent = new Date(task.due_at_ms).toLocaleString(); content.append(due); }
    if (task.auto_done) {
      const late = document.createElement('small');
      late.textContent = 'Completed automatically';
      content.append(late);
    }
    if (task.description) { const detail = document.createElement('small'); detail.textContent = task.description; content.append(detail); }
    if (task.repeat) {
      const label = document.createElement('small');
      const days = task.repeat.days.map(day => taskDayNames[day]).join(', ');
      label.textContent = `Repeats ${days} · ${taskTimeLabel(task.repeat.minute)}`;
      content.append(label);
    }
    const edit = action('Edit', () => {
      editingTask = task.id;
      document.querySelector('#task-form').hidden = false;
      document.querySelector('#task-input').value = task.text;
      document.querySelector('#task-late').value = task.late_minutes ?? '';
      const due = document.querySelector('#task-due');
      if (task.due_at_ms != null) { const date = new Date(task.due_at_ms); due.value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
      else due.value = '';
      const description = document.querySelector('#task-description'); description.value = task.description || ''; description.hidden = false;
      for (const input of repeatDays) {
        input.checked = task.repeat?.days.includes(Number(input.value)) ?? false;
        input.disabled = task.done;
      }
      repeatTime.value = task.repeat ? taskTimeLabel(task.repeat.minute) : '';
      document.querySelector('#task-repeat').open = Boolean(task.repeat);
      document.querySelector('#task-submit').textContent = 'Save'; document.querySelector('#task-cancel').hidden = false;
    });
    edit.setAttribute('aria-label', `Edit ${task.text}`);
    const remove = action('Delete', async () => { if (await mutate('remove_task', { id: task.id }) && editingTask === task.id) resetTaskForm(); });
    remove.setAttribute('aria-label', `Delete ${task.text}`);
    const card = document.createElement('div');
    card.className = 'task-card';
    const steps = task.steps || [];
    const stepsPanel = taskStepsPanel(task, steps);
    const details = action(steps.length ? `Steps ${steps.filter(step => step.done).length}/${steps.length}` : 'Steps', () => {
      if (expandedTasks.has(task.id)) expandedTasks.delete(task.id);
      else expandedTasks.add(task.id);
      stepsPanel.hidden = !expandedTasks.has(task.id);
      details.setAttribute('aria-expanded', String(!stepsPanel.hidden));
    });
    details.setAttribute('aria-label', `Steps for ${task.text}`);
    details.setAttribute('aria-expanded', String(!stepsPanel.hidden));
    row.append(check, content, details, edit, remove);
    if (!task.done && task.due_at_ms != null && task.due_at_ms <= Date.now()) {
      const snooze = action('Snooze', () => snoozeTask(task));
      snooze.setAttribute('aria-label', `Snooze ${task.text}`);
      snooze.title = `Postpone for ${preferences.todo.snooze_minutes} minutes`;
      row.append(snooze);
    }
    card.append(row, stepsPanel);
    tasks.append(card);
  });
  if (!visible.length) tasks.textContent = taskView === 'done' ? 'No completed tasks yet' : 'No active tasks';
}

document.querySelectorAll('[data-task-view]').forEach(button => button.addEventListener('click', () => {
  taskView = button.dataset.taskView;
  resetTaskForm();
  renderTasks();
}));
document.querySelector('#tasks').addEventListener('focusout', () => {
  if (taskRedrawPending) setTimeout(() => {
    if (!document.activeElement?.matches('#tasks input:not([type="checkbox"])')) renderTasks();
  }, 0);
});
document.querySelector('#task-clear').addEventListener('click', () => {
  if (taskView === 'trash') {
    if (window.confirm('Permanently delete all tasks in Trash?')) void mutate('change_task_trash', { action:'empty' });
  } else {
    void mutate('change_task_trash', { action:'clear_completed' });
  }
});

function render() {
  renderTasks();
  renderTodoReminder();
  renderTimer();
  renderStopwatch();
  renderMonthCalendar();
  renderCalendar();
}

function taskStepsPanel(task, steps) {
  const panel = document.createElement('div');
  panel.className = 'task-steps';
  panel.hidden = !expandedTasks.has(task.id);
  for (const step of steps) {
    const row = document.createElement('div');
    row.className = 'task-step';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = step.done;
    check.setAttribute('aria-label', `Complete step ${step.text}`);
    check.addEventListener('change', () => mutate('update_task_step', {taskId: task.id, stepId: step.id, action:'toggle'}));
    const text = document.createElement('span');
    text.textContent = step.text;
    text.classList.toggle('done', step.done);
    const remove = action('Remove', () => mutate('update_task_step', {taskId: task.id, stepId: step.id, action:'remove'}));
    remove.setAttribute('aria-label', `Remove step ${step.text}`);
    row.append(check, text, remove);
    panel.append(row);
  }
  const form = document.createElement('form');
  form.className = 'task-step';
  const input = document.createElement('input');
  input.setAttribute('aria-label', 'New step');
  input.placeholder = 'Add a step';
  input.maxLength = 500;
  input.required = true;
  const submit = document.createElement('button');
  submit.textContent = 'Add step';
  form.append(input, submit);
  form.addEventListener('submit', event => {
    event.preventDefault();
    void mutate('update_task_step', {taskId: task.id, action:'add', text:input.value});
  });
  panel.append(form);
  return panel;
}

function occurrencesOnDay(day, events = data.calendar_events || []) {
  const startDay = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const endDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  const previousDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1);
  const result = [];
  for (const event of events) {
    const original = new Date(event.start_ms);
    if (!Number.isFinite(original.getTime())) continue;
    if (!event.repeat || event.repeat === 'none') {
      if (event.start_ms < endDay && event.start_ms + event.duration_minutes * 60000 > startDay) result.push({event, start:event.start_ms});
      continue;
    }
    for (const date of [previousDay, startDay]) {
      const diff = (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(original.getFullYear(), original.getMonth(), original.getDate())) / 86400000;
      if (diff < 0) continue;
      const matches = event.repeat === 'daily' || (event.repeat === 'weekly' && diff % 7 === 0) || (event.repeat === 'monthly' && date.getDate() === original.getDate()) || (event.repeat === 'yearly' && date.getDate() === original.getDate() && date.getMonth() === original.getMonth());
      if (!matches) continue;
      const occurrence = new Date(date.getFullYear(), date.getMonth(), date.getDate(), original.getHours(), original.getMinutes(), original.getSeconds(), original.getMilliseconds()).getTime();
      if (occurrence >= event.start_ms && occurrence < endDay && occurrence + event.duration_minutes * 60000 > startDay) result.push({event, start:occurrence});
    }
  }
  return result.sort((a, b) => a.start - b.start);
}

function localInputDate(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function resetEventForm() {
  editingEvent = null;
  document.querySelector('#calendar-form').reset();
  const start = new Date(selectedDate); start.setHours(9);
  document.querySelector('#event-start').value = localInputDate(start);
  document.querySelector('#event-submit').textContent = 'Add event';
  document.querySelector('#event-cancel').hidden = true;
}
const hijriMonths = ['Muharram', 'Safar', 'Rabi al-Awwal', 'Rabi al-Thani', 'Jumada al-Ula', 'Jumada al-Akhirah', 'Rajab', 'Sha’ban', 'Ramadan', 'Shawwal', 'Dhu al-Qa’dah', 'Dhu al-Hijjah'];
let hijriFormatter = null;
try {
  const formatter = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {day:'numeric', month:'numeric', year:'numeric', timeZone:'UTC'});
  if (formatter.resolvedOptions().calendar === 'islamic-umalqura') hijriFormatter = formatter;
} catch { /* civil calendar fallback */ }
function hijriDate(date, offset) {
  const days = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000) + offset;
  if (hijriFormatter) {
    const parts = Object.fromEntries(hijriFormatter.formatToParts(new Date(days * 86400000 + 43200000)).map(part => [part.type, part.value]));
    const day = Number(parts.day), month = Number(parts.month), year = Number(parts.year);
    if (day && month >= 1 && month <= 12 && year) return {day, month, year};
  }
  const epoch = -492148;
  const start = (year, month) => Math.ceil(29.5 * (month - 1)) + (year - 1) * 354 + Math.floor((3 + 11 * year) / 30) + epoch;
  const year = Math.floor((30 * (days - epoch) + 10646) / 10631);
  const month = Math.min(12, Math.ceil((days - 29 - start(year, 1)) / 29.5) + 1);
  return {day:days - start(year, month) + 1, month, year};
}
function hijriText(date, offset) {
  const h = hijriDate(date, offset); return `${h.day} ${hijriMonths[h.month - 1]} ${h.year} AH`;
}
function hijriRange(date, offset) {
  const first = hijriDate(new Date(date.getFullYear(), date.getMonth(), 1), offset);
  const last = hijriDate(new Date(date.getFullYear(), date.getMonth() + 1, 0), offset);
  const a = hijriMonths[first.month - 1], b = hijriMonths[last.month - 1];
  if (first.month === last.month && first.year === last.year) return `${a} ${first.year} AH`;
  if (first.year === last.year) return `${a} – ${b} ${last.year} AH`;
  return `${a} ${first.year} – ${b} ${last.year} AH`;
}
function renderMonthCalendar() {
  const grid = document.querySelector('#calendar-grid'); grid.replaceChildren();
  document.querySelector('#calendar-month').textContent = new Intl.DateTimeFormat(undefined, { month:'long', year:'numeric' }).format(displayedMonth);
  const first = firstWeekday();
  const weekdayLabel = new Intl.DateTimeFormat(undefined, {weekday:'short'});
  for (let i = 0; i < 7; i++) {
    const day = document.createElement('span');
    const date = new Date(2024, 0, 7 + (first + i) % 7);
    day.textContent = weekdayLabel.format(date);
    grid.append(day);
  }
  const lead = (displayedMonth.getDay() - first + 7) % 7;
  for (let i = 0; i < 42; i++) {
    const date = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth(), 1 - lead + i);
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    const button = document.createElement('button'); button.type = 'button'; button.textContent = date.getDate();
    button.classList.toggle('out', date.getMonth() !== displayedMonth.getMonth());
    button.classList.toggle('selected', date.getTime() === selectedDate.getTime());
    button.classList.toggle('has-event', occurrencesOnDay(date).length > 0 || data.tasks.some(t => t.due_at_ms != null && t.due_at_ms >= date.getTime() && t.due_at_ms < end));
    button.setAttribute('aria-label', new Intl.DateTimeFormat(undefined, {dateStyle:'full'}).format(date));
    button.addEventListener('click', () => { selectedDate = date; displayedMonth = new Date(date.getFullYear(), date.getMonth(), 1); resetEventForm(); renderMonthCalendar(); }); grid.append(button);
  }
  document.querySelector('#calendar-selected').textContent = new Intl.DateTimeFormat(undefined, {dateStyle:'full'}).format(selectedDate);
  const offset = data.hijri_offset ?? 0;
  document.querySelector('#calendar-hijri-range').textContent = hijriRange(displayedMonth, offset);
  document.querySelector('#calendar-hijri-day').textContent = hijriText(selectedDate, offset);
  document.querySelector('#hijri-offset').value = String(offset);
  const end = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 1).getTime();
  const items = document.querySelector('#calendar-items'); items.replaceChildren();
  occurrencesOnDay(selectedDate).forEach(({event, start}) => {
    const row = document.createElement('div'); row.className = 'calendar-item';
    const text = document.createElement('span'); text.textContent = `${new Date(start).toLocaleTimeString(undefined, {hour:'numeric',minute:'2-digit'})} · ${event.title}${event.location ? ` · ${event.location}` : ''}`;
    const edit = action('Edit', () => { editingEvent = event.id; document.querySelector('#event-title').value = event.title; document.querySelector('#event-start').value = localInputDate(new Date(event.start_ms)); document.querySelector('#event-duration').value = event.duration_minutes; document.querySelector('#event-repeat').value = event.repeat || 'none'; document.querySelector('#event-location').value = event.location; document.querySelector('#event-submit').textContent = 'Save'; document.querySelector('#event-cancel').hidden = false; });
    edit.setAttribute('aria-label', `Edit event ${event.title}`);
    const remove = action('Delete', async () => {
      const message = event.repeat && event.repeat !== 'none' ? 'Delete this event and all its repeats?' : 'Delete this event?';
      if (!window.confirm(message)) return;
      if (await mutate('remove_calendar_event', {id:event.id}) && editingEvent === event.id) resetEventForm();
    }); remove.setAttribute('aria-label', `Delete event ${event.title}`);
    row.append(text, edit, remove); items.append(row);
  });
  data.tasks.filter(t => t.due_at_ms >= selectedDate.getTime() && t.due_at_ms < end).forEach(task => { const row = document.createElement('div'); row.className = 'calendar-item'; row.textContent = `${new Date(task.due_at_ms).toLocaleTimeString(undefined, {hour:'numeric',minute:'2-digit'})} · ${task.text} · Todo`; items.append(row); });
  if (!document.querySelector('#event-start').value) resetEventForm();
}
document.querySelector('#calendar-prev').addEventListener('click', () => { displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() - 1, 1); renderMonthCalendar(); });
document.querySelector('#calendar-next').addEventListener('click', () => { displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + 1, 1); renderMonthCalendar(); });
document.querySelector('#hijri-offset').addEventListener('change', async event => { if (!await mutate('set_hijri_offset', {offset:Number(event.target.value)})) renderMonthCalendar(); });
document.querySelector('#event-cancel').addEventListener('click', resetEventForm);
document.querySelector('#calendar-form').addEventListener('submit', async event => {
  event.preventDefault(); const startMs = new Date(document.querySelector('#event-start').value).getTime();
  if (!Number.isFinite(startMs) || startMs < 0) { status.textContent = 'Choose a valid event date.'; return; }
  const args = { id:editingEvent, title:document.querySelector('#event-title').value, startMs, durationMinutes:Number(document.querySelector('#event-duration').value), location:document.querySelector('#event-location').value, repeat:document.querySelector('#event-repeat').value };
  if (await mutate('save_calendar_event', args)) { const date = new Date(startMs); selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()); displayedMonth = new Date(date.getFullYear(), date.getMonth(), 1); resetEventForm(); renderMonthCalendar(); }
});

function timerActive(timer) {
  return timer.ends_at_ms == null
    ? timer.remaining_ms > 0 && timer.remaining_ms < timer.total_ms
    : timer.ends_at_ms > Date.now();
}

function startingTimerMinutes() {
  const timer = data.timer;
  const legacyMinutes = timer.total_ms === 1_500_000 ? null : timer.total_ms / 60_000;
  const last = preferences.timer_remember ? timer.last_started_minutes ?? legacyMinutes : null;
  return last || preferences.timer_presets[0] || 25;
}

function chooseTimerMinutes(minutes) {
  document.querySelector('#timer-minutes').value = minutes;
}

function renderTimerPresets() {
  const presets = document.querySelector('#timer-presets');
  presets.replaceChildren(...preferences.timer_presets.map(minutes => {
    const button = action(`${minutes} min`, () => {
      chooseTimerMinutes(minutes);
      renderTimer();
    });
    button.dataset.minutes = minutes;
    return button;
  }));
  renderTimer();
}

let wasTimerActive = false;
function renderTimer() {
  const timer = data.timer;
  const active = timerActive(timer);
  if (wasTimerActive && !active) chooseTimerMinutes(startingTimerMinutes());
  wasTimerActive = active;
  const input = document.querySelector('#timer-minutes');
  const remaining = active
    ? timer.ends_at_ms == null ? timer.remaining_ms : Math.max(0, timer.ends_at_ms - Date.now())
    : (input.validity.valid ? input.valueAsNumber : 0) * 60_000;
  const seconds = Math.ceil(remaining / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const format = value => String(value).padStart(2, '0');
  document.querySelector('#timer-display').textContent = `${hours ? `${hours}:` : ''}${format(minutes)}:${format(seconds % 60)}`;
  document.querySelector('#timer-start').textContent = active && timer.ends_at_ms != null ? 'Pause' : 'Start';
  for (const button of document.querySelectorAll('#timer-presets button')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.minutes) === input.valueAsNumber));
  }
}

setInterval(renderTimer, 1000);
function stopwatchValue(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor(ms % 3600000 / 60000);
  const seconds = Math.floor(ms % 60000 / 1000);
  const format = value => String(value).padStart(2, '0');
  return `${hours ? `${hours}:` : ''}${format(minutes)}:${format(seconds)}.${Math.floor(ms % 1000 / 100)}`;
}
function renderStopwatch() {
  const sw = data.stopwatch;
  const elapsed = sw.elapsed_ms + (sw.started_at_ms == null ? 0 : Math.max(0, Date.now() - sw.started_at_ms));
  document.querySelector('#stopwatch-display').textContent = stopwatchValue(elapsed);
  document.querySelector('#stopwatch-start').textContent = sw.started_at_ms == null ? 'Start' : 'Pause';
  const laps = document.querySelector('#stopwatch-laps');
  laps.replaceChildren();
  sw.laps.slice(-3).reverse().forEach((time, index) => {
    const row = document.createElement('div');
    row.textContent = `Lap ${sw.laps.length - index} · ${stopwatchValue(time)}`;
    laps.append(row);
  });
}
setInterval(() => { if (data.stopwatch.started_at_ms != null) renderStopwatch(); }, 100);

const taskDayNames = [...Array(7)].map((_, day) =>
  new Intl.DateTimeFormat(undefined, {weekday:'short'}).format(new Date(2026, 0, 4 + day)));
const repeatTime = document.querySelector('#task-repeat-time');
const repeatDays = taskDayNames.map((name, day) => {
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.value = day;
  label.append(box, ' ' + name);
  document.querySelector('#task-repeat-days').append(label);
  return box;
});
const taskTimeLabel = minute => [Math.floor(minute / 60), minute % 60]
  .map(part => String(part).padStart(2, '0')).join(':');

function resetTaskForm() {
  editingTask = null;
  document.querySelector('#task-form').reset();
  document.querySelector('#task-form').hidden = taskView !== 'active';
  document.querySelector('#task-description').hidden = true;
  document.querySelector('#task-cancel').hidden = true;
  document.querySelector('#task-submit').textContent = 'Add';
  document.querySelector('#task-repeat').open = false;
  repeatDays.forEach(input => { input.disabled = false; });
}
document.querySelector('#task-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = document.querySelector('#task-input');
  const dueText = document.querySelector('#task-due').value;
  const dueAtMs = dueText ? new Date(dueText).getTime() : null;
  if (dueAtMs != null && (!Number.isFinite(dueAtMs) || dueAtMs < 0)) { status.textContent = 'Choose a valid due date.'; return; }
  const days = repeatDays.filter(box => box.checked).map(box => Number(box.value));
  if (days.length && !repeatTime.value) { status.textContent = 'Choose a repeat time.'; return; }
  const [hour, minute] = repeatTime.value.split(':').map(Number);
  const repeat = days.length ? {days, minute: hour * 60 + minute} : null;
  const late = document.querySelector('#task-late').value;
  const args = { text: input.value, dueAtMs, repeat, lateMinutes: late === '' ? null : Number(late) };
  if (editingTask) Object.assign(args, { id: editingTask, description: document.querySelector('#task-description').value });
  if (await mutate(editingTask ? 'update_task' : 'add_task', args)) resetTaskForm();
});
document.querySelector('#task-cancel').addEventListener('click', resetTaskForm);
document.querySelector('#timer-form').addEventListener('submit', event => {
  event.preventDefault();
  const timer = data.timer;
  const running = timer.ends_at_ms != null && timer.ends_at_ms > Date.now();
  const minutes = Number(document.querySelector('#timer-minutes').value);
  const changed = minutes * 60000 !== timer.total_ms;
  mutate('timer_action', { action: running ? 'pause' : 'start', minutes: running || (!changed && timer.remaining_ms < timer.total_ms) ? null : minutes });
});
document.querySelector('#timer-minutes').addEventListener('input', renderTimer);
document.querySelector('#timer-reset').addEventListener('click', async () => {
  if (await mutate('timer_action', { action: 'reset', minutes: null })) {
    chooseTimerMinutes(startingTimerMinutes());
    renderTimer();
  }
});
document.querySelectorAll('[data-timer-mode]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-timer-mode]').forEach(item => item.classList.toggle('active', item === button));
  document.querySelector('#timer-countdown').hidden = button.dataset.timerMode !== 'countdown';
  document.querySelector('#timer-stopwatch').hidden = button.dataset.timerMode !== 'stopwatch';
}));
document.querySelector('#stopwatch-start').addEventListener('click', () => mutate('stopwatch_action', { action: data.stopwatch.started_at_ms == null ? 'start' : 'pause' }));
document.querySelector('#stopwatch-lap').addEventListener('click', () => mutate('stopwatch_action', { action: 'lap' }));
document.querySelector('#stopwatch-reset').addEventListener('click', () => mutate('stopwatch_action', { action: 'reset' }));

function weatherDescription(code) {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 95) return 'Thunderstorm';
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'Snow';
  if (code >= 51 && code <= 82) return 'Rain';
  return 'Weather';
}

async function loadWeather(location) {
  const request = ++weatherRequest;
  const weatherStatus = document.querySelector('#weather-status');
  weatherStatus.textContent = 'Loading weather…';
  document.querySelector('#weather-current').textContent = '';
  document.querySelector('#weather-days').replaceChildren();
  try {
    const forecast = await invoke('weather_forecast', { location });
    if (request !== weatherRequest) return;
    const current = forecast.current;
    weatherStatus.textContent = [location.name, location.admin1, location.country].filter(Boolean).join(', ');
    document.querySelector('#weather-current').textContent = `${Math.round(current.temperature_2m)}°C · ${weatherDescription(current.weather_code)} · ${Math.round(current.relative_humidity_2m)}% · ${Math.round(current.wind_speed_10m)} km/h`;
    const days = document.querySelector('#weather-days');
    days.replaceChildren();
    forecast.daily.time.slice(0, 7).forEach((date, index) => {
      const item = document.createElement('span');
      const day = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(`${date}T12:00:00`));
      item.textContent = `${day} ${Math.round(forecast.daily.temperature_2m_max[index])}° / ${Math.round(forecast.daily.temperature_2m_min[index])}°`;
      days.append(item);
    });
  } catch (error) {
    if (request === weatherRequest) weatherStatus.textContent = `Weather unavailable: ${String(error)}`;
  }
}

document.querySelector('#weather-search').addEventListener('submit', async event => {
  event.preventDefault();
  const request = ++searchRequest;
  const weatherStatus = document.querySelector('#weather-status');
  const results = document.querySelector('#weather-results');
  results.replaceChildren();
  weatherStatus.textContent = 'Searching…';
  try {
    const cities = await invoke('search_weather_city', { query: document.querySelector('#weather-city').value.trim() });
    if (request !== searchRequest) return;
    weatherStatus.textContent = cities.length ? 'Choose a city' : 'No cities found';
    cities.forEach(city => {
      const button = action([city.name, city.admin1, city.country].filter(Boolean).join(', '), async () => {
        if (await mutate('set_weather_location', { location: city })) {
          results.replaceChildren();
          void loadWeather(city);
        }
      });
      results.append(button);
    });
  } catch (error) {
    if (request === searchRequest) weatherStatus.textContent = `Search failed: ${String(error)}`;
  }
});

queue = invoke('get_data').then(saved => {
  data = saved;
  applyPreferences(data.settings);
  chooseTimerMinutes(timerActive(data.timer) ? data.timer.total_ms / 60_000 : startingTimerMinutes());
  render();
  if (data.weather_location) void loadWeather(data.weather_location);
}).catch(error => { status.textContent = String(error); });
window.poniIcsImport?.mount(document.getElementById('calendar-import'), importCalendarFile);

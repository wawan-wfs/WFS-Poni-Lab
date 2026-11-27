'use strict';

const invoke = window.__TAURI__.core.invoke;
const surface = document.querySelector('#surface');
const closed = document.querySelector('#closed');
const closedClock = closed.querySelector('.closed-clock');
const closedDay = document.querySelector('#closed-day');
const greeting = document.querySelector('#closed-greeting');
const closedDisplay = window.poniClosedDisplay;
const closedSlots = [...closed.querySelectorAll('.closed-slot')];
const open = document.querySelector('#open');
const hideNotch = document.querySelector('#hide-notch');
const status = document.querySelector('#status');
const todoReminder = document.querySelector('#todo-reminder');
const bedtimeReminder = document.querySelector('#bedtime-reminder');
const timerReminder = document.querySelector('#timer-reminder');
const healthReminder = document.querySelector('#health-reminder');
const liveActivity = document.querySelector('#notch-live');
const liveTitle = document.querySelector('#notch-live-title');
const liveTime = document.querySelector('#notch-live-time');
const closedMediaControls = document.querySelector('#closed-media-controls');
const closedMusicProgress = document.querySelector('#closed-music-progress');
const closedArtwork = document.querySelector('#closed-media-artwork');
const homeArtwork = document.querySelector('#media-artwork');
const artworkFallback = document.querySelector('#media-artwork-fallback');
const musicPeek = document.querySelector('#music-peek');
let liveIndex = 0;
let currentLive = null;
let mediaSnapshot;
let mediaSampleAt = 0;
let artworkUrl = '';
let lastMediaCheck = 0;
let hourGlowTimer;
let musicPeekTimer;
let lastSystemPeek = Date.now();
let systemPeek = null;
let systemPeekPending = false;
let bluetoothPeek = null;
let idleSystemSample = null;
let idleSystemPending = false;
let nextIdleSystemSample = 0;
let currentWeather = null;
let closedWidth = 0;
let greetingTimer;
let nextGreetingCheck = Date.now() + 4000;
let lastGreetingDay = null;
let greetingPending = false;
let preferencesLoaded = false;
let data = { tasks: [], notes: [], timer: { total_ms: 1500000, remaining_ms: 1500000, ends_at_ms: null }, stopwatch: { elapsed_ms: 0, started_at_ms: null, laps: [] }, weather_location: null, world_clocks: [], calendar_events: [] };
let editingTask = null;
let ignoreTaskLanguage = false;
let taskView = 'active';
let reminderTask = null;
let reminderBusy = false;
let taskRedrawPending = false;
let bedtimeNotice = null;
let bedtimeTimer = null;
let timerNotice = null;
let timerNoticeTimeout = null;
let lastTimerNoticeEnd = null;
let healthNotice = null;
let healthNoticeTimeout = null;
const expandedTasks = new Set();
let queue = Promise.resolve();
let panelSequence = 0;
let closeTimer = null;
let hoverTimer = null;
let rememberTimer = null;
let preferenceQueue = Promise.resolve();
let mediaPending = false;
let keyboardOpen = false;
let notchTucked = false;
let lastNotchRightClick = 0;
let notchDrag = null;
let suppressPanelClick = false;
let moveRequest = Promise.resolve();
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
  user_name: '', closed_display: closedDisplay.defaults,
  clock_format: 'region', clock_with_activities: true, header_clock: true, open_on_hover: true,
  media_enabled: true, music_progress: true, color_glow: true,
  haptics: true, battery_saving: 'off',
  animations: { timer_outline:true, shelf_fly:true, tab_slide:true, shadow:'off', celebrate:true },
  hover_delay: 0, close_delay: 450, module_shortcuts: true,
  module_order: [], hidden_modules: [], default_module: 'home',
  remember_module: false, last_module: null,
  mirror_enabled: true, mirror_shape: 'rounded', calendar_enabled: true, week_start: 'windows',
  timer_presets: [], timer_remember: true,
  todo: { late_minutes: 0, snooze_minutes: 10, trash_days: 7 },
  bedtime_reminder: false,
  live: { enabled:true, rotate:true, timers:true, calendar:true, bluetooth:true, todo:true, music:true,
    system:false, system_interval:120, sneak_peek:false, hover_media_controls:false },
  bluetooth: { enabled:true, low_threshold:20 },
  shelf: { enabled:true, open_on_drag:true, remove_after_drag:false },
  panel: { direction: 'auto', top_gap: 0, position: 50, width: 200, height: 32, opacity: 100,
    enabled: true, display: 'primary', lock_position: false, hide_in_fullscreen: true, auto_hide: false,
    standby_show: false, standby_secs: 12, hide_button: false,
    expanded_width: 680, expanded_height: 196, tall_height: 268, show_in_screenshots: true },
};
const mountedModules = new Set();
let activePage = 'home';
const panelSession = crypto.randomUUID();
const panelReady = invoke('initialize_panel', { session: panelSession });
panelReady.catch(error => { status.textContent = String(error); });

function setOpen(value) {
  if (value && !preferences.panel.enabled) return;
  if (closed.hidden === value) {
    if (value && keyboardOpen) updatePanelSize(true, true);
    return;
  }
  clearTimeout(hoverTimer);
  if (value) {
    notchTucked = false;
    musicPeek.hidden = true;
    dismissGreeting();
    closed.setAttribute('aria-label', 'Open Poni');
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
  renderLiveActivities();
  renderTimerNotice();
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
  const taskAlert = !isOpen && (otherClosedAlerts() || !musicPeek.hidden);
  panelReady.then(() => invoke('set_panel_open', { session: panelSession, open: isOpen, tall, focus, seq, taskAlert, tucked: notchTucked, contentWidth: closedWidth }))
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
  preferences = { ...preferences, ...value, panel: { ...previous.panel, ...value.panel },
    live: { ...previous.live, ...value.live }, animations: {...previous.animations, ...value.animations},
    closed_display: { ...closedDisplay.defaults, ...value.closed_display } };
  if (previous.user_name !== preferences.user_name) {
    dismissGreeting();
    if (preferencesLoaded) nextGreetingCheck = Date.now() + 300;
  }
  preferencesLoaded = true;
  const panel = preferences.panel;
  const bluetoothEnabled = panel.enabled && preferences.live.bluetooth && preferences.bluetooth?.enabled;
  window.poniBluetoothAlerts.configure({enabled: !!bluetoothEnabled, threshold: preferences.bluetooth?.low_threshold ?? 20}, showBluetoothNotice);
  if (!bluetoothEnabled) bluetoothPeek = null;
  document.documentElement.dir = panel.direction === 'rtl' ? 'rtl' : 'ltr';
  surface.classList.toggle('floating', panel.top_gap > 0);
  surface.style.setProperty('--notch-height', panel.height + 'px');
  surface.style.setProperty('--notch-opacity', String(panel.opacity / 100));
  hideNotch.hidden = !panel.hide_button;
  document.querySelector('#page-home .media').hidden = !preferences.media_enabled;
  surface.classList.toggle('album-glow', preferences.color_glow);
  window.poniAnimations.configure({...preferences.animations, haptics: preferences.haptics});
  updatePowerSaving();
  if (!panel.enabled && !open.hidden) setOpen(false);
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
      tab.hidden = hidden.has(id) || (id === 'shelf' && !preferences.shelf.enabled);
      navigation.append(tab);
    }
  }
  window.poniShelf?.configure(preferences.shelf, !moduleTabs.get('shelf').hidden);
  if (moduleTabs.get(activePage)?.hidden) {
    if (!selectModule(preferences.default_module)) navigation.querySelector('.tab:not([hidden])')?.click();
  }
  document.querySelector('#header-clock').hidden = !preferences.header_clock;
  document.querySelector('#home-calendar').hidden = !preferences.calendar_enabled;
  window.poniMirror?.configure({enabled:preferences.mirror_enabled, shape:preferences.mirror_shape});
  window.poniBattery?.configure(preferences.battery);
  window.poniModules?.health?.configure(preferences.health);
  if (!preferences.bedtime_reminder && bedtimeNotice) showBedtime(null);
  if (preferences.health?.enabled === false && healthNotice) showHealthNotice(null);
  renderTodoReminder();
  renderLiveActivities();
  if (previous.live.system !== preferences.live.system || previous.live.system_interval !== preferences.live.system_interval) {
    lastSystemPeek = Date.now();
    systemPeek = null;
  }
  if (!preferences.media_enabled || !preferences.live.enabled || !preferences.live.sneak_peek) dismissMusicPeek();
  if (preferences.live.music || preferences.live.hover_media_controls) void refreshMedia();
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
window.poniBattery?.listen().catch(error => { status.textContent = String(error); });
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
window.__TAURI__.event.listen('poni-timer-completed', () => {
  queue = queue.then(async () => {
    const updated = await invoke('get_data');
    if (!updated?.timer) return;
    data.timer = updated.timer;
    renderTimer();
  }).catch(error => { status.textContent = String(error); });
}).catch(error => { status.textContent = String(error); });
window.__TAURI__.event.listen('poni-health-reminder', event => showHealthNotice(event.payload))
  .catch(error => { status.textContent = String(error); });
window.__TAURI__.event.listen('poni-health-changed', event => modules.health?.update(event.payload))
  .catch(error => { status.textContent = String(error); });
window.__TAURI__.event.listen('poni-eye-break-failed', event => { status.textContent = event.payload; })
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
closed.addEventListener('click', () => {
  if (suppressPanelClick) return;
  if (notchTucked) { tuckNotch(false); return; }
  const destination = currentLive?.tab;
  setOpen(true);
  if (destination) selectModule(destination);
});
function openFromHover() {
  clearTimeout(hoverTimer);
  if (!preferences.open_on_hover || notchTucked || notchDrag) return;
  if (preferences.hover_delay) hoverTimer = setTimeout(() => setOpen(true), preferences.hover_delay);
  else setOpen(true);
}
closed.addEventListener('pointerenter', () => {
  updateClosedMediaControls();
  openFromHover();
});
window.__TAURI__.event.listen('poni-step-aside-edge', ({payload}) => {
  if (!open.hidden || !preferences.panel.step_aside) return;
  if (payload) openFromHover();
  else clearTimeout(hoverTimer);
}).catch(error => { status.textContent = String(error); });
closed.addEventListener('pointerleave', () => clearTimeout(hoverTimer));
document.querySelector('#close').addEventListener('click', () => setOpen(false));
hideNotch.addEventListener('click', () => tuckNotch(true));

function tuckNotch(tucked) {
  notchTucked = tucked;
  closed.setAttribute('aria-label', tucked ? 'Bring Poni back' : 'Open Poni');
  if (tucked && !open.hidden) setOpen(false);
  else updatePanelSize(false);
}

surface.addEventListener('contextmenu', event => {
  if (!event.target.closest('#closed, #open header') || event.target.closest('input, select')) return;
  event.preventDefault();
  if (Date.now() - lastNotchRightClick <= 650) {
    lastNotchRightClick = 0;
    tuckNotch(!notchTucked);
  } else {
    lastNotchRightClick = Date.now();
  }
});

function moveNotch(delta, save) {
  moveRequest = moveRequest.then(() => panelReady)
    .then(() => invoke('move_panel', {session: panelSession, delta, save}))
    .catch(error => { status.textContent = String(error); });
}

surface.addEventListener('pointerdown', event => {
  if (event.button !== 0 || preferences.panel.lock_position || notchTucked) return;
  const handle = event.target.closest('#closed') ||
    (!event.target.closest('button, input, select, a') && event.target.closest('#open header'));
  if (!handle) return;
  handle.setPointerCapture(event.pointerId);
  notchDrag = { id: event.pointerId, start: event.screenX, moving: false, sent: 0 };
});

surface.addEventListener('pointermove', event => {
  if (notchDrag?.id !== event.pointerId) return;
  const delta = Math.round(event.screenX - notchDrag.start);
  if (!notchDrag.moving && Math.abs(delta) < 6) return;
  notchDrag.moving = true;
  clearTimeout(hoverTimer);
  clearTimeout(closeTimer);
  if (performance.now() - notchDrag.sent >= 33) {
    notchDrag.sent = performance.now();
    moveNotch(delta, false);
  }
});

function finishNotchDrag(event) {
  if (notchDrag?.id !== event.pointerId) return;
  const drag = notchDrag;
  notchDrag = null;
  if (!drag.moving) return;
  suppressPanelClick = true;
  setTimeout(() => { suppressPanelClick = false; }, 0);
  moveNotch(event.type === 'pointerup' ? Math.round(event.screenX - drag.start) : null, true);
}

surface.addEventListener('pointerup', finishNotchDrag);
surface.addEventListener('pointercancel', finishNotchDrag);
surface.addEventListener('lostpointercapture', finishNotchDrag);
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
  updateClosedMediaControls();
  closeTimer = setTimeout(() => {
    if (!keyboardOpen && !notchDrag && !window.poniShelf?.keepOpen() && !surface.matches(':hover') && !document.activeElement.matches('input, textarea, select, [contenteditable="true"]')) setOpen(false);
  }, preferences.close_delay);
});
window.__TAURI__.event.listen('poni-toggle', event => {
  const shouldOpen = open.hidden || event?.payload === true;
  keyboardOpen = shouldOpen;
  setOpen(shouldOpen);
}).catch(error => { status.textContent = String(error); });
window.__TAURI__.event.listen('poni-snoozed', () => {
  clearTimeout(hoverTimer);
  setOpen(false);
}).catch(error => { status.textContent = String(error); });
window.__TAURI__.event.listen('poni-hour-chime', () => {
  if (!open.hidden) return;
  clearTimeout(hourGlowTimer);
  surface.classList.add('hour-glow');
  hourGlowTimer = setTimeout(() => surface.classList.remove('hour-glow'), 1800);
}).catch(error => { status.textContent = String(error); });
invoke('shortcut_status').then(available => {
  if (!available) status.textContent = 'Poni’s open shortcut is already in use.';
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
  const tabs = [...navigation.querySelectorAll('.tab:not([hidden])')];
  const delta = tabs.indexOf(tab) - tabs.indexOf(moduleTabs.get(previousPage));
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
    const nextPage = document.getElementById('page-' + activePage);
    window.poniAnimations.tab(nextPage, delta);
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

async function refreshMedia(periodic = false) {
  const live = preferences.live;
  const now = Date.now();
  if (periodic && surface.classList.contains('power-saving') && now - lastMediaCheck < 15000) return;
  if (mediaPending || !preferences.panel.enabled || !preferences.media_enabled ||
      (open.hidden && (!live.enabled || !(live.music || live.sneak_peek || live.hover_media_controls)))) return;
  mediaPending = true;
  lastMediaCheck = now;
  try {
    const media = await invoke('current_media', {wantArtwork:true, previousTrack:mediaSnapshot?.track_id ?? null});
    const previous = mediaSnapshot;
    mediaSnapshot = media;
    mediaSampleAt = Date.now();
    if (!media || media.artwork || previous?.track_id !== media.track_id) paintArtwork(media?.artwork);
    if (previous && media?.title && media.playing &&
        (previous.title !== media.title || previous.artist !== media.artist)) showMusicPeek(media);
    document.querySelector('#media-title').textContent = media?.title || (media ? 'Unknown track' : 'Nothing playing');
    document.querySelector('#media-artist').textContent = media?.artist || (media ? 'Unknown artist' : 'Play something in a media player');
    for (const toggle of document.querySelectorAll('[data-media="toggle"]')) {
      toggle.textContent = media?.playing ? '❚❚' : '▶';
    }
    const percentage = media?.duration_ms > 0 ? Math.max(0, Math.min(100, media.position_ms / media.duration_ms * 100)) : 0;
    document.querySelector('#media-progress-fill').style.width = `${percentage}%`;
    renderLiveActivities();
  } catch (error) {
    mediaSnapshot = null;
    paintArtwork();
    renderLiveActivities();
    document.querySelector('#media-title').textContent = 'Media unavailable';
    document.querySelector('#media-artist').textContent = String(error);
  } finally { mediaPending = false; }
}
setInterval(() => void refreshMedia(true), 5000);

function paintArtwork(artwork) {
  if (artworkUrl) URL.revokeObjectURL(artworkUrl);
  artworkUrl = '';
  if (artwork?.jpeg) {
    try {
      const bytes = Uint8Array.from(atob(artwork.jpeg), char => char.charCodeAt(0));
      artworkUrl = URL.createObjectURL(new Blob([bytes], {type:'image/jpeg'}));
    } catch (_) {
      // The playback controls can still use the song metadata.
    }
  }
  for (const image of [homeArtwork, closedArtwork]) {
    if (artworkUrl) image.src = artworkUrl;
    else image.removeAttribute('src');
  }
  homeArtwork.hidden = !artworkUrl;
  artworkFallback.hidden = !!artworkUrl;
  const accent = artwork?.accent;
  if (artworkUrl && /^#[0-9a-f]{6}$/i.test(accent)) surface.style.setProperty('--album-accent', accent);
  else surface.style.removeProperty('--album-accent');
}
function updateClosedMediaControls() {
  closedMediaControls.hidden = !open.hidden || notchTucked || !surface.matches(':hover') ||
    preferences.open_on_hover || !preferences.media_enabled || !preferences.live.enabled ||
    !preferences.live.hover_media_controls || !mediaSnapshot;
}

function otherClosedAlerts() {
  return [todoReminder, bedtimeReminder, timerReminder, healthReminder, document.getElementById('video-shrink')]
    .some(node => !node.hidden);
}

function dismissMusicPeek() {
  clearTimeout(musicPeekTimer);
  if (!musicPeek.hidden) {
    musicPeek.hidden = true;
    if (open.hidden) updatePanelSize(false);
  }
}

function showMusicPeek(media) {
  if (!open.hidden || !preferences.live.enabled || !preferences.live.sneak_peek || otherClosedAlerts()) return;
  musicPeek.firstElementChild.textContent = [media.title, media.artist].filter(Boolean).join(' — ');
  musicPeek.hidden = false;
  window.poniAnimations.bounce();
  updatePanelSize(false);
  clearTimeout(musicPeekTimer);
  musicPeekTimer = setTimeout(dismissMusicPeek, 3200);
}

function showBluetoothNotice(notice) {
  if (!open.hidden || notchTucked || otherClosedAlerts() || closed.classList.contains('battery-alert')) return;
  bluetoothPeek = { tab:'bluetooth', title:notice.title, time:notice.text, kind:notice.kind,
    until:Date.now() + (notice.kind === 'low' ? 5000 : 4000) };
  window.poniAnimations.bounce();
  renderLiveActivities();
}

async function sampleSystemPeek(now) {
  const settings = preferences.live;
  if (!settings.enabled || !settings.system || !open.hidden || !preferences.panel.enabled) {
    lastSystemPeek = now;
    return;
  }
  const interval = settings.system_interval * (surface.classList.contains('power-saving') ? 2000 : 1000);
  if (systemPeekPending || now - lastSystemPeek < interval || otherClosedAlerts() || !musicPeek.hidden) return;
  lastSystemPeek = now;
  systemPeekPending = true;
  try {
    const sample = await invoke('system_snapshot');
    if (!open.hidden || !preferences.live.system || otherClosedAlerts()) return;
    const cpu = sample.cpu_percent == null ? 'CPU —' : `CPU ${Math.round(sample.cpu_percent)}%`;
    const ram = sample.memory_total > 0 ? `RAM ${Math.round(100 * sample.memory_used / sample.memory_total)}%` : 'RAM —';
    systemPeek = {tab:'system', title:cpu, time:ram, until:Date.now() + 6000};
    renderLiveActivities();
  } catch (_) {
    // Retry at the next configured interval.
  } finally { systemPeekPending = false; }
}

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
  updatePowerSaving();
  const time = closedDisplay.time(now, preferences.clock_format);
  for (const clock of document.querySelectorAll('.clock')) {
    if (clock.textContent !== time) clock.textContent = time;
  }
  renderLiveActivities(now.getTime());
  if (otherClosedAlerts()) dismissMusicPeek();
  void sampleSystemPeek(now.getTime());
  void sampleIdleSystem(now.getTime());
  void checkGreeting(now);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (today !== calendarToday) { calendarToday = today; if (calendarDay == null || calendarDay < today) calendarDay = today; renderCalendar(); }
}

function nextClosedCalendar(now, limit, includeOngoing) {
  if (!preferences.calendar_enabled || !data.calendar_events?.length) return null;
  const today = new Date(now);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const fits = item => item.start <= limit && (includeOngoing
    ? item.start + item.event.duration_minutes * 60000 > now : item.start > now);
  return occurrencesOnDay(today).find(fits) || (tomorrow.getTime() <= limit && occurrencesOnDay(tomorrow).find(fits));
}

function slotText(kind, now) {
  const time = (value, zone) => closedDisplay.time(new Date(value), preferences.clock_format, zone);
  switch (kind) {
    case 'time': return time(now);
    case 'date': return closedDisplay.day(now);
    case 'weather': return Number.isFinite(currentWeather?.temperature_2m)
      ? `${Math.round(currentWeather.temperature_2m)}°` : '';
    case 'event': {
      const next = nextClosedCalendar(now.getTime(), now.getTime() + 43_200_000, true);
      return next ? `${next.event.title} ${time(next.start)}` : '';
    }
    case 'todo': {
      const next = data.tasks.filter(task => !task.done).reduce((first, task) => {
        if (!first) return task;
        return (task.due_at_ms ?? Infinity) < (first.due_at_ms ?? Infinity) ? task : first;
      }, null);
      return next ? `${next.text}${next.due_at_ms == null ? '' : ` ${time(next.due_at_ms)}`}` : '';
    }
    case 'world': {
      const place = data.world_clocks?.[0];
      if (!place) return '';
      try { return `${place.name} ${time(now, place.zone)}`; }
      catch (error) { if (error instanceof RangeError) return ''; throw error; }
    }
    case 'cpu': return Number.isFinite(idleSystemSample?.cpu_percent) ? `CPU ${Math.round(idleSystemSample.cpu_percent)}%` : '';
    case 'ram': return idleSystemSample?.memory_total > 0 ? `RAM ${Math.round(100 * idleSystemSample.memory_used / idleSystemSample.memory_total)}%` : '';
    default: return '';
  }
}

async function sampleIdleSystem(now) {
  if (!open.hidden || !preferences.panel.enabled || currentLive || idleSystemPending || now < nextIdleSystemSample ||
      ![preferences.closed_display.left, preferences.closed_display.right].some(kind => kind === 'cpu' || kind === 'ram')) return;
  idleSystemPending = true;
  nextIdleSystemSample = now + (surface.classList.contains('power-saving') ? 10_000 : 5000);
  try { idleSystemSample = await invoke('system_snapshot'); }
  catch (_) { idleSystemSample = null; }
  finally { idleSystemPending = false; }
}

function renderClosedDisplay(now) {
  if (!open.hidden) return;
  const config = preferences.closed_display;
  const panel = preferences.panel;
  const keepClock = closed.classList.contains('keep-live-clock');
  const hasGreeting = !greeting.hidden;
  closedClock.hidden = config.mode === 'off' || (currentLive && !keepClock) || hasGreeting;
  closedDay.hidden = config.mode !== 'date';
  if (!closedDay.hidden) closedDay.textContent = closedDisplay.day(now);
  closed.style.setProperty('--clock-size', `${closedDisplay.font(panel.height, config.size)}px`);
  closed.classList.toggle('clock-bold', config.bold);
  const widths = closedSlots.map((slot, index) => {
    const kind = index === 0 ? config.left : config.right;
    const value = slot.querySelector('.closed-slot-value');
    const text = slotText(kind, now);
    if (value.textContent !== text) value.textContent = text;
    slot.dataset.kind = kind;
    slot.hidden = !!currentLive || hasGreeting || (!text && !(kind === 'battery' && window.poniBattery.present));
    return slot.hidden ? 0 : Math.min(112, Math.ceil(slot.firstElementChild.scrollWidth || slot.lastElementChild.offsetWidth) + 7);
  });
  const side = Math.max(...widths);
  const minute = Math.floor(now.getTime() / 60000);
  const sideKey = [config.left, config.right, minute].join('|');
  if (closed.dataset.sideKey !== sideKey || (!side && !currentLive && !hasGreeting)) {
    closed.dataset.sideKey = sideKey;
    closed.style.removeProperty('--slot-width');
  }
  const stableSide = side ? Math.max(side, parseInt(closed.style.getPropertyValue('--slot-width'), 10) || 0) : 0;
  if (side) closed.style.setProperty('--slot-width', `${stableSide}px`);
  const centerWidth = closedClock.hidden ? 0 : closedClock.scrollWidth;
  const width = Math.min(560, Math.ceil(Math.max(panel.width, centerWidth + 24) + 2 * stableSide));
  surface.style.setProperty('--notch-width', `${width}px`);
  if (closedWidth !== width) {
    closedWidth = width;
    updatePanelSize(false);
  }
}

function dismissGreeting() {
  clearTimeout(greetingTimer);
  greeting.hidden = true;
}

async function checkGreeting(now) {
  const name = preferences.user_name;
  if (!name || !preferences.panel.enabled || greetingPending || now.getTime() < nextGreetingCheck) return;
  const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0')).join('-');
  if (lastGreetingDay === day || data.last_greeting === day) return;
  nextGreetingCheck = now.getTime() + 5000;
  const busy = () => !open.hidden || notchTucked || currentLive || otherClosedAlerts() || !musicPeek.hidden ||
    closed.classList.contains('battery-alert');
  if (busy()) return;
  greetingPending = true;
  try {
    if (!await invoke('claim_poni_greeting', { name })) return;
    lastGreetingDay = day;
    if (busy() || preferences.user_name !== name) return;
    const hour = now.getHours();
    const [text, icon, color] = hour >= 5 && hour < 12 ? [`Good morning, ${name}`, '☀', '#ffd60a'] :
      hour >= 12 && hour < 18 ? [`Good afternoon, ${name}`, '◒', '#ff9f0a'] :
      hour >= 18 && hour < 22 ? [`Good evening, ${name}`, '☾', '#bf5af2'] :
        [`Still up, ${name}?`, '★', '#64d2ff'];
    greeting.querySelector('#greeting-symbol').textContent = icon;
    greeting.querySelector('#greeting-text').textContent = text;
    greeting.querySelector('#greeting-day').textContent = closedDisplay.day(now);
    greeting.style.setProperty('--greeting-color', color);
    greeting.hidden = false;
    renderClosedDisplay(now);
    window.poniAnimations.bounce();
    greetingTimer = setTimeout(() => { dismissGreeting(); renderClosedDisplay(new Date()); }, 4000);
  } catch (_) {
    // Leave the notch clock in place when the profile cannot be updated.
  } finally { greetingPending = false; }
}

function updatePowerSaving() {
  surface.classList.toggle('power-saving', preferences.battery_saving === 'auto' && !!window.poniBattery?.saving);
}

function liveCountdown(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return (hours ? `${hours}:${String(minutes).padStart(2, '0')}` : String(minutes)) +
    ':' + String(seconds % 60).padStart(2, '0');
}

function playbackFraction(current, total) {
  return total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
}

function renderLiveActivities(now = Date.now(), advance = false) {
  const settings = preferences.live;
  const candidates = [];
  if (settings.enabled && open.hidden) {
    if (preferences.media_enabled && settings.music && mediaSnapshot?.playing) {
      const total = mediaSnapshot.duration_ms;
      const elapsed = Math.max(0, (mediaSnapshot.position_ms || 0) + now - mediaSampleAt);
      candidates.push({tab:'home', title:mediaSnapshot.title || 'Music',
        time:total > 0 ? liveCountdown(Math.min(elapsed, total)) : '♫',
        played: total > 0 ? playbackFraction(elapsed, total) : null});
    }
    const pomodoro = window.poniFocusPlayback.session;
    if (settings.timers) {
      if (pomodoro?.ends_at_ms > now) candidates.push({
        tab: 'pomodoro', title: pomodoro.phase === 'focus' ? 'Focus' : 'Break',
        time: liveCountdown(pomodoro.ends_at_ms - now),
        outline: playbackFraction(pomodoro.ends_at_ms - now, pomodoro.total_ms),
      });
      const stopwatch = data.stopwatch;
      if (stopwatch.started_at_ms != null) candidates.push({
        tab: 'timer', title: 'Stopwatch',
        time: stopwatchValue(stopwatch.elapsed_ms + Math.max(0, now - stopwatch.started_at_ms)).split('.')[0],
      });
      if (data.timer.ends_at_ms > now) candidates.push({
        tab: 'timer', title: 'Timer', time: liveCountdown(data.timer.ends_at_ms - now),
        outline: playbackFraction(data.timer.ends_at_ms - now, data.timer.total_ms),
      });
    }
    if (settings.calendar) {
      const next = nextClosedCalendar(now, now + 900_000, false);
      if (next) candidates.push({
        tab: 'calendar', title: next.event.title, time: `in ${Math.ceil((next.start - now) / 60_000)}m`,
      });
    }
    if (settings.todo) {
      const upcoming = data.tasks.filter(task =>
        !task.done && task.due_at_ms > now && task.due_at_ms - now <= 3_600_000);
      const next = upcoming.reduce((earliest, task) =>
        !earliest || task.due_at_ms < earliest.due_at_ms ? task : earliest, null);
      if (next) candidates.push({
        tab: 'tasks', title: upcoming.length > 1 ? `${upcoming.length} tasks` : next.text,
        time: liveCountdown(next.due_at_ms - now),
      });
    }
  }
  if (advance && candidates.length > 1) liveIndex++;
  const summary = settings.enabled && settings.system && open.hidden && systemPeek?.until > now && !otherClosedAlerts() ? systemPeek : null;
  const device = open.hidden && bluetoothPeek?.until > now && !otherClosedAlerts() ? bluetoothPeek : null;
  currentLive = device || summary || (candidates.length
    ? candidates[(settings.rotate ? liveIndex : 0) % candidates.length]
    : null);
  liveActivity.hidden = !currentLive;
  closed.classList.toggle('has-live', !!currentLive);
  closed.classList.toggle('music-playing', currentLive?.tab === 'home');
  closed.dataset.deviceNotice = device?.kind || '';
  closedArtwork.hidden = !artworkUrl || currentLive?.tab !== 'home';
  closed.classList.toggle('keep-live-clock', preferences.clock_with_activities &&
    ['home', 'pomodoro', 'timer'].includes(currentLive?.tab));
  closed.classList.toggle('timer-outline', preferences.animations.timer_outline && currentLive?.outline > 0);
  closed.style.setProperty('--timer-outline', `${(currentLive?.outline || 0) * 100}%`);
  closedMusicProgress.hidden = !preferences.music_progress || currentLive?.played == null;
  closedMusicProgress.style.width = `calc((100% - 16px) * ${currentLive?.played || 0})`;
  updateClosedMediaControls();
  if (currentLive) {
    if (liveTitle.textContent !== currentLive.title) liveTitle.textContent = currentLive.title;
    if (liveTime.textContent !== currentLive.time) liveTime.textContent = currentLive.time;
  }
  if (currentLive || otherClosedAlerts() || closed.classList.contains('battery-alert')) dismissGreeting();
  renderClosedDisplay(new Date(now));
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
setInterval(() => {
  if (!open.hidden || !preferences.live.rotate || closed.matches(':hover') ||
      closed.classList.contains('battery-alert') || bedtimeNotice || timerNotice || healthNotice || reminderTask) return;
  renderLiveActivities(Date.now(), true);
}, 6000);

function mutate(command, args) {
  const operation = queue.then(async () => {
    const payload = typeof args === 'function' ? args(data) : args;
    const today = new Date().toDateString();
    const pendingToday = task => !task.done && task.due_at_ms != null && new Date(task.due_at_ms).toDateString() === today;
    const completedToday = command === 'toggle_task' && data.tasks.some(task => task.id === payload.id && pendingToday(task));
    data = await invoke(command, payload);
    status.textContent = '';
    render();
    if (completedToday && !data.tasks.some(pendingToday)) window.poniAnimations.celebrate();
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
  reminderTask = open.hidden && !bedtimeNotice && !timerNotice && !healthNotice ? reminderCandidate(Date.now()) : null;
  const hidden = !reminderTask;
  const changed = todoReminder.hidden !== hidden;
  todoReminder.hidden = hidden;
  if (changed && !hidden) window.poniAnimations.bounce();
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
    window.poniAnimations.bounce();
    const scheduled = new Date(bedtimeNotice.scheduled_for_ms);
    const time = new Intl.DateTimeFormat(undefined, {hour:'numeric', minute:'2-digit'}).format(scheduled);
    document.querySelector('#bedtime-reminder-text').textContent = `It’s bedtime · ${time}`;
    const snooze = document.querySelector('#bedtime-snooze');
    snooze.title = `Snooze for ${preferences.todo.snooze_minutes} minutes`;
    bedtimeTimer = setTimeout(() => showBedtime(null), bedtimeNotice.expires_at_ms - Date.now());
  }
  renderTimerNotice();
  renderTodoReminder(false);
  if (open.hidden) updatePanelSize(false);
}

function renderTimerNotice(resize = false) {
  const hidden = !timerNotice || !!bedtimeNotice;
  const changed = timerReminder.hidden !== hidden;
  timerReminder.hidden = hidden;
  if (changed && !hidden) window.poniAnimations.bounce();
  renderHealthNotice();
  if (resize) {
    renderTodoReminder(false);
    if (changed && open.hidden) updatePanelSize(false);
  }
}

function renderHealthNotice() {
  healthReminder.hidden = !healthNotice || !!bedtimeNotice || !!timerNotice;
}

function showHealthNotice(notice) {
  clearTimeout(healthNoticeTimeout);
  healthNotice = notice?.expires_at_ms > Date.now() && preferences.health?.enabled !== false ? notice : null;
  if (healthNotice) {
    window.poniAnimations.bounce();
    const water = notice.kind === 'water';
    healthReminder.dataset.kind = notice.kind;
    document.querySelector('#health-reminder-text').textContent = water
      ? `Time for a glass of water · ${notice.glasses}/${notice.goal}`
      : `Time for a break · ${notice.minutes}m`;
    document.querySelector('#health-log-water').hidden = !water;
    document.querySelector('#health-reminder-open').hidden = !!moduleTabs.get('health')?.hidden;
    healthNoticeTimeout = setTimeout(() => showHealthNotice(null), notice.expires_at_ms - Date.now());
  }
  renderHealthNotice();
  renderTodoReminder(false);
  if (open.hidden) updatePanelSize(false);
}

document.querySelector('#health-reminder-open').addEventListener('click', () => {
  if (!healthNotice || moduleTabs.get('health')?.hidden) return;
  showHealthNotice(null);
  keyboardOpen = true;
  setOpen(true);
  selectModule('health');
  updatePanelSize(true, true);
});

document.querySelector('#health-log-water').addEventListener('click', async event => {
  const notice = healthNotice;
  if (notice?.kind !== 'water') return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const date = new Date();
    const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
    await invoke('health_record', { day, action: 'water_add' });
    if (healthNotice === notice) showHealthNotice(null);
  } catch (error) {
    status.textContent = String(error);
  } finally {
    button.disabled = false;
  }
});

function clearTimerNotice() {
  clearTimeout(timerNoticeTimeout);
  timerNotice = null;
  renderTimerNotice(true);
}

function runTimerNoticeTimeout() {
  clearTimeout(timerNoticeTimeout);
  timerNotice.until = Date.now() + timerNotice.remaining;
  timerNoticeTimeout = setTimeout(clearTimerNotice, timerNotice.remaining);
}

function syncTimerNotice(timer) {
  const end = timer.ends_at_ms;
  if (timerNotice && (!timer.notice_until_ms || end !== timerNotice.end)) clearTimerNotice();
  if (end == null || end === lastTimerNoticeEnd || !(timer.notice_until_ms > Date.now()) ||
      timer.notified_end_ms !== end) return;
  lastTimerNoticeEnd = end;
  timerNotice = { end, remaining: Math.min(timer.notice_until_ms - Date.now(), open.hidden ? 30000 : 8000) };
  const duration = Math.round(timer.total_ms / 60000);
  document.querySelector('#timer-reminder-text').textContent = `Time’s up · Timer ${duration} min`;
  runTimerNoticeTimeout();
  renderTimerNotice(true);
}

timerReminder.addEventListener('pointerenter', () => {
  if (!timerNotice || !open.hidden) return;
  clearTimeout(timerNoticeTimeout);
  timerNotice.remaining = Math.max(0, timerNotice.until - Date.now());
});
timerReminder.addEventListener('pointerleave', () => {
  if (timerNotice && open.hidden) runTimerNoticeTimeout();
});
for (const [id, extend] of [['timer-extend', true], ['timer-dismiss', false]]) {
  document.getElementById(id).addEventListener('click', () => {
    if (timerNotice) void mutate('timer_notice_action', { expectedEnd: timerNotice.end, extend });
  });
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
      document.querySelector('#task-language-preview').hidden = true;
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
  renderLiveActivities();
  renderStopwatch();
  renderMonthCalendar();
  renderCalendar();
}

function taskStepsPanel(task, steps) {
  const panel = document.createElement('div');
  panel.className = 'task-steps';
  panel.hidden = !expandedTasks.has(task.id);
  const links = document.createElement('div');
  links.className = 'task-note';
  const list = document.createElement('select');
  list.setAttribute('aria-label', `Note for ${task.text}`);
  list.hidden = true;
  list.addEventListener('change', () => {
    void mutate('set_task_note', {id:task.id, noteId:list.value || null});
  });
  if (task.note_id) {
    links.append(action('Open linked note', async () => {
      if (!selectModule('notes')) {
        status.textContent = 'Enable Notes in Settings to open this note.';
        return;
      }
      if (!await modules.notes?.openNote(task.note_id)) status.textContent = 'The note is no longer available.';
    }));
  }
  const link = action(task.note_id ? 'Change linked note' : 'Link note', async () => {
    if (!list.hidden) {
      list.hidden = true;
      return;
    }
    link.disabled = true;
    try {
      const available = await invoke('note_choices');
      list.replaceChildren(new Option(task.note_id ? 'Unlink note' : 'Choose a note', ''));
      if (!task.note_id) list.firstElementChild.disabled = true;
      for (const note of available) list.add(new Option(note.title, note.id));
      list.value = task.note_id ?? '';
      if (!available.length && !task.note_id) {
        status.textContent = 'Create a note before linking it to a task.';
        return;
      }
      list.hidden = false;
      list.focus();
    } catch (error) {
      status.textContent = String(error);
    } finally {
      link.disabled = false;
    }
  });
  links.append(link, list);
  panel.append(links);
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
  syncTimerNotice(timer);
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

function parseTaskInput() {
  const input = document.querySelector('#task-input').value;
  if (!input.trim()) ignoreTaskLanguage = false;
  if (editingTask || ignoreTaskLanguage || document.querySelector('#task-due').value ||
      repeatDays.some(day => day.checked)) return null;
  return window.poniTodoLanguage.parse(input);
}

function renderTaskLanguage() {
  const preview = document.querySelector('#task-language-preview');
  const result = parseTaskInput();
  preview.hidden = !result;
  if (!result) return;
  const schedule = result.repeat
    ? `Every ${result.repeat.days.map(day => taskDayNames[day]).join(', ')} · ${result.repeat.time}`
    : new Intl.DateTimeFormat(undefined, {dateStyle:'medium', timeStyle:'short'}).format(result.due);
  document.querySelector('#task-language-text').textContent = `${result.text} · ${schedule}`;
}

document.querySelector('#task-form').addEventListener('input', renderTaskLanguage);
document.querySelector('#task-language-ignore').addEventListener('click', () => {
  ignoreTaskLanguage = true;
  renderTaskLanguage();
  document.querySelector('#task-input').focus();
});

function resetTaskForm() {
  editingTask = null;
  ignoreTaskLanguage = false;
  document.querySelector('#task-form').reset();
  document.querySelector('#task-form').hidden = taskView !== 'active';
  document.querySelector('#task-description').hidden = true;
  document.querySelector('#task-cancel').hidden = true;
  document.querySelector('#task-submit').textContent = 'Add';
  document.querySelector('#task-repeat').open = false;
  repeatDays.forEach(input => { input.disabled = false; });
  renderTaskLanguage();
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
  let repeat = days.length ? {days, minute: hour * 60 + minute} : null;
  const parsed = parseTaskInput();
  if (parsed?.repeat) {
    const [hour, minute] = parsed.repeat.time.split(':').map(Number);
    repeat = {days: parsed.repeat.days, minute: hour * 60 + minute};
  }
  const late = document.querySelector('#task-late').value;
  const args = { text: parsed?.text ?? input.value, dueAtMs: parsed?.due ?? dueAtMs,
    repeat, lateMinutes: late === '' ? null : Number(late) };
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
  currentWeather = null;
  const weatherStatus = document.querySelector('#weather-status');
  weatherStatus.textContent = 'Loading weather…';
  document.querySelector('#weather-current').textContent = '';
  document.querySelector('#weather-days').replaceChildren();
  try {
    const forecast = await invoke('weather_forecast', { location });
    if (request !== weatherRequest) return;
    const current = forecast.current;
    currentWeather = current;
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
window.poniShelf?.connect({
  isOpen: () => !open.hidden,
  isShelf: () => activePage === 'shelf' && !open.hidden,
  open() {
    clearTimeout(closeTimer);
    setOpen(true);
    selectModule('shelf');
  },
  openActions() {
    clearTimeout(closeTimer);
    setOpen(true);
  },
  refreshSize() { updatePanelSize(!open.hidden); },
});

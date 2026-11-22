'use strict';

const invoke = window.__TAURI__.core.invoke;
const surface = document.querySelector('#surface');
const closed = document.querySelector('#closed');
const open = document.querySelector('#open');
const status = document.querySelector('#status');
let data = { tasks: [], notes: [], timer: { total_ms: 1500000, remaining_ms: 1500000, ends_at_ms: null }, stopwatch: { elapsed_ms: 0, started_at_ms: null, laps: [] } };
let editingNote = null;
let queue = Promise.resolve();
let panelSequence = 0;
let closeTimer = null;
let mediaPending = false;
let keyboardOpen = false;

function setOpen(value) {
  if (closed.hidden === value) return;
  if (!value) keyboardOpen = false;
  closed.hidden = value;
  open.hidden = !value;
  closed.setAttribute('aria-expanded', String(value));
  invoke('set_panel_open', { open: value, seq: ++panelSequence }).catch(error => { status.textContent = String(error); });
  if (value) void refreshMedia();
}
closed.addEventListener('click', () => setOpen(true));
closed.addEventListener('pointerenter', () => setOpen(true));
document.querySelector('#close').addEventListener('click', () => setOpen(false));
surface.addEventListener('pointerenter', () => clearTimeout(closeTimer));
surface.addEventListener('pointerleave', () => {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    if (!keyboardOpen && !surface.matches(':hover') && !document.activeElement.matches('input, textarea')) setOpen(false);
  }, 450);
});
window.__TAURI__.event.listen('poni-toggle', () => {
  const shouldOpen = open.hidden;
  keyboardOpen = shouldOpen;
  setOpen(shouldOpen);
}).catch(error => { status.textContent = String(error); });
invoke('shortcut_status').then(available => {
  if (!available) status.textContent = 'Alt+N is already in use.';
}).catch(error => { status.textContent = String(error); });

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item === tab));
  document.querySelectorAll('.page').forEach(page => { page.hidden = page.id !== `page-${tab.dataset.page}`; });
}));
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

function updateClock() {
  const now = new Date();
  document.querySelectorAll('.clock').forEach(clock => { clock.textContent = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now); });
  document.querySelector('#month').textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(now);
  const week = document.querySelector('#week');
  week.replaceChildren();
  for (let offset = -now.getDay(); offset < 7 - now.getDay(); offset++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const cell = document.createElement('span');
    const day = document.createElement('small');
    day.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date).slice(0, 2).toUpperCase();
    const number = document.createElement('span');
    number.textContent = date.getDate();
    if (offset === 0) number.className = 'today';
    cell.append(day, number);
    week.append(cell);
  }
}
updateClock();
setInterval(updateClock, 1000);

function mutate(command, args) {
  const operation = queue.then(async () => {
    data = await invoke(command, args);
    status.textContent = '';
    render();
    return true;
  });
  queue = operation.catch(error => { status.textContent = String(error); return false; });
  return queue;
}

function action(label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function render() {
  const tasks = document.querySelector('#tasks');
  tasks.replaceChildren();
  data.tasks.forEach(task => {
    const row = document.createElement('div'); row.className = 'item';
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = task.done; check.setAttribute('aria-label', `Complete ${task.text}`);
    check.addEventListener('change', () => mutate('toggle_task', { id: task.id }));
    const text = document.createElement('p'); text.textContent = task.text; text.classList.toggle('done', task.done);
    row.append(check, text, action('Delete', () => mutate('remove_task', { id: task.id })));
    tasks.append(row);
  });
  const notes = document.querySelector('#notes');
  notes.replaceChildren();
  data.notes.forEach(note => {
    const row = document.createElement('div'); row.className = 'item';
    const text = document.createElement('p'); text.textContent = note.text;
    const edit = action('Edit', () => { editingNote = note.id; document.querySelector('#note-input').value = note.text; document.querySelector('#note-cancel').hidden = false; });
    row.append(text, edit, action('Delete', () => mutate('remove_note', { id: note.id })));
    notes.append(row);
  });
  renderTimer();
  renderStopwatch();
}

function renderTimer() {
  const timer = data.timer;
  const remaining = timer.ends_at_ms == null ? timer.remaining_ms : Math.max(0, timer.ends_at_ms - Date.now());
  const seconds = Math.ceil(remaining / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const format = value => String(value).padStart(2, '0');
  document.querySelector('#timer-display').textContent = `${hours ? `${hours}:` : ''}${format(minutes)}:${format(seconds % 60)}`;
  document.querySelector('#timer-start').textContent = timer.ends_at_ms != null && remaining > 0 ? 'Pause' : 'Start';
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

document.querySelector('#task-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = document.querySelector('#task-input');
  if (await mutate('add_task', { text: input.value })) input.value = '';
});
document.querySelector('#note-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = document.querySelector('#note-input');
  if (await mutate('save_note', { id: editingNote, text: input.value })) { input.value = ''; editingNote = null; document.querySelector('#note-cancel').hidden = true; }
});
document.querySelector('#note-cancel').addEventListener('click', () => { editingNote = null; document.querySelector('#note-input').value = ''; document.querySelector('#note-cancel').hidden = true; });
document.querySelector('#timer-form').addEventListener('submit', event => {
  event.preventDefault();
  const timer = data.timer;
  const running = timer.ends_at_ms != null && timer.ends_at_ms > Date.now();
  const minutes = Number(document.querySelector('#timer-minutes').value);
  const changed = minutes * 60000 !== timer.total_ms;
  mutate('timer_action', { action: running ? 'pause' : 'start', minutes: running || (!changed && timer.remaining_ms < timer.total_ms) ? null : minutes });
});
document.querySelector('#timer-reset').addEventListener('click', () => mutate('timer_action', { action: 'reset', minutes: null }));
document.querySelectorAll('[data-timer-mode]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-timer-mode]').forEach(item => item.classList.toggle('active', item === button));
  document.querySelector('#timer-countdown').hidden = button.dataset.timerMode !== 'countdown';
  document.querySelector('#timer-stopwatch').hidden = button.dataset.timerMode !== 'stopwatch';
}));
document.querySelector('#stopwatch-start').addEventListener('click', () => mutate('stopwatch_action', { action: data.stopwatch.started_at_ms == null ? 'start' : 'pause' }));
document.querySelector('#stopwatch-lap').addEventListener('click', () => mutate('stopwatch_action', { action: 'lap' }));
document.querySelector('#stopwatch-reset').addEventListener('click', () => mutate('stopwatch_action', { action: 'reset' }));
queue = invoke('get_data').then(saved => { data = saved; render(); }).catch(error => { status.textContent = String(error); });

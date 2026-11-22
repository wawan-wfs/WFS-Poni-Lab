'use strict';

const invoke = window.__TAURI__.core.invoke;
const surface = document.querySelector('#surface');
const closed = document.querySelector('#closed');
const open = document.querySelector('#open');
const status = document.querySelector('#status');
let data = { tasks: [], notes: [] };
let editingNote = null;
let queue = Promise.resolve();

function setOpen(value) {
  closed.hidden = value;
  open.hidden = !value;
  closed.setAttribute('aria-expanded', String(value));
}
closed.addEventListener('click', () => setOpen(true));
closed.addEventListener('pointerenter', () => setOpen(true));
document.querySelector('#close').addEventListener('click', () => setOpen(false));

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item === tab));
  document.querySelectorAll('.page').forEach(page => { page.hidden = page.id !== `page-${tab.dataset.page}`; });
}));

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
}

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
queue = invoke('get_data').then(saved => { data = saved; render(); }).catch(error => { status.textContent = String(error); });

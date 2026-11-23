(() => {
  'use strict';

  const sources = { todo: 'Todo', timer: 'Timer', pomodoro: 'Pomodoro', calendar: 'Calendar' };
  const shortTime = new Intl.DateTimeFormat(undefined, {hour: 'numeric', minute: '2-digit'});
  const fullDay = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'});
  let elements;
  let poll;
  let visible = false;
  let busy = false;
  let reading = false;
  let request = 0;
  let confirming = false;
  let filter = 'all';
  let items = [];

  function create(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function button(text, onClick, className) {
    const element = create('button', text, className);
    element.type = 'button';
    element.addEventListener('click', onClick);
    return element;
  }

  function mount(page) {
    page.innerHTML = `
      <div class="nh-header">
        <strong>Notifications</strong>
        <span class="nh-actions"></span>
      </div>
      <div class="nh-body">
        <aside class="nh-filters" aria-label="Notification filters"></aside>
        <div class="nh-list" aria-label="Notification history"></div>
      </div>
      <p class="nh-error" role="status"></p>
      <small class="nh-retention">Poni reminders · Last 3 days · Up to 200 entries</small>
    `;
    elements = {
      actions: page.querySelector('.nh-actions'),
      filters: page.querySelector('.nh-filters'),
      list: page.querySelector('.nh-list'),
      error: page.querySelector('.nh-error'),
    };
    render();
  }

  function dayHeading(date) {
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return fullDay.format(date);
  }

  function renderActions() {
    const {actions} = elements;
    actions.replaceChildren();
    if (confirming) {
      const confirm = button('Clear', () => {
        confirming = false;
        run('clear');
      }, 'nh-danger');
      confirm.disabled = busy;
      const cancel = button('Cancel', () => { confirming = false; renderActions(); });
      actions.append(create('span', `Clear all ${items.length}?`), confirm, cancel);
      return;
    }
    const read = button('Mark all read', () => run('read_all'));
    read.disabled = busy || items.every(item => item.read);
    const clear = button('Clear all', () => { confirming = true; renderActions(); });
    clear.disabled = busy || items.length === 0;
    actions.append(read, clear);
  }

  function render() {
    const {filters, list} = elements;
    const previousScroll = list.scrollTop;
    renderActions();
    const counts = new Map([['all', items.length]]);
    for (const item of items) counts.set(item.source, (counts.get(item.source) || 0) + 1);
    if (!counts.has(filter)) filter = 'all';
    filters.replaceChildren();
    for (const [source, count] of counts) {
      const option = button(`${source === 'all' ? 'All' : sources[source]} · ${count}`, () => {
        filter = source;
        list.scrollTop = 0;
        render();
      });
      option.setAttribute('aria-pressed', String(source === filter));
      filters.append(option);
    }
    list.replaceChildren();
    const shown = items.filter(item => filter === 'all' || item.source === filter);
    if (!shown.length) list.append(create('p', 'No Poni notifications yet.', 'nh-empty'));
    let lastDay;
    for (const item of shown) {
      const date = new Date(item.created_at_ms);
      const day = date.toDateString();
      if (day !== lastDay) {
        list.append(create('h3', dayHeading(date), 'nh-day'));
        lastDay = day;
      }

      const row = create('div', '', 'nh-row');
      if (!item.read) row.classList.add('unread');
      const read = button('', () => { if (!item.read) run('read', item.id); }, 'nh-notice');
      read.setAttribute('aria-label', `${item.read ? 'Read' : 'Mark read'}: ${item.title}`);
      const metadata = create('span', `${sources[item.source]} · ${shortTime.format(date)}`, 'nh-meta');
      read.append(metadata, create('strong', item.title));
      if (item.body) read.append(create('span', item.body, 'nh-message'));
      const remove = button('×', () => run('remove', item.id), 'nh-remove');
      remove.setAttribute('aria-label', `Remove ${item.title}`);
      row.append(read, remove);
      list.append(row);
    }
    list.scrollTop = previousScroll;
  }

  async function run(action, id) {
    if (busy || (!action && reading)) return;
    const started = ++request;
    if (action) busy = true;
    else reading = true;
    if (action) renderActions();
    try {
      const invoke = window.__TAURI__.core.invoke;
      const next = action
        ? await invoke('update_notification_history', {action, id})
        : await invoke('notification_history');
      if (started !== request) return;
      const changed = JSON.stringify(items) !== JSON.stringify(next);
      items = next;
      elements.error.textContent = '';
      if (visible && (changed || action)) render();
    } catch (error) {
      if (started === request) elements.error.textContent = String(error);
    } finally {
      if (action) busy = false;
      else reading = false;
      if (action && visible) renderActions();
    }
  }

  function show() {
    visible = true;
    confirming = false;
    render();
    run();
    clearInterval(poll);
    poll = setInterval(run, 2000);
  }

  function hide() {
    visible = false;
    clearInterval(poll);
  }

  window.poniModules ||= {};
  window.poniModules.notifs = {mount, show, hide};
})();

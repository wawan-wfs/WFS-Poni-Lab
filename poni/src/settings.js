(() => {
  'use strict';

  const names = {
    home: 'Home', tasks: 'Todo', notes: 'Notes', calendar: 'Calendar', timer: 'Timer',
    weather: 'Weather', worldclock: 'World Clock', dayprogress: 'Day Progress', system: 'System',
    bookmarks: 'Bookmarks', pomodoro: 'Pomodoro', teleprompter: 'Teleprompter',
    dashboard: 'Dashboard', health: 'Health', control: 'Control', github: 'GitHub',
    notifs: 'Notifications', prayer: 'Prayer Times', radio: 'Radio', screentime: 'Screen Time',
    support: 'Support', translate: 'Translate', aiusage: 'AI Usage', bluetooth: 'Bluetooth & Wi-Fi',
    chat: 'AI Chat', currency: 'Currency',
  };

  const categories = [
    { group: 'Poni', pages: [
      { id: 'general', title: 'General', icon: '⚙', color: 'grey' },
      { id: 'modules', title: 'Modules', icon: '▦', color: 'indigo' },
    ] },
    { group: 'Features', pages: [
      { id: 'dashboard', title: 'Dashboard', icon: '⊞', color: 'blue', link: 'dashboard',
        hint: 'Choose and reorder your Dashboard widgets.' },
      { id: 'calendar', title: 'Calendar', icon: '▤', color: 'red', link: 'calendar',
        hint: 'Calendar display, meeting reminders, and the first day of the week.' },
      { id: 'weather', title: 'Weather', icon: '☀', color: 'cyan', link: 'weather',
        hint: 'Search for your city and choose the forecast location.' },
      { id: 'prayer', title: 'Prayer Times', icon: '◒', color: 'green', link: 'prayer',
        hint: 'Choose a city, calculation method and Asr school.' },
      { id: 'pomodoro', title: 'Pomodoro', icon: '◷', color: 'orange', link: 'pomodoro',
        hint: 'Set focus sessions and break durations.' },
      { id: 'dayprogress', title: 'Day Progress', icon: '◴', color: 'blue', link: 'dayprogress',
        hint: 'Choose when your day begins and ends.' },
      { id: 'screentime', title: 'Screen Time', icon: '⌛', color: 'indigo', link: 'screentime',
        hint: 'Turn activity tracking on or off and clear stored history.' },
    ] },
    { group: 'Poni & system', pages: [
      { id: 'notifications', title: 'Notifications', icon: '♧', color: 'red', link: 'notifs',
        hint: 'View or clear notifications saved by Poni.' },
      { id: 'mirror', title: 'Mirror', icon: '●', color: 'purple' },
      { id: 'dock', title: 'Dock', icon: '▭', color: 'blue',
        hint: 'Dock settings will be available when the Dock is implemented.' },
      { id: 'buddy', title: 'Buddy', icon: '♢', color: 'orange',
        hint: 'Buddy settings will be available when the Buddy is implemented.' },
      { id: 'shelf', title: 'Drop Actions & Shelf', icon: '↧', color: 'orange',
        hint: 'Drop Actions and Shelf settings are not available yet.' },
    ] },
    { group: 'Integrations', pages: [
      { id: 'chat', title: 'AI Chat & Translate', icon: '✦', color: 'purple', link: 'chat',
        hint: 'Set a local Ollama model in AI Chat or choose languages in Translate.' },
      { id: 'aiusage', title: 'AI Usage', icon: '◕', color: 'orange', link: 'aiusage',
        hint: 'Import a usage snapshot from Codex or Claude.' },
      { id: 'github', title: 'GitHub', icon: '◈', color: 'grey', link: 'github',
        hint: 'Choose which GitHub account to display.' },
    ] },
  ];
  const pages = categories.flatMap(section => section.pages);
  const indexedFields = [
    ['general', 'Clock format', '12 hour 24 hour region time', 'clock-format'],
    ['general', 'Time at the top of the open Poni', 'header clock', 'header-clock'],
    ['general', 'Open on hover', 'mouse click to open', 'open-on-hover'],
    ['general', 'Hover delay', 'open mouse milliseconds', 'hover-delay'],
    ['general', 'Close delay', 'dismiss mouse milliseconds', 'close-delay'],
    ['general', 'Switch tabs with ← / →', 'arrows keyboard shortcuts', 'module-shortcuts'],
    ['modules', 'Open this module by default', 'initial page', 'default-module'],
    ['modules', 'Remember the last module', 'startup restore last tab', 'remember-module'],
    ['mirror', 'Show the Mirror on Home', 'camera webcam local video', 'mirror-enabled'],
    ['mirror', 'Mirror shape', 'rounded circle camera', 'mirror-shape'],
    ['calendar', 'Show calendar', 'calendar visibility home kalender', 'calendar-enabled'],
    ['calendar', 'Meeting reminder', 'calendar notification event minutes pertemuan pengingat', 'meeting-reminder'],
    ['calendar', 'Week starts on', 'calendar first day monday sunday minggu senin awal pekan', 'week-start'],
  ];

  const option = (label, value) => {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    return element;
  };
  const create = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  };

  let root, search, menu, panel, banner;
  let settings = null;
  let active = 'general';
  let busy = false;
  let loading = false;
  let dragId = null;

  function choose(id, focusId = null) {
    active = id;
    search.value = '';
    render(false);
    if (focusId) document.getElementById('settings-' + focusId)?.focus();
  }

  function broadcast() {
    window.dispatchEvent(new CustomEvent('poni-settings-changed', { detail: settings }));
  }

  async function change(patch, focusId) {
    if (busy || !settings) return;
    busy = true;
    banner.textContent = 'Saving…';
    updateBusy();
    try {
      settings = await window.__TAURI__.core.invoke('set_poni_settings', { patch });
      broadcast();
      banner.textContent = 'Saved';
    } catch (error) {
      banner.textContent = String(error);
    } finally {
      busy = false;
      render(true);
      if (focusId) document.getElementById('settings-' + focusId)?.focus({ preventScroll: true });
    }
  }

  function updateBusy() {
    root.setAttribute('aria-busy', String(busy || loading));
    const controls = panel.querySelector('fieldset');
    if (controls) controls.disabled = busy || loading;
  }

  function button(text, handler, className = 'settings-button') {
    const node = create('button', className, text);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  }

  function group(parent, title) {
    if (title) parent.append(create('h3', null, title));
    const node = create('div', 'settings-group');
    parent.append(node);
    return node;
  }

  function row(container, title, description, control) {
    const node = create('label', 'settings-row');
    const label = create('span', 'settings-label');
    label.append(create('span', null, title));
    if (description) label.append(create('small', null, description));
    node.append(label, control);
    container.append(node);
  }

  function toggle(container, id, title, description, key) {
    const input = create('input', 'settings-switch');
    input.id = 'settings-' + id;
    input.type = 'checkbox';
    input.checked = settings[key];
    input.addEventListener('change', () => void change({ [key]: input.checked }, id));
    row(container, title, description, input);
  }

  function select(container, id, title, description, key, options, disabled = false) {
    const input = create('select', 'settings-select');
    input.id = 'settings-' + id;
    input.disabled = disabled;
    for (const [value, label] of options) input.append(option(label, value));
    input.value = settings[key];
    input.addEventListener('change', () => void change({ [key]: input.value }, id));
    row(container, title, description, input);
  }

  function range(container, id, title, key, { max, step, disabled = false, unit, spokenUnit, description }) {
    const box = create('span', 'settings-range');
    const input = create('input');
    const output = create('span', 'settings-range-value');
    output.setAttribute('aria-hidden', 'true');
    input.id = 'settings-' + id;
    input.type = 'range';
    input.min = '0';
    input.max = max;
    input.step = step;
    input.value = settings[key];
    input.disabled = disabled;
    const showValue = () => {
      output.textContent = input.value + ' ' + unit;
      input.setAttribute('aria-valuetext', input.value + ' ' + spokenUnit);
    };
    showValue();
    input.addEventListener('input', showValue);
    input.addEventListener('change', () => void change({ [key]: Number(input.value) }, id));
    box.append(input, output);
    row(container, title, description, box);
  }

  function delay(container, id, title, key, max, step, disabled = false) {
    range(container, id, title, key, { max, step, disabled, unit: 'ms', spokenUnit: 'milliseconds' });
  }

  function general(content) {
    const clock = group(content, 'Clock');
    select(clock, 'clock-format', 'Clock format', 'Follow the Windows region or choose a format.',
      'clock_format', [['region', 'Windows region'], ['h12', '12-hour'], ['h24', '24-hour']]);
    toggle(clock, 'header-clock', 'Time at the top of the open Poni', 'On every tab.', 'header_clock');

    const opening = group(content, 'Opening');
    toggle(opening, 'open-on-hover', 'Open on hover', 'Otherwise click to open.', 'open_on_hover');
    delay(opening, 'hover-delay', 'Hover delay', 'hover_delay', '800', '10', !settings.open_on_hover);
    delay(opening, 'close-delay', 'Close delay', 'close_delay', '1500', '50');

    const shortcuts = group(content, 'Keyboard shortcuts');
    toggle(shortcuts, 'module-shortcuts', 'Switch tabs with ← / →', 'After opening Poni with Alt+N.',
      'module_shortcuts');
  }

  function mirror(content) {
    const controls = group(content);
    toggle(controls, 'mirror-enabled', 'Show the Mirror on Home',
      'Open the Mirror from Home to preview your camera.', 'mirror_enabled');
    select(controls, 'mirror-shape', 'Mirror shape', null, 'mirror_shape',
      [['rounded', 'Rounded'], ['circle', 'Circle']], !settings.mirror_enabled);
  }

  function calendar(content) {
    const controls = group(content);
    toggle(controls, 'calendar-enabled', 'Show calendar', null, 'calendar_enabled');
    range(controls, 'meeting-reminder', 'Meeting reminder', 'meeting_reminder_minutes', {
      max: 30, step: 1, unit: 'min', spokenUnit: 'minutes',
      description: 'Poni pops up this many minutes before a local event (0 = off).',
    });
    select(controls, 'week-start', 'Week starts on',
      'Applies to the Calendar tab and Day Progress.',
      'week_start', [['windows', 'As in Windows'], ['monday', 'Monday'], ['sunday', 'Sunday']]);
    const hidden = settings.hidden_modules.includes('calendar');
    content.append(button(hidden ? 'Show Calendar in Modules' : 'Open Calendar', () => void openLink('calendar')));
  }

  function move(id, target, after = false, focusId = null) {
    if (busy || id === target) return;
    const order = settings.module_order.filter(value => value !== id);
    order.splice(order.indexOf(target) + (after ? 1 : 0), 0, id);
    void change({ module_order: order }, focusId);
  }

  function modules(content) {
    content.append(create('p', 'settings-lead',
      'Choose which modules show as tabs. Drag the handle or use the arrows to change their order.'));
    const visible = settings.module_order.filter(id => !settings.hidden_modules.includes(id));
    const list = create('div', 'settings-module-list');
    for (const [index, id] of settings.module_order.entries()) {
      const title = names[id] || id;
      const item = create('div', 'settings-module-row');
      const grip = create('span', 'settings-module-grip', '⠿');
      grip.setAttribute('aria-hidden', 'true');
      grip.title = 'Drag to reorder';
      grip.draggable = true;
      grip.addEventListener('dragstart', event => {
        dragId = id;
        event.dataTransfer.setData('text/plain', id);
        event.dataTransfer.effectAllowed = 'move';
      });
      grip.addEventListener('dragend', () => {
        dragId = null;
        list.querySelectorAll('.drag-target').forEach(row => row.classList.remove('drag-target'));
      });
      item.addEventListener('dragover', event => {
        if (!dragId || dragId === id || busy) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        item.classList.add('drag-target');
      });
      item.addEventListener('dragleave', () => item.classList.remove('drag-target'));
      item.addEventListener('drop', event => {
        if (!dragId || busy) return;
        event.preventDefault();
        item.classList.remove('drag-target');
        const box = item.getBoundingClientRect();
        const position = event.clientY >= box.top + box.height / 2;
        move(dragId, id, position);
        dragId = null;
      });

      const upId = 'move-up-' + id;
      const up = button('⌃', () => move(id, settings.module_order[index - 1], false, upId));
      up.id = 'settings-' + upId;
      up.disabled = index === 0;
      up.setAttribute('aria-label', 'Move ' + title + ' up');
      up.title = up.getAttribute('aria-label');
      const downId = 'move-down-' + id;
      const down = button('⌄', () => move(id, settings.module_order[index + 1], true, downId));
      down.id = 'settings-' + downId;
      down.disabled = index === settings.module_order.length - 1;
      down.setAttribute('aria-label', 'Move ' + title + ' down');
      down.title = down.getAttribute('aria-label');
      const showId = 'visible-' + id;
      const show = create('input', 'settings-switch');
      show.type = 'checkbox';
      show.id = 'settings-' + showId;
      show.checked = visible.includes(id);
      show.disabled = show.checked && visible.length === 1;
      show.setAttribute('aria-label', 'Show ' + title);
      show.addEventListener('change', () => {
        const hidden = settings.hidden_modules.filter(value => value !== id);
        if (!show.checked) hidden.push(id);
        void change({ hidden_modules: hidden }, showId);
      });
      item.append(grip, create('span', 'settings-module-name', title), up, down, show);
      list.append(item);
    }
    content.append(list);
    const defaults = group(content, 'Default');
    select(defaults, 'default-module', 'Open this module by default', null, 'default_module',
      visible.map(id => [id, names[id] || id]));
    toggle(defaults, 'remember-module', 'Remember the last module',
      'Otherwise Poni opens the default module.', 'remember_module');
  }

  async function openLink(id) {
    const trigger = document.querySelector('.tab[data-page="' + id + '"]');
    if (trigger?.hidden || settings.hidden_modules.includes(id)) {
      choose('modules', 'visible-' + id);
      return;
    }
    if (trigger) {
      trigger.click();
      return;
    }
    try {
      await window.__TAURI__.core.invoke('show_poni_module', { module: id });
    } catch (error) {
      await refresh();
      if (settings?.hidden_modules.includes(id)) choose('modules', 'visible-' + id);
      else banner.textContent = String(error);
    }
  }

  function feature(content, page) {
    content.append(create('p', 'settings-lead', page.hint));
    if (!page.link) return;
    const title = names[page.link] || page.title;
    const hidden = settings.hidden_modules.includes(page.link);
    content.append(button(hidden ? 'Show ' + title + ' in Modules' : 'Open ' + title,
      () => void openLink(page.link)));
    if (page.id === 'chat') {
      content.append(button('Open Translate', () => void openLink('translate')));
    }
  }

  function drawSearch(query) {
    panel.append(create('h2', 'settings-title', 'Search Settings'));
    const matches = [
      ...pages.map(page => [page.id, page.title, page.hint || '']),
      ...indexedFields,
      ...Object.entries(names).map(([id, title]) => ['modules', title, 'show hide tab reorder', 'visible-' + id]),
    ];
    const words = query.toLocaleLowerCase().split(/\s+/);
    const list = group(panel);
    const seen = new Set();
    for (const [id, text, description, focusId] of matches) {
      if (!words.every(word => (text + ' ' + description).toLocaleLowerCase().includes(word))) continue;
      const identity = JSON.stringify([id, text, focusId]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const node = button(text, () => choose(id, focusId), 'settings-result');
      const category = pages.find(page => page.id === id);
      if (category.title !== text) node.append(create('small', null, category.title));
      list.append(node);
    }
    if (!seen.size) list.append(create('p', 'settings-empty', 'No settings match this search.'));
  }

  function render(keepScroll) {
    const scroll = keepScroll ? panel.scrollTop : 0;
    const query = search.value.trim();
    panel.replaceChildren();
    menu.querySelectorAll('[data-section]').forEach(item => {
      if (item.dataset.section === active && !query) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    if (query && settings) {
      drawSearch(query);
    } else {
      const current = pages.find(page => page.id === active);
      const heading = create('h2', 'settings-title');
      const icon = create('span', 'settings-icon ' + current.color, current.icon);
      icon.setAttribute('aria-hidden', 'true');
      heading.append(icon, document.createTextNode(current.title));
      panel.append(heading);
      if (!settings) {
        panel.append(button(loading ? 'Loading settings…' : 'Load settings', () => void refresh()));
      } else {
        const controls = create('fieldset', 'settings-controls');
        panel.append(controls);
        if (active === 'general') general(controls);
        else if (active === 'modules') modules(controls);
        else if (active === 'mirror') mirror(controls);
        else if (active === 'calendar') calendar(controls);
        else feature(controls, current);
      }
    }
    updateBusy();
    panel.scrollTop = scroll;
  }

  async function refresh() {
    if (busy || loading) return;
    loading = true;
    banner.textContent = '';
    updateBusy();
    try {
      settings = await window.__TAURI__.core.invoke('get_poni_settings');
      broadcast();
    } catch (error) {
      banner.textContent = String(error);
    } finally {
      loading = false;
      render(true);
    }
  }

  function mount(page) {
    root = page;
    root.classList.add('settings-page');
    const sidebar = create('aside', 'settings-sidebar');
    const brand = create('div', 'settings-brand');
    brand.append(create('span', 'settings-mark', '⌒'), create('strong', null, 'Poni Settings'));
    search = create('input', 'settings-search');
    search.type = 'search';
    search.placeholder = 'Search settings';
    search.setAttribute('aria-label', 'Search settings');
    search.addEventListener('input', () => render(false));
    search.addEventListener('keydown', event => {
      if (event.key === 'Enter') panel.querySelector('.settings-result')?.click();
    });
    menu = create('div', 'settings-menu');
    menu.setAttribute('aria-label', 'Settings categories');
    for (const section of categories) {
      menu.append(create('p', 'settings-menu-group', section.group));
      for (const item of section.pages) {
        const node = button('', () => choose(item.id), 'settings-menu-item');
        const icon = create('span', 'settings-icon ' + item.color, item.icon);
        icon.setAttribute('aria-hidden', 'true');
        node.append(icon, document.createTextNode(item.title));
        node.dataset.section = item.id;
        menu.append(node);
      }
    }
    sidebar.append(brand, search, menu);
    const content = create('div', 'settings-content');
    panel = create('div', 'settings-panel');
    banner = create('div', 'settings-status');
    banner.setAttribute('role', 'status');
    content.append(panel, banner);
    root.append(sidebar, content);
    render(false);
  }

  window.poniModules ||= {};
  window.poniModules.settings = { mount, show: refresh };
})();

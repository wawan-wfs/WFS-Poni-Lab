(() => {
  'use strict';

  const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
  const surface = document.querySelector('#surface');
  const badge = document.querySelector('#shelf-count');
  const dropPanel = document.querySelector('#file-drop-actions');
  const dropTiles = {
    shelf: ['Shelf', '▰'], zip: ['ZIP', '▣'], extract: ['Extract', '⇩'], copy: ['Copy', '▤'],
  };
  const defaults = { enabled: true, open_on_drag: true, clipboard_enabled: false,
    drop_enabled: true, tiles: ['shelf', 'zip', 'extract', 'copy'] };
  let preferences = defaults;
  let visible = true;
  let page;
  let hooks;
  let cards = [];
  let selected = new Set();
  let primary;
  let picking = false;
  let draggingIn = false;
  let hoveredTile = null;
  let confirming = false;
  let clipboardView = false;
  let queue = Promise.resolve();

  function formatBytes(size) {
    if (size == null) return 'File';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = size ? Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1) : 0;
    const amount = size / 1024 ** index;
    return `${index && amount < 10 ? amount.toFixed(1) : Math.round(amount)} ${units[index]}`;
  }

  function part(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function button(text, handler) {
    const element = part('button', '', text);
    element.type = 'button';
    element.addEventListener('click', handler);
    return element;
  }

  function status(message) {
    const local = hooks?.isShelf() && page?.querySelector('.shelf-status');
    (local || document.querySelector('#status')).textContent = message;
  }

  function update(next) {
    if (!Array.isArray(next)) return;
    cards = next;
    const known = new Set(cards.map(item => item.id));
    selected = new Set([...selected].filter(id => known.has(id)));
    if (!selected.has(primary)) primary = selected.values().next().value;
    render();
  }

  function run(command, args, message = '') {
    const operation = queue.then(async () => {
      const result = await invoke(command, args);
      update(result);
      status(message);
      return result;
    });
    queue = operation.catch(error => status(String(error)));
    return queue;
  }

  function select(id, multiple) {
    if (!multiple) selected.clear();
    if (multiple && selected.has(id)) selected.delete(id);
    else selected.add(id);
    primary = selected.has(id) ? id : selected.values().next().value;
    confirming = false;
    drawSelection();
  }

  function action(item, type) {
    const copy = type === 'copy' || (type === 'open' && item.kind === 'text');
    return run('shelf_item_action', { id: item.id, action: type }, copy ? 'Copied to clipboard' : '');
  }

  function drawSelection() {
    if (!page) return;
    for (const element of page.querySelectorAll('.shelf-card')) {
      element.setAttribute('aria-pressed', String(selected.has(element.dataset.id)));
    }
    const toolbar = page.querySelector('.shelf-selection');
    toolbar.replaceChildren();
    const item = cards.find(item => item.id === primary);
    if (!item) return;
    if (item.kind !== 'text') {
      const open = button('Open', () => void action(item, 'open'));
      open.disabled = item.missing;
      toolbar.append(open);
    }
    if (item.kind === 'file') {
      const reveal = button('Show in folder', () => void action(item, 'reveal'));
      reveal.disabled = item.missing;
      toolbar.append(reveal);
    }
    toolbar.append(
      button(item.kind === 'file' ? 'Copy path' : 'Copy', () => void action(item, 'copy')),
      button(selected.size > 1 ? `Remove ${selected.size} items` : 'Remove', () => void run('shelf_remove', { ids: [...selected] })),
    );
  }

  function card(item) {
    const kind = item.kind === 'file' ? item.directory ? 'Folder' : formatBytes(item.size)
      : item.kind === 'link' ? 'Link' : 'Text';
    const element = button('', event => select(item.id, event.ctrlKey || event.metaKey || event.shiftKey));
    element.className = 'shelf-card';
    if (item.missing) element.classList.add('shelf-missing');
    element.dataset.id = item.id;
    element.title = item.path || item.text;
    element.setAttribute('aria-label', item.name + (item.missing ? ', missing' : ''));
    element.draggable = item.kind === 'file' && !item.missing;
    const symbol = item.kind === 'file' ? item.directory ? '▰' : '▤' : item.kind === 'link' ? '↗' : '≡';
    const icon = part('span', 'shelf-icon', symbol);
    icon.setAttribute('aria-hidden', 'true');
    element.append(icon, part('span', 'shelf-name', item.name), part('small', '', item.missing ? 'Missing' : kind));
    element.addEventListener('dblclick', () => { if (!item.missing) void action(item, 'open'); });
    element.addEventListener('contextmenu', event => {
      event.preventDefault();
      if (!selected.has(item.id)) select(item.id, false);
      page.querySelector('.shelf-selection button:not(:disabled)')?.focus();
    });
    element.addEventListener('keydown', event => {
      if (event.key === 'Delete') {
        event.preventDefault();
        void run('shelf_remove', { ids: selected.has(item.id) ? [...selected] : [item.id] });
      }
    });
    element.addEventListener('dragstart', event => {
      event.preventDefault();
      if (item.kind !== 'file' || item.missing) return;
      const ids = selected.has(item.id) ? [...selected] : [item.id];
      void run('shelf_drag', { ids });
    });
    return element;
  }

  function drawClear() {
    const target = page.querySelector('.shelf-clear');
    if (!cards.length) {
      confirming = false;
      target.replaceChildren();
    } else if (confirming) {
      target.replaceChildren(
        button('Clear all', () => { confirming = false; void run('shelf_remove', { ids: null }); }),
        button('Cancel', () => { confirming = false; drawClear(); }),
      );
    } else {
      target.replaceChildren(button('Clear shelf', () => { confirming = true; drawClear(); }));
    }
  }

  function render() {
    badge.hidden = cards.length === 0 || !visible;
    badge.textContent = cards.length > 99 ? '99+' : String(cards.length);
    if (!page) return;
    const list = page.querySelector('.shelf-items');
    const scroll = list.scrollLeft;
    const focused = document.activeElement?.dataset.id;
    list.replaceChildren(...cards.map(card));
    list.hidden = cards.length === 0;
    list.scrollLeft = scroll;
    page.querySelector('.shelf-empty').hidden = cards.length !== 0;
    drawClear();
    drawSelection();
    if (focused) [...list.children].find(element => element.dataset.id === focused)?.focus({preventScroll: true});
  }

  async function pick(folders) {
    if (picking) return;
    picking = true;
    try {
      await run('shelf_pick', { folders });
    } finally {
      picking = false;
    }
  }

  function updateView() {
    if (!page) return;
    const showClipboard = preferences.clipboard_enabled && clipboardView;
    page.querySelector('.shelf-file-view').hidden = showClipboard;
    page.querySelector('#clipboard-view').hidden = !showClipboard;
    page.querySelector('.shelf-view-switch').hidden = !preferences.clipboard_enabled;
    for (const control of page.querySelectorAll('.shelf-view-switch button')) {
      control.setAttribute('aria-pressed', String(control.dataset.view === (showClipboard ? 'clipboard' : 'files')));
    }
    window.poniClipboard?.show(showClipboard && Boolean(hooks?.isShelf()));
  }

  function mount(container) {
    page = container;
    page.innerHTML = `
      <div class="shelf-view-switch" aria-label="Shelf views" hidden></div>
      <div class="shelf-file-view">
        <div class="shelf-body">
          <div class="shelf-items" aria-label="Shelf items" hidden></div>
          <div class="shelf-empty"><span aria-hidden="true">⇩</span><strong>Drop files here</strong></div>
          <div class="shelf-controls"></div>
        </div>
        <div class="shelf-selection" aria-label="Selected items"></div>
        <div class="shelf-status" role="status"></div>
      </div>
      <div id="clipboard-view" hidden></div>`;
    const views = page.querySelector('.shelf-view-switch');
    for (const [view, title] of [['files', 'Files'], ['clipboard', 'Clipboard']]) {
      const control = button(title, () => {
        clipboardView = view === 'clipboard';
        updateView();
      });
      control.dataset.view = view;
      views.append(control);
    }
    const controls = page.querySelector('.shelf-controls');
    controls.append(
      button('Add files', () => void pick(false)),
      button('Add folders', () => void pick(true)),
      button('Paste text or link', () => void run('shelf_paste')),
      part('div', 'shelf-clear'),
    );
    window.poniClipboard?.mount(page.querySelector('#clipboard-view'));
    updateView();
    render();
  }

  function endDrag() {
    draggingIn = false;
    hoveredTile = null;
    surface.classList.remove('shelf-dragging');
    dropPanel.hidden = true;
    dropPanel.replaceChildren();
  }

  function openDropPanel(paths) {
    const tiles = preferences.tiles.filter(tile => tile in dropTiles && (tile !== 'shelf' || visible));
    if (!preferences.drop_enabled || !tiles.length) return false;
    dropPanel.replaceChildren();
    for (const id of tiles) {
      const [name, symbol] = dropTiles[id];
      const tile = part('div', 'file-drop-tile');
      const icon = part('span', '', symbol);
      icon.setAttribute('aria-hidden', 'true');
      tile.append(icon, part('strong', '', name));
      if (id !== 'extract' || paths.every(path => /\.zip$/i.test(path))) {
        tile.dataset.tile = id;
      } else {
        tile.classList.add('file-drop-unavailable');
      }
      dropPanel.append(tile);
    }
    hooks.openActions();
    dropPanel.hidden = false;
    return true;
  }

  function tileAt(position) {
    if (dropPanel.hidden) return null;
    if (!position) return hoveredTile;
    const scale = window.devicePixelRatio || 1;
    return document.elementFromPoint(position.x / scale, position.y / scale)?.closest('#file-drop-actions [data-tile]')?.dataset.tile || null;
  }

  async function processFiles(tile, paths) {
    picking = tile === 'copy';
    try {
      status('Working…');
      const outputs = await invoke('run_drop_action', {action: tile, paths});
      if (!outputs.length) status('');
      else if (outputs.length === 1) status(`Saved ${outputs[0].split(/[\\/]/).pop()}`);
      else status(`Saved ${outputs.length} items`);
    } catch (error) {
      status(String(error));
    } finally {
      picking = false;
    }
  }

  function handleNativeDrag({type, paths = [], position}) {
    if (type === 'leave') { endDrag(); return; }
    if (!visible && !preferences.drop_enabled) return;
    if (type === 'enter' && paths.length) {
      draggingIn = true;
      surface.classList.add('shelf-dragging');
      if (clipboardView) { clipboardView = false; updateView(); }
      if (!openDropPanel(paths) && visible && (hooks.isOpen() || preferences.open_on_drag)) hooks.open();
    } else if (type === 'over') {
      hoveredTile = tileAt(position);
      for (const tile of dropPanel.querySelectorAll('[data-tile]')) {
        tile.classList.toggle('file-drop-over', tile.dataset.tile === hoveredTile);
      }
    } else if (type === 'drop') {
      const choose = tileAt(position);
      const usedTiles = !dropPanel.hidden;
      endDrag();
      if (!paths.length) return;
      if (choose && choose !== 'shelf') {
        void processFiles(choose, paths);
        return;
      }
      if (!visible || (!usedTiles && hooks.isOpen() && !hooks.isShelf())) return;
      if (usedTiles || hooks.isOpen() || preferences.open_on_drag) hooks.open();
      void run('shelf_add', {items: paths.map(path => ({kind: 'file', path}))});
    }
  }

  function handleTextDrop(event) {
    if (!visible || !event.dataTransfer || event.dataTransfer.types.includes('Files') ||
        !event.dataTransfer.types.some(type => type === 'text/plain' || type === 'text/uri-list') ||
        event.target.closest('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
    if (event.type !== 'drop') return;
    const text = event.dataTransfer.getData('text/plain') || event.dataTransfer.getData('text/uri-list')
      .split(/\r?\n/).find(line => line && !line.startsWith('#'));
    if (!text?.trim()) return;
    hooks.open();
    clipboardView = false;
    updateView();
    void run('shelf_add', {items: [{kind: 'text', text}]});
  }

  window.poniShelf = {
    async connect(configuration) {
      hooks = configuration;
      surface.addEventListener('dragover', handleTextDrop);
      surface.addEventListener('drop', handleTextDrop);
      try {
        const event = window.__TAURI__.event;
        await Promise.all([
          event.listen('poni-shelf-items', ({payload}) => update(payload)),
          event.listen('poni-shelf-drag-error', ({payload}) => status(payload)),
          window.__TAURI__.webview?.getCurrentWebview().onDragDropEvent(({payload}) => handleNativeDrag(payload)),
        ]);
        await run('shelf_items');
      } catch (error) {
        status(String(error));
      }
    },
    configure(value, available) {
      preferences = { ...defaults, ...value };
      visible = available && preferences.enabled;
      if (!visible && !preferences.drop_enabled) endDrag();
      if (!preferences.clipboard_enabled) clipboardView = false;
      updateView();
      render();
    },
    keepOpen: () => picking || draggingIn,
  };
  window.poniModules ||= {};
  window.poniModules.shelf = {
    mount,
    show() { updateView(); return run('shelf_items'); },
    hide() { window.poniClipboard?.show(false); },
  };
})();

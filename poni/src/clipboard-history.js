(() => {
  'use strict';

  const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
  const age = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'narrow' });
  let root, observer;
  let visible = false;
  let items = [];
  let selected = null;
  let currentRequest = 0;
  let working = false;
  let confirming = false;
  const previews = new Set();

  function part(tag, classname, text) {
    const element = document.createElement(tag);
    if (classname) element.className = classname;
    if (text) element.textContent = text;
    return element;
  }

  function button(text, handler) {
    const element = part('button', '', text);
    element.type = 'button';
    element.addEventListener('click', handler);
    return element;
  }

  function showStatus(message) {
    root.querySelector('.clip-status').textContent = message;
  }

  function releaseImages() {
    observer?.disconnect();
    for (const url of previews) URL.revokeObjectURL(url);
    previews.clear();
  }

  async function paintImage(img) {
    try {
      const bytes = await invoke('clipboard_image', {id: img.dataset.id});
      if (!img.isConnected || !visible) return;
      const data = bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes);
      const url = URL.createObjectURL(new Blob([data], {type: 'image/png'}));
      previews.add(url);
      img.src = url;
    } catch {
      img.alt = 'Image unavailable';
    }
  }

  function elapsed(epoch) {
    const minutes = Math.max(0, Math.floor((Date.now() - epoch) / 60000));
    return minutes < 60 ? age.format(-minutes, 'minute')
      : minutes < 1440 ? age.format(-Math.floor(minutes / 60), 'hour')
      : age.format(-Math.floor(minutes / 1440), 'day');
  }

  function renderActions() {
    const controls = root.querySelector('.clip-controls');
    controls.replaceChildren();
    const item = items.find(item => item.id === selected);
    if (item) controls.append(
      button(item.pinned ? 'Unpin' : 'Pin', () => void update(item.pinned ? 'unpin' : 'pin', item.id)),
      button('Remove copy', () => void update('remove', item.id)),
    );
    if (confirming) {
      controls.append(
        button('Clear unpinned', () => { confirming = false; void update('clear'); }),
        button('Cancel', () => { confirming = false; renderActions(); }),
      );
    } else if (items.some(item => !item.pinned)) {
      controls.append(button('Clear history', () => { confirming = true; renderActions(); }));
    }
  }

  function render() {
    releaseImages();
    if (!visible || !root) return;
    const list = root.querySelector('.clip-items');
    const left = list.scrollLeft;
    list.replaceChildren();
    list.hidden = items.length === 0;
    root.querySelector('.clip-empty').hidden = items.length !== 0;
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        void paintImage(entry.target);
      }
    }, { root: list });
    for (const item of items) {
      const tile = button('', () => { selected = item.id; renderActions(); void update('copy', item.id); });
      tile.className = 'clip-tile';
      tile.setAttribute('aria-label', item.kind === 'image' ? `Copy image ${item.width} × ${item.height}`
        : `Copy ${item.text.slice(0, 80)}`);
      if (item.kind === 'image') {
        const img = part('img', 'clip-image');
        img.alt = `${item.width} × ${item.height}`;
        img.dataset.id = item.id;
        tile.append(img);
        observer.observe(img);
      } else {
        tile.append(part('span', 'clip-preview', item.text.slice(0, 512)));
      }
      tile.append(part('small', '', [item.pinned ? 'Pinned' : elapsed(item.copied_at_ms),
        item.kind === 'image' ? 'Image' : item.kind === 'link' ? 'Link' : 'Text'].join(' · ')));
      tile.addEventListener('contextmenu', event => {
        event.preventDefault();
        selected = item.id;
        renderActions();
        root.querySelector('.clip-controls button')?.focus();
      });
      list.append(tile);
    }
    list.scrollLeft = left;
    renderActions();
  }

  async function refresh() {
    if (!visible) return;
    const token = ++currentRequest;
    try {
      const next = await invoke('clipboard_history');
      if (!visible || token !== currentRequest || !Array.isArray(next)) return;
      if (JSON.stringify(next) === JSON.stringify(items)) return;
      items = next;
      if (!items.some(item => item.id === selected)) selected = null;
      render();
    } catch (error) {
      if (visible && token === currentRequest) showStatus(String(error));
    }
  }

  async function update(action, id) {
    if (working) return;
    working = true;
    try {
      await invoke('clipboard_history_action', { action, id });
      if (visible) {
        showStatus(action === 'copy' ? 'Copied to clipboard' : '');
        await refresh();
      }
    } catch (error) {
      if (visible) showStatus(String(error));
    } finally {
      working = false;
      if (visible) renderActions();
    }
  }

  function mount(container) {
    root = container;
    root.innerHTML = `<div class="clip-items" aria-label="Clipboard history" hidden></div>
      <div class="clip-empty">Nothing copied yet</div>
      <div class="clip-controls" aria-label="Clipboard actions"></div>
      <div class="clip-status" role="status"></div>`;
    window.__TAURI__.event.listen('poni-clipboard-changed', refresh)
      .catch(error => showStatus(String(error)));
  }

  function show(next) {
    if (!root || visible === next) return;
    visible = next;
    if (visible) {
      render();
      void refresh();
    } else {
      currentRequest++;
      items = [];
      selected = null;
      confirming = false;
      showStatus('');
      releaseImages();
      root.querySelector('.clip-items').replaceChildren();
    }
  }

  window.poniClipboard = { mount, show };
})();

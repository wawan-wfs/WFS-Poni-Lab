(() => {
  'use strict';

  const invoke = window.__TAURI__.core.invoke;
  const modules = window.poniModules ||= {};
  const cuePattern = /\[[^\]\n]*\]/g;
  const wpm = 140;
  const maxBody = 20000;
  let page, editor, viewer, scriptSelect, nameInput, bodyInput, speedInput, sizeInput;
  let countdownInput, estimateOutput, statusOutput, viewport, playButton, readerStatus;
  let data = null;
  let loading = false;
  let saveTimer = 0;
  let saveSerial = 0;
  let queue = Promise.resolve();
  let read = null;
  let frameId = 0;

  const selected = () => data?.scripts.find(script => script.id === data.selected);
  const words = line => line.replace(cuePattern, ' ').split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
  const asTime = seconds => {
    const total = Math.ceil(seconds);
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  };

  function parts(body) {
    return body.split(/\r?\n/).flatMap(raw => {
      const line = raw.trim();
      if (!line) return [];
      const count = words(line);
      return [{line, count, duration: count ? Math.max(.45, count * 60 / wpm) : 1.2}];
    });
  }

  function estimate() {
    const lines = parts(bodyInput.value);
    const count = lines.reduce((sum, row) => sum + row.count, 0);
    const seconds = lines.reduce((sum, row) => sum + row.duration, 0) * 10 / (data?.speed || 10);
    estimateOutput.textContent = count + (count === 1 ? ' word' : ' words') + ' · ≈' + asTime(seconds);
    page.querySelector('.tele-start').disabled = !lines.length;
  }

  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!data) return;
    const snapshot = structuredClone(data);
    const serial = ++saveSerial;
    queue = queue.then(async () => {
      try {
        await invoke('save_teleprompter', {settings: snapshot});
        if (serial === saveSerial) statusOutput.textContent = '';
      } catch (error) {
        if (serial === saveSerial) statusOutput.textContent = 'Save failed. ' + String(error);
      }
    });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 350);
  }

  function renderEditor() {
    const script = selected();
    editor.disabled = !data;
    scriptSelect.replaceChildren();
    if (!data?.scripts.length) scriptSelect.add(new Option('No scripts yet', ''));
    for (const item of data?.scripts || []) scriptSelect.add(new Option(item.name, item.id));
    scriptSelect.value = script?.id || '';
    nameInput.value = script?.name || '';
    bodyInput.value = script?.body || '';
    nameInput.disabled = !script;
    bodyInput.disabled = !script;
    page.querySelector('.tele-delete').disabled = !script;
    speedInput.value = data?.speed || 10;
    sizeInput.value = data?.size || 22;
    countdownInput.checked = data?.countdown ?? true;
    page.querySelector('.tele-speed-value').textContent = (Number(speedInput.value) / 10).toFixed(1) + '×';
    estimate();
  }

  async function load() {
    if (loading || data) return;
    loading = true;
    statusOutput.textContent = 'Loading scripts…';
    try {
      data = await invoke('get_teleprompter');
      statusOutput.textContent = '';
      renderEditor();
    } catch (error) {
      statusOutput.textContent = String(error);
    } finally {
      loading = false;
    }
  }

  function addScript(name = '', body = '') {
    if (!data) return;
    if (data.scripts.length >= 30) {
      statusOutput.textContent = 'You can keep up to 30 scripts.';
      return;
    }
    if (!name) {
      const names = new Set(data.scripts.map(script => script.name));
      let index = 1;
      while (names.has('Script ' + index)) index++;
      name = 'Script ' + index;
    }
    const script = {id: crypto.randomUUID(), name, body};
    data.scripts.unshift(script);
    data.selected = script.id;
    renderEditor();
    bodyInput.focus();
    flushSave();
  }

  async function importFile(file) {
    if (!file || !data) return;
    if (!/\.txt$/i.test(file.name) || file.size > maxBody * 4) {
      statusOutput.textContent = 'Choose a .txt file with up to 20,000 characters.';
      return;
    }
    try {
      const body = await file.text();
      if (body.length <= maxBody) {
        const name = file.name.replace(/\.txt$/i, '').trim().slice(0, 60);
        addScript(name, body);
      } else {
        statusOutput.textContent = 'This script is too long.';
      }
    } catch {
      statusOutput.textContent = 'Could not read this text file.';
    }
  }

  function paintReader() {
    if (!read) return;
    const remaining = Math.max(0, read.total - read.elapsed) * 10 / data.speed;
    readerStatus.textContent = read.countdown > 0 ? String(Math.ceil(read.countdown)) :
      read.elapsed >= read.total ? 'Finished' : asTime(remaining) + ' left';
    playButton.textContent = read.playing ? 'Pause' : 'Play';
    playButton.disabled = read.elapsed >= read.total;
    if (read.countdown > 0) return;
    while (read.index < read.lines.length - 1 && read.elapsed >= read.lines[read.index].end) {
      read.index++;
    }
    const row = read.lines[read.index];
    if (read.active !== row) {
      if (read.active) read.active.element.classList.remove('tele-current');
      row.element.classList.add('tele-current');
      read.active = row;
    }
    const next = read.lines[read.index + 1];
    const progress = Math.max(0, Math.min(1, (read.elapsed - row.start) / row.duration));
    const distance = next ? next.element.offsetTop - row.element.offsetTop : 0;
    viewport.scrollTop = row.element.offsetTop + distance * progress;
  }

  function frame(now) {
    if (!read?.playing) return;
    let seconds = read.last == null ? 0 : Math.min((now - read.last) / 1000, .25);
    read.last = now;
    if (read.countdown > 0) {
      const countdown = Math.min(read.countdown, seconds);
      read.countdown -= countdown;
      seconds -= countdown;
    }
    read.elapsed = Math.min(read.total, read.elapsed + seconds * data.speed / 10);
    if (read.elapsed >= read.total) read.playing = false;
    paintReader();
    if (read.playing) frameId = requestAnimationFrame(frame);
  }

  function play(enabled) {
    if (!read) return;
    cancelAnimationFrame(frameId);
    read.playing = enabled && read.elapsed < read.total;
    read.last = null;
    paintReader();
    if (read.playing) frameId = requestAnimationFrame(frame);
  }

  function start() {
    const rows = parts(bodyInput.value);
    if (!rows.length) return;
    if (saveTimer) flushSave();
    viewport.replaceChildren();
    viewport.style.fontSize = data.size + 'px';
    let total = 0;
    for (const row of rows) {
      const element = document.createElement('div');
      element.className = 'tele-line';
      element.dir = 'auto';
      for (const piece of row.line.split(/(\[[^\]\n]*\])/g)) {
        if (piece.startsWith('[') && piece.endsWith(']')) {
          const cue = document.createElement('span');
          cue.className = 'tele-cue';
          cue.textContent = piece;
          element.append(cue);
        } else element.append(piece);
      }
      viewport.append(element);
      row.start = total;
      total += row.duration;
      row.end = total;
      row.element = element;
    }
    const tail = document.createElement('div');
    tail.className = 'tele-tail';
    tail.setAttribute('aria-hidden', 'true');
    viewport.append(tail);
    read = {lines: rows, index: 0, elapsed: 0, countdown: data.countdown ? 3 : 0, total, active: null, last: null, playing: false};
    editor.hidden = true;
    viewer.hidden = false;
    viewport.scrollTop = 0;
    play(true);
    playButton.focus();
  }

  function stop() {
    cancelAnimationFrame(frameId);
    read = null;
    viewer.hidden = true;
    editor.hidden = false;
  }

  modules.teleprompter = {
    mount(target) {
      page = target;
      page.innerHTML = `
        <fieldset class="tele-editor" disabled>
          <div class="tele-tools">
            <select aria-label="Script"></select>
            <button type="button" class="tele-new">New script</button>
            <button type="button" class="tele-import">Import .txt</button>
            <input type="file" accept=".txt,text/plain" class="tele-file" hidden>
            <button type="button" class="tele-delete">Delete</button>
            <input class="tele-name" type="text" maxlength="60" aria-label="Script name" placeholder="Script name">
          </div>
          <textarea aria-label="Script text" placeholder="Write your script. Put cues in [brackets]." maxlength="20000" spellcheck="false"></textarea>
          <div class="tele-controls">
            <label>Speed <input class="tele-speed" type="range" min="1" max="20" aria-label="Reading speed"></label>
            <span class="tele-speed-value"></span>
            <label>Size <input class="tele-size" type="number" min="16" max="32" step="2" aria-label="Reading text size"></label>
            <label><input class="tele-countdown" type="checkbox"> 3 s countdown</label>
            <span class="tele-estimate"></span>
            <button type="button" class="tele-start">Start</button>
          </div>
        </fieldset>
        <div class="tele-viewer" hidden>
          <div class="tele-reader-controls">
            <button type="button" class="tele-play">Pause</button>
            <button type="button" class="tele-restart">Restart</button>
            <button type="button" class="tele-stop">Edit script</button>
            <output class="tele-reader-status"></output>
          </div>
          <div class="tele-viewport" aria-label="Script reader"></div>
        </div>
        <p class="tele-status" role="status"></p>`;
      const find = selector => page.querySelector(selector);
      editor = find('.tele-editor');
      viewer = find('.tele-viewer');
      scriptSelect = find('.tele-tools select');
      nameInput = find('.tele-name');
      bodyInput = find('textarea');
      speedInput = find('.tele-speed');
      sizeInput = find('.tele-size');
      countdownInput = find('.tele-countdown');
      estimateOutput = find('.tele-estimate');
      statusOutput = find('.tele-status');
      viewport = find('.tele-viewport');
      playButton = find('.tele-play');
      readerStatus = find('.tele-reader-status');

      find('.tele-new').addEventListener('click', () => addScript());
      const fileInput = find('.tele-file');
      find('.tele-import').addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        void importFile(fileInput.files[0]);
        fileInput.value = '';
      });
      find('.tele-delete').addEventListener('click', () => {
        if (!selected() || !window.confirm('Delete this script?')) return;
        data.scripts = data.scripts.filter(script => script.id !== data.selected);
        data.selected = data.scripts[0]?.id || null;
        renderEditor();
        flushSave();
      });
      scriptSelect.addEventListener('change', () => {
        data.selected = scriptSelect.value;
        renderEditor();
        flushSave();
      });
      nameInput.addEventListener('change', () => {
        const script = selected();
        if (!script) return;
        script.name = nameInput.value.trim() || script.name;
        nameInput.value = script.name;
        scriptSelect.selectedOptions[0].textContent = script.name;
        flushSave();
      });
      bodyInput.addEventListener('input', () => {
        selected().body = bodyInput.value;
        estimate();
        scheduleSave();
      });
      speedInput.addEventListener('input', () => {
        data.speed = Number(speedInput.value);
        find('.tele-speed-value').textContent = (data.speed / 10).toFixed(1) + '×';
        estimate();
        scheduleSave();
      });
      sizeInput.addEventListener('change', () => {
        data.size = Math.max(16, Math.min(32, Math.round(Number(sizeInput.value) || data.size)));
        sizeInput.value = data.size;
        flushSave();
      });
      countdownInput.addEventListener('change', () => {
        data.countdown = countdownInput.checked;
        flushSave();
      });
      find('.tele-start').addEventListener('click', start);
      find('.tele-stop').addEventListener('click', stop);
      find('.tele-restart').addEventListener('click', () => {
        stop();
        start();
      });
      playButton.addEventListener('click', () => play(!read.playing));
      renderEditor();
    },
    show() { void load(); },
    hide() {
      if (saveTimer) flushSave();
      if (read) play(false);
    },
  };
})();

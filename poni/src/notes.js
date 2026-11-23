(() => {
  'use strict';

  const modules = window.poniModules ||= {};
  const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
  const maximumLength = 100000;
  const notes = new Map();
  const drafts = new Map();
  let page;
  let ready;
  let loaded = false;
  let selected = null;
  let mode = 'notes';
  let saveDelay;
  let writeQueue = Promise.resolve();
  let study;
  let composing;

  const element = selector => page.querySelector(selector);
  const titleOf = note => note.text.split('\n').find(line => line.trim())?.trim() || 'New note';
  const ordered = () => [...notes.values()].sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
  const status = text => { element('.nt-status').textContent = text; };

  function node(tag, text, className) {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
  }

  function button(label, handler, className) {
    const item = node('button', label, className);
    item.type = 'button';
    item.addEventListener('click', handler);
    return item;
  }

  function queue(command, args, completed, failed) {
    writeQueue = writeQueue.then(async () => {
      try {
        await invoke(command, args);
        completed?.();
        status('');
      } catch (error) {
        failed?.();
        status(String(error));
      }
    });
    return writeQueue;
  }

  function flush() {
    clearTimeout(saveDelay);
    for (const [id, text] of drafts) {
      drafts.delete(id);
      queue('notes_save', { id, text }, undefined, () => {
        const note = notes.get(id);
        if (note?.text === text && !drafts.has(id)) drafts.set(id, text);
      });
    }
    return writeQueue;
  }

  function updateNote(id, text) {
    const note = notes.get(id) ?? { id, study: {} };
    note.text = text;
    note.updated_at = Date.now();
    notes.set(id, note);
    drafts.set(id, text);
    clearTimeout(saveDelay);
    saveDelay = setTimeout(() => void flush(), 400);
    return note;
  }

  function dateText(at, precise = false) {
    if (!at) return '';
    const options = precise ? { dateStyle: 'medium', timeStyle: 'short' } : { day: 'numeric', month: 'short' };
    return new Date(at).toLocaleString(undefined, options);
  }

  function listButton(note, label, detail, active, handler) {
    const item = button('', handler, 'nt-list-item');
    item.append(node('strong', label), node('small', detail));
    item.setAttribute('aria-label', label);
    item.setAttribute('aria-pressed', String(active));
    item.title = titleOf(note);
    return item;
  }

  function renderList() {
    const list = element('.nt-list');
    const query = element('.nt-search').value.trim().toLocaleLowerCase();
    list.replaceChildren();
    for (const note of ordered()) {
      if (query && !note.text.toLocaleLowerCase().includes(query)) continue;
      const title = titleOf(note);
      if (mode === 'cards') {
        const cards = cardsOf(note.text);
        if (!cards.length) continue;
        const row = node('div', undefined, 'nt-deck');
        const last = note.study?.last_round;
        const count = cards.length + (cards.length === 1 ? ' card' : ' cards');
        const detail = last ? count + ' · last ' + last.got + '/' + last.of : count;
        row.append(
          listButton(note, title, detail, study?.id === note.id || composing?.id === note.id, () => startStudy(note.id)),
          button('+', () => openComposer(note.id), 'nt-add-card'),
        );
        row.lastChild.setAttribute('aria-label', 'Add cards to ' + title);
        list.append(row);
      } else {
        const preview = note.text.split('\n').filter(line => line.trim()).slice(1).join(' ').trim() || 'No additional text';
        const timestamp = dateText(note.updated_at);
        list.append(listButton(note, title, [timestamp, preview].filter(Boolean).join(' · '),
          selected === note.id, () => select(note.id)));
      }
    }
    if (!list.childElementCount) {
      const empty = query ? 'No results' : mode === 'notes' ? 'No notes yet' : 'No cards yet';
      list.append(node('p', empty, 'nt-empty'));
    }
  }

  function renderEditor() {
    const note = notes.get(selected);
    const editor = element('.nt-editor textarea');
    editor.value = note?.text ?? '';
    element('.nt-delete').disabled = !note;
    updateTimestamp();
  }

  function updateTimestamp() {
    const at = notes.get(selected)?.updated_at;
    element('.nt-edited').textContent = at ? 'Edited ' + dateText(at, true) : '';
  }

  function select(id) {
    void flush();
    selected = id;
    renderEditor();
    renderList();
  }

  function newNote() {
    void flush();
    selected = crypto.randomUUID();
    element('.nt-search').value = '';
    updateNote(selected, '');
    void flush();
    renderList();
    renderEditor();
    element('.nt-editor textarea').focus();
  }

  function deleteNote() {
    if (!selected) return;
    const id = selected;
    const removed = notes.get(id);
    const draft = drafts.get(id);
    drafts.delete(id);
    notes.delete(id);
    if (study?.id === id) study = undefined;
    selected = ordered()[0]?.id ?? null;
    renderEditor();
    renderList();
    queue('notes_delete', { id }, undefined, () => {
      if (removed) notes.set(id, removed);
      if (draft !== undefined) drafts.set(id, draft);
      renderList();
    });
  }

  function editorInput(event) {
    if (!selected) selected = crypto.randomUUID();
    updateNote(selected, event.target.value);
    element('.nt-delete').disabled = false;
    updateTimestamp();
    renderList();
  }

  function insertSeparator(event) {
    if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
    const target = event.target;
    const position = target.selectionStart;
    if (position !== target.selectionEnd) return;
    const before = target.value.slice(0, position).split('\n').pop();
    const after = target.value.slice(position).split('\n')[0];
    const line = before + after;
    if (!line.trim() || /(^|\s)::(\s|$)/.test(line)) return;
    const insertion = (/\s$/.test(before) ? '' : ' ') + '::' + (/^\s/.test(after) ? '' : ' ');
    if (target.value.length + insertion.length > maximumLength) return;
    event.preventDefault();
    if (!document.execCommand('insertText', false, insertion)) {
      target.setRangeText(insertion, position, position, 'end');
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (/^\s/.test(after)) target.setSelectionRange(target.selectionEnd + 1, target.selectionEnd + 1);
  }

  function cardsOf(text) {
    return text.split('\n').flatMap(line => {
      const match = line.match(/^(.*?)\s+::\s+(.*)$/) || line.match(/^(.*?)::(.*)$/);
      if (!match) return [];
      const question = match[1].replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
      const answer = match[2].trim();
      return question && answer ? [{ question, answer }] : [];
    });
  }

  function mixed(values) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) {
      const other = Math.floor(Math.random() * (i + 1));
      [result[i], result[other]] = [result[other], result[i]];
    }
    return result;
  }

  function startStudy(id, cards) {
    const note = notes.get(id);
    if (!note) return;
    if (!cards && study?.id === id && study.remaining.length && !composing) return;
    const deck = cards ?? cardsOf(note.text);
    if (!deck.length) return;
    const indexes = deck.map((card, index) => index);
    const shuffle = Boolean(note.study?.shuffle);
    composing = null;
    study = {
      id, deck, shuffle, partial: Boolean(cards), flipped: false, missed: new Set(),
      remaining: shuffle ? mixed(indexes) : indexes,
    };
    renderList();
    renderStudy(true);
  }

  function saveStudy(score = null) {
    const note = notes.get(study.id);
    if (!note) return;
    note.study ??= {};
    note.study.shuffle = study.shuffle;
    if (score) note.study.last_round = { ...score, at: Date.now() };
    void flush();
    queue('notes_save_study', { id: note.id, shuffle: study.shuffle, score });
  }

  function toggleShuffle() {
    study.shuffle = !study.shuffle;
    const [first, ...rest] = study.remaining;
    if (first !== undefined) {
      const fresh = rest.filter(index => !study.missed.has(index));
      const missed = rest.filter(index => study.missed.has(index));
      study.remaining = [first, ...(study.shuffle ? mixed(fresh) : fresh.sort((a, b) => a - b)), ...missed];
    }
    saveStudy();
    renderStudy(true);
  }

  function flip() {
    study.flipped = !study.flipped;
    renderStudy(true);
  }

  function grade(known) {
    if (!study.flipped) { flip(); return; }
    const index = study.remaining.shift();
    if (!known) {
      study.missed.add(index);
      study.remaining.push(index);
    }
    study.flipped = false;
    if (!study.remaining.length && !study.partial) {
      saveStudy({ got: study.deck.length - study.missed.size, of: study.deck.length });
      renderList();
    }
    renderStudy(true);
  }

  function closeStudy() {
    study = undefined;
    renderList();
    renderStudy(true);
  }

  function renderStudy(focus = false) {
    const pane = element('.nt-study');
    pane.replaceChildren();
    if (composing) { renderComposer(pane); return; }
    if (!study) {
      pane.append(node('div', 'Pick a deck to study. Each line written as question :: answer is a card.', 'nt-study-message'));
      if (focus) pane.focus({ preventScroll: true });
      return;
    }
    const progress = node('progress');
    progress.max = study.deck.length;
    progress.value = study.deck.length - study.remaining.length;
    progress.setAttribute('aria-label', 'Round progress');
    const toolbar = node('div', undefined, 'nt-study-top');
    const shuffle = button('Shuffle', toggleShuffle);
    shuffle.setAttribute('aria-pressed', String(study.shuffle));
    toolbar.append(node('span', progress.value + '/' + progress.max), progress,
      button('Add cards', () => openComposer(study.id)), shuffle, button('Back', closeStudy));
    const controls = node('div', undefined, 'nt-study-actions');
    pane.append(toolbar);
    if (!study.remaining.length) {
      const known = study.deck.length - study.missed.size;
      const result = node('div', undefined, 'nt-study-message');
      result.append(node('strong', 'Round done'), node('span', known + ' of ' + study.deck.length + ' right the first time'));
      pane.append(result);
      controls.append(button('Study again', () => startStudy(study.id)));
      if (study.missed.size) {
        controls.append(button('Only the missed cards', () =>
          startStudy(study.id, [...study.missed].map(index => study.deck[index]))));
      }
    } else {
      const card = study.deck[study.remaining[0]];
      const face = button('', flip, 'nt-study-face');
      if (study.flipped) face.append(node('small', card.question));
      face.append(node('strong', study.flipped ? card.answer : card.question));
      pane.append(face);
      if (study.flipped) controls.append(button('Again', () => grade(false)), button('Got it', () => grade(true)));
      else controls.append(button('Show answer', flip));
    }
    pane.append(controls);
    if (focus) pane.focus({ preventScroll: true });
  }

  function cleanLine(text) {
    return text.replace(/\s+/g, ' ').replace(/(^| )::(?= |$)/g, '$1').replace(/ {2,}/g, ' ').trim();
  }

  function openComposer(id = null) {
    composing = { id, last: '' };
    renderStudy();
    renderList();
    element(id ? '.nt-question' : '.nt-deck-name').focus();
  }

  function closeComposer() {
    composing = null;
    renderStudy(true);
    renderList();
  }

  function renderComposer(pane) {
    const form = node('form', undefined, 'nt-composer');
    const name = node('input', undefined, 'nt-deck-name');
    const question = node('input', undefined, 'nt-question');
    const answer = node('input', undefined, 'nt-answer');
    for (const [input, label] of [[name, 'Deck name'], [question, 'Question'], [answer, 'Answer']]) {
      input.placeholder = label;
      input.setAttribute('aria-label', label);
      input.maxLength = input === name ? 80 : 10000;
      input.required = input !== name;
    }
    const heading = node('div', undefined, 'nt-study-top');
    const note = notes.get(composing.id);
    if (note) heading.append(node('strong', 'Add to ' + titleOf(note)));
    else heading.append(name);
    heading.append(button('Done', closeComposer));
    const add = node('button', 'Add card');
    add.type = 'submit';
    form.append(heading, question, answer, add);
    if (composing.last) form.append(node('small', 'Added: ' + composing.last));
    question.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing && question.value.trim()) {
        event.preventDefault();
        answer.focus();
      }
    });
    name.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        question.focus();
      }
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      const q = cleanLine(question.value);
      const a = cleanLine(answer.value);
      if (!q || !a) { (q ? answer : question).focus(); return; }
      const saved = notes.get(composing.id);
      const title = saved?.text.replace(/\n+$/, '') ?? (cleanLine(name.value) || nextDeckName());
      const text = title + '\n' + q + ' :: ' + a;
      if (text.length > maximumLength) { status('A note can contain up to 100,000 characters'); return; }
      composing.id ??= crypto.randomUUID();
      composing.last = q;
      updateNote(composing.id, text);
      if (study?.id === composing.id && study.remaining.length) {
        study.remaining.push(study.deck.length);
        study.deck.push({ question: q, answer: a });
      }
      void flush();
      renderList();
      renderStudy();
      element('.nt-question').focus();
    });
    pane.append(form);
  }

  function nextDeckName() {
    const used = new Set(ordered().map(titleOf));
    let name = 'Cards';
    for (let index = 2; used.has(name); index++) name = 'Cards ' + index;
    return name;
  }

  function setMode(value) {
    if (!loaded || value === mode) return;
    void flush();
    mode = value;
    element('.nt-editor').hidden = mode !== 'notes';
    element('.nt-study').hidden = mode !== 'cards';
    for (const item of page.querySelectorAll('[data-notes-mode]')) {
      item.setAttribute('aria-pressed', String(item.dataset.notesMode === mode));
    }
    const make = element('.nt-new');
    make.setAttribute('aria-label', mode === 'notes' ? 'New note' : 'New deck');
    make.title = make.getAttribute('aria-label');
    renderEditor();
    renderList();
    if (mode === 'cards') renderStudy();
  }

  function studyKey(event) {
    if (mode !== 'cards' || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape' && (composing || study)) {
      event.preventDefault();
      event.stopPropagation();
      if (composing) closeComposer(); else closeStudy();
      return;
    }
    if (!study || composing || event.target !== element('.nt-study')) return;
    const key = event.key.toLowerCase();
    if (key === 'a') openComposer(study.id);
    else if (key === 's') toggleShuffle();
    else if (study.remaining.length && (key === ' ' || key === 'enter')) flip();
    else if (study.remaining.length && ['1', '2', 'arrowleft', 'arrowright'].includes(key)) {
      grade(key === '2' || (key.startsWith('arrow') && (key === 'arrowright') !== (document.documentElement.dir === 'rtl')));
    } else if (!study.remaining.length && key === 'enter') startStudy(study.id);
    else if (!study.remaining.length && key === 'm' && study.missed.size) {
      startStudy(study.id, [...study.missed].map(index => study.deck[index]));
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }

  function mount(container) {
    page = container;
    page.innerHTML = [
      '<aside class="nt-sidebar">',
      '  <div class="nt-toolbar"><div class="nt-switch"><button type="button" data-notes-mode="notes" aria-pressed="true">Notes</button><button type="button" data-notes-mode="cards" aria-pressed="false">Cards</button></div>',
      '  <button type="button" class="nt-new" aria-label="New note" title="New note">＋</button></div>',
      '  <input type="search" class="nt-search" aria-label="Search notes and cards" placeholder="Search">',
      '  <div class="nt-list" aria-label="Saved notes"></div>',
      '</aside>',
      '<div class="nt-body">',
      '  <div class="nt-editor"><textarea aria-label="Note" placeholder="Start typing… The first line becomes the title." spellcheck="false" maxlength="100000" disabled></textarea>',
      '  <div class="nt-footer"><span class="nt-edited"></span><button type="button" class="nt-delete" aria-label="Delete note" disabled>Delete</button></div></div>',
      '  <div class="nt-study" tabindex="-1" hidden></div>',
      '  <div class="nt-status" role="status"></div>',
      '</div>',
    ].join('');
    for (const item of page.querySelectorAll('[data-notes-mode]')) {
      item.addEventListener('click', () => setMode(item.dataset.notesMode));
    }
    element('.nt-search').addEventListener('input', renderList);
    element('.nt-new').addEventListener('click', () => {
      if (!loaded) return;
      if (mode === 'notes') newNote(); else openComposer();
    });
    element('.nt-delete').addEventListener('click', deleteNote);
    element('.nt-editor textarea').addEventListener('input', editorInput);
    element('.nt-editor textarea').addEventListener('keydown', insertSeparator);
    page.addEventListener('keydown', studyKey);
  }

  function show() {
    if (loaded) {
      if (drafts.size) return flush();
      return;
    }
    if (ready) return ready;
    ready = invoke('notes_get').then(items => {
      notes.clear();
      for (const note of items) notes.set(note.id, note);
      selected = ordered()[0]?.id ?? null;
      loaded = true;
      element('.nt-editor textarea').disabled = false;
      renderEditor();
      renderList();
      if (mode === 'cards') renderStudy();
      status('');
    }).catch(error => { status(String(error)); }).finally(() => { ready = null; });
    return ready;
  }

  modules.notes = { mount, show, hide: flush };
})();

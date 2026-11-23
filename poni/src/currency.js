'use strict';

(() => {
  const invoke = (command, params) => window.__TAURI__.core.invoke(command, params);
  const currencyNames = new Intl.DisplayNames(undefined, {type: 'currency'});
  const dateFormat = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeZone: 'UTC'});
  const common = ['USD', 'EUR', 'SGD', 'MYR', 'JPY', 'SAR'];
  const suffixes = { k: 1000, rb: 1000, ribu: 1000, jt: 1000000, juta: 1000000 };
  const sourceNames = {ecb: 'ECB', open: 'ExchangeRate-API'};
  const favouritesLimit = 8;
  const formatters = new Map();

  let fields;
  let preferences;
  let snapshot;
  let active = false;
  let loading = false;
  let loadError = '';
  let saving = false;
  let shape = '';
  let choices = [];
  let picker = null;

  function mount(page) {
    page.innerHTML = `
      <div id="currency-empty" class="currency-empty">
        <p id="currency-empty-status" role="status">Getting today’s exchange rates…</p>
        <button id="currency-refresh" type="button" hidden>Try again</button>
      </div>
      <div class="currency-panel" id="currency-panel" hidden>
        <div class="currency-converter">
          <div class="currency-side">
            <button id="currency-from" class="currency-pick" type="button" aria-label="From currency" aria-haspopup="listbox" aria-expanded="false"><span></span><small aria-hidden="true">⌄</small></button>
            <input id="currency-amount" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="Amount" maxlength="30">
          </div>
          <button id="currency-swap" type="button" aria-label="Swap currencies" title="Swap">⇄</button>
          <div class="currency-side">
            <button id="currency-to" class="currency-pick" type="button" aria-label="To currency" aria-haspopup="listbox" aria-expanded="false"><span></span><small aria-hidden="true">⌄</small></button>
            <div class="currency-result"><output id="currency-result" aria-label="Converted amount">—</output><button id="currency-copy" type="button">Copy</button></div>
          </div>
        </div>
        <div class="currency-actions">
          <div id="currency-favourites" aria-label="Favourite pairs"></div>
          <button id="currency-star" type="button" aria-label="Favourite this pair">☆</button>
        </div>
        <div class="currency-footer">
          <span id="currency-quote"></span>
          <span class="currency-source"><span id="currency-status" role="status"></span> <button id="currency-source" type="button" hidden></button></span>
        </div>
      </div>`;
    const find = name => page.querySelector(`#currency-${name}`);
    fields = Object.fromEntries(['from', 'to', 'amount', 'swap', 'result', 'copy', 'favourites', 'star', 'refresh',
      'quote', 'status', 'source', 'empty', 'empty-status', 'panel'].map(name => [name, find(name)]));
    fields.amount.addEventListener('input', paintAmount);
    for (const side of ['from', 'to']) {
      fields[side].addEventListener('click', () => openPicker(side));
    }
    document.addEventListener('pointerdown', event => {
      if (picker && !picker.menu.contains(event.target) && !picker.button.contains(event.target)) closePicker();
    }, true);
    document.addEventListener('keydown', event => {
      if (picker && event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closePicker(true);
      }
    }, true);
    fields.swap.addEventListener('click', () => choose(preferences.pair.to, preferences.pair.from));
    fields.star.addEventListener('click', toggleFavourite);
    fields.refresh.addEventListener('click', () => void refresh());
    fields.source.addEventListener('click', async () => {
      try {
        await invoke('open_currency_source', {source: fields.source.dataset.source});
        document.querySelector('#close').click();
      } catch (error) {
        fields.status.textContent = String(error);
      }
    });
    fields.copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(fields.result.value);
        fields.status.textContent = 'Copied';
      } catch {
        fields.status.textContent = 'Cannot copy to clipboard';
      }
    });
  }

  function closePicker(focus = false) {
    if (!picker) return;
    const {menu, button} = picker;
    picker = null;
    menu.remove();
    button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus();
  }

  function openPicker(side) {
    const button = fields[side];
    const wasOpen = picker?.button === button;
    closePicker();
    if (wasOpen) return;
    const host = document.querySelector('#open');
    const menu = document.createElement('div');
    menu.className = 'currency-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', button.getAttribute('aria-label'));
    const current = preferences.pair[side];
    const options = choices.map(code => {
      const option = document.createElement('button');
      option.type = 'button';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(code === current));
      option.textContent = currencyLabel(code);
      option.addEventListener('click', () => {
        closePicker(true);
        if (code !== current) {
          if (side === 'from') choose(code, preferences.pair.to);
          else choose(preferences.pair.from, code);
        }
      });
      return option;
    });
    menu.append(...options);
    menu.addEventListener('keydown', event => {
      const index = options.indexOf(document.activeElement);
      const last = options.length - 1;
      const next = { ArrowDown: Math.min(index + 1, last), ArrowUp: Math.max(0, index - 1), Home: 0, End: last };
      if (Object.hasOwn(next, event.key)) {
        event.preventDefault();
        options[next[event.key]]?.focus();
      }
    });
    host.append(menu);
    const panel = host.getBoundingClientRect();
    const anchor = button.getBoundingClientRect();
    const padding = 8;
    const height = Math.min(menu.scrollHeight + 2, panel.height - 2 * padding);
    const below = anchor.bottom - panel.top + 4;
    const above = anchor.top - panel.top - 4 - height;
    const top = below + height <= panel.height - padding ? below :
      above >= padding ? above : Math.max(padding, panel.height - padding - height);
    menu.style.maxHeight = `${height}px`;
    menu.style.minWidth = `${anchor.width}px`;
    menu.style.top = `${top}px`;
    menu.style.left = `${Math.max(padding, Math.min(anchor.left - panel.left, panel.width - menu.offsetWidth - padding))}px`;
    picker = {menu, button};
    button.setAttribute('aria-expanded', 'true');
    options[choices.indexOf(current)]?.focus();
  }

  async function show() {
    active = true;
    if (loading) return;
    try {
      const saved = await invoke('currency_snapshot');
      if (!active || loading) return;
      preferences = saved.preferences;
      snapshot = {...saved, errors: {...snapshot?.errors, ...saved.errors}};
      loadError = '';
      render();
      if (saved.due) await refresh();
    } catch (error) {
      loadError = String(error);
      if (active) render();
    }
  }

  async function refresh() {
    if (!active || loading) return;
    loading = true;
    loadError = '';
    render();
    try {
      snapshot = await invoke('refresh_currency_rates');
      preferences ||= snapshot.preferences;
    } catch (error) {
      loadError = String(error);
    } finally {
      loading = false;
      if (active) render();
    }
  }

  async function save(next) {
    if (saving) return;
    saving = true;
    render();
    let error = '';
    try { preferences = await invoke('save_currency_preferences', {preferences: next}); }
    catch (reason) { error = String(reason); }
    finally { saving = false; if (active) render(); }
    if (active && error) fields.status.textContent = error;
  }

  function choose(from, to) {
    if (from === to) {
      ({from: to, to: from} = preferences.pair);
    }
    void save({...preferences, pair: {from, to}});
  }

  function samePair(a, b) { return a.from === b.from && a.to === b.to; }

  function toggleFavourite() {
    const {pair, favourites} = preferences;
    const others = favourites.filter(item => !samePair(item, pair));
    if (others.length === favourites.length) {
      if (others.length >= favouritesLimit) return;
      others.push(pair);
    }
    void save({...preferences, favourites: others});
  }

  function rate(from, to) {
    for (const source of ['ecb', 'open']) {
      const table = snapshot?.[source];
      if (!table) continue;
      const a = from === table.base ? 1 : table.rates[from];
      const b = to === table.base ? 1 : table.rates[to];
      if (a > 0 && b > 0) return {value: b / a, source, date: table.date};
    }
    return null;
  }

  function render() {
    const tables = [snapshot?.ecb, snapshot?.open].filter(Boolean);
    const pair = preferences?.pair;
    const codes = new Set(tables.flatMap(table => [table.base, ...Object.keys(table.rates)]));
    fields.empty.hidden = Boolean(codes.size && pair);
    fields.panel.hidden = !fields.empty.hidden;
    if (fields.panel.hidden) {
      const issue = loadError || Object.values(snapshot?.errors || {})[0];
      fields['empty-status'].textContent = loading ? 'Getting today’s exchange rates…' :
        issue ? `No exchange rates yet. ${issue}` : 'No exchange rates yet. Poni gets them when this tab opens with the internet on.';
      fields.refresh.hidden = loading;
      return;
    }

    codes.add(pair.from);
    codes.add(pair.to);
    const favourites = preferences.favourites;
    const first = [pair.from, pair.to, snapshot.local, ...favourites.flatMap(pair => [pair.from, pair.to]), ...common];
    choices = [...new Set([...first.filter(code => codes.has(code)), ...[...codes].sort()])];
    const currentShape = JSON.stringify([pair, favourites, choices]);
    if (shape !== currentShape) {
      shape = currentShape;
      fields.favourites.replaceChildren(...favourites.map(favourite => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `${favourite.from} → ${favourite.to}`;
        button.title = `${currencyNames.of(favourite.from)} → ${currencyNames.of(favourite.to)}`;
        button.setAttribute('aria-pressed', String(samePair(favourite, pair)));
        button.addEventListener('click', () => choose(favourite.from, favourite.to));
        return button;
      }));
    }
    for (const side of ['from', 'to']) {
      fields[side].querySelector('span').textContent = currencyLabel(pair[side]);
      fields[side].value = pair[side];
      fields[side].disabled = saving;
    }
    for (const button of fields.favourites.children) button.disabled = saving;
    fields.swap.disabled = saving;
    const starred = favourites.some(favourite => samePair(favourite, pair));
    fields.star.textContent = starred ? '★' : '☆';
    fields.star.setAttribute('aria-pressed', String(starred));
    fields.star.title = starred ? 'Remove this pair from favourites' : 'Add this pair to favourites';
    fields.star.disabled = saving || (!starred && favourites.length >= favouritesLimit);
    paintAmount();
  }

  function currencyLabel(code) { return `${code} · ${currencyNames.of(code)}`; }

  function numberFormat(options = {}) {
    const preferred = snapshot?.locale || navigator.language;
    const key = JSON.stringify([preferred, options]);
    if (!formatters.has(key)) {
      try {
        formatters.set(key, new Intl.NumberFormat(preferred, {...options, numberingSystem:'latn'}));
      } catch {
        formatters.set(key, new Intl.NumberFormat(undefined, {...options, numberingSystem:'latn'}));
      }
    }
    return formatters.get(key);
  }

  function parseAmount(input) {
    let clean = input.toLowerCase().replace(/[\s'’_]/g, '');
    const suffix = clean.match(/(ribu|juta|rb|jt|k)$/)?.[0];
    if (suffix) clean = clean.slice(0, -suffix.length);
    clean = clean.replace(/[^\d.,]/g, '');
    if (!/\d/.test(clean)) return NaN;
    const group = numberFormat().formatToParts(12345.6).find(part => part.type === 'group')?.value || ',';
    const dots = [...clean.matchAll(/\./g)].length;
    const commas = [...clean.matchAll(/,/g)].length;
    let decimal = '';
    if (dots && commas) decimal = clean.lastIndexOf('.') > clean.lastIndexOf(',') ? '.' : ',';
    else if (dots + commas === 1) {
      const mark = dots ? '.' : ',';
      if (mark !== group || !/^\d{3}$/.test(clean.slice(clean.indexOf(mark) + 1))) decimal = mark;
    }
    const number = Number(clean.split(decimal || '\0').map(part => part.replace(/[.,]/g, '')).join('.'));
    return number * (suffixes[suffix] || 1);
  }

  function money(value, code, quote = false) {
    const options = {style: 'currency', currency: code};
    const formatter = numberFormat(options);
    const whole = rate('EUR', code)?.value >= 1000;
    const digits = whole ? 0 : formatter.resolvedOptions().maximumFractionDigits;
    if (quote && value < 1) {
      options.maximumSignificantDigits = 4;
    } else if (!quote && value !== 0 && Math.abs(value) < 10 ** -digits) {
      options.maximumSignificantDigits = 3;
    } else {
      options.minimumFractionDigits = quote && !whole ? 2 : digits;
      options.maximumFractionDigits = quote && !whole ? 4 : digits;
    }
    return numberFormat(options).format(value);
  }

  function fit(element, length) {
    element.classList.toggle('long', length > 13 && length <= 18);
    element.classList.toggle('longer', length > 18);
  }

  function paintAmount() {
    const pair = preferences?.pair;
    if (!pair || fields.panel.hidden) return;
    const quote = rate(pair.from, pair.to);
    const euroRate = rate('EUR', pair.from)?.value;
    const round = euroRate ? 10 ** Math.max(0, Math.round(Math.log10(euroRate * 50))) : 1;
    const typed = fields.amount.value.trim();
    const amount = typed ? parseAmount(typed) : round;
    const result = quote ? amount * quote.value : NaN;
    fields.amount.placeholder = numberFormat({maximumFractionDigits: 2}).format(round);
    fields.amount.setAttribute('aria-invalid', String(Boolean(typed && !Number.isFinite(amount))));
    fields.result.value = Number.isFinite(result) ? money(result, pair.to) : '—';
    fields.copy.disabled = !Number.isFinite(result);
    fields.copy.hidden = !quote;
    fit(fields.amount, (typed || fields.amount.placeholder).length);
    fit(fields.result, fields.result.value.length);
    fields.quote.textContent = quote
      ? `1 ${pair.from} = ${money(quote.value, pair.to, true)} · 1 ${pair.to} = ${money(1 / quote.value, pair.from, true)}`
      : '';

    fields.source.hidden = loading || !quote;
    const issue = loadError || (quote && snapshot.errors?.[quote.source]);
    fields.status.classList.toggle('currency-warning', Boolean(issue || !quote));
    fields.status.title = issue || '';
    if (loading) {
      fields.status.textContent = 'Getting today’s exchange rates…';
    } else if (!quote) {
      fields.status.textContent = `No rate for ${pair.from} → ${pair.to} yet`;
    } else {
      const date = new Date(`${quote.date}T12:00:00Z`);
      const stamp = Number.isNaN(date.getTime()) ? quote.date : dateFormat.format(date);
      fields.status.textContent = issue ? `Rates from ${stamp}, couldn’t get newer ones ·` : `Rates from ${stamp} ·`;
      fields.source.textContent = sourceNames[quote.source];
      fields.source.dataset.source = quote.source;
    }
  }

  window.poniModules ||= {};
  window.poniModules.currency = {mount, show, hide() { active = false; closePicker(); }};
})();

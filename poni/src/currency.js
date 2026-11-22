'use strict';

(() => {
  const invoke = (command, params) => window.__TAURI__.core.invoke(command, params);
  const currencyNames = new Intl.DisplayNames(undefined, {type: 'currency'});
  const decimalParts = new Intl.NumberFormat().formatToParts(12345.6);
  const decimal = decimalParts.find(part => part.type === 'decimal')?.value || '.';
  const group = decimalParts.find(part => part.type === 'group')?.value || ',';
  const quoteFormat = new Intl.NumberFormat(undefined, {maximumSignificantDigits: 6});
  const dateFormat = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeZone: 'UTC'});
  const favouritesLimit = 8;

  let fields;
  let preferences;
  let table;
  let loading = false;
  let loadError = '';
  let saving = false;

  function mount(page) {
    page.innerHTML = `
      <div class="currency-panel">
        <div class="currency-converter">
          <label>From <select id="currency-from" aria-label="From currency"></select>
            <input id="currency-amount" type="text" inputmode="decimal" autocomplete="off" aria-label="Amount" maxlength="30" value="1">
          </label>
          <button id="currency-swap" type="button" aria-label="Swap currencies">⇄</button>
          <label>To <select id="currency-to" aria-label="To currency"></select>
            <span class="currency-result"><output id="currency-result" aria-label="Converted amount">—</output><button id="currency-copy" type="button">Copy</button></span>
          </label>
        </div>
        <div class="currency-actions">
          <div id="currency-favourites" aria-label="Favourite pairs"></div>
          <button id="currency-star" type="button" aria-label="Favourite this pair">☆</button>
          <button id="currency-refresh" type="button">Refresh rates</button>
        </div>
        <div class="currency-footer"><span id="currency-quote"></span><span id="currency-status" role="status"></span></div>
      </div>`;
    const find = name => page.querySelector(`#currency-${name}`);
    fields = Object.fromEntries(['from', 'to', 'amount', 'swap', 'result', 'copy', 'favourites', 'star', 'refresh', 'quote', 'status'].map(name => [name, find(name)]));
    fields.amount.addEventListener('input', paintAmount);
    fields.from.addEventListener('change', () => choose(fields.from.value, preferences.pair.to));
    fields.to.addEventListener('change', () => choose(preferences.pair.from, fields.to.value));
    fields.swap.addEventListener('click', () => choose(preferences.pair.to, preferences.pair.from));
    fields.star.addEventListener('click', toggleFavourite);
    fields.refresh.addEventListener('click', refresh);
    fields.copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(fields.result.value);
        fields.status.textContent = 'Copied';
      } catch {
        fields.status.textContent = 'Cannot copy to clipboard';
      }
    });
    render();
  }

  async function show() {
    if (loading || saving) return;
    loading = true;
    render();
    try {
      const saved = await invoke('currency_snapshot');
      preferences = saved.preferences;
      table = saved.table;
      await loadRates();
    } catch (error) {
      loadError = String(error);
    } finally {
      loading = false;
      render();
    }
  }

  async function refresh() {
    if (!preferences) { await show(); return; }
    if (loading || saving) return;
    loading = true;
    render();
    try { await loadRates(); }
    finally { loading = false; render(); }
  }

  async function loadRates() {
    loadError = '';
    render();
    try { table = await invoke('refresh_currency_rates'); }
    catch (error) { loadError = String(error); }
  }

  async function save(next) {
    if (saving) return;
    saving = true;
    render();
    let error = '';
    try { preferences = await invoke('save_currency_preferences', {preferences: next}); }
    catch (reason) { error = String(reason); }
    finally { saving = false; render(); }
    if (error) fields.status.textContent = error;
  }

  function choose(from, to) {
    if (from === to) return choose(preferences.pair.to, preferences.pair.from);
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

  function render() {
    if (!fields) return;
    const codes = new Set(Object.keys(table?.rates || {}));
    const pair = preferences?.pair;
    if (pair) { codes.add(pair.from); codes.add(pair.to); }
    const sorted = [...codes].sort();
    for (const side of ['from', 'to']) {
      fields[side].replaceChildren(...sorted.map(code => new Option(`${code} · ${currencyNames.of(code)}`, code)));
      if (pair) fields[side].value = pair[side];
      fields[side].disabled = !pair || saving;
    }
    fields.swap.disabled = !pair || saving;
    fields.refresh.disabled = loading || saving;
    const favourites = preferences?.favourites || [];
    fields.favourites.replaceChildren(...favourites.map(favourite => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${favourite.from} → ${favourite.to}`;
      button.setAttribute('aria-pressed', String(samePair(favourite, pair)));
      button.disabled = saving;
      button.addEventListener('click', () => choose(favourite.from, favourite.to));
      return button;
    }));
    const starred = !!pair && favourites.some(favourite => samePair(favourite, pair));
    fields.star.textContent = starred ? '★' : '☆';
    fields.star.setAttribute('aria-pressed', String(starred));
    fields.star.disabled = !pair || saving || (!starred && favourites.length >= favouritesLimit);
    fields.status.textContent = statusText();
    paintAmount();
  }

  function statusText() {
    if (loading) return 'Checking exchange rates…';
    if (!table) return loadError || '';
    const release = new Date(`${table.date}T00:00:00Z`);
    const date = Number.isNaN(release.getTime()) ? table.date : dateFormat.format(release);
    return loadError ? `Saved rates · ${date} · Frankfurter (${loadError})` : `Rates from ${date} · Frankfurter`;
  }

  function parseAmount(input) {
    const clean = input.trim().split(group).join('').replace(/\s/g, '').replace(decimal, '.');
    return /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(clean) ? Number(clean) : NaN;
  }

  function paintAmount() {
    const pair = preferences?.pair;
    const rate = pair && table ? table.rates[pair.to] / table.rates[pair.from] : NaN;
    const amount = parseAmount(fields.amount.value);
    const result = amount * rate;
    fields.amount.setAttribute('aria-invalid', String(fields.amount.value !== '' && !Number.isFinite(amount)));
    fields.result.value = Number.isFinite(result)
      ? new Intl.NumberFormat(undefined, {style: 'currency', currency: pair.to, currencyDisplay: 'code'}).format(result)
      : '—';
    fields.copy.disabled = !Number.isFinite(result);
    fields.quote.textContent = Number.isFinite(rate)
      ? `1 ${pair.from} = ${quoteFormat.format(rate)} ${pair.to} · 1 ${pair.to} = ${quoteFormat.format(1 / rate)} ${pair.from}`
      : table && pair ? 'No rate for this pair' : '';
  }

  window.poniModules ||= {};
  window.poniModules.currency = {mount, show};
})();

'use strict';

(() => {
  const invoke = (command, arguments_) => window.__TAURI__.core.invoke(command, arguments_);
  const providers = {codex: 'Codex', claude: 'Claude'};
  const dateFormat = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'});
  let view;
  let provider = 'codex';
  let snapshots = {};
  let refreshing;
  let busy = false;

  function date(seconds) {
    return dateFormat.format(seconds * 1000);
  }

  function duration(seconds) {
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    const hours = Math.floor(minutes / 60);
    return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  }

  function pace(window, capturedAt, now) {
    if (!capturedAt || !window.resets_at || window.resets_at <= now || window.used_percent >= 100) return '';
    const start = window.resets_at - (window.window_minutes * 60);
    const elapsed = capturedAt - start;
    const fraction = elapsed / (window.window_minutes * 60);
    if (fraction < .03 || fraction >= 1) return '';
    if (window.used_percent <= fraction * 50) return 'Plenty left at captured pace';
    if (window.used_percent <= fraction * 100) return 'On track at captured pace';
    const projected = start + elapsed * 100 / window.used_percent;
    if (projected <= now) return 'The captured pace projected an earlier limit. Import updated data.';
    return `Projected limit at ${date(projected)}`;
  }

  function makeNode(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function windowRow(window, snapshot, now) {
    const expired = window.resets_at && window.resets_at <= now;
    const row = makeNode('li', 'aiu-limit');
    const amount = Number(window.used_percent.toFixed(1));
    const details = makeNode('div', 'aiu-limit-details');
    details.append(
      makeNode('strong', '', window.label),
      makeNode('span', '', `${amount}% used at capture`),
    );
    const meter = makeNode('div', 'aiu-meter');
    meter.setAttribute('role', 'meter');
    meter.setAttribute('aria-label', window.label + ' usage');
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', '100');
    meter.setAttribute('aria-valuenow', String(amount));
    const fill = makeNode('span', 'aiu-fill');
    fill.style.width = `${window.used_percent}%`;
    meter.classList.toggle('aiu-high', amount >= 90);
    meter.classList.toggle('aiu-warning', amount >= 70 && amount < 90);
    meter.append(fill);
    if (window.resets_at && !expired) {
      const span = window.window_minutes * 60;
      const elapsed = 100 * (1 - (window.resets_at - now) / span);
      const tick = makeNode('span', 'aiu-tick');
      tick.style.left = `${Math.min(100, Math.max(0, elapsed))}%`;
      tick.title = `${Math.round(Math.min(100, Math.max(0, elapsed)))}% of window elapsed`;
      meter.append(tick);
    }
    const footer = makeNode('div', 'aiu-limit-details aiu-sub');
    if (window.resets_at) {
      const label = expired ? 'Window ended. Import updated data.' :
        window.resets_at - now < 86400 ? `Resets in ${duration(window.resets_at - now)}` : `Resets ${date(window.resets_at)}`;
      footer.append(makeNode('span', '', label));
    }
    const forecast = pace(window, snapshot.captured_at, now);
    if (forecast) footer.append(makeNode('span', '', forecast));
    row.append(details, meter, footer);
    if (expired) row.classList.add('aiu-expired');
    return row;
  }

  function render() {
    const snapshot = snapshots[provider];
    const now = Math.floor(Date.now() / 1000);
    view.provider.value = provider;
    view.provider.disabled = busy;
    view.input.disabled = busy;
    view.clear.disabled = busy || !snapshot;
    view.list.replaceChildren();
    if (!snapshot) {
      view.summary.textContent = `Import a usage file to view ${providers[provider]} limits.`;
      return;
    }
    const timestamp = snapshot.captured_at ? `Captured ${date(snapshot.captured_at)}` : `Imported ${date(snapshot.imported_at)}`;
    view.summary.textContent = [providers[provider], snapshot.plan, timestamp].filter(Boolean).join(' · ');
    for (const window of snapshot.windows) view.list.append(windowRow(window, snapshot, now));
  }

  async function selectedJson(file, provider) {
    if (/\.jsonl$/i.test(file.name)) {
      if (provider !== 'codex') throw new Error('Session JSONL import is supported for Codex.');
      const offset = Math.max(0, file.size - 2 * 1024 * 1024);
      const lines = (await file.slice(offset).text()).split('\n');
      if (offset) lines.shift();
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].trim()) continue;
        let row;
        try { row = JSON.parse(lines[i]); } catch { continue; }
        const limits = row.type === 'event_msg' && row.payload?.type === 'token_count' && row.payload.rate_limits;
        if (limits?.primary || limits?.secondary) {
          // Only rate-limit fields from the selected session file go to the backend.
          const windowFields = window => window && ({
            used_percent: window.used_percent,
            window_minutes: window.window_minutes,
            resets_at: window.resets_at,
          });
          const rate_limits = {
            primary: windowFields(limits.primary),
            secondary: windowFields(limits.secondary),
            plan_type: limits.plan_type,
          };
          return JSON.stringify({rate_limits, timestamp: row.timestamp});
        }
      }
      throw new Error('No rate limits found in the last 2 MB of this session file.');
    }
    if (file.size > 256 * 1024) throw new Error('Usage JSON cannot exceed 256 KB.');
    return (await file.text()).replace(/^\uFEFF/, '');
  }

  async function importFile() {
    const file = view.input.files[0];
    if (!file || busy) return;
    busy = true;
    view.status.textContent = 'Importing usage…';
    render();
    try {
      const raw = await selectedJson(file, provider);
      snapshots = await invoke('import_ai_usage', {provider, raw});
      view.status.textContent = 'Snapshot imported';
    } catch (error) {
      view.status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
      view.input.value = '';
      render();
    }
  }

  async function clear() {
    if (!snapshots[provider] || busy) return;
    busy = true;
    render();
    try {
      snapshots = await invoke('clear_ai_usage', {provider});
      view.status.textContent = 'Snapshot removed';
    } catch (error) {
      view.status.textContent = String(error);
    } finally {
      busy = false;
      render();
    }
  }

  function mount(page) {
    page.innerHTML = `
      <div class="aiu-panel">
        <div class="aiu-toolbar">
          <label>Provider <select id="aiu-provider"><option value="codex">Codex</option><option value="claude">Claude</option></select></label>
          <label class="aiu-file-label">Import usage file <input id="aiu-input" type="file" accept=".json,.jsonl,application/json"></label>
          <button id="aiu-clear" type="button">Clear snapshot</button>
        </div>
        <p id="aiu-summary" class="aiu-summary"></p>
        <ul id="aiu-list" class="aiu-list" aria-label="Usage limits"></ul>
        <p id="aiu-status" role="status"></p>
        <details class="aiu-help">
          <summary>Supported file formats</summary>
          <ul>
            <li>Codex rate-limit JSON (primary and secondary windows) or a Codex session JSONL containing a rate-limit event. The latest record in the last 2 MB is used.</li>
            <li>Claude usage JSON with <code>five_hour</code> and/or <code>seven_day</code> windows.</li>
            <li>A JSON object with a <code>windows</code> array. Each entry has <code>label</code>, <code>used_percent</code>, <code>window_minutes</code> and optional <code>resets_at</code> (Unix seconds). The object may include <code>plan</code> and <code>captured_at</code> (RFC 3339 or Unix seconds).</li>
          </ul>
          <p>Usage stays on this device. Import a new file to refresh.</p>
        </details>
      </div>`;
    const ids = ['provider', 'input', 'clear', 'summary', 'list', 'status'];
    view = Object.fromEntries(ids.map(id => [id, page.querySelector(`#aiu-${id}`)]));
    view.provider.addEventListener('change', () => {
      provider = view.provider.value;
      view.status.textContent = '';
      render();
    });
    view.input.addEventListener('change', importFile);
    view.clear.addEventListener('click', clear);
    render();
  }

  async function show() {
    clearInterval(refreshing);
    refreshing = setInterval(render, 30000);
    if (busy) return;
    busy = true;
    render();
    try {
      snapshots = await invoke('ai_usage_state');
    } catch (error) {
      view.status.textContent = String(error);
    } finally {
      busy = false;
      render();
    }
  }

  function hide() {
    clearInterval(refreshing);
  }

  (window.poniModules ||= {}).aiusage = {mount, show, hide};
})();

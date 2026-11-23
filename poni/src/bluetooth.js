(() => {
  'use strict';

  const invoke = (name, args) => window.__TAURI__.core.invoke(name, args);
  let list, status, refreshButton, settingsButton, summary;
  let visible = false;
  let pending = false;
  let interval;

  function render(snapshot) {
    list.replaceChildren();
    settingsButton.disabled = !snapshot.supported;
    if (!snapshot.supported) {
      status.textContent = 'Bluetooth device lookup is available on Windows.';
      summary.textContent = '';
      return;
    }
    if (!snapshot.adapter_present) {
      status.textContent = 'Windows could not find an active Bluetooth adapter.';
      summary.textContent = '';
      return;
    }
    if (!snapshot.devices.length) {
      status.textContent = 'No paired or remembered Bluetooth devices found.';
    }
    const connected = snapshot.devices.filter(device => device.connected).length;
    summary.textContent = connected + ' connected · ' + snapshot.devices.length + ' saved';
    for (const device of snapshot.devices) {
      const item = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = device.name;
      const details = document.createElement('span');
      details.className = 'bluetooth-detail';
      details.textContent = device.kind + (device.paired ? ' · Paired' : ' · Remembered');
      const state = document.createElement('div');
      state.className = device.connected ? 'bluetooth-state connected' : 'bluetooth-state';
      state.textContent = device.connected == null ? 'Connection unknown' :
        device.connected ? 'Connected' : 'Not connected';
      item.append(title, details, state);
      list.append(item);
    }
  }

  async function refresh() {
    if (pending || !visible) return;
    pending = true;
    refreshButton.disabled = true;
    status.textContent = '';
    try {
      const snapshot = await invoke('bluetooth_devices');
      if (visible) render(snapshot);
    } catch (error) {
      if (visible) {
        list.replaceChildren();
        summary.textContent = '';
        status.textContent = String(error);
      }
    } finally {
      pending = false;
      refreshButton.disabled = false;
    }
  }

  function mount(page) {
    page.innerHTML = `
      <div class="bluetooth-toolbar">
        <strong>Bluetooth devices</strong>
        <span class="bluetooth-summary"></span>
        <button type="button" class="bluetooth-refresh">Refresh</button>
        <button type="button" class="bluetooth-settings" disabled>Bluetooth settings</button>
      </div>
      <div class="bluetooth-status" role="status"></div>
      <ul class="bluetooth-devices" aria-label="Saved Bluetooth devices"></ul>`;
    list = page.querySelector('.bluetooth-devices');
    status = page.querySelector('.bluetooth-status');
    summary = page.querySelector('.bluetooth-summary');
    refreshButton = page.querySelector('.bluetooth-refresh');
    settingsButton = page.querySelector('.bluetooth-settings');
    refreshButton.addEventListener('click', () => void refresh());
    settingsButton.addEventListener('click', async () => {
      try {
        await invoke('open_control_settings', {page: 'bluetooth'});
      } catch (error) {
        status.textContent = String(error);
      }
    });
    window.addEventListener('focus', () => void refresh());
  }

  function show() {
    visible = true;
    clearInterval(interval);
    void refresh();
    interval = setInterval(() => void refresh(), 10000);
  }

  function hide() {
    visible = false;
    clearInterval(interval);
  }

  (window.poniModules ||= {}).bluetooth = {mount, show, hide};
})();

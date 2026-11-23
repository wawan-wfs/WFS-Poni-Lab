(() => {
  'use strict';

  const windowsPages = [
    ['wifi', 'Wi-Fi'], ['bluetooth', 'Bluetooth'], ['display', 'Display'],
    ['sound', 'Sound'], ['night_light', 'Night light'], ['personalization', 'Colors'],
  ];
  const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
  let keepAwake, mute, microphone, volume, volumeValue, settings, status;
  let snapshot, interval;
  let generation = 0;
  let polling = false;
  let changing = false;

  function button(label, handler) {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = label;
    control.addEventListener('click', handler);
    return control;
  }

  function toggle(control, pressed, available) {
    control.disabled = changing || !available;
    control.setAttribute('aria-pressed', String(pressed ?? false));
  }

  function render() {
    const available = !!snapshot?.available;
    toggle(keepAwake, snapshot?.keep_awake, available);
    toggle(mute, snapshot?.volume?.muted, available && snapshot.volume != null);
    toggle(microphone, snapshot?.microphone_muted, available && snapshot.microphone_muted != null);
    volume.disabled = changing || !available || snapshot.volume == null;
    if (snapshot?.volume && (document.activeElement !== volume || changing)) {
      volume.value = String(snapshot.volume.level);
      volumeValue.textContent = `${volume.value}%`;
    } else if (!snapshot?.volume) {
      volumeValue.textContent = 'Unavailable';
    }
    for (const control of settings.children) control.disabled = changing || !available;
  }

  async function refresh(token) {
    if (polling || changing) return;
    polling = true;
    try {
      const result = await invoke('control_snapshot');
      if (token !== generation || changing) return;
      snapshot = result;
      if (!snapshot.available) status.textContent = 'Windows controls are unavailable here.';
      render();
    } catch (error) {
      if (token === generation) status.textContent = String(error);
    } finally {
      polling = false;
    }
  }

  async function change(command, args, apply) {
    if (changing) return;
    changing = true;
    render();
    status.textContent = '';
    try {
      const result = await invoke(command, args);
      apply?.(result);
    } catch (error) {
      status.textContent = String(error);
    } finally {
      render();
      changing = false;
      render();
    }
  }

  function mount(page) {
    page.classList.add('control-page');
    const tiles = document.createElement('div');
    tiles.className = 'control-tiles';
    keepAwake = button('Keep awake', () => change('set_keep_awake', {enabled: !snapshot.keep_awake}, enabled => {
      snapshot.keep_awake = enabled;
    }));
    keepAwake.title = 'Keep this PC awake until you turn this off or quit Poni';
    mute = button('Mute sound', () => change('set_control_mute', {device:'output', muted: !snapshot.volume.muted}, muted => {
      snapshot.volume.muted = muted;
    }));
    microphone = button('Mute microphone', () => change('set_control_mute', {device:'microphone', muted: !snapshot.microphone_muted}, muted => {
      snapshot.microphone_muted = muted;
    }));
    tiles.append(keepAwake, mute, microphone);

    const row = document.createElement('label');
    row.className = 'control-level';
    row.append('Output volume');
    volume = document.createElement('input');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '100';
    volume.value = '0';
    volume.setAttribute('aria-label', 'Output volume');
    volumeValue = document.createElement('output');
    volume.addEventListener('input', () => { volumeValue.textContent = `${volume.value}%`; });
    volume.addEventListener('change', () => change('set_control_volume', {level: Number(volume.value)}, level => {
      snapshot.volume.level = level;
    }));
    row.append(volume, volumeValue);

    const settingsTitle = document.createElement('h3');
    settingsTitle.textContent = 'Windows Settings';
    settings = document.createElement('div');
    settings.className = 'control-tiles';
    for (const [id, label] of windowsPages) {
      settings.append(button(label, () => change('open_control_settings', {page: id})));
    }
    status = document.createElement('p');
    status.className = 'control-status';
    status.setAttribute('role', 'status');
    page.append(tiles, row, settingsTitle, settings, status);
    render();
  }

  function show() {
    const token = ++generation;
    clearInterval(interval);
    void refresh(token);
    interval = setInterval(() => { void refresh(token); }, 4000);
  }

  function hide() {
    generation++;
    clearInterval(interval);
  }

  window.poniModules ||= {};
  window.poniModules.control = {mount, show, hide};
})();

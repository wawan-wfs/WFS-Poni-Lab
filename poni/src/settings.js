(() => {
  'use strict';

  const names = {
    home: 'Home', tasks: 'Todo', notes: 'Notes', calendar: 'Calendar', timer: 'Timer',
    weather: 'Weather', worldclock: 'World Clock', dayprogress: 'Day Progress', system: 'System',
    bookmarks: 'Bookmarks', pomodoro: 'Pomodoro', teleprompter: 'Teleprompter',
    dashboard: 'Dashboard', health: 'Health', control: 'Control', github: 'GitHub',
    notifs: 'Notifications', prayer: 'Prayer Times', radio: 'Radio', screentime: 'Screen Time',
    support: 'Support', translate: 'Translate', aiusage: 'AI Usage', bluetooth: 'Bluetooth & Wi-Fi',
    chat: 'AI Chat', currency: 'Currency', shelf: 'Shelf',
  };

  const categories = [
    { group: 'Poni', pages: [
      { id: 'general', title: 'General', icon: '⚙', color: 'grey' },
      { id: 'modules', title: 'Modules', icon: '▦', color: 'indigo' },
      { id: 'live', title: 'Live Activities', icon: '↗', color: 'red' },
      { id: 'animations', title: 'Animations', icon: '✧', color: 'purple' },
    ] },
    { group: 'Features', pages: [
      { id: 'dashboard', title: 'Dashboard', icon: '⊞', color: 'blue', link: 'dashboard',
        hint: 'Choose and reorder your Dashboard widgets.' },
      { id: 'todo', title: 'Todo', icon: '☑', color: 'orange', link: 'tasks',
        hint: 'Late completion, snooze, and Trash retention.' },
      { id: 'media', title: 'Media', icon: '♫', color: 'red' },
      { id: 'calendar', title: 'Calendar', icon: '▤', color: 'red', link: 'calendar',
        hint: 'Calendar display, meeting reminders, and the first day of the week.' },
      { id: 'weather', title: 'Weather', icon: '☀', color: 'cyan', link: 'weather',
        hint: 'Search for your city and choose the forecast location.' },
      { id: 'prayer', title: 'Prayer Times', icon: '◒', color: 'green', link: 'prayer',
        hint: 'Choose a city, calculation method and Asr school.' },
      { id: 'pomodoro', title: 'Pomodoro', icon: '◷', color: 'orange', link: 'pomodoro',
        hint: 'Set focus sessions and break durations.' },
      { id: 'health', title: 'Health', icon: '♥', color: 'green', link: 'health' },
      { id: 'dayprogress', title: 'Day Progress', icon: '◴', color: 'blue', link: 'dayprogress',
        hint: 'Choose when your day begins and ends.' },
      { id: 'screentime', title: 'Screen Time', icon: '⌛', color: 'indigo', link: 'screentime',
        hint: 'Tracking, idle time, and excluded apps.' },
      { id: 'bluetooth', title: 'Bluetooth & Wi-Fi', icon: 'ᛒ', color: 'blue', link: 'bluetooth' },
    ] },
    { group: 'Poni & system', pages: [
      { id: 'notifications', title: 'Notifications', icon: '♧', color: 'red', link: 'notifs',
        hint: 'View or clear notifications saved by Poni.' },
      { id: 'mirror', title: 'Mirror', icon: '●', color: 'purple' },
      { id: 'battery', title: 'Battery', icon: '▣', color: 'green' },
      { id: 'dock', title: 'Dock', icon: '▭', color: 'blue',
        hint: 'Dock settings will be available when the Dock is implemented.' },
      { id: 'buddy', title: 'Buddy', icon: '♢', color: 'orange',
        hint: 'Buddy settings will be available when the Buddy is implemented.' },
      { id: 'shelf', title: 'Drop Actions & Shelf', icon: '↧', color: 'orange', link: 'shelf' },
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
    ['todo', 'Mark late tasks as done', 'automatic overdue tasks selesai terlambat', 'todo-late'],
    ['todo', 'Snooze a due task for', 'postpone due reminder tunda tugas', 'todo-snooze'],
    ['todo', 'Keep deleted tasks in Trash for', 'retention days deleted task hapus sampah', 'todo-trash-days'],
    ['dayprogress', 'Day starts', 'day progress wake time mulai bangun', 'day-wake'],
    ['dayprogress', 'Bedtime', 'day progress sleep time jadwal tidur', 'day-bed'],
    ['dayprogress', 'Remind me at bedtime', 'day progress reminder pengingat tidur', 'bedtime-reminder'],
    ['dayprogress', 'Chime even in Do not disturb', 'day progress dnd sound bunyi tidur', 'bedtime-chime-dnd'],
    ['health', 'Water goal', 'health glasses water target minum gelas', 'health-water-goal'],
    ['health', 'Track health', 'health activity pelacakan kesehatan', 'health-enabled'],
    ['health', 'Break goal', 'health movement breaks daily target gerak jeda', 'health-break-goal'],
    ['health', 'Mindful minutes goal', 'health breathing target pernapasan fokus menit', 'health-mindful-goal'],
    ['health', 'Eye break length', 'health eye break duration istirahat mata', 'health-eye-duration'],
    ['health', 'Remind me to take a break', 'health movement stretch reminder pengingat jeda', 'health-break-reminders'],
    ['health', 'After working continuously for', 'health movement stretch interval', 'health-break-interval'],
    ['health', 'Remind me to drink water', 'health drink water reminder pengingat minum', 'health-water-reminders'],
    ['health', 'Water reminder every', 'health drink water interval', 'health-water-interval'],
    ['health', '20-20-20 eye breaks', 'health eye screen overlay mata', 'health-eye-breaks'],
    ['health', 'Eye break every', 'health eye interval screen reminder', 'health-eye-interval'],
    ['general', 'Clock format', '12 hour 24 hour region time', 'clock-format'],
    ['general', 'Keep the time while music or a timer plays', 'clock time live activity jam musik', 'clock-with-activities'],
    ['general', 'Hourly chime', 'hour clock seconds bell half hour sound bunyi jam', 'hour-chime'],
    ['general', 'Bounce on events', 'notch animation spring reminder pengingat gerak', 'notch-bounce'],
    ['general', 'Battery saver', 'low power energy reduce battery daya baterai', 'notch-battery-saver'],
    ['general', 'Time at the top of the open Poni', 'header clock', 'header-clock'],
    ['general', 'Open on hover', 'mouse click to open', 'open-on-hover'],
    ['general', 'Hover delay', 'open mouse milliseconds', 'hover-delay'],
    ['general', 'Close delay', 'dismiss mouse milliseconds', 'close-delay'],
    ['general', 'Switch tabs with ← / →', 'arrows keyboard shortcuts', 'module-shortcuts'],
    ['general', 'Open / close Poni', 'global keyboard shortcut hotkey alt n pintasan', 'toggle-shortcut'],
    ['general', 'Snooze Poni', 'global keyboard shortcut hotkey wake sembunyikan tunda', 'snooze-shortcut'],
    ['general', 'Snooze duration', 'minutes pause hide tunda menit', 'snooze-minutes'],
    ['general', 'Layout direction', 'right left rtl ltr writing arah tata letak', 'layout-direction'],
    ['general', 'Your name', 'greeting name nama panggilan sapaan', 'user-name'],
    ['general', 'What the closed Poni shows', 'idle closed notch clock sides waktu sisi', 'closed-middle'],
    ['general', 'Left side', 'idle slots time date weather battery calendar todo cpu ram world', 'closed-left'],
    ['general', 'Right side', 'idle slots time date weather battery calendar todo cpu ram world', 'closed-right'],
    ['general', 'Clock size', 'middle day and time jam ukuran bold tebal', 'closed-middle'],
    ['bluetooth', 'Bluetooth devices & battery', 'headset connected perangkat koneksi', 'bluetooth-enabled'],
    ['bluetooth', 'Low battery alert at', 'bluetooth percentage threshold persen baterai', 'bluetooth-low'],
    ['live', 'Bluetooth connect / disconnect / low battery', 'live activity bluetooth perangkat baterai', 'live-bluetooth'],
    ['general', 'Launch at login', 'windows startup sign in otomatis mulai masuk', 'launch-at-login'],
    ['general', 'Show Poni (the notch)', 'hide disable tray tampil sembunyikan', 'notch-enabled'],
    ['general', 'Show Poni on', 'display screen monitor cursor layar', 'notch-display'],
    ['general', 'Lock position', 'stop notch drag kunci posisi', 'notch-lock-position'],
    ['general', 'Hide when an app is fullscreen', 'games video presentation layar penuh', 'notch-fullscreen'],
    ['general', 'Auto-hide', 'top edge mouse hidden sembunyi otomatis', 'notch-auto-hide'],
    ['general', 'Come down when you’re idle', 'auto hide standby inactive diam', 'notch-standby'],
    ['general', 'Idle for', 'standby delay inactive seconds detik', 'notch-standby-secs'],
    ['general', 'Hide button', 'manual hide eye handle sembunyikan', 'notch-hide-button'],
    ['general', 'Step aside for the mouse', 'notch moves up click behind pointer minggir tetikus', 'notch-step-aside'],
    ['general', 'Position along the top', 'notch position left centre right posisi', 'notch-position'],
    ['general', 'Gap from the top edge', 'notch position floating distance jarak atas', 'notch-top-gap'],
    ['general', 'Show Poni in screenshots & recordings', 'share capture protection privacy rekaman', 'show-in-screenshots'],
    ['general', 'Width', 'closed notch width lebar tertutup', 'notch-width'],
    ['general', 'Height', 'closed notch height tinggi tertutup', 'notch-height'],
    ['general', 'Opacity when closed', 'closed notch transparency opasitas', 'notch-opacity'],
    ['general', 'Expanded width', 'notch expanded width lebar terbuka', 'expanded-width'],
    ['general', 'Expanded height', 'notch expanded height biasa', 'expanded-height'],
    ['general', 'Expanded height (tall modules)', 'notch expanded height tall tinggi modul', 'tall-height'],
    ['general', 'Warmer colors at night', 'sunset blue light malam warna hangat', 'warm-night'],
    ['general', 'Night warmth', 'strength colour preview opasitas malam', 'night-warmth'],
    ['modules', 'Open this module by default', 'initial page', 'default-module'],
    ['modules', 'Remember the last module', 'startup restore last tab', 'remember-module'],
    ['mirror', 'Show the Mirror on Home', 'camera webcam local video', 'mirror-enabled'],
    ['mirror', 'Mirror shape', 'rounded circle camera', 'mirror-shape'],
    ['battery', 'Show battery', 'battery indicator tampilkan baterai', 'battery-enabled'],
    ['battery', 'Show percentage', 'battery level persentase baterai', 'battery-percentage'],
    ['battery', 'Icon', 'battery bar ring icon', 'battery-icon'],
    ['battery', 'Charging animation', 'battery plugged unplugged charger', 'battery-charging-activity'],
    ['battery', 'Low battery warning at', 'battery low threshold daya rendah', 'battery-threshold'],
    ['live', 'Live activities while Poni is closed', 'closed notch activities aktivitas tertutup', 'live-enabled'],
    ['live', 'Rotate between activities', 'closed notch every six seconds bergantian', 'live-rotate'],
    ['live', 'Pomodoro, timer and stopwatch', 'live clocks countdown activity', 'live-timers'],
    ['live', 'Events starting within 15 minutes', 'live calendar event activity', 'live-calendar'],
    ['live', 'Todo deadlines', 'live upcoming tasks hour deadline tunda tugas', 'live-todo'],
    ['live', 'Music', 'live current song track playing musik', 'live-music'],
    ['live', 'System summary now and then', 'cpu ram memory live system ringkasan', 'live-system'],
    ['live', 'Show the System summary every', 'cpu ram memory live interval', 'live-system-interval'],
    ['live', 'Sneak peek on song change', 'title next song preview', 'live-sneak-peek'],
    ['live', 'Hover-reveal media controls while Poni is closed', 'play pause skip previous next track', 'live-hover-media'],
    ['animations', 'Timer outline', 'timer pomodoro countdown animation garis', 'animation-timer-outline'],
    ['animations', 'Files fly into the Shelf', 'drop file shelf animation gerak', 'animation-shelf-fly'],
    ['animations', 'Tabs slide in from their side', 'module transition slide direction animasi', 'animation-tab-slide'],
    ['animations', 'Shadow of the open Poni', 'window shadow bayangan', 'animation-shadow'],
    ['animations', 'Celebrate a done day', 'task todo complete confetti konfeti', 'animation-celebrate'],
    ['media', 'Music controls', 'media playback spotify musik', 'media-enabled'],
    ['media', 'Progress bar in the closed Poni', 'song progress elapsed lagu pemutaran', 'media-progress'],
    ['media', 'Color glow from album art', 'artwork cover color glow sampul cahaya', 'media-color-glow'],
    ['shelf', 'Shelf tab', 'shelf files folders show tab rak file', 'shelf-enabled'],
    ['shelf', 'Drop actions', 'drop file tiles zip extract copy seret', 'shelf-drop-enabled'],
    ['shelf', 'Shrink PDFs, images and videos', 'compress PDF photo video sharpest medium smallest kompres foto', 'shelf-quality'],
    ['shelf', 'Open the shelf when dragging files', 'shelf open drag file buka seret', 'shelf-open-on-drag'],
    ['shelf', 'Remove from shelf after dragging out', 'shelf drag remove references lepas seret', 'shelf-remove-after-drag'],
    ['shelf', 'Remember what you copy', 'clipboard history pin riwayat salin tempel', 'shelf-clipboard-enabled'],
    ['shelf', 'Keep the last copies', 'clipboard history limit retention salin', 'shelf-clipboard-limit'],
    ['calendar', 'Show calendar', 'calendar visibility home kalender', 'calendar-enabled'],
    ['calendar', 'Meeting reminder', 'calendar notification event minutes pertemuan pengingat', 'meeting-reminder'],
    ['calendar', 'Week starts on', 'calendar first day monday sunday minggu senin awal pekan', 'week-start'],
    ['screentime', 'Track screen time', 'activity tracking waktu layar', 'screen-time-enabled'],
    ['screentime', 'Stop counting after idle', 'activity threshold inactive ambang diam', 'screen-time-idle'],
    ['screentime', 'Excluded apps', 'ignore executable abaikan kecualikan aplikasi', 'screen-time-excluded'],
    ['pomodoro', 'Focus', 'pomodoro duration minutes fokus', 'pomo-focus'],
    ['pomodoro', 'Short break', 'pomodoro duration minutes jeda pendek', 'pomo-short'],
    ['pomodoro', 'Long break', 'pomodoro duration minutes jeda panjang', 'pomo-long'],
    ['pomodoro', 'Focus sessions before a long break', 'pomodoro cycle', 'pomo-cycle'],
    ['pomodoro', 'Start breaks automatically', 'pomodoro auto break', 'pomo-auto-break'],
    ['pomodoro', 'Start focus automatically after a break', 'pomodoro auto focus', 'pomo-auto-focus'],
    ['pomodoro', 'Completion sound', 'pomodoro timer end quiet do not disturb suara selesai', 'pomo-completion-sound'],
    ['pomodoro', 'Sound while you focus', 'pomodoro background audio noise suara', 'pomo-sound'],
    ['pomodoro', 'Volume', 'pomodoro background sound audio suara', 'pomo-volume'],
    ['pomodoro', 'Keep playing in breaks', 'pomodoro background sound audio', 'pomo-break-sound'],
    ['pomodoro', 'Timer presets', 'add remove countdown minutes', 'timer-preset'],
    ['pomodoro', 'Remember the last duration', 'timer countdown last length', 'timer-remember'],
    ['pomodoro', 'Start a break after the timer', 'countdown pomodoro short break', 'timer-then-break'],
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
  let screenTime = null;
  let pomo = null;
  let batteryStatus = null;
  let launchAtLogin = null;
  let daySchedule = null;
  let displays = [];
  let active = 'general';
  let busy = false;
  let loading = false;
  let dragId = null;
  let closedPart = null;

  function choose(id, focusId = null) {
    active = id;
    if (id === 'general' && /^closed-(left|middle|right)$/.test(focusId || '')) closedPart = focusId.slice(7);
    search.value = '';
    render(false);
    if (focusId) document.getElementById('settings-' + focusId)?.focus();
  }

  function broadcast() {
    document.documentElement.dir = settings.panel?.direction === 'rtl' ? 'rtl' : 'ltr';
    window.dispatchEvent(new CustomEvent('poni-settings-changed', { detail: settings }));
  }

  async function change(patch, focusId, source = active === 'screentime' ? 'screenTime' : 'settings') {
    if (busy || !settings) return;
    busy = true;
    banner.textContent = 'Saving…';
    updateBusy();
    try {
      if (source === 'screenTime') {
        screenTime = await window.__TAURI__.core.invoke('set_screentime_preferences', { patch });
      } else if (source === 'startup') {
        launchAtLogin = await window.__TAURI__.core.invoke('set_poni_startup', { enabled: patch.launch_at_login });
      } else if (source === 'shortcuts') {
        settings = await window.__TAURI__.core.invoke('set_poni_shortcuts', { patch });
      } else if (source === 'dayprogress') {
        const saved = await window.__TAURI__.core.invoke('set_day_schedule', patch);
        daySchedule = { wake_minute: saved.wake_minute, bed_minute: saved.bed_minute };
      } else if (source === 'pomodoro') {
        const timer = await window.__TAURI__.core.invoke('pomodoro_settings', { settings: patch });
        pomo = timer.settings;
        if ('focus_sound' in patch || 'focus_sound_volume' in patch) {
          window.poniFocusPlayback.previewSettings(timer);
        }
      } else {
        const update = ['panel', 'todo', 'health', 'battery', 'live', 'shelf', 'animations', 'hourly', 'bluetooth', 'closed_display'].includes(source) ? { [source]: patch } : patch;
        settings = await window.__TAURI__.core.invoke('set_poni_settings', { patch: update });
        broadcast();
      }
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

  function values(source) {
    if (source === 'pomodoro') return pomo;
    if (source === 'closed_display') return { ...window.poniClosedDisplay.defaults, ...settings.closed_display };
    if (source === 'bluetooth') return { enabled: true, low_threshold: 20, ...settings.bluetooth };
    if (['panel', 'todo', 'health', 'battery', 'live', 'shelf', 'animations', 'hourly'].includes(source)) return settings[source];
    if (source === 'shortcuts') return settings.shortcuts || { toggle: 'Alt+N', snooze: '', minutes: 30 };
    if (source === 'startup') return { launch_at_login: launchAtLogin };
    return active === 'screentime' ? screenTime : settings;
  }

  function toggle(container, id, title, description, key, source, disabled = false) {
    const input = create('input', 'settings-switch');
    input.id = 'settings-' + id;
    input.type = 'checkbox';
    input.checked = values(source)[key];
    input.disabled = disabled;
    input.addEventListener('change', () => void change({ [key]: input.checked }, id, source));
    row(container, title, description, input);
  }

  function select(container, id, title, description, key, options, disabled = false, source) {
    const input = create('select', 'settings-select');
    input.id = 'settings-' + id;
    input.disabled = disabled;
    for (const [value, label] of options) input.append(option(label, value));
    input.value = values(source)[key];
    input.addEventListener('change', () => {
      const value = typeof options[0]?.[0] === 'number' ? Number(input.value) : input.value;
      void change({ [key]: value }, id, source);
    });
    row(container, title, description, input);
  }

  function range(container, id, title, key, { min = 0, max, step, disabled = false, unit, spokenUnit, description, source, physical = false, preview }) {
    const box = create('span', 'settings-range');
    const input = create('input');
    const output = create('span', 'settings-range-value');
    output.setAttribute('aria-hidden', 'true');
    input.id = 'settings-' + id;
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = values(source)[key];
    input.disabled = disabled;
    if (physical) box.dir = 'ltr';
    const showValue = () => {
      output.textContent = unit ? input.value + ' ' + unit : input.value;
      if (spokenUnit) input.setAttribute('aria-valuetext', input.value + ' ' + spokenUnit);
    };
    showValue();
    input.addEventListener('input', () => {
      showValue();
      if (preview) preview(input.valueAsNumber);
    });
    input.addEventListener('change', () => void change({ [key]: Number(input.value) }, id, source));
    box.append(input, output);
    row(container, title, description, box);
  }

  function delay(container, id, title, key, max, step, disabled = false) {
    range(container, id, title, key, { max, step, disabled, unit: 'ms', spokenUnit: 'milliseconds' });
  }

  function closedPreview(container) {
    const display = window.poniClosedDisplay;
    const config = values('closed_display');
    const now = new Date();
    const time = display.time(now, settings.clock_format);
    const day = display.day(now);
    const sideText = kind => kind === 'time' ? time : kind === 'date' ? day : display.slots.find(([id]) => id === kind)?.[2];
    container.append(create('div', 'settings-closed-label', 'What the closed Poni shows'));
    const bar = create('div', 'settings-closed-preview');
    bar.dir = 'ltr';
    bar.style.setProperty('--preview-height', `${Math.max(26, settings.panel.height || 32)}px`);
    bar.style.setProperty('--preview-font', `${display.font(settings.panel.height || 32, config.size)}px`);
    bar.classList.toggle('clock-bold', config.bold);
    const controls = [
      ['left', 'Left side', sideText(config.left)],
      ['middle', 'Middle', config.mode === 'date' ? `${day} ${time}` : config.mode === 'time' ? time : ''],
      ['right', 'Right side', sideText(config.right)],
    ];
    for (const [part, label, value] of controls) {
      const preview = button(value || '+', () => {
        closedPart = closedPart === part ? null : part;
        render(true);
        document.getElementById('settings-closed-' + part)?.focus({preventScroll: true});
      }, 'settings-closed-part');
      preview.id = 'settings-closed-' + part;
      preview.title = label;
      preview.setAttribute('aria-label', label);
      preview.setAttribute('aria-expanded', String(closedPart === part));
      bar.append(preview);
    }
    container.append(bar);
    if (!closedPart) {
      container.append(create('small', 'settings-closed-hint', 'Choose the left, middle, or right part.'));
      return;
    }
    const choice = create('div', 'settings-closed-choices');
    choice.setAttribute('role', 'group');
    choice.setAttribute('aria-label', controls.find(([part]) => part === closedPart)[1] + ' choices');
    const isMiddle = closedPart === 'middle';
    const key = isMiddle ? 'mode' : closedPart;
    const choices = isMiddle ? [['time', 'Time'], ['date', 'Day and time'], ['off', 'Nothing']] : display.slots;
    for (const [value, label] of choices) {
      const id = `closed-${key}-${value}`;
      const tile = button(label, () => void change({[key]: value}, id, 'closed_display'));
      tile.id = 'settings-' + id;
      tile.setAttribute('aria-pressed', String(config[key] === value));
      choice.append(tile);
    }
    choice.addEventListener('keydown', event => {
      const buttons = [...choice.children];
      const index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      const delta = document.documentElement.dir === 'rtl' ? -1 : 1;
      const columns = buttons.filter(tile => tile.offsetTop === buttons[0].offsetTop).length;
      const target = { ArrowLeft: index - delta, ArrowRight: index + delta, ArrowUp: index - columns,
        ArrowDown: index + columns, Home: 0, End: buttons.length - 1 }[event.key];
      if (!buttons[target]) return;
      event.preventDefault();
      buttons[target].focus();
    });
    container.append(choice);
    if (isMiddle) {
      select(container, 'closed-size', 'Clock size', 'The clock grows with the height of the closed notch.', 'size',
        [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large'], ['xlarge', 'Extra large']], config.mode === 'off', 'closed_display');
      toggle(container, 'closed-bold', 'Bold', 'Emphasize the day and time.', 'bold', 'closed_display', config.mode === 'off');
    }
  }

  function general(content) {
    const display = group(content, 'Display');
    const name = create('input', 'settings-text');
    name.id = 'settings-user-name';
    name.type = 'text';
    name.maxLength = 40;
    name.spellcheck = false;
    name.autocomplete = 'off';
    name.value = settings.user_name || '';
    name.addEventListener('change', () => void change({user_name: name.value}, 'user-name'));
    name.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); name.blur(); }
    });
    row(display, 'Your name', 'Poni uses this name for its greeting. It is saved on this PC.', name);
    select(display, 'layout-direction', 'Layout direction', null, 'direction',
      [['auto', 'Follow the language'], ['ltr', 'Left to right'], ['rtl', 'Right to left']], false, 'panel');
    toggle(display, 'launch-at-login', 'Launch at login',
      launchAtLogin == null ? 'Startup settings are unavailable.' : 'Open Poni when you sign in to Windows.',
      'launch_at_login', 'startup', launchAtLogin == null);
    toggle(display, 'notch-enabled', 'Show Poni (the notch)',
      'You can also show Poni again from the system tray.', 'enabled', 'panel');
    const displayOptions = [['primary', 'Primary display'], ['cursor', 'Display with the mouse cursor'],
      ...displays.map(item => [item.id, item.label])];
    const selectedDisplay = settings.panel.display || 'primary';
    if (!displayOptions.some(([id]) => id === selectedDisplay)) {
      displayOptions.push([selectedDisplay, 'Selected display unavailable']);
    }
    select(display, 'notch-display', 'Show Poni on', null, 'display', displayOptions, false, 'panel');
    range(display, 'notch-position', 'Position along the top', 'position',
      { max: 100, step: 1, unit: '%', spokenUnit: 'percent', source: 'panel', physical: true });
    const positions = create('div', 'settings-position-presets');
    positions.dir = 'ltr';
    for (const [title, position] of [['Left', 6], ['Centre', 50], ['Right', 94]]) {
      const preset = button(title, () => void change({ position }, 'notch-position', 'panel'));
      preset.setAttribute('aria-pressed', String(settings.panel.position === position));
      positions.append(preset);
    }
    display.append(positions);
    toggle(display, 'notch-lock-position', 'Lock position',
      'Stop the notch from being dragged.', 'lock_position', 'panel');
    toggle(display, 'notch-fullscreen', 'Hide when an app is fullscreen',
      'Use the open shortcut or Open Poni in the tray to bring it back for a moment.', 'hide_in_fullscreen', 'panel');
    toggle(display, 'notch-auto-hide', 'Auto-hide',
      'Move the mouse to the top edge to show Poni. Reminders still come down.', 'auto_hide', 'panel');
    toggle(display, 'notch-standby', 'Come down when you’re idle',
      'Show the closed notch after a period without mouse or keyboard input.', 'standby_show', 'panel', !settings.panel.auto_hide);
    const standby = create('input', 'settings-text');
    standby.id = 'settings-notch-standby-secs';
    standby.type = 'number';
    standby.min = 1;
    standby.max = 3600;
    standby.required = true;
    standby.value = settings.panel.standby_secs ?? 12;
    standby.disabled = !settings.panel.auto_hide || !settings.panel.standby_show;
    standby.addEventListener('change', () => {
      if (standby.validity.valid) void change({standby_secs: standby.valueAsNumber}, 'notch-standby-secs', 'panel');
      else standby.value = settings.panel.standby_secs ?? 12;
    });
    row(display, 'Idle for', 'Seconds without mouse or keyboard input.', standby);
    toggle(display, 'notch-hide-button', 'Hide button',
      'Show a button in Poni that tucks it into a handle at the top edge.', 'hide_button', 'panel');
    toggle(display, 'notch-step-aside', 'Step aside for the mouse',
      'Move the closed notch out of the way when the pointer approaches from below. Reach the top edge to use Poni.',
      'step_aside', 'panel', settings.panel.auto_hide);
    const pixels = { unit: 'px', spokenUnit: 'pixels', source: 'panel' };
    range(display, 'notch-top-gap', 'Gap from the top edge', 'top_gap',
      { ...pixels, max: 120, step: 2, description: 'At 0, Poni stays attached to the top edge.' });
    toggle(display, 'show-in-screenshots', 'Show Poni in screenshots & recordings',
      'Turn off to hide the notch from Windows screen capture.', 'show_in_screenshots', 'panel');
    toggle(display, 'notch-bounce', 'Bounce on events', 'A small spring animation for new activity.', 'haptics');
    select(display, 'notch-battery-saver', 'Battery saver',
      'Pause decorative animations and update media less often while on battery or with Energy saver on.',
      'battery_saving', [['off', 'Off'], ['auto', 'Automatic']]);

    closedPreview(group(content, 'Closed Poni'));
    const clock = group(content, 'Clock');
    select(clock, 'clock-format', 'Clock format', 'Follow the Windows region or choose a format.',
      'clock_format', [['region', 'Windows region'], ['h12', '12-hour'], ['h24', '24-hour']]);
    toggle(clock, 'header-clock', 'Time at the top of the open Poni', 'On every tab.', 'header_clock');
    toggle(clock, 'clock-with-activities', 'Keep the time while music or a timer plays',
      'Also while Pomodoro and the stopwatch are running.', 'clock_with_activities');
    hourlyChime(clock);

    const opening = group(content, 'Opening');
    toggle(opening, 'open-on-hover', 'Open on hover', 'Otherwise click to open.', 'open_on_hover');
    delay(opening, 'hover-delay', 'Hover delay', 'hover_delay', '800', '10', !settings.open_on_hover);
    delay(opening, 'close-delay', 'Close delay', 'close_delay', '1500', '50');

    const shortcuts = group(content, 'Keyboard shortcuts');
    for (const [id, key, label, hint] of [
      ['toggle-shortcut', 'toggle', 'Open / close Poni', 'For example Alt+N or Ctrl+Shift+Space. Leave empty to turn it off.'],
      ['snooze-shortcut', 'snooze', 'Snooze Poni', 'Press again to wake Poni. Leave empty to turn it off.'],
    ]) {
      const input = create('input', 'settings-text');
      input.type = 'text';
      input.id = 'settings-' + id;
      input.maxLength = 64;
      input.spellcheck = false;
      input.value = values('shortcuts')[key];
      input.addEventListener('keydown', event => { if (event.key === 'Enter') input.blur(); });
      input.addEventListener('change', () => void change({ [key]: input.value }, id, 'shortcuts'));
      row(shortcuts, label, hint, input);
    }
    range(shortcuts, 'snooze-minutes', 'Snooze duration', 'minutes', {
      min: 5, max: 240, step: 5, unit: 'min', spokenUnit: 'minutes', source: 'shortcuts',
    });
    toggle(shortcuts, 'module-shortcuts', 'Switch tabs with ← / →', 'After opening Poni with its keyboard shortcut.',
      'module_shortcuts');

    const size = group(content, 'Size');
    range(size, 'notch-width', 'Width', 'width', { ...pixels, min: 80, max: 320, step: 2 });
    range(size, 'notch-height', 'Height', 'height', { ...pixels, min: 22, max: 44, step: 1 });
    range(size, 'notch-opacity', 'Opacity when closed', 'opacity',
      { min: 20, max: 100, step: 5, unit: '%', spokenUnit: 'percent', source: 'panel' });
    range(size, 'expanded-width', 'Expanded width', 'expanded_width', { ...pixels, min: 560, max: 780, step: 10 });
    range(size, 'expanded-height', 'Expanded height', 'expanded_height', { ...pixels, min: 170, max: 260, step: 2 });
    range(size, 'tall-height', 'Expanded height (tall modules)', 'tall_height',
      { ...pixels, min: 220, max: 340, step: 2 });

    const colors = group(content, 'Colors');
    toggle(colors, 'warm-night', 'Warmer colors at night',
      'Poni’s background warms gradually after sunset and returns to its daytime color at sunrise.',
      'warm_night', 'panel');
    range(colors, 'night-warmth', 'Night warmth', 'warmth', {
      min: 10, max: 100, step: 5, unit: '%', spokenUnit: 'percent', source: 'panel',
      preview: strength => void window.__TAURI__.core.invoke('preview_night_warmth', { strength })
        .catch(error => { banner.textContent = String(error); }),
    });
  }

  function mirror(content) {
    const controls = group(content);
    toggle(controls, 'mirror-enabled', 'Show the Mirror on Home',
      'Open the Mirror from Home to preview your camera.', 'mirror_enabled');
    select(controls, 'mirror-shape', 'Mirror shape', null, 'mirror_shape',
      [['rounded', 'Rounded'], ['circle', 'Circle']], !settings.mirror_enabled);
  }

  function hourlyChime(clock) {
    select(clock, 'hour-chime', 'Hourly chime', 'The bell stays quiet in Do not disturb and over fullscreen apps.',
      'mode', [['off', 'Off'], ['sound', 'Sound'], ['light', 'Light'], ['both', 'Sound and light']], false, 'hourly');
    if (settings.hourly.mode === 'off') return;
    toggle(clock, 'hour-chime-half', 'On the half hour too', 'One note at half past, two on the hour.', 'half', 'hourly');
    toggle(clock, 'hour-chime-quiet', 'Quiet hours', 'Skip chimes within the chosen time range.', 'quiet', 'hourly');
    for (const [key, title] of [['from', 'Quiet from'], ['to', 'Quiet until']]) {
      const input = create('input', 'settings-text');
      input.id = 'settings-hour-chime-' + key;
      input.type = 'time';
      const value = settings.hourly[key];
      input.value = `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
      input.disabled = !settings.hourly.quiet;
      input.addEventListener('change', () => {
        if (!input.value) return;
        const [hours, minutes] = input.value.split(':').map(Number);
        void change({ [key]: hours * 60 + minutes }, 'hour-chime-' + key, 'hourly');
      });
      row(clock, title, null, input);
    }
    if (['sound', 'both'].includes(settings.hourly.mode)) {
      clock.append(button('Try the bell', () => void window.__TAURI__.core.invoke('preview_hourly_chime')
        .catch(error => { banner.textContent = String(error); })));
    }
  }

  function liveActivities(content) {
    const controls = group(content);
    toggle(controls, 'live-enabled', 'Live activities while Poni is closed', null, 'enabled', 'live');
    toggle(controls, 'live-rotate', 'Rotate between activities', 'Every 6 seconds', 'rotate', 'live');
    toggle(controls, 'live-music', 'Music', 'Show the playing track and its progress.', 'music', 'live');
    toggle(controls, 'live-timers', 'Pomodoro, timer and stopwatch', null, 'timers', 'live');
    toggle(controls, 'live-system', 'System summary now and then', 'Briefly show CPU and memory use.', 'system', 'live');
    select(controls, 'live-system-interval', 'Show the System summary every', null, 'system_interval',
      [[30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [600, '10 minutes'], [1800, '30 minutes']],
      !settings.live.system, 'live');
    toggle(controls, 'live-calendar', 'Events starting within 15 minutes', null, 'calendar', 'live');
    toggle(controls, 'live-bluetooth', 'Bluetooth connect / disconnect / low battery', null, 'bluetooth', 'live');
    toggle(controls, 'live-todo', 'Todo deadlines',
      'Counts down the next task due within an hour.', 'todo', 'live');
    toggle(controls, 'live-sneak-peek', 'Sneak peek on song change', 'Briefly show the song title under Poni.',
      'sneak_peek', 'live');
    toggle(controls, 'live-hover-media', 'Hover-reveal media controls while Poni is closed',
      'Turn off Open on hover to use the media controls here.', 'hover_media_controls', 'live');
  }

  function bluetooth(content) {
    const controls = group(content);
    toggle(controls, 'bluetooth-enabled', 'Bluetooth devices & battery',
      'Shows a paired device when it connects, disconnects, or its battery runs low.', 'enabled', 'bluetooth');
    range(controls, 'bluetooth-low', 'Low battery alert at', 'low_threshold',
      { min: 5, max: 50, step: 5, unit: '%', spokenUnit: 'percent', source: 'bluetooth', disabled: !values('bluetooth').enabled });
    const devices = group(content, 'Bluetooth devices');
    const list = create('ul', 'settings-device-list');
    list.replaceChildren(create('li', null, 'Checking for paired devices…'));
    devices.append(list);
    window.__TAURI__.core.invoke('bluetooth_devices').then(snapshot => {
      if (!list.isConnected) return;
      const entries = snapshot.devices?.map(device => {
        const item = create('li');
        const connection = device.connected == null ? 'Connection unknown' : device.connected ? 'Connected' : 'Not connected';
        const battery = Number.isInteger(device.battery) ? ` · ${device.battery}%` : '';
        item.append(create('strong', null, device.name), create('small', null, `${connection} · ${device.kind}${battery}`));
        return item;
      }) || [];
      if (!entries.length) {
        entries.push(create('li', null, snapshot.adapter_present ? 'No paired devices found.' : 'Bluetooth adapter unavailable.'));
      }
      list.replaceChildren(...entries);
    }).catch(error => {
      if (list.isConnected) list.replaceChildren(create('li', null, String(error)));
    });
  }

  function shelf(content) {
    const actions = group(content);
    toggle(actions, 'shelf-drop-enabled', 'Drop actions', null, 'drop_enabled', 'shelf');
    const catalog = new Map(window.poniDropCatalog.map(tile => [tile.id, tile]));
    const tiles = group(content, 'Tiles');
    const ids = settings.shelf.tiles;
    for (const id of [...ids, ...[...catalog.keys()].filter(id => !ids.includes(id))]) {
      const {label: title, description} = catalog.get(id);
      const node = create('div', 'settings-row');
      const name = create('label', 'settings-label');
      const checkbox = create('input', 'settings-switch');
      checkbox.id = 'settings-shelf-tile-' + id;
      checkbox.type = 'checkbox';
      checkbox.checked = ids.includes(id);
      name.htmlFor = checkbox.id;
      name.append(create('span', null, title), create('small', null, description));
      const controls = create('span', 'settings-row-actions');
      const index = ids.indexOf(id);
      for (const step of [-1, 1]) {
        const target = index + step;
        const move = button(step < 0 ? '↑' : '↓', () => {
          const next = [...ids];
          [next[index], next[target]] = [next[target], next[index]];
          void change({ tiles: next }, 'shelf-tile-' + id, 'shelf');
        });
        move.setAttribute('aria-label', `Move ${title} ${step < 0 ? 'up' : 'down'}`);
        move.disabled = index < 0 || target < 0 || target >= ids.length;
        controls.append(move);
      }
      checkbox.addEventListener('change', () => void change({ tiles: checkbox.checked
        ? [...ids, id] : ids.filter(key => key !== id) }, 'shelf-tile-' + id, 'shelf'));
      controls.append(checkbox);
      node.append(name, controls);
      tiles.append(node);
    }
    select(group(content), 'shelf-quality', 'Shrink PDFs, images and videos',
      'Shrink photos, pictures inside PDFs, and videos. MP4 copies are at most 1920, 1280, or 854 px wide.', 'quality',
      [['light', 'Light: sharpest'], ['medium', 'Medium'], ['strong', 'Strong: smallest']], false, 'shelf');
    const controls = group(content, 'Shelf');
    toggle(controls, 'shelf-enabled', 'Shelf tab', null, 'enabled', 'shelf');
    toggle(controls, 'shelf-open-on-drag', 'Open the shelf when dragging files', null, 'open_on_drag', 'shelf');
    toggle(controls, 'shelf-remove-after-drag', 'Remove from shelf after dragging out',
      'Removes the Shelf reference after a successful drop.', 'remove_after_drag', 'shelf');
    content.append(create('p', 'settings-lead', 'The Shelf remembers where files are.'));
    const history = group(content, 'Clipboard');
    toggle(history, 'shelf-clipboard-enabled', 'Remember what you copy',
      'Show copied text, links and pictures on the Shelf. Pinned entries stay when history is turned off.',
      'clipboard_enabled', 'shelf');
    const count = create('input', 'settings-text');
    count.id = 'settings-shelf-clipboard-limit';
    count.type = 'number';
    count.min = 5;
    count.max = 100;
    count.step = 1;
    count.required = true;
    count.value = settings.shelf.clipboard_limit;
    count.addEventListener('change', () => {
      if (count.validity.valid) void change({ clipboard_limit: count.valueAsNumber }, 'shelf-clipboard-limit', 'shelf');
      else count.value = settings.shelf.clipboard_limit;
    });
    count.addEventListener('keydown', event => {
      if (event.key === 'Enter') count.blur();
    });
    row(history, 'Keep the last copies', 'Pinned ones don’t count.', count);
    if (settings.shelf.enabled && !settings.hidden_modules.includes('shelf')) {
      content.append(button('Open Shelf', () => void openLink('shelf')));
    }
  }

  function animations(content) {
    const section = group(content);
    toggle(section, 'animation-timer-outline', 'Timer outline', 'Trace the time left on the closed notch.',
      'timer_outline', 'animations');
    toggle(section, 'animation-shelf-fly', 'Files fly into the Shelf', 'Animate files as they reach the Shelf.',
      'shelf_fly', 'animations');
    toggle(section, 'animation-tab-slide', 'Tabs slide in from their side', null, 'tab_slide', 'animations');
    select(section, 'animation-shadow', 'Shadow of the open Poni', null, 'shadow',
      [['always', 'Always'], ['opening', 'While it opens'], ['off', 'Off']], false, 'animations');
    toggle(section, 'animation-celebrate', 'Celebrate a done day', 'Show confetti when the last task due today is completed.',
      'celebrate', 'animations');
  }

  function media(content) {
    const section = group(content);
    toggle(section, 'media-enabled', 'Music controls', 'Show media on Home and in the closed notch.', 'media_enabled');
    toggle(section, 'media-progress', 'Progress bar in the closed Poni', 'A line shows how much of the song has played.',
      'music_progress', undefined, !settings.media_enabled);
    toggle(section, 'media-color-glow', 'Color glow from album art', 'Use a color from the artwork provided by Windows.',
      'color_glow', undefined, !settings.media_enabled);
  }

  function battery(content) {
    const controls = group(content);
    toggle(controls, 'battery-enabled', 'Show battery', null, 'enabled', 'battery');
    toggle(controls, 'battery-percentage', 'Show percentage',
      'Next to the battery icon in the open and closed Poni.', 'show_percentage', 'battery');
    select(controls, 'battery-icon', 'Icon', null, 'icon',
      [['bar', 'Bar'], ['ring', 'Ring']], false, 'battery');
    toggle(controls, 'battery-charging-activity', 'Charging animation',
      'When you plug in or unplug the charger.', 'charging_activity', 'battery');
    range(controls, 'battery-threshold', 'Low battery warning at', 'low_threshold',
      { min: 5, max: 50, step: 1, unit: '%', spokenUnit: 'percent', source: 'battery' });
    const details = create('p', 'settings-battery-state');
    details.id = 'battery-details';
    controls.append(details);
    paintBattery();
  }

  function paintBattery() {
    const details = document.querySelector('#battery-details');
    if (!details) return;
    if (typeof batteryStatus?.charging !== 'boolean') {
      details.textContent = 'No battery detected (desktop PC). The battery indicator stays hidden.';
      return;
    }
    const level = batteryStatus.percent == null ? 'Battery level unavailable' : `Battery: ${batteryStatus.percent}%`;
    const source = batteryStatus.plugged_in == null ? 'power source unavailable'
      : batteryStatus.plugged_in ? 'plugged in' : 'on battery';
    details.textContent = `${level} · ${source}${batteryStatus.saver ? ' · battery saver on' : ''}`;
  }

  function todo(content) {
    const controls = group(content);
    const minutes = value => value === 60 ? '1 hour' : `${value} minute${value === 1 ? '' : 's'}`;
    select(controls, 'todo-late', 'Mark late tasks as done',
      'Each task can override this choice in its own deadline settings.', 'late_minutes',
      [[0, 'Off'], ...[1, 3, 5, 10, 30, 60].map(value => [value, `${minutes(value)} after their time`])],
      false, 'todo');
    select(controls, 'todo-snooze', 'Snooze a due task for',
      'Move a due task this far ahead. A repeating task keeps its schedule.', 'snooze_minutes',
      [5, 10, 15, 30, 60].map(value => [value, minutes(value)]), false, 'todo');
    range(controls, 'todo-trash-days', 'Keep deleted tasks in Trash for', 'trash_days',
      { min: 1, max: 30, step: 1, unit: 'days', spokenUnit: 'days', source: 'todo' });
  }

  function dayProgress(content) {
    const controls = group(content);
    for (const [key, label] of [['wake', 'Day starts'], ['bed', 'Bedtime']]) {
      const time = create('input', 'settings-text');
      const id = 'day-' + key;
      time.id = 'settings-' + id;
      time.type = 'time';
      time.required = true;
      const value = daySchedule[key + '_minute'];
      time.value = [Math.floor(value / 60), value % 60].map(value => String(value).padStart(2, '0')).join(':');
      time.addEventListener('change', () => {
        if (!time.validity.valid) return;
        const [hour, minute] = time.value.split(':').map(Number);
        void change({ [key]: hour * 60 + minute }, id, 'dayprogress');
      });
      row(controls, label, null, time);
    }
    toggle(controls, 'bedtime-reminder', 'Remind me at bedtime',
      'Show a 15-second reminder while Poni is running.', 'bedtime_reminder');
    toggle(controls, 'bedtime-chime-dnd', 'Chime even in Do not disturb',
      'Play the bedtime chime even when Windows is suppressing interruptions.', 'bedtime_chime_dnd');
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

  function health(content) {
    const goals = group(content);
    toggle(goals, 'health-enabled', 'Track health', null, 'enabled', 'health');
    range(goals, 'health-water-goal', 'Water goal', 'water_goal',
      { min: 2, max: 16, step: 1, unit: 'glasses', spokenUnit: 'glasses', source: 'health' });
    range(goals, 'health-break-goal', 'Break goal', 'break_goal',
      { min: 1, max: 16, step: 1, unit: 'breaks', spokenUnit: 'breaks', source: 'health' });
    range(goals, 'health-mindful-goal', 'Mindful minutes goal', 'mindful_goal',
      { min: 1, max: 30, step: 1, unit: 'min', spokenUnit: 'minutes', source: 'health' });
    const reminders = group(content, 'Reminders');
    const minutes = { step: 5, unit: 'min', spokenUnit: 'minutes', source: 'health' };
    toggle(reminders, 'health-break-reminders', 'Remind me to take a break', null, 'break_reminders', 'health');
    range(reminders, 'health-break-interval', 'After working continuously for', 'break_interval',
      { ...minutes, min: 15, max: 120 });
    toggle(reminders, 'health-water-reminders', 'Remind me to drink water',
      'While you’re at the PC. Pauses when you reach today’s goal.', 'water_reminders', 'health');
    range(reminders, 'health-water-interval', 'Water reminder every', 'water_interval',
      { ...minutes, min: 5, max: 180 });
    toggle(reminders, 'health-eye-breaks', '20-20-20 eye breaks',
      'Dims the screen and prompts you to look 20 feet away. Press Esc to skip.', 'eye_breaks', 'health');
    range(reminders, 'health-eye-interval', 'Eye break every', 'eye_interval',
      { ...minutes, min: 10, max: 60 });
    range(reminders, 'health-eye-duration', 'Eye break length', 'eye_duration',
      { min: 10, max: 60, step: 5, unit: 's', spokenUnit: 'seconds', source: 'health' });
  }

  function screenTimeControls(content) {
    const controls = group(content);
    toggle(controls, 'screen-time-enabled', 'Track screen time', null, 'enabled');
    range(controls, 'screen-time-idle', 'Stop counting after idle', 'idle_seconds', {
      min: 30, max: 600, step: 30, unit: 's', spokenUnit: 'seconds',
    });

    const input = create('input', 'settings-text');
    input.id = 'settings-screen-time-excluded';
    input.type = 'text';
    input.value = screenTime.excluded_apps.join(', ');
    input.spellcheck = false;
    input.addEventListener('change', () => {
      void change({ excluded_apps: input.value.split(',') }, 'screen-time-excluded');
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') input.blur();
    });
    row(controls, 'Excluded apps', 'Comma-separated .exe names, e.g. keepass.exe, steam.exe', input);

    const hidden = settings.hidden_modules.includes('screentime');
    content.append(button(hidden ? 'Show Screen Time in Modules' : 'Open Screen Time', () => void openLink('screentime')));
  }

  function pomodoroControls(content) {
    const durations = group(content);
    const minutes = { unit: 'min', spokenUnit: 'minutes', source: 'pomodoro' };
    range(durations, 'pomo-focus', 'Focus', 'focus_minutes', { ...minutes, min: 5, max: 90, step: 5 });
    range(durations, 'pomo-short', 'Short break', 'short_minutes', { ...minutes, min: 1, max: 30, step: 1 });
    range(durations, 'pomo-long', 'Long break', 'long_minutes', { ...minutes, min: 5, max: 60, step: 5 });
    range(durations, 'pomo-cycle', 'Focus sessions before a long break', 'cycle_length',
      { min: 2, max: 8, step: 1, source: 'pomodoro' });
    toggle(durations, 'pomo-auto-break', 'Start breaks automatically', null, 'auto_break', 'pomodoro');
    toggle(durations, 'pomo-auto-focus', 'Start focus automatically after a break', null, 'auto_focus', 'pomodoro');
    toggle(durations, 'pomo-completion-sound', 'Completion sound',
      'The Timer’s too. Quiet while Windows’ Do not disturb is on.', 'completion_sound', 'pomodoro');

    const audio = group(content, 'Background sound');
    select(audio, 'pomo-sound', 'Sound while you focus', 'Fades in when a focus session runs.',
      'focus_sound', window.poniFocusPlayback.options, false, 'pomodoro');
    range(audio, 'pomo-volume', 'Volume', 'focus_sound_volume',
      { min: 0, max: 100, step: 5, unit: '%', spokenUnit: 'percent', source: 'pomodoro' });
    toggle(audio, 'pomo-break-sound', 'Keep playing in breaks', null, 'focus_sound_breaks', 'pomodoro');

    const timer = group(content, 'Timer');
    const presets = settings.timer_presets;
    const form = create('form', 'settings-row settings-preset-form');
    const label = create('label', 'settings-label');
    label.htmlFor = 'settings-timer-preset';
    label.append(create('span', null, 'Presets'), create('small', null, 'Up to eight durations, 1–600 minutes each.'));
    const input = create('input', 'settings-text');
    Object.assign(input, {
      id: label.htmlFor, type: 'number', min: 1, max: 600, step: 1, required: true, disabled: presets.length === 8,
    });
    const add = create('button', 'settings-button', 'Add');
    add.type = 'submit';
    add.disabled = input.disabled;
    form.append(label, input, add);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (presets.includes(input.valueAsNumber)) {
        banner.textContent = 'This preset already exists.';
        return;
      }
      void change({ timer_presets: [...presets, input.valueAsNumber] }, 'timer-preset');
    });
    timer.append(form);
    if (presets.length) {
      const list = create('div', 'settings-presets');
      for (const minutes of presets) {
        const remove = button(`${minutes} min ×`, () => {
          void change({ timer_presets: presets.filter(preset => preset !== minutes) }, 'timer-preset');
        });
        remove.setAttribute('aria-label', `Remove ${minutes} minute preset`);
        list.append(remove);
      }
      timer.append(list);
    }
    toggle(timer, 'timer-remember', 'Remember the last duration', 'Otherwise start at the first preset.',
      'timer_remember');
    toggle(timer, 'timer-then-break', 'Start a break after the timer',
      'Start Pomodoro’s short break when the Timer ends and no Pomodoro is running.', 'timer_then_break');
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
        else if (active === 'live' && settings.live) liveActivities(controls);
        else if (active === 'animations' && settings.animations) animations(controls);
        else if (active === 'media') media(controls);
        else if (active === 'shelf' && settings.shelf) shelf(controls);
        else if (active === 'todo') todo(controls);
        else if (active === 'dayprogress' && daySchedule) dayProgress(controls);
        else if (active === 'health' && settings.health) health(controls);
        else if (active === 'mirror') mirror(controls);
        else if (active === 'battery' && settings.battery) battery(controls);
        else if (active === 'calendar') calendar(controls);
        else if (active === 'screentime' && screenTime) screenTimeControls(controls);
        else if (active === 'bluetooth') bluetooth(controls);
        else if (active === 'pomodoro' && pomo) pomodoroControls(controls);
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
      const invoke = window.__TAURI__.core.invoke;
      [settings, screenTime, pomo, launchAtLogin, daySchedule, batteryStatus, displays] = await Promise.all([
        invoke('get_poni_settings'), invoke('get_screentime_preferences'), invoke('get_pomodoro_settings'),
        invoke('get_poni_startup').catch(() => null),
        invoke('get_day_schedule').catch(() => null),
        invoke('get_battery').catch(() => null),
        invoke('panel_displays').then(value => Array.isArray(value) ? value : []).catch(() => []),
      ]);
      settings.panel.display ||= 'primary';
      settings.hourly ||= {mode:'off', half:false, quiet:true, from:1320, to:360};
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
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        panel.querySelector('.settings-result')?.click();
      }
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
    window.__TAURI__.event.listen('poni-day-schedule-changed', event => {
      daySchedule = event.payload;
      if (active === 'dayprogress' && !busy && !loading) render(true);
    }).catch(error => { banner.textContent = String(error); });
    window.__TAURI__.event.listen('poni-settings-changed', event => {
      if (busy || loading || !event.payload?.panel) return;
      settings = event.payload;
      broadcast();
      render(true);
    }).catch(error => { banner.textContent = String(error); });
    window.__TAURI__.event.listen('poni-battery-changed', event => {
      batteryStatus = event.payload;
      paintBattery();
    }).catch(error => { banner.textContent = String(error); });
    window.__TAURI__.event.listen('poni-screentime-changed', event => {
      screenTime = event.payload;
      const toggle = document.getElementById('settings-screen-time-enabled');
      if (toggle) toggle.checked = screenTime.enabled;
    }).catch(error => { banner.textContent = String(error); });
    window.__TAURI__.event.listen('poni-pomodoro-settings-changed', event => {
      pomo = event.payload;
      if (active === 'pomodoro' && !busy && !loading) render(true);
    }).catch(error => { banner.textContent = String(error); });
    render(false);
  }

  window.poniModules ||= {};
  window.poniModules.settings = { mount, show: refresh };
})();

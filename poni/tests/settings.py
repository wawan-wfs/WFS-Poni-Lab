from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from shutil import which
from threading import Thread

from playwright.sync_api import expect, sync_playwright


FIXTURE = """
(() => {
  const defaults = {
    clock_format:'region', header_clock:true, open_on_hover:true, hover_delay:0, close_delay:450,
    module_shortcuts:true, module_order:['home','tasks','notes','calendar','timer','weather','worldclock','screentime'],
    hidden_modules:[], default_module:'home', remember_module:false, last_module:null,
    mirror_enabled:true, mirror_shape:'rounded',
    calendar_enabled:true, meeting_reminder_minutes:5, week_start:'windows',
  };
  const read = () => JSON.parse(localStorage.getItem('test-settings')) || structuredClone(defaults);
  const save = value => localStorage.setItem('test-settings', JSON.stringify(value));
  const readScreenTime = () => JSON.parse(localStorage.getItem('test-screen-time')) || {
    enabled:false, idle_seconds:120, excluded_apps:[],
  };
  const bus = new BroadcastChannel('poni-settings-test');
  const listeners = new Map();
  bus.onmessage = ({data}) => {
    for (const listener of listeners.get(data.name) || []) listener({payload:data.payload});
  };

  window.__TAURI__ = {
    event: { listen: async (name, handler) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
      if (name === 'poni-toggle') window.testShortcut = () => handler({payload:null});
      return () => listeners.get(name).delete(handler);
    } },
    core: { invoke: async (command, args = {}) => {
      const settings = read();
      if (command === 'open_poni_settings') {
        window.open('/settings.html', 'poni-settings');
        return;
      }
      if (command === 'show_poni_module') {
        if (settings.hidden_modules.includes(args.module)) throw new Error('This module is not visible');
        bus.postMessage({name:'poni-settings-open-module',payload:args.module});
        return;
      }
      if (command === 'get_poni_settings') return settings;
      if (command === 'get_screentime_preferences') return readScreenTime();
      if (command === 'set_screentime_preferences' || command === 'set_screentime_enabled') {
        const screenTime = readScreenTime();
        const patch = command === 'set_screentime_enabled' ? {enabled:args.enabled} : {...args.patch};
        if (patch.excluded_apps) {
          patch.excluded_apps = [...new Set(patch.excluded_apps.map(name => name.trim().toLowerCase()).filter(Boolean))];
        }
        Object.assign(screenTime, patch);
        localStorage.setItem('test-screen-time', JSON.stringify(screenTime));
        bus.postMessage({name:'poni-screentime-changed',payload:screenTime});
        return screenTime;
      }
      if (command === 'screentime_summary') return {
        available:true, enabled:readScreenTime().enabled, apps:[], hours:Array(24).fill(0), total:0, switches:0,
      };
      if (command === 'set_poni_settings') {
        Object.assign(settings, args.patch);
        if (settings.hidden_modules.includes(settings.default_module)) {
          settings.default_module = settings.module_order.find(id => !settings.hidden_modules.includes(id));
        }
        save(settings);
        bus.postMessage({name:'poni-settings-changed',payload:settings});
        return settings;
      }
      if (command === 'remember_poni_module') {
        if (settings.remember_module && !settings.hidden_modules.includes(args.module)) {
          settings.last_module = args.module;
          save(settings);
        }
        return settings;
      }
      if (command === 'shortcut_status') return true;
      if (command === 'get_data') return {
        settings, tasks: [], notes: [], world_clocks: [], calendar_events: [],
        timer:{total_ms:1500000,remaining_ms:1500000,ends_at_ms:null},
        stopwatch:{elapsed_ms:0,started_at_ms:null,laps:[]},
      };
      if (command === 'set_panel_open') return;
      if (command === 'current_media') return null;
      if (command === 'calendar_first_weekday') return 0;
    } },
  };
})();
"""


def open_settings(page):
    with page.expect_popup() as opened:
        page.get_by_role('button', name='Settings', exact=True).click()
    popup = opened.value
    settings = popup.locator('#page-settings')
    expect(settings.get_by_role('heading', name='General', exact=True)).to_be_visible()
    return popup, settings


def test_settings(page):
    page.evaluate('window.testShortcut()')
    popup, settings = open_settings(page)

    search = settings.get_by_role('searchbox', name='Search settings')
    search.fill('hover delay')
    settings.get_by_role('button', name='Hover delay', exact=False).click()
    expect(settings.locator('#settings-hover-delay')).to_be_focused()
    settings.locator('#settings-hover-delay').fill('620')
    expect(settings.locator('#settings-hover-delay')).to_have_value('620')
    expect(settings.get_by_role('status')).to_have_text('Saved')

    settings.locator('#settings-clock-format').select_option('h24')
    expect(settings.locator('#settings-clock-format')).to_have_value('h24')
    settings.locator('#settings-header-clock').uncheck()
    expect(page.locator('#header-clock')).to_have_attribute('hidden', '')

    settings.locator('#settings-open-on-hover').uncheck()
    expect(settings.locator('#settings-hover-delay')).to_be_disabled()
    expect(settings.get_by_role('status')).to_have_text('Saved')

    settings.get_by_role('button', name='Modules', exact=True).click()
    settings.get_by_role('checkbox', name='Show Todo').uncheck()
    expect(page.locator('.tab[data-page="tasks"]')).to_have_attribute('hidden', '')

    settings.get_by_role('button', name='Move Weather up').click()
    page.wait_for_function("""
      document.querySelector('.tab[data-page="weather"]').nextElementSibling?.dataset.page === 'timer'
    """)
    settings.locator('#settings-default-module').select_option('weather')
    expect(settings.locator('#settings-default-module')).to_have_value('weather')

    search.fill('mirror shape')
    settings.get_by_role('button', name='Mirror shape', exact=False).click()
    expect(settings.locator('#settings-mirror-shape')).to_be_focused()
    settings.locator('#settings-mirror-shape').select_option('circle')
    expect(settings.locator('#settings-mirror-shape')).to_have_value('circle')

    search.fill('meeting reminder')
    settings.get_by_role('button', name='Meeting reminder', exact=False).click()
    reminder = settings.locator('#settings-meeting-reminder')
    expect(reminder).to_be_focused()
    expect(reminder).to_have_value('5')
    expect(reminder).to_have_attribute('max', '30')
    reminder.fill('0')
    expect(reminder).to_have_attribute('aria-valuetext', '0 minutes')
    expect(settings.get_by_role('status')).to_have_text('Saved')
    settings.locator('#settings-week-start').select_option('monday')
    expect(settings.locator('#settings-week-start')).to_have_value('monday')
    settings.locator('#settings-calendar-enabled').uncheck()
    expect(settings.get_by_role('status')).to_have_text('Saved')
    page.wait_for_function("document.querySelector('#page-home .calendar').hidden")
    settings.get_by_role('button', name='Open Calendar', exact=True).click()
    expect(page.locator('#page-calendar')).to_be_visible()
    expect(page.locator('#calendar-grid > span').first).to_have_text('Mon')

    search.fill('excluded apps')
    settings.get_by_role('button', name='Excluded apps', exact=False).click()
    excluded = settings.locator('#settings-screen-time-excluded')
    expect(excluded).to_be_focused()
    excluded.fill(' Steam.exe, keepass.exe, STEAM.exe')
    excluded.press('Enter')
    expect(excluded).to_have_value('steam.exe, keepass.exe')
    idle = settings.locator('#settings-screen-time-idle')
    expect(idle).to_have_value('120')
    expect(idle).to_have_attribute('min', '30')
    idle.fill('300')
    expect(idle).to_have_attribute('aria-valuetext', '300 seconds')
    tracking = settings.locator('#settings-screen-time-enabled')
    tracking.check()
    expect(settings.get_by_role('status')).to_have_text('Saved')
    settings.get_by_role('button', name='Open Screen Time', exact=True).click()
    panel_tracking = page.locator('#page-screentime .st-toggle')
    expect(panel_tracking).to_be_checked()
    panel_tracking.uncheck()
    expect(tracking).not_to_be_checked()

    popup.close()
    page.reload()
    closed = page.locator('#closed')
    closed.dispatch_event('pointerenter')
    expect(page.locator('#open')).to_be_hidden()
    closed.click()
    expect(page.locator('#page-weather')).to_be_visible()
    expect(page.locator('.tab[data-page="tasks"]')).to_be_hidden()
    expect(page.locator('#header-clock')).to_be_hidden()

    popup, settings = open_settings(page)
    settings.get_by_role('button', name='General', exact=True).click()
    expect(settings.locator('#settings-open-on-hover')).not_to_be_checked()
    expect(settings.locator('#settings-clock-format')).to_have_value('h24')
    expect(settings.locator('#settings-hover-delay')).to_have_value('620')
    settings.get_by_role('button', name='Mirror', exact=True).click()
    expect(settings.locator('#settings-mirror-shape')).to_have_value('circle')
    settings.get_by_role('button', name='Calendar', exact=True).click()
    expect(settings.locator('#settings-calendar-enabled')).not_to_be_checked()
    expect(settings.locator('#settings-week-start')).to_have_value('monday')
    expect(settings.locator('#settings-meeting-reminder')).to_have_value('0')
    settings.get_by_role('button', name='Screen Time', exact=True).click()
    expect(settings.locator('#settings-screen-time-idle')).to_have_value('300')
    expect(settings.locator('#settings-screen-time-excluded')).to_have_value('steam.exe, keepass.exe')
    expect(settings.locator('#settings-screen-time-enabled')).not_to_be_checked()

    settings.get_by_role('button', name='Modules', exact=True).click()
    settings.locator('#settings-remember-module').check()
    popup.close()
    page.locator('#closed').click()
    page.locator('.tab[data-page="calendar"]').click()
    page.wait_for_function("JSON.parse(localStorage.getItem('test-settings')).last_module === 'calendar'")
    page.reload()
    page.locator('#closed').click()
    expect(page.locator('#page-calendar')).to_be_visible()


def main():
    root = Path(__file__).resolve().parents[1]
    handler = partial(SimpleHTTPRequestHandler, directory=str(root / 'src'))
    with ThreadingHTTPServer(('127.0.0.1', 0), handler) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as playwright:
                executable = which('chromium') or which('chromium-browser') or which('google-chrome')
                options = {'executable_path': executable} if executable else {}
                browser = playwright.chromium.launch(headless=True, args=['--no-sandbox'], **options)
                context = browser.new_context(viewport={'width': 900, 'height': 600}, locale='en-US')
                context.set_default_timeout(7000)
                errors = []
                context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
                context.add_init_script(FIXTURE)
                page = context.new_page()
                page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
                test_settings(page)
                assert not errors, errors
                browser.close()
        finally:
            server.shutdown()


if __name__ == '__main__':
    main()

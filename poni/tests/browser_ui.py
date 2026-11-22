from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from shutil import which
from threading import Thread
from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(root / 'src')))
Thread(target=server.serve_forever, daemon=True).start()
with sync_playwright() as pw:
    executable = which('chromium') or which('chromium-browser') or which('google-chrome')
    browser = pw.chromium.launch(**({'executable_path': executable} if executable else {}), headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 680, 'height': 200})
    page.add_init_script('''
      window.__TAURI__ = { event: {listen: async (name, listener) => { window.poniTestShortcut = listener; }}, core: { invoke: async (command, args = {}) => {
        const data = JSON.parse(localStorage.getItem('test-data') || '{"tasks":[],"notes":[],"timer":{"total_ms":1500000,"remaining_ms":1500000,"ends_at_ms":null},"stopwatch":{"elapsed_ms":0,"started_at_ms":null,"laps":[]}}');
        if (command === 'current_media') return {title: 'Test track', artist: 'Test artist', playing: true, position_ms: 30000, duration_ms: 60000};
        if (command === 'shortcut_status') return true;
        if (command === 'search_weather_city') return [{name:'Jakarta', admin1:'Jakarta', country:'Indonesia', latitude:-6.2, longitude:106.8}];
        if (command === 'weather_forecast') return {current:{temperature_2m:30, relative_humidity_2m:70, weather_code:2, wind_speed_10m:10}, daily:{time:['2026-11-22'], temperature_2m_max:[32], temperature_2m_min:[25], weather_code:[2]}};
        if (command === 'set_weather_location') data.weather_location = args.location;
        if (command === 'media_control') localStorage.setItem('last-media-action', args.action);
        if (command === 'add_task') data.tasks.push({id: crypto.randomUUID(), text: args.text, done: false});
        if (command === 'toggle_task') { const t = data.tasks.find(t => t.id === args.id); t.done = !t.done; }
        if (command === 'remove_task') data.tasks = data.tasks.filter(t => t.id !== args.id);
        if (command === 'save_note') { const n = data.notes.find(n => n.id === args.id); if (n) n.text = args.text; else data.notes.push({id: crypto.randomUUID(), text: args.text}); }
        if (command === 'remove_note') data.notes = data.notes.filter(n => n.id !== args.id);
        if (command === 'timer_action') {
          if (args.action === 'start') { if (args.minutes) data.timer.total_ms = data.timer.remaining_ms = args.minutes * 60000; data.timer.ends_at_ms = Date.now() + data.timer.remaining_ms; }
          if (args.action === 'pause') { data.timer.remaining_ms = Math.max(0, data.timer.ends_at_ms - Date.now()); data.timer.ends_at_ms = null; }
          if (args.action === 'reset') { data.timer.remaining_ms = data.timer.total_ms; data.timer.ends_at_ms = null; }
        }
        if (command === 'stopwatch_action') {
          const sw = data.stopwatch;
          if (args.action === 'start') sw.started_at_ms = Date.now();
          if (args.action === 'pause') { sw.elapsed_ms += Date.now() - sw.started_at_ms; sw.started_at_ms = null; }
          if (args.action === 'lap' && sw.started_at_ms !== null) sw.laps.push(sw.elapsed_ms + Date.now() - sw.started_at_ms);
          if (args.action === 'reset') data.stopwatch = {elapsed_ms: 0, started_at_ms: null, laps: []};
        }
        localStorage.setItem('test-data', JSON.stringify(data)); return data;
      } } };
    ''')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
    page.evaluate('window.poniTestShortcut()')
    expect(page.locator('#open')).to_be_visible()
    page.evaluate('window.poniTestShortcut()')
    expect(page.locator('#open')).to_be_hidden()
    page.locator('#closed').dispatch_event('pointerenter')
    expect(page.locator('#media-title')).to_have_text('Test track')
    expect(page.locator('#media-progress-fill')).to_have_attribute('style', 'width: 50%;')
    page.get_by_role('button', name='Next track').click()
    assert page.evaluate("localStorage.getItem('last-media-action')") == 'next'
    page.locator('[data-page="tasks"]').click()
    page.locator('#task-input').fill('Prepare meeting')
    page.locator('#task-form button').click()
    expect(page.get_by_text('Prepare meeting')).to_be_visible()
    page.get_by_role('checkbox', name='Complete Prepare meeting').check()
    page.reload()
    page.locator('#closed').dispatch_event('pointerenter')
    page.locator('[data-page="tasks"]').click()
    expect(page.get_by_role('checkbox', name='Complete Prepare meeting')).to_be_checked()
    page.locator('[data-page="notes"]').click()
    page.locator('#note-input').fill('First note')
    page.get_by_role('button', name='Save note').click()
    expect(page.get_by_text('First note')).to_be_visible()
    page.get_by_role('button', name='Edit').click()
    page.locator('#note-input').fill('Updated note')
    page.get_by_role('button', name='Save note').click()
    expect(page.get_by_text('Updated note')).to_be_visible()
    page.get_by_role('button', name='Delete').click()
    expect(page.get_by_text('Updated note')).to_have_count(0)
    page.locator('[data-page="timer"]').click()
    page.locator('#timer-minutes').fill('5')
    page.locator('#timer-start').click()
    expect(page.locator('#timer-start')).to_have_text('Pause')
    page.locator('#timer-start').click()
    expect(page.locator('#timer-start')).to_have_text('Start')
    page.locator('#timer-reset').click()
    expect(page.locator('#timer-display')).to_have_text('05:00')
    page.get_by_role('button', name='Stopwatch').click()
    page.locator('#stopwatch-start').click()
    expect(page.locator('#stopwatch-start')).to_have_text('Pause')
    page.locator('#stopwatch-lap').click()
    expect(page.locator('#stopwatch-laps')).to_contain_text('Lap 1')
    page.locator('#stopwatch-start').click()
    page.locator('#stopwatch-reset').click()
    expect(page.locator('#stopwatch-display')).to_have_text('00:00.0')
    page.locator('[data-page="weather"]').click()
    page.locator('#weather-city').fill('Jakarta')
    page.locator('#weather-search button').click()
    page.get_by_role('button', name='Jakarta, Jakarta, Indonesia').click()
    expect(page.locator('#weather-current')).to_contain_text('30°C')
    page.reload()
    page.locator('#closed').dispatch_event('pointerenter')
    page.locator('[data-page="weather"]').click()
    expect(page.locator('#weather-current')).to_contain_text('30°C')
    assert not errors, errors
    browser.close()
server.shutdown()
print('PASS: task and note interactions using a mock backend')

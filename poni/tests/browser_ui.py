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
      window.__TAURI__ = { core: { invoke: async (command, args = {}) => {
        const data = JSON.parse(localStorage.getItem('test-data') || '{"tasks":[],"notes":[],"timer":{"total_ms":1500000,"remaining_ms":1500000,"ends_at_ms":null}}');
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
        localStorage.setItem('test-data', JSON.stringify(data)); return data;
      } } };
    ''')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
    page.locator('#closed').dispatch_event('pointerenter')
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
    assert not errors, errors
    browser.close()
server.shutdown()
print('PASS: task and note interactions using a mock backend')

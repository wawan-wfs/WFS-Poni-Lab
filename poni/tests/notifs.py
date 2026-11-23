from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from shutil import which
from threading import Thread

from playwright.sync_api import expect, sync_playwright


root = Path(__file__).resolve().parents[1]
handler = partial(SimpleHTTPRequestHandler, directory=str(root / 'src'))

with ThreadingHTTPServer(('127.0.0.1', 0), handler) as server:
    Thread(target=server.serve_forever, daemon=True).start()
    with sync_playwright() as pw:
        executable = which('chromium') or which('chromium-browser') or which('google-chrome')
        launch_options = {'executable_path': executable} if executable else {}
        browser = pw.chromium.launch(**launch_options, headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 680, 'height': 260}, timezone_id='UTC')
        page.add_init_script("""
          const now = Date.now();
          const seed = [
            {id:'1', source:'pomodoro', title:'Focus finished', body:'Short break ready', created_at_ms:now, read:false},
            {id:'2', source:'timer', title:'Timer expired', body:'Time is up', created_at_ms:now - 86400000, read:false},
            {id:'3', source:'todo', title:'Task due', body:'<b>Book tickets</b>', created_at_ms:now - 86400000, read:false}
          ];
          window.__TAURI__ = { event: { listen: async (_, handler) => { window.poniTestShortcut = handler; } },
            core: { invoke: async (command, args = {}) => {
              if (command === 'shortcut_status') return true;
              if (command === 'get_data') return {
                tasks: [], notes: [], world_clocks: [], calendar_events: [],
                timer: {total_ms:1500000, remaining_ms:1500000, ends_at_ms:null},
                stopwatch:{elapsed_ms:0, started_at_ms:null, laps:[]}
              };
              if (!['notification_history', 'update_notification_history'].includes(command)) return null;
              let history = JSON.parse(localStorage.getItem('test-notifs')) || seed;
              if (args.action === 'read') history.find(item => item.id === args.id).read = true;
              if (args.action === 'read_all') history.forEach(item => item.read = true);
              if (args.action === 'remove') history = history.filter(item => item.id !== args.id);
              if (args.action === 'clear') history = [];
              localStorage.setItem('test-notifs', JSON.stringify(history));
              return history;
            } }
          };
        """)
        page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
        page.evaluate('window.poniTestShortcut()')
        page.locator('[data-page="notifs"]').click()
        history = page.locator('.nh-list')
        expect(history.get_by_text('Today')).to_be_visible()
        expect(history.get_by_text('Yesterday')).to_be_visible()
        expect(history.get_by_text('<b>Book tickets</b>')).to_be_visible()
        page.locator('.nh-filters').get_by_role('button', name='Timer · 1', exact=True).click()
        expect(history.get_by_text('Focus finished')).to_have_count(0)
        history.get_by_role('button', name='Mark read: Timer expired').click()
        expect(history.get_by_role('button', name='Read: Timer expired')).to_be_visible()
        history.get_by_role('button', name='Remove Timer expired').click()
        expect(history.get_by_text('Timer expired')).to_have_count(0)
        page.get_by_role('button', name='Mark all read').click()
        expect(history.locator('.unread')).to_have_count(0)
        page.get_by_role('button', name='Clear all', exact=True).click()
        page.get_by_role('button', name='Cancel', exact=True).click()
        expect(history.get_by_text('Focus finished')).to_be_visible()
        page.reload()
        page.evaluate('window.poniTestShortcut()')
        page.locator('[data-page="notifs"]').click()
        expect(history.get_by_role('button', name='Read: Focus finished')).to_be_visible()
        expect(history.get_by_text('Timer expired')).to_have_count(0)
        page.get_by_role('button', name='Clear all', exact=True).click()
        page.get_by_role('button', name='Clear', exact=True).click()
        expect(history.get_by_text('No Poni notifications yet.')).to_be_visible()
        browser.close()
    server.shutdown()

print('PASS: Notifications history grouping, source filters, read state, removal, and clear confirmation')

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from shutil import which
from threading import Thread
from playwright.sync_api import expect, sync_playwright

src = Path(__file__).resolve().parents[1] / 'src'
handler = partial(SimpleHTTPRequestHandler, directory=str(src))
with ThreadingHTTPServer(('127.0.0.1', 0), handler) as server:
    Thread(target=server.serve_forever, daemon=True).start()
    with sync_playwright() as pw:
        executable = which('chromium') or which('chromium-browser') or which('google-chrome')
        options = {'executable_path': executable} if executable else {}
        browser = pw.chromium.launch(**options, headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 680, 'height': 420})
        page.add_init_script('''
          window.__TAURI__ = {
            event: {listen: async () => () => {}},
            core: {invoke: async (command, args = {}) => {
              const data = JSON.parse(localStorage.getItem('ai-usage-test') || '{}');
              if (command === 'ai_usage_state') return data;
              if (command === 'import_ai_usage') {
                const parsed = JSON.parse(args.raw);
                window.selectedImport = parsed;
                const now = Math.floor(Date.now() / 1000);
                let plan, used, resets;
                if (args.provider === 'codex') {
                  plan = parsed.rate_limits.plan_type;
                  used = parsed.rate_limits.primary.used_percent;
                  resets = now + 2 * 3600;
                } else {
                  used = parsed.five_hour.utilization;
                  resets = now - 3600;
                }
                data[args.provider] = {
                  plan, imported_at: now, captured_at: now,
                  windows: [{label: '5-hour session', used_percent: used, window_minutes: 300, resets_at: resets}],
                };
                localStorage.setItem('ai-usage-test', JSON.stringify(data));
                return data;
              }
              if (command === 'clear_ai_usage') {
                delete data[args.provider];
                localStorage.setItem('ai-usage-test', JSON.stringify(data));
                return data;
              }
              return undefined;
            }},
          };
        ''')
        page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
        page.locator('#closed').dispatch_event('pointerenter')
        page.locator('[data-page="aiusage"]').click()
        panel = page.locator('#page-aiusage')
        picker = panel.get_by_label('Import usage file')
        expect(picker).to_be_enabled()
        picker.set_input_files({
            'name': 'session.jsonl',
            'mimeType': 'application/json',
            'buffer': (
                b'{"type":"event_msg","payload":{"type":"token_count","rate_limits":'
                b'{"plan_type":"plus","primary":{"used_percent":42},"credits":{"unused":"ignore"}}}}\n'
                b'{"type":"event_msg","payload":{"type":"user_message","message":"ignored note"}}\n'
            ),
        })
        expect(panel.get_by_role('status')).to_have_text('Snapshot imported')
        expect(panel.get_by_role('meter')).to_have_attribute('aria-valuenow', '42')
        assert page.evaluate('Object.keys(window.selectedImport.rate_limits).sort().join(",")') == 'plan_type,primary'
        expect(panel.get_by_text('On track at captured pace')).to_be_visible()
        panel.get_by_role('combobox', name='Provider').select_option('claude')
        picker.set_input_files({
            'name': 'usage.json',
            'mimeType': 'application/json',
            'buffer': b'{"five_hour":{"utilization":93}}',
        })
        expect(panel.get_by_role('meter')).to_have_attribute('aria-valuenow', '93')
        expect(panel.get_by_text('Window ended. Import updated data.')).to_be_visible()
        page.reload()
        page.locator('#closed').dispatch_event('pointerenter')
        page.locator('[data-page="aiusage"]').click()
        expect(panel.get_by_role('meter')).to_have_attribute('aria-valuenow', '42')
        panel.get_by_role('button', name='Clear snapshot').click()
        expect(panel.get_by_text('Import a usage file to view Codex limits.')).to_be_visible()
        panel.get_by_role('combobox', name='Provider').select_option('claude')
        expect(panel.get_by_role('meter')).to_have_attribute('aria-valuenow', '93')
        browser.close()
    server.shutdown()

print('PASS: AI Usage imports, pace, expiry and stored provider snapshots')

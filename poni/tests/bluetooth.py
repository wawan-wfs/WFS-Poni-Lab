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
        options = {'executable_path': executable} if executable else {}
        browser = pw.chromium.launch(**options, headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 680, 'height': 380})
        page.add_init_script("""
          window.bluetoothMock = {
            calls: 0, settings: [],
            snapshot: {
              supported: true, adapter_present: true,
              devices: [
                {name:'<b>Headphones</b>', connected:true, paired:true, kind:'Audio or video'},
                {name:'Mouse', connected:false, paired:false, kind:'Peripheral'},
              ]
            }
          };
          window.__TAURI__ = {
            event: {listen: async (name, callback) => { if (name === 'poni-toggle') window.poniTestShortcut = callback; }},
            core: {invoke: async (command, args = {}) => {
              if (command === 'shortcut_status') return true;
              if (command === 'get_data') return {
                tasks: [], notes: [], world_clocks: [], calendar_events: [],
                timer:{total_ms:1500000,remaining_ms:1500000,ends_at_ms:null},
                stopwatch:{elapsed_ms:0,started_at_ms:null,laps:[]},
              };
              if (command === 'bluetooth_devices') {
                bluetoothMock.calls++;
                return bluetoothMock.snapshot;
              }
              if (command === 'open_control_settings') bluetoothMock.settings.push(args);
              return null;
            }}
          };
        """)
        page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
        page.evaluate('window.poniTestShortcut()')
        page.locator('[data-page="bluetooth"]').click()
        panel = page.locator('#page-bluetooth')
        expect(panel.get_by_text('1 connected · 2 saved')).to_be_visible()
        headphones = panel.get_by_role('listitem').filter(has_text='<b>Headphones</b>')
        expect(headphones.get_by_text('<b>Headphones</b>', exact=True)).to_be_visible()
        expect(headphones.get_by_text('Connected', exact=True)).to_be_visible()
        mouse = panel.get_by_role('listitem').filter(has_text='Mouse')
        expect(mouse.get_by_text('Peripheral · Remembered')).to_be_visible()
        expect(mouse.get_by_text('Not connected', exact=True)).to_be_visible()
        panel.get_by_role('button', name='Bluetooth settings').click()
        assert page.evaluate('bluetoothMock.settings') == [{'page': 'bluetooth'}]

        page.evaluate('bluetoothMock.snapshot.adapter_present = false; bluetoothMock.snapshot.devices = []')
        panel.get_by_role('button', name='Refresh', exact=True).click()
        expect(panel.get_by_role('status')).to_contain_text('could not find an active Bluetooth adapter')
        expect(panel.get_by_role('listitem')).to_have_count(0)

        page.evaluate('bluetoothMock.snapshot.supported = false')
        panel.get_by_role('button', name='Refresh', exact=True).click()
        expect(panel.get_by_role('status')).to_contain_text('available on Windows')
        expect(panel.get_by_role('button', name='Bluetooth settings')).to_be_disabled()
        browser.close()
    server.shutdown()

print('PASS: Bluetooth connected and remembered devices, refresh, unavailable states, and Windows Settings')

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
        page = browser.new_page(viewport={'width': 680, 'height': 230}, timezone_id='UTC')
        page.add_init_script("""
          window.__TAURI__ = { event: { listen: async (_, handler) => { window.poniTestShortcut = handler; } },
            core: { invoke: async (command, args = {}) => {
              if (command === 'shortcut_status') return true;
              if (command === 'get_data') return {
                tasks: [], notes: [], world_clocks: [], calendar_events: [],
                timer: {total_ms:1500000, remaining_ms:1500000, ends_at_ms:null},
                stopwatch:{elapsed_ms:0, started_at_ms:null, laps:[]}
              };
              if (!command.startsWith('pomodoro_')) return null;
              const timer = JSON.parse(localStorage.getItem('test-pomodoro')) || {
                phase:'focus', total_ms:1500000, remaining_ms:1500000, ends_at_ms:null,
                settings:{focus_minutes:25, short_minutes:5, long_minutes:15, cycle_length:4,
                  auto_break:false, auto_focus:false}, cycle:0, completed:[]
              };
              const now = Date.now();
              if (command === 'pomodoro_settings') {
                Object.assign(timer.settings, args.settings);
                timer.total_ms = timer.remaining_ms = timer.settings.focus_minutes * 60000;
              }
              if (command === 'pomodoro_action' && args.action === 'toggle') {
                if (timer.ends_at_ms == null) timer.ends_at_ms = now + timer.remaining_ms;
                else {
                  timer.remaining_ms = Math.max(0, timer.ends_at_ms - now);
                  timer.ends_at_ms = null;
                }
              }
              if (command === 'pomodoro_state' && timer.ends_at_ms != null && timer.ends_at_ms <= now) {
                timer.completed.push({at_ms:timer.ends_at_ms, focus_ms:timer.total_ms});
                timer.phase = 'short_break';
                timer.cycle = 1;
                timer.total_ms = timer.remaining_ms = timer.settings.short_minutes * 60000;
                timer.ends_at_ms = null;
              }
              localStorage.setItem('test-pomodoro', JSON.stringify(timer));
              return timer;
            } }
          };
        """)
        page.clock.install(time=1_800_000_000_000)
        page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
        rendered = page.evaluate("""
          async () => {
            const { build, kinds } = window.poniFocusSound;
            const result = [];
            for (const kind of kinds) {
              const context = new OfflineAudioContext(2, 44100, 44100);
              build(context, context.destination, kind, 173);
              const buffer = await context.startRendering();
              const samples = buffer.getChannelData(0);
              const audible = samples.every(Number.isFinite) && samples.some(sample => Math.abs(sample) > 0.0001);
              result.push([kind, audible]);
            }
            return result;
          }
        """)
        assert dict(rendered) == dict.fromkeys(
            ('white', 'pink', 'brown', 'rain', 'waves', 'wind', 'fire', 'cafe'), True
        ), rendered
        page.evaluate('window.poniTestShortcut()')
        page.locator('[data-page="pomodoro"]').click()
        expect(page.locator('[data-pomo-time]')).to_have_text('25:00')
        page.locator('[data-pomo-options]').click()
        page.locator('input[name="focus_minutes"]').fill('5')
        page.locator('input[name="short_minutes"]').fill('1')
        page.get_by_role('button', name='Save settings').click()
        expect(page.locator('[data-pomo-time]')).to_have_text('05:00')
        page.locator('[data-pomo-options]').click()
        toggle = page.locator('[data-pomo-toggle]')
        toggle.click()
        expect(toggle).to_have_text('Pause')
        page.clock.fast_forward(59_990)
        toggle.click()
        expect(toggle).to_have_text('Resume')
        expect(page.locator('[data-pomo-time]')).to_have_text('04:00')
        page.reload()
        page.evaluate('window.poniTestShortcut()')
        page.locator('[data-page="pomodoro"]').click()
        expect(toggle).to_have_text('Resume')
        toggle.click()
        expect(toggle).to_have_text('Pause')
        page.clock.fast_forward(241_000)
        expect(page.locator('[data-pomo-phase]')).to_have_text('Short break')
        expect(page.locator('[data-pomo-time]')).to_have_text('01:00')
        expect(page.locator('[data-pomo-today]')).to_contain_text('1 sessions')
        browser.close()
    server.shutdown()

print('PASS: Pomodoro settings, countdown, pause, restart, and phase transition')

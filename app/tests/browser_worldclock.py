from pathlib import Path
from shutil import which
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(root / 'src')))
Thread(target=server.serve_forever, daemon=True).start()
with sync_playwright() as pw:
    executable = which('chromium') or which('chromium-browser') or which('google-chrome')
    browser = pw.chromium.launch(**({'executable_path': executable} if executable else {}), headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    context = browser.new_context(viewport={'width': 760, 'height': 470}, timezone_id='UTC', locale='en-US')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
    page.locator('[data-tab="worldclock"]').click()
    page.locator('#worldclock-name').fill('New York')
    page.locator('#worldclock-zone').fill('America/New_York')
    page.locator('#worldclock-add button').click()
    expect(page.locator('.worldclock-row')).to_have_count(2)
    page.locator('#worldclock-time').fill('2026-07-01T12:00')
    assert '8:00 AM' in page.locator('.worldclock-row').nth(1).inner_text()
    page.locator('#worldclock-time').fill('2026-01-01T12:00')
    assert '7:00 AM' in page.locator('.worldclock-row').nth(1).inner_text()
    page.locator('#worldclock-name').fill('Another')
    page.locator('#worldclock-zone').fill('America/New_York')
    page.locator('#worldclock-add button').click()
    expect(page.locator('#worldclock-message')).to_contain_text('already')
    page.reload()
    page.locator('[data-tab="worldclock"]').click()
    expect(page.locator('.worldclock-row')).to_have_count(2)
    expect(page.get_by_role('button', name='Remove New York')).to_be_visible()
    page.get_by_role('button', name='Remove New York').click()
    expect(page.locator('.worldclock-row')).to_have_count(1)
    page.reload()
    page.locator('[data-tab="worldclock"]').click()
    expect(page.locator('.worldclock-row')).to_have_count(1)
    assert not errors, errors
    browser.close()
server.shutdown()
print('PASS: world clock timezone, DST, duplicate, save and remove')

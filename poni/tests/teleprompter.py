"""Exercise script editing, persistence and timed reading in Chromium."""

import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from shutil import which
from threading import Thread

from playwright.sync_api import expect, sync_playwright


def main():
    source = Path(__file__).resolve().parents[1] / 'src'
    handler = partial(SimpleHTTPRequestHandler, directory=str(source))
    with ThreadingHTTPServer(('127.0.0.1', 0), handler) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        with sync_playwright() as playwright:
            executable = os.environ.get('CHROMIUM_PATH') or which('chromium')
            browser = playwright.chromium.launch(executable_path=executable, args=['--no-sandbox'])
            page = browser.new_page(viewport={'width': 660, 'height': 140})
            page.route('**/teleprompter-test.html', lambda route: route.fulfill(
                content_type='text/html',
                body='<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/teleprompter.css"><main><section id="reader"></section></main>',
            ))
            page.add_init_script("""
                window.__TAURI__ = {core: {invoke: async (command, args) => {
                  if (command === 'get_teleprompter') return JSON.parse(localStorage.getItem('tele') || '{"scripts":[],"selected":null,"speed":10,"size":22,"countdown":true}');
                  if (command === 'save_teleprompter') localStorage.setItem('tele', JSON.stringify(args.settings));
                }}};
            """)

            def open_reader():
                page.goto(f'http://127.0.0.1:{server.server_port}/teleprompter-test.html')
                page.add_script_tag(url='/teleprompter.js')
                page.evaluate("""() => {
                  const module = window.poniModules.teleprompter;
                  module.mount(document.querySelector('#reader'));
                  module.show();
                }""")

            open_reader()
            page.get_by_role('button', name='New script').click()
            page.get_by_role('textbox', name='Script name').fill('Camera intro')
            page.get_by_role('textbox', name='Script text').fill('Hello world [Smile]\n[Pause]\nWelcome back')
            expect(page.locator('.tele-estimate')).to_contain_text('4 words')
            page.get_by_label('3 s countdown').uncheck()
            page.get_by_role('button', name='Start').click()
            expect(page.locator('.tele-current')).to_contain_text('Hello world')
            expect(page.locator('.tele-cue').first).to_have_text('[Smile]')
            page.get_by_role('button', name='Pause').click()
            expect(page.get_by_role('button', name='Play', exact=True)).to_be_enabled()
            page.get_by_role('button', name='Play', exact=True).click()
            expect(page.locator('.tele-current')).to_have_text('[Pause]')
            expect(page.locator('.tele-reader-status')).to_have_text('Finished')
            page.get_by_role('button', name='Restart').click()
            expect(page.locator('.tele-current')).to_contain_text('Hello world')
            page.get_by_role('button', name='Edit script').click()
            open_reader()
            expect(page.get_by_role('textbox', name='Script name')).to_have_value('Camera intro')
            expect(page.get_by_role('textbox', name='Script text')).to_have_value('Hello world [Smile]\n[Pause]\nWelcome back')
            expect(page.get_by_label('3 s countdown')).not_to_be_checked()
            page.locator('.tele-file').set_input_files({
                'name': 'Meeting.txt',
                'mimeType': 'text/plain',
                'buffer': b'Agenda',
            })
            expect(page.get_by_role('textbox', name='Script name')).to_have_value('Meeting')
            page.get_by_role('combobox', name='Script', exact=True).select_option(label='Camera intro')
            expect(page.get_by_role('textbox', name='Script text')).to_have_value('Hello world [Smile]\n[Pause]\nWelcome back')
            browser.close()
        server.shutdown()


if __name__ == '__main__':
    main()

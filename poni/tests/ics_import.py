from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from shutil import which
from threading import Thread

from playwright.sync_api import expect, sync_playwright


class Fixture(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/fixture":
            return super().do_GET()
        body = b'<script src="/ics-import.js" defer></script><section id="calendar-import"></section>'
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


root = Path(__file__).resolve().parents[1]
handler = partial(Fixture, directory=str(root / "src"))
with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
    Thread(target=server.serve_forever, daemon=True).start()
    with sync_playwright() as pw:
        executable = which("chromium") or which("chromium-browser") or which("google-chrome")
        options = {"executable_path": executable} if executable else {}
        browser = pw.chromium.launch(**options, headless=True, args=["--no-sandbox"])
        page = browser.new_page()
        page.goto(f"http://127.0.0.1:{server.server_port}/fixture")
        page.evaluate(
            """() => {
              window.importedCalendars = [];
              window.poniIcsImport.mount(document.querySelector('#calendar-import'), async text => {
                window.importedCalendars.push(text);
                if (text.includes('MALFORMED')) throw 'Invalid calendar structure';
                return {imported: 1, duplicates: 1, skipped: 1, reasons: {'All-day events': 1}};
              });
            }"""
        )
        picker = page.get_by_label("Import a local calendar (.ics, up to 2 MB)")
        status = page.get_by_role("status")
        picker.set_input_files({"name": "event.html", "mimeType": "text/html", "buffer": b"bad"})
        expect(status).to_have_text("Choose a file ending in .ics.")
        picker.set_input_files({"name": "large.ics", "mimeType": "text/calendar", "buffer": b"x" * (2 * 1024 * 1024 + 1)})
        expect(status).to_have_text("Choose an .ics file of 2 MB or less.")
        picker.set_input_files({"name": "invalid.ics", "mimeType": "text/calendar", "buffer": b"\xff"})
        expect(status).to_have_text("This file could not be read as a UTF-8 calendar.")
        assert page.evaluate("window.importedCalendars.length") == 0

        valid = b"BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Meeting\r\nEND:VEVENT\r\nEND:VCALENDAR"
        picker.set_input_files({"name": "events.ICS", "mimeType": "text/calendar", "buffer": valid})
        expect(status).to_have_text("Imported 1 · 1 already in Calendar · 1 skipped. All-day events: 1")
        assert page.evaluate("window.importedCalendars[0]") == valid.decode()
        picker.set_input_files({"name": "invalid.ics", "mimeType": "text/calendar", "buffer": b"MALFORMED"})
        expect(status).to_have_text("Invalid calendar structure")
        expect(picker).to_be_enabled()
        browser.close()
    server.shutdown()

print("PASS: local calendar file validation, import summary, and backend error")

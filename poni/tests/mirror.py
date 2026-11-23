from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from shutil import which
from threading import Thread

from playwright.sync_api import expect, sync_playwright


class MirrorFixture(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/fixture':
            return super().do_GET()
        body = (b'<link rel="stylesheet" href="/mirror.css"><script src="/mirror.js" defer></script>'
                b'<section id="page-home" class="home"><div id="mirror"></div></section>')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Security-Policy',
                         "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' https:")
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def verify_mirror(page):
    page.evaluate('''() => {
      window.requests = [];
      window.tracks = [];
      navigator.mediaDevices.getUserMedia = constraints => new Promise((resolve, reject) => {
        requests.push({constraints, resolve, reject});
      });
      window.allowCamera = requestIndex => {
        // A real in-browser MediaStream with no device permissions or network access.
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const context = canvas.getContext('2d');
        const stream = canvas.captureStream(25);
        const [track] = stream.getVideoTracks();
        tracks.push(track);
        const timer = setInterval(() => {
          if (track.readyState === 'ended') {
            clearInterval(timer);
            return;
          }
          context.fillStyle = 'orange';
          context.fillRect(0, 0, 32, 32);
        }, 30);
        requests[requestIndex].resolve(stream);
      };
      window.poniMirror.mount(document.querySelector('#mirror'));
    }''')
    tile = page.get_by_role('button', name='Mirror', exact=True)
    assert page.evaluate('requests.length') == 0
    tile.click()
    assert page.evaluate('requests[0].constraints') == {
        'video': {'width': 320, 'height': 320, 'facingMode': 'user'}, 'audio': False,
    }
    page.evaluate('allowCamera(0)')
    expect(tile).to_have_attribute('aria-pressed', 'true')
    page.wait_for_function("document.querySelector('#mirror video').videoWidth === 32")
    tile.click()
    assert page.evaluate("tracks[0].readyState === 'ended' && document.querySelector('#mirror video').srcObject === null")

    tile.click()
    page.evaluate('window.poniMirror.hide()')
    page.evaluate('allowCamera(1)')
    page.wait_for_function("tracks[1].readyState === 'ended'")
    expect(tile).to_have_attribute('aria-pressed', 'false')

    tile.click()
    page.evaluate("requests[2].reject(new DOMException('Not permitted', 'NotAllowedError'))")
    expect(tile.get_by_role('status')).to_have_text('Camera access denied')
    tile.click()
    page.evaluate('allowCamera(3)')
    expect(tile).to_have_attribute('aria-pressed', 'true')
    page.evaluate("window.poniMirror.configure({enabled:false, shape:'circle'})")
    expect(tile).not_to_be_visible()
    page.wait_for_function("tracks[2].readyState === 'ended'")
    page.evaluate("window.poniMirror.configure({enabled:true})")
    expect(tile).to_be_visible()
    expect(tile).to_have_class('mirror-tile mirror-circle')
    expect(tile).to_have_attribute('aria-pressed', 'false')


if __name__ == '__main__':
    src = Path(__file__).resolve().parents[1] / 'src'
    handler = partial(MirrorFixture, directory=str(src))
    with ThreadingHTTPServer(('127.0.0.1', 0), handler) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with sync_playwright() as playwright:
                chromium = which('chromium') or which('google-chrome')
                browser = playwright.chromium.launch(executable_path=chromium, args=['--no-sandbox'])
                page = browser.new_page()
                page.goto(f'http://127.0.0.1:{server.server_port}/fixture')
                verify_mirror(page)
                browser.close()
        finally:
            server.shutdown()

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from shutil import which
from threading import Thread

from playwright.sync_api import expect, sync_playwright

src = Path(__file__).resolve().parents[1] / "src"
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(src)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as pw:
        chromium = which("chromium") or which("chromium-browser") or which("google-chrome")
        options = {"executable_path": chromium} if chromium else {}
        browser = pw.chromium.launch(**options, headless=True, args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 680, "height": 200})
        page.route("**/github-test", lambda route: route.fulfill(status=200, content_type="text/html", body="""
            <!doctype html>
            <link rel="stylesheet" href="/style.css">
            <link rel="stylesheet" href="/github.css">
            <div id="github"></div>
            <script src="/github.js"></script>
            <script>
              const module = window.poniModules.github;
              module.mount(document.querySelector('#github'));
              module.show();
            </script>
        """))
        page.add_init_script("""
            window.__TAURI__ = { core: { invoke: async (command, args) => {
              if (command === 'github_login') return localStorage.getItem('login') || null;
              if (command === 'save_github_login') {
                localStorage.setItem('login', args.login);
                return args.login || null;
              }
              if (command === 'open_github_pull_request') {
                window.openedPullRequest = args;
                return;
              }
              if (command === 'refresh_github_inbox') {
                const record = {owner:'octo', repo:'sample', number:17, draft:true,
                  comments:2, author:'octocat', updated_at:'2026-11-01T15:00:00Z'};
                const result = title => ({total:1, items:[{...record, title}]});
                return {review: window.rejectReviews
                          ? {total:0, items:[], error:'GitHub search unavailable'}
                          : result('Review <example>'),
                        mine: result('Fix example')};
              }
              throw new Error('Unexpected command: ' + command);
            } } };
        """)
        page.goto(f"http://127.0.0.1:{server.server_port}/github-test")
        expect(page.locator("#github-status")).to_contain_text("Enter a GitHub username")
        page.get_by_label("GitHub username").fill("octocat")
        page.get_by_role("button", name="Save").click()
        expect(page.get_by_role("heading", name="Review requested (1)")).to_be_visible()
        expect(page.get_by_role("heading", name="Open pull requests by octocat (1)")).to_be_visible()
        page.get_by_role("button", name="Review <example>").click()
        assert page.evaluate("openedPullRequest") == {"owner": "octo", "repo": "sample", "number": 17}

        page.reload()
        expect(page.get_by_label("GitHub username")).to_have_value("octocat")
        expect(page.get_by_role("button", name="Fix example")).to_be_visible()
        page.evaluate("window.rejectReviews = true")
        page.get_by_role("button", name="Refresh").click()
        expect(page.get_by_text("GitHub search unavailable")).to_be_visible()
        expect(page.get_by_role("button", name="Fix example")).to_be_visible()

        page.get_by_label("GitHub username").fill("")
        page.get_by_role("button", name="Save").click()
        expect(page.locator("#github-status")).to_contain_text("Enter a GitHub username")
        expect(page.get_by_role("button", name="Fix example")).to_have_count(0)
        browser.close()
finally:
    server.shutdown()

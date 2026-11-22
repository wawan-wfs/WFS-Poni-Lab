from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from shutil import which
from threading import Thread

from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(root / "src")))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as pw:
        chromium = which("chromium") or which("chromium-browser") or which("google-chrome")
        options = {"executable_path": chromium} if chromium else {}
        browser = pw.chromium.launch(**options, headless=True, args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 680, "height": 200})
        page.route("**/bookmark-test", lambda route: route.fulfill(status=200, content_type="text/html", body="""
            <!doctype html>
            <link rel="stylesheet" href="/style.css">
            <link rel="stylesheet" href="/bookmarks.css">
            <div id="bookmarks"></div>
            <script src="/bookmarks.js"></script>
            <script>
              const bookmarks = window.poniModules.bookmarks;
              bookmarks.mount(document.querySelector('#bookmarks'));
              bookmarks.show();
            </script>
        """))
        page.add_init_script("""
            window.__TAURI__ = { core: { invoke: async (command, args) => {
              const data = JSON.parse(localStorage.getItem('bookmarks') || '{"items":[],"categories":[]}');
              if (command === 'save_bookmark') {
                const url = new URL(/^https?:/.test(args.url) ? args.url : 'https://' + args.url);
                const bookmark = { id: args.id || crypto.randomUUID(), url: url.href,
                  title: args.title || url.hostname, category: args.category || null };
                if (!data.categories.includes(bookmark.category) && bookmark.category) data.categories.push(bookmark.category);
                if (args.id) data.items = data.items.map(item => item.id === args.id ? bookmark : item);
                else data.items.unshift(bookmark);
              } else if (command === 'remove_bookmark') {
                data.items = data.items.filter(item => item.id !== args.id);
              } else if (command === 'rename_bookmark_category') {
                if (args.previous) {
                  data.categories = data.categories.map(name => name === args.previous ? args.name : name);
                  data.items.forEach(item => { if (item.category === args.previous) item.category = args.name; });
                } else data.categories.push(args.name);
              } else if (command === 'remove_bookmark_category') {
                data.categories = data.categories.filter(name => name !== args.name);
                data.items.forEach(item => { if (item.category === args.name) item.category = null; });
              } else if (command === 'open_bookmark') {
                window.openedId = args.id;
                return;
              } else if (command !== 'list_bookmarks') throw new Error('Unexpected command: ' + command);
              localStorage.setItem('bookmarks', JSON.stringify(data));
              return data;
            } } };
        """)
        page.goto(f"http://127.0.0.1:{server.server_port}/bookmark-test")
        expect(page.locator("#bookmarks-list")).to_have_text("No bookmarks yet")
        page.get_by_label("Bookmark link").fill("example.com/inbox")
        page.get_by_label("Bookmark title").fill("Inbox")
        page.get_by_label("Bookmark category").fill("Work")
        page.get_by_role("button", name="Save", exact=True).click()
        expect(page.get_by_role("button", name="Open Inbox")).to_be_visible()
        expect(page.get_by_label("Filter bookmarks by category")).to_have_value("Work")
        page.get_by_role("button", name="Open Inbox").click()
        assert page.evaluate("openedId === JSON.parse(localStorage.getItem('bookmarks')).items[0].id")

        page.get_by_role("button", name="Rename category").click()
        page.get_by_label("Category name").fill("Projects")
        page.get_by_role("button", name="Save category").click()
        expect(page.get_by_label("Filter bookmarks by category")).to_have_value("Projects")
        page.get_by_role("button", name="Edit Inbox").click()
        page.get_by_label("Bookmark title").fill("New Inbox")
        page.get_by_role("button", name="Update").click()
        page.reload()
        expect(page.get_by_role("button", name="Open New Inbox")).to_be_visible()
        page.get_by_label("Search bookmarks").fill("missing")
        expect(page.locator("#bookmarks-list")).to_have_text("No matching bookmarks")
        page.get_by_label("Search bookmarks").fill("")
        page.get_by_label("Filter bookmarks by category").select_option("Projects")
        page.once("dialog", lambda dialog: dialog.accept())
        page.get_by_role("button", name="Delete category").click()
        page.get_by_label("Filter bookmarks by category").select_option(label="Unsorted")
        expect(page.get_by_role("button", name="Open New Inbox")).to_be_visible()
        page.once("dialog", lambda dialog: dialog.accept())
        page.get_by_role("button", name="Delete New Inbox").click()
        expect(page.locator("#bookmarks-list")).to_have_text("No bookmarks yet")
        browser.close()
finally:
    server.shutdown()

from pathlib import Path
from shutil import which

from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[1]
with sync_playwright() as playwright:
    executable = which("chromium") or which("chromium-browser") or which("google-chrome")
    options = {"executable_path": executable} if executable else {}
    browser = playwright.chromium.launch(**options, headless=True, args=["--no-sandbox"])
    page = browser.new_page(timezone_id="UTC")
    page.clock.install()
    page.set_content('<section id="page-health"></section>')
    page.evaluate(
        """() => {
            let totals = {water: 0, breaks: 0, mindful: 0};
            const handlers = {
              water_add: () => totals.water++,
              water_remove: () => totals.water--,
              stretch: () => totals.breaks++,
              breathing: () => totals.mindful++,
            };
            window.__TAURI__ = {core: {
              invoke: async (command, {day, action} = {}) => {
                if (command === 'health_eye_break') return false;
                if (!Number.isInteger(day)) throw Error('Expected local date');
                if (command === 'health_record') handlers[action]();
                return {today: {...totals}, last_break_ms: null, streak: 0};
              }
            }};
        }"""
    )
    page.add_script_tag(path=str(root / "src" / "health.js"))
    page.evaluate(
        """() => {
            const health = window.poniModules.health;
            health.mount(document.querySelector('#page-health'));
            return health.show();
        }"""
    )
    water = page.locator('[data-health-measure="water"] strong')
    expect(page.get_by_role("button", name="Remove glass of water")).to_be_disabled()
    page.get_by_role("button", name="Log glass of water").click()
    expect(water).to_have_text("1 / 8")
    page.get_by_role("button", name="Remove glass of water").click()
    expect(water).to_have_text("0 / 8")

    page.get_by_role("button", name="Breathing").click()
    expect(page.locator(".health-guide-title")).to_have_text("Breathe in")
    page.clock.fast_forward(60_500)
    expect(page.locator('[data-health-measure="mindful"] strong')).to_have_text("1 / 5")

    page.get_by_role("button", name="Eye break").click()
    expect(page.locator(".health-instruction")).to_contain_text("20 feet")
    page.clock.fast_forward(20_500)
    expect(page.get_by_role("status")).to_have_text("Eye break complete.")

    page.get_by_role("button", name="Movement break").click()
    expect(page.locator(".health-guide-title")).to_have_text("Neck turns")
    page.clock.fast_forward(20_500)
    expect(page.locator(".health-guide-title")).to_have_text("Shoulder shrugs")
    page.get_by_role("button", name="End").click()
    page.clock.fast_forward(121_000)
    breaks = page.locator('[data-health-measure="breaks"] strong')
    expect(breaks).to_have_text("0 / 6")
    page.get_by_role("button", name="Movement break").click()
    page.clock.fast_forward(121_000)
    expect(breaks).to_have_text("1 / 6")
    page.evaluate("window.poniModules.health.configure({break_goal: 9, eye_duration: 35})")
    expect(breaks).to_have_text("1 / 9")
    page.get_by_role("button", name="Eye break").click()
    page.clock.fast_forward(20_000)
    expect(page.locator(".health-countdown")).to_have_text("15s")
    page.clock.fast_forward(15_500)
    expect(page.get_by_role("status")).to_have_text("Eye break complete.")
    browser.close()

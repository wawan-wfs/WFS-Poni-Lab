"""Verify actual browser task controls. Native toast protection is tested in Rust."""
from datetime import datetime, timezone
from pathlib import Path
from shutil import which

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "test-results"
EVIDENCE.mkdir(exist_ok=True)
FIXED = datetime(2027, 6, 19, 9, 0, tzinfo=timezone.utc)
DUE = int(FIXED.timestamp() * 1000)

with sync_playwright() as pw:
    executable = which("chromium") or which("chromium-browser") or which("google-chrome")
    browser = pw.chromium.launch(
        **({"executable_path": executable} if executable else {}),
        headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"],
    )
    page = browser.new_page(viewport={"width": 560, "height": 420}, timezone_id="UTC")
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.clock.set_fixed_time(FIXED)
    page.goto((ROOT / "src" / "index.html").as_uri())
    page.get_by_role("button", name="Tasks", exact=True).click()
    page.get_by_role("textbox", name="New task", exact=True).fill("Review queue")
    page.locator("#todo-due").fill("2027-06-19T09:00")
    page.locator("#todo-recurrence").select_option("daily")
    page.get_by_role("button", name="Add task").click()
    snooze = page.get_by_role("combobox", name="Snooze reminder for Review queue")
    snooze.select_option("5")
    expect(page.locator("#toast")).to_contain_text("Reminder snoozed")
    args = page.evaluate("""() => {
      const t = data.todos[0];
      return {id:t.id, expectedDueAtMs:t.due_at_ms, expectedToken:t.change_token};
    }""")
    complete = page.get_by_role("button", name="Complete and reschedule: Review queue")
    complete.click()
    expect(complete).to_be_focused()
    assert page.evaluate("data.todos[0].due_at_ms") == DUE + 86_400_000
    assert page.evaluate("""async args => {
      try { await invoke('toggle_todo', args); return false; } catch (_) { return true; }
    }""", args)
    page.reload()
    page.get_by_role("button", name="Tasks", exact=True).click()
    history = page.get_by_text("Recent task completions", exact=True)
    history.click()
    undo = page.get_by_role("button", name="Undo completion: Review queue", exact=False)
    expect(undo).to_be_visible()
    page.screenshot(path=str(EVIDENCE / "browser-phase43-task-undo.png"))
    undo.focus()
    page.keyboard.press("Enter")
    expect(history).to_be_focused()
    expect(undo).to_have_count(0)
    assert page.evaluate("data.todos[0].due_at_ms") == DUE
    assert page.evaluate("data.todos[0].snoozed_until_ms") == DUE + 300_000

    # Redo by completing the restored occurrence. Non-undo edits make the
    # next completion entry informational instead of changing edited data.
    complete.click()
    expect(undo).to_be_visible()
    page.get_by_role("button", name="Edit task: Review queue").click()
    page.locator("#todo-edit-title").fill("Review edited queue")
    page.get_by_role("button", name="Save task").click()
    expect(undo).to_have_count(0)
    expect(page.locator("#todo-completion-history")).to_contain_text("Review queue")
    backup_id = page.evaluate("async () => (await invoke('create_backup')).id")
    retention = page.get_by_role("combobox", name="Keep completion history")
    retention.select_option("0")  # dismiss the destructive confirmation
    expect(retention).to_have_value("200")
    page.once("dialog", lambda dialog: dialog.accept())
    retention.select_option("0")
    expect(page.locator("#todo-completion-empty")).to_have_text("Completion history and undo are off.")
    assert page.evaluate("data.task_completions.length") == 0
    await_restore = "async id => await invoke('restore_backup', {id})"
    restored = page.evaluate(await_restore, backup_id)
    assert restored["settings"]["task_history_limit"] == 0
    assert restored["task_completions"] == []
    page.reload()
    page.get_by_role("button", name="Tasks", exact=True).click()
    page.get_by_text("Recent task completions", exact=True).click()
    expect(retention).to_have_value("0")
    retention.select_option("25")
    page.get_by_role("button", name="Complete and reschedule: Review edited queue").click()
    expect(page.get_by_role("button", name="Undo completion: Review edited queue", exact=False)).to_be_visible()
    assert page.evaluate("data.task_completions.length") == 1
    assert not errors, errors
    browser.close()
print("PASS: task occurrence undo, redo, stale submits, keyboard focus, retention and backup restore")

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from shutil import which
from threading import Thread
from playwright.sync_api import expect, sync_playwright
from currency import test_currency
from chat import test_chat
from dashboard import test_dashboard
from translate import test_translate
from next_modules import test_next_modules
from notes import test_notes
from worldclock import test_worldclock

root = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(root / 'src')))
Thread(target=server.serve_forever, daemon=True).start()
with sync_playwright() as pw:
    executable = which('chromium') or which('chromium-browser') or which('google-chrome')
    browser = pw.chromium.launch(**({'executable_path': executable} if executable else {}), headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 680, 'height': 200}, timezone_id='UTC', locale='en-US')
    page.add_init_script('''
      window.__TAURI__ = { event: {listen: async (name, listener) => { window.poniTestShortcut = listener; }}, core: { invoke: async (command, args = {}) => {
        const data = JSON.parse(localStorage.getItem('test-data') || '{"tasks":[],"notes":[],"timer":{"total_ms":1500000,"remaining_ms":1500000,"ends_at_ms":null},"stopwatch":{"elapsed_ms":0,"started_at_ms":null,"laps":[]},"world_clocks":[]}');
        if (command === 'current_media') return {title: 'Test track', artist: 'Test artist', playing: true, position_ms: 30000, duration_ms: 60000};
        if (command === 'system_snapshot') return {cpu_percent: 32.5, memory_used: 2147483648, memory_total: 8589934592};
        if (command === 'shortcut_status') return true;
        if (command === 'set_panel_open' && typeof args.focus !== 'boolean') throw new Error('focus is required');
        if (command === 'search_weather_city') return [{name:'Jakarta', admin1:'Jakarta', country:'Indonesia', latitude:-6.2, longitude:106.8}];
        if (command === 'weather_forecast') return {current:{temperature_2m:30, relative_humidity_2m:70, weather_code:2, wind_speed_10m:10}, daily:{time:['2026-11-22'], temperature_2m_max:[32], temperature_2m_min:[25], weather_code:[2]}};
        if (command === 'set_weather_location') data.weather_location = args.location;
        if (command === 'set_world_clocks') data.world_clocks = args.places;
        if (command === 'set_dashboard_widgets') data.dashboard_widgets = args.widgets;
        if (command === 'pomodoro_state') return {phase:'focus', total_ms:1500000, remaining_ms:1500000, ends_at_ms:null};
        if (command === 'set_hijri_offset') data.hijri_offset = args.offset;
        if (command === 'set_day_schedule') { data.wake_minute = args.wake; data.bed_minute = args.bed; }
        data.calendar_events ||= [];
        if (command === 'save_calendar_event') { const e = {id:args.id || crypto.randomUUID(), title:args.title.trim(), start_ms:args.startMs, duration_minutes:args.durationMinutes, location:args.location, repeat:args.repeat}; const i = data.calendar_events.findIndex(item => item.id === args.id); if (i < 0) data.calendar_events.push(e); else data.calendar_events[i] = e; }
        if (command === 'remove_calendar_event') data.calendar_events = data.calendar_events.filter(e => e.id !== args.id);
        if (command === 'media_control') localStorage.setItem('last-media-action', args.action);
        data.trashed_tasks ||= [];
        if (command === 'add_task') data.tasks.push({id: crypto.randomUUID(), text: args.text, done: false, description:'', due_at_ms:args.dueAtMs, repeat:args.repeat, late_minutes:args.lateMinutes, steps:[]});
        if (command === 'update_task') { const t = data.tasks.find(t => t.id === args.id); t.text = args.text; t.description = args.description; t.due_at_ms = args.dueAtMs; t.repeat = args.repeat; t.late_minutes = args.lateMinutes; }
        if (command === 'toggle_task') {
          const task = data.tasks.find(t => t.id === args.id);
          task.done = !task.done;
          task.done_at_ms = task.done ? Date.now() : null;
          if (task.repeat && task.done) {
            data.tasks.unshift({...task, id:crypto.randomUUID(), done:false, done_at_ms:null, steps:task.steps.map(step => ({...step, done:false}))});
            task.repeat = null;
            task.repeated = true;
          }
        }
        if (command === 'update_task_step') {
          const task = data.tasks.find(t => t.id === args.taskId);
          if (args.action === 'add') task.steps.push({id:crypto.randomUUID(), text:args.text, done:false});
          if (args.action === 'toggle') { const step = task.steps.find(s => s.id === args.stepId); step.done = !step.done; }
          if (args.action === 'remove') task.steps = task.steps.filter(s => s.id !== args.stepId);
        }
        if (command === 'remove_task') {
          const [task] = data.tasks.splice(data.tasks.findIndex(t => t.id === args.id), 1);
          data.trashed_tasks.push({task, deleted_at_ms:Date.now()});
        }
        if (command === 'change_task_trash') {
          if (args.action === 'restore') {
            const [entry] = data.trashed_tasks.splice(data.trashed_tasks.findIndex(t => t.task.id === args.id), 1);
            data.tasks.push(entry.task);
          }
          if (args.action === 'delete') data.trashed_tasks = data.trashed_tasks.filter(t => t.task.id !== args.id);
        }
        if (command === 'snooze_task') {
          const task = data.tasks.find(t => t.id === args.id);
          if (task.due_at_ms !== args.dueAtMs || task.done) throw new Error('Stale deadline');
          task.due_at_ms = Date.now() + 600000;
          task.notified_due_at_ms = null;
        }
        if (command === 'note_choices') return JSON.parse(localStorage.getItem('notes-parity-fixture') || '[]')
          .map(note => ({id:note.id, title:note.text.split('\\n')[0]}));
        if (command === 'set_task_note') data.tasks.find(t => t.id === args.id).note_id = args.noteId;
        if (command === 'timer_action') {
          if (args.action === 'start') { if (args.minutes) data.timer.total_ms = data.timer.remaining_ms = args.minutes * 60000; data.timer.ends_at_ms = Date.now() + data.timer.remaining_ms; }
          if (args.action === 'pause') { data.timer.remaining_ms = Math.max(0, data.timer.ends_at_ms - Date.now()); data.timer.ends_at_ms = null; }
          if (args.action === 'reset') { data.timer.remaining_ms = data.timer.total_ms; data.timer.ends_at_ms = null; }
        }
        if (command === 'stopwatch_action') {
          const sw = data.stopwatch;
          if (args.action === 'start') sw.started_at_ms = Date.now();
          if (args.action === 'pause') { sw.elapsed_ms += Date.now() - sw.started_at_ms; sw.started_at_ms = null; }
          if (args.action === 'lap' && sw.started_at_ms !== null) sw.laps.push(sw.elapsed_ms + Date.now() - sw.started_at_ms);
          if (args.action === 'reset') data.stopwatch = {elapsed_ms: 0, started_at_ms: null, laps: []};
        }
        localStorage.setItem('test-data', JSON.stringify(data)); return data;
      } } };
    ''')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
    page.evaluate('window.poniTestShortcut()')
    expect(page.locator('#open')).to_be_visible()
    page.keyboard.press('ArrowRight')
    expect(page.locator('#page-tasks')).to_be_visible()
    page.keyboard.press('Escape')
    expect(page.locator('#open')).to_be_hidden()
    page.evaluate('window.poniTestShortcut()')
    expect(page.locator('#open')).to_be_visible()
    page.evaluate('window.poniTestShortcut()')
    expect(page.locator('#open')).to_be_hidden()
    page.locator('#closed').dispatch_event('pointerenter')
    page.locator('[data-page="home"]').click()
    expect(page.locator('#status')).to_be_empty()
    expect(page.locator('#week button')).to_have_count(7)
    expect(page.locator('#week button').first).to_have_attribute('aria-pressed', 'true')
    page.locator('#week button').last.click()
    expect(page.locator('#week button').last).to_have_attribute('aria-pressed', 'true')
    expect(page.locator('#month')).to_have_text(page.evaluate("new Intl.DateTimeFormat(undefined, {month:'long', year:'numeric'}).format(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 6))"))
    expect(page.locator('#media-title')).to_have_text('Test track')
    expect(page.locator('#media-progress-fill')).to_have_attribute('style', 'width: 50%;')
    page.get_by_role('button', name='Next track').click()
    assert page.evaluate("localStorage.getItem('last-media-action')") == 'next'
    page.locator('[data-page="tasks"]').click()
    page.locator('#task-input').fill('Prepare meeting')
    page.locator('#task-due').fill('2027-01-05T13:30')
    page.locator('#task-submit').click()
    expect(page.get_by_text('Prepare meeting')).to_be_visible()
    page.get_by_role('button', name='Edit Prepare meeting').click()
    page.locator('#task-description').fill('Bring notes')
    page.locator('#task-submit').click()
    expect(page.get_by_text('Bring notes')).to_be_visible()
    page.locator('[data-page="calendar"]').click()
    assert page.evaluate("hijriText(new Date(2024, 3, 10), 0)") == '1 Shawwal 1445 AH'
    assert page.evaluate("hijriText(new Date(2024, 3, 10), 1)") == '2 Shawwal 1445 AH'
    expect(page.locator('#calendar-hijri-range')).to_contain_text('AH')
    page.locator('#hijri-offset').select_option('1')
    expect(page.locator('#hijri-offset')).to_have_value('1')
    page.locator('#event-title').fill('Team meeting')
    page.locator('#event-start').fill('2027-01-05T10:00')
    page.locator('#event-duration').fill('60')
    page.locator('#event-repeat').select_option('weekly')
    page.locator('#event-location').fill('Office')
    page.locator('#event-submit').click()
    expect(page.locator('#calendar-items')).to_contain_text('Team meeting')
    expect(page.locator('#calendar-items')).to_contain_text('Prepare meeting')
    page.get_by_role('button', name='Tuesday, January 12, 2027').click()
    expect(page.locator('#calendar-items')).to_contain_text('Team meeting')
    page.get_by_role('button', name='Tuesday, January 5, 2027').click()
    page.get_by_role('button', name='Edit event Team meeting').click()
    page.locator('#event-title').fill('Team review')
    page.locator('#event-submit').click()
    expect(page.locator('#calendar-items')).to_contain_text('Team review')
    assert page.evaluate("data.calendar_events[0].repeat") == 'weekly'
    page.reload()
    page.locator('#closed').dispatch_event('pointerenter')
    page.locator('[data-page="calendar"]').click()
    expect(page.locator('#hijri-offset')).to_have_value('1')
    page.locator('#event-start').fill('2027-01-05T10:00')
    page.locator('#event-title').fill('Temporary')
    page.locator('#event-submit').click()
    expect(page.locator('#calendar-items')).to_contain_text('Team review')
    page.once('dialog', lambda dialog: dialog.dismiss())
    page.get_by_role('button', name='Delete event Temporary').click()
    expect(page.locator('#calendar-items')).to_contain_text('Temporary')
    page.once('dialog', lambda dialog: dialog.accept())
    page.get_by_role('button', name='Delete event Temporary').click()
    page.once('dialog', lambda dialog: dialog.accept())
    page.get_by_role('button', name='Delete event Team review').click()
    expect(page.locator('#calendar-items')).not_to_contain_text('Team review')
    assert page.evaluate('''() => {
      const old = data.calendar_events;
      data.calendar_events = [{start_ms:new Date(2028,0,31,23,30).getTime(),duration_minutes:90,repeat:'monthly'}];
      const feb = occurrencesOnDay(new Date(2028,1,29)).length;
      const march = occurrencesOnDay(new Date(2028,2,31)).length;
      const nextDay = occurrencesOnDay(new Date(2028,3,1)).length;
      data.calendar_events = old;
      return feb === 0 && march === 1 && nextDay === 1;
    }''')
    page.locator('[data-page="tasks"]').click()
    completed = page.get_by_role('checkbox', name='Complete Prepare meeting')
    completed.click()
    expect(completed).to_have_count(0)
    page.reload()
    page.locator('#closed').dispatch_event('pointerenter')
    page.locator('[data-page="tasks"]').click()
    page.locator('[data-task-view="done"]').click()
    expect(page.get_by_role('checkbox', name='Complete Prepare meeting')).to_be_checked()
    expect(page.get_by_text('Bring notes')).to_be_visible()
    page.get_by_role('button', name='Delete Prepare meeting', exact=True).click()
    expect(page.get_by_text('Prepare meeting')).to_have_count(0)
    page.locator('[data-task-view="trash"]').click()
    page.get_by_role('button', name='Restore Prepare meeting', exact=True).click()
    expect(page.get_by_text('Trash is empty', exact=False)).to_be_visible()
    page.locator('[data-task-view="done"]').click()
    expect(page.get_by_role('checkbox', name='Complete Prepare meeting')).to_be_checked()
    page.locator('[data-task-view="active"]').click()
    page.locator('#task-input').fill('Weekly review')
    page.locator('#task-repeat summary').click()
    page.get_by_role('checkbox', name='Mon', exact=True).check()
    page.locator('#task-repeat-time').fill('09:30')
    page.locator('#task-submit').click()
    expect(page.get_by_text('Repeats Mon · 09:30')).to_be_visible()
    page.get_by_role('button', name='Steps for Weekly review').click()
    page.get_by_role('textbox', name='New step').fill('Check notes')
    page.get_by_role('button', name='Add step').click()
    page.get_by_role('checkbox', name='Complete step Check notes').check()
    task_done = page.get_by_role('checkbox', name='Complete Weekly review')
    expect(task_done).not_to_be_checked()
    task_done.click()
    expect(task_done).to_have_count(1)
    expect(task_done).not_to_be_checked()
    page.get_by_role('button', name='Steps for Weekly review').first.click()
    expect(page.get_by_role('checkbox', name='Complete step Check notes').first).not_to_be_checked()
    page.locator('[data-task-view="done"]').click()
    expect(task_done).to_be_checked()
    page.locator('[data-task-view="active"]').click()
    page.locator('#task-input').fill('Due reminder fixture')
    due = page.evaluate("new Date(Date.now() - 60000).toISOString().slice(0, 16)")
    page.locator('#task-due').fill(due)
    page.locator('#task-late').select_option('0')
    page.locator('#task-submit').click()
    expect(page.get_by_role('button', name='Snooze Due reminder fixture')).to_be_visible()
    page.locator('#close').click()
    expect(page.locator('#todo-reminder-text')).to_have_text('Due: Due reminder fixture')
    page.locator('#todo-reminder-snooze').click()
    expect(page.locator('#todo-reminder')).to_be_hidden()
    assert page.evaluate("""() => {
      const item = data.tasks.find(t => t.text === 'Due reminder fixture');
      return item.late_minutes === 0 && item.due_at_ms > Date.now() + 590000;
    }""")
    page.evaluate('window.poniTestShortcut()')
    page.locator('[data-page="tasks"]').click()
    page.locator('#task-input').fill('Rapat besok jam 3 sore')
    expect(page.locator('#task-language-text')).to_contain_text('Rapat ·')
    page.locator('#task-submit').click()
    assert page.evaluate("""() => {
      const due = new Date(data.tasks.find(t => t.text === 'Rapat').due_at_ms);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return due.getDate() === tomorrow.getDate() && due.getHours() === 15;
    }""")
    page.locator('#task-input').fill('Walk every Monday and Thursday at 7am')
    expect(page.locator('#task-language-text')).to_contain_text('Every Mon, Thu · 07:00')
    page.locator('#task-submit').click()
    expect(page.get_by_text('Repeats Mon, Thu · 07:00', exact=True)).to_be_visible()
    page.locator('#task-input').fill('Call mom in 15 minutes')
    expect(page.locator('#task-language-preview')).to_be_visible()
    page.locator('#task-language-ignore').click()
    expect(page.locator('#task-language-preview')).to_be_hidden()
    page.locator('#task-submit').click()
    expect(page.get_by_text('Call mom in 15 minutes', exact=True)).to_be_visible()
    test_notes(page)
    page.locator('[data-page="tasks"]').click()
    page.get_by_role('button', name='Steps for Rapat', exact=True).click()
    card = page.locator('.task-card').filter(has_text='Rapat').first
    card.get_by_role('button', name='Link note', exact=True).click()
    card.get_by_role('combobox', name='Note for Rapat').select_option(label='Science')
    card.get_by_role('button', name='Open linked note').click()
    expect(page.locator('#page-notes').get_by_role('textbox', name='Note', exact=True)).to_have_value(
        'Science\nEarth :: Planet\nMoon :: Satellite'
    )
    page.locator('[data-page="tasks"]').click()
    card.get_by_role('button', name='Change linked note').click()
    card.get_by_role('combobox', name='Note for Rapat').select_option('')
    expect(card.get_by_role('button', name='Open linked note')).to_have_count(0)
    page.locator('[data-page="timer"]').click()
    page.locator('#timer-minutes').fill('5')
    page.locator('#timer-start').click()
    expect(page.locator('#timer-start')).to_have_text('Pause')
    page.locator('#timer-start').click()
    expect(page.locator('#timer-start')).to_have_text('Start')
    page.locator('#timer-reset').click()
    expect(page.locator('#timer-display')).to_have_text('05:00')
    page.get_by_role('button', name='Stopwatch').click()
    page.locator('#stopwatch-start').click()
    expect(page.locator('#stopwatch-start')).to_have_text('Pause')
    page.locator('#stopwatch-lap').click()
    expect(page.locator('#stopwatch-laps')).to_contain_text('Lap 1')
    page.locator('#stopwatch-start').click()
    page.locator('#stopwatch-reset').click()
    expect(page.locator('#stopwatch-display')).to_have_text('00:00.0')
    page.locator('[data-page="weather"]').click()
    page.locator('#weather-city').fill('Jakarta')
    page.locator('#weather-search button').click()
    page.get_by_role('button', name='Jakarta, Jakarta, Indonesia').click()
    expect(page.locator('#weather-current')).to_contain_text('30°C')
    test_worldclock(page)
    page.locator('[data-page="system"]').click()
    expect(page.locator('#system-cpu')).to_have_text('33%')
    expect(page.locator('#system-memory')).to_have_text('2.0 / 8.0 GB')
    page.locator('[data-page="dayprogress"]').click()
    page.evaluate("renderDayProgress(new Date(2026, 0, 1, 15, 0))")
    expect(page.locator('#day-percent')).to_have_text('50%')
    expect(page.locator('#day-remaining')).to_contain_text('8h 0m')
    expect(page.locator('#day-periods')).to_contain_text('Year')
    page.evaluate('''() => {
      data.calendar_events = [{id:'night', title:'Overnight event', start_ms:new Date(2026,0,1,22,30).getTime(), duration_minutes:180, repeat:'none'}];
      data.tasks = [{id:'task', text:'Checklist', done:true, done_at_ms:new Date(2026,0,2,0,30).getTime()}];
      data.wake_minute = 22 * 60;
      data.bed_minute = 2 * 60;
      renderDayProgress(new Date(2026,0,2,1));
    }''')
    expect(page.locator('#day-percent')).to_have_text('75%')
    expect(page.locator('#day-agenda')).to_contain_text('Completed: Checklist')
    expect(page.get_by_text('Overnight event')).to_have_count(1)
    page.evaluate('data.wake_minute = 420; data.bed_minute = 1380;')
    page.evaluate("renderDayProgress(new Date(2026, 0, 1, 23, 30))")
    expect(page.locator('#day-percent')).to_have_text('100%')
    expect(page.locator('#day-remaining')).to_contain_text('past bedtime')
    page.locator('#day-wake').fill('08:00')
    page.locator('#day-bed').fill('20:00')
    page.locator('#day-schedule button').click()
    expect(page.locator('#day-wake-label')).to_have_text('08:00')
    page.evaluate("renderDayProgress(new Date(2026, 0, 1, 14, 0))")
    expect(page.locator('#day-percent')).to_have_text('50%')
    page.reload()
    page.locator('#closed').dispatch_event('pointerenter')
    page.locator('[data-page="dayprogress"]').click()
    expect(page.locator('#day-wake')).to_have_value('08:00')
    page.reload()
    page.locator('#closed').dispatch_event('pointerenter')
    page.locator('[data-page="weather"]').click()
    expect(page.locator('#weather-current')).to_contain_text('30°C')
    page.locator('[data-page="home"]').click()
    page.evaluate('''() => {
      const now = new Date(); now.setHours(9,0,0,0);
      data.calendar_events = [{id:'test',title:'Home event',start_ms:now.getTime(),duration_minutes:30,repeat:'none'}];
      renderCalendar();
    }''')
    expect(page.get_by_role('button', name='Home event')).to_be_visible()
    page.get_by_role('button', name='Home event').click()
    expect(page.locator('#page-calendar')).to_be_visible()
    expect(page.locator('#calendar-items')).to_contain_text('Home event')
    test_dashboard(page)
    test_currency(page)
    test_translate(page)
    test_next_modules(page)
    test_chat(page)
    assert not errors, errors
    browser.close()
server.shutdown()
print('PASS: task and note interactions using a mock backend')

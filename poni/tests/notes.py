import re

from playwright.sync_api import expect


def test_notes(page):
    def install_mock():
        page.evaluate(r'''() => {
          const original = window.__TAURI__.core.invoke;
          const key = 'notes-parity-fixture';
          if (!localStorage.getItem(key)) {
            localStorage.setItem(key, JSON.stringify([{id: crypto.randomUUID(), text: 'Legacy note\n  Existing spacing  '}]));
          }
          window.__TAURI__.core.invoke = async (command, args) => {
            if (!command.startsWith('notes_')) return original(command, args);
            let saved = JSON.parse(localStorage.getItem(key));
            if (command === 'notes_get') return saved;
            const note = saved.find(item => item.id === args.id);
            if (command === 'notes_save') {
              if (note) Object.assign(note, {text: args.text, updated_at: Date.now()});
              else saved.push({id: args.id, text: args.text, updated_at: Date.now()});
            }
            if (command === 'notes_delete') saved = saved.filter(item => item.id !== args.id);
            if (command === 'notes_save_study') {
              note.study ||= {};
              note.study.shuffle = args.shuffle;
              if (args.score) note.study.last_round = {...args.score, at: Date.now()};
            }
            localStorage.setItem(key, JSON.stringify(saved));
          };
        }''')

    install_mock()
    page.locator('[data-page="notes"]').click()
    panel = page.locator('#page-notes')
    editor = panel.get_by_role('textbox', name='Note', exact=True)
    expect(editor).to_have_value('Legacy note\n  Existing spacing  ')
    panel.get_by_role('button', name='New note').click()
    editor.fill('Science\nEarth :: Planet\nMoon :: Satellite')
    # Switching notes flushes the draft immediately, before the debounce timer expires.
    panel.get_by_role('button', name='Legacy note').click()
    expect(editor).to_have_value('Legacy note\n  Existing spacing  ')
    page.wait_for_function("JSON.parse(localStorage.getItem('notes-parity-fixture')).some(note => note.text.startsWith('Science\\nEarth'))")
    search = panel.get_by_role('searchbox', name='Search notes and cards')
    search.fill('Satellite')
    expect(panel.get_by_role('button', name='Science')).to_be_visible()
    expect(panel.get_by_role('button', name='Legacy note')).to_have_count(0)
    search.fill('')
    panel.get_by_role('button', name='Cards', exact=True).click()
    panel.get_by_role('button', name='Science', exact=True).click()
    expect(panel.get_by_role('button', name='Earth', exact=True)).to_be_visible()
    page.keyboard.press('Space')
    expect(panel.get_by_role('button', name=re.compile('Planet'))).to_be_visible()
    panel.get_by_role('button', name='Again').click()
    panel.get_by_role('button', name='Show answer').click()
    panel.get_by_role('button', name='Got it').click()
    expect(panel.get_by_role('button', name='Earth', exact=True)).to_be_visible()
    panel.get_by_role('button', name='Show answer').click()
    panel.get_by_role('button', name='Got it').click()
    expect(panel.get_by_text('1 of 2 right the first time')).to_be_visible()
    page.wait_for_function("JSON.parse(localStorage.getItem('notes-parity-fixture')).some(note => note.study?.last_round?.got === 1)")
    panel.get_by_role('button', name='Only the missed cards').click()
    expect(panel.get_by_role('button', name='Earth', exact=True)).to_be_visible()
    panel.get_by_role('button', name='New deck').click()
    panel.get_by_role('textbox', name='Deck name').fill('Languages')
    panel.get_by_role('textbox', name='Question').fill('Apa kabar?')
    panel.get_by_role('textbox', name='Answer').fill('How are you?')
    panel.get_by_role('button', name='Add card', exact=True).click()
    expect(panel.get_by_text('Added: Apa kabar?')).to_be_visible()
    page.wait_for_function("JSON.parse(localStorage.getItem('notes-parity-fixture')).some(note => note.text.startsWith('Languages'))")

    page.reload()
    page.locator('#closed').dispatch_event('pointerenter')
    install_mock()
    page.locator('[data-page="notes"]').click()
    expect(editor).to_have_value('Languages\nApa kabar? :: How are you?')
    panel.get_by_role('button', name='Delete note').click()
    expect(panel.get_by_role('button', name='Languages')).to_have_count(0)
    page.wait_for_function("!JSON.parse(localStorage.getItem('notes-parity-fixture')).some(note => note.text.startsWith('Languages'))")

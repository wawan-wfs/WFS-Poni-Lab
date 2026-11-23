from playwright.sync_api import expect


def test_translate(page):
    page.evaluate('''() => {
      window.translationCalls = [];
      const invoke = window.__TAURI__.core.invoke;
      window.__TAURI__.core.invoke = async (command, args) => {
        if (command !== 'translate_text') return invoke(command, args);
        window.translationCalls.push(args);
        if (args.from === 'id') throw new Error('Provider unavailable');
        return 'Halo Dunia';
      };
    }''')
    page.locator('[data-page="translate"]').click()
    text = page.get_by_role('textbox', name='Text to translate')
    submit = page.locator('#translate-submit')
    text.fill('界' * 167)
    expect(submit).to_be_disabled()
    text.fill('hello world')
    assert page.evaluate('window.translationCalls.length') == 0
    text.press('Control+Enter')
    expect(page.get_by_role('region', name='Translation', exact=True)).to_have_text('Halo Dunia')
    assert page.evaluate('window.translationCalls') == [{'text': 'hello world', 'from': 'en', 'to': 'id'}]
    page.get_by_role('button', name='Swap languages').click()
    expect(page.get_by_label('Source language')).to_have_value('id')
    expect(text).to_have_value('Halo Dunia')
    submit.click()
    expect(page.locator('#translate-status')).to_contain_text('Provider unavailable')
    expect(page.get_by_role('button', name='Copy', exact=True)).to_be_disabled()

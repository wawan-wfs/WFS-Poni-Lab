from playwright.sync_api import expect


CURRENCY_MOCK = '''
    const previousCurrencyInvoke = window.__TAURI__.core.invoke;
    window.__TAURI__.core.invoke = async (command, args = {}) => {
        const key = 'currency-test-data';
        const pair = {from: 'USD', to: 'IDR'};
        const data = JSON.parse(localStorage.getItem(key) || 'null') || {preferences: {pair, favourites: [pair]}, table: null};
        if (command === 'currency_snapshot') return data;
        if (command === 'refresh_currency_rates') {
            if (localStorage.getItem('currency-test-offline')) throw new Error('Network unavailable');
            data.table = {date: '2026-11-20', rates: {USD: 1, IDR: 18263, EUR: 0.90992}, fetched_at: 1795132800};
            localStorage.setItem(key, JSON.stringify(data));
            return data.table;
        }
        if (command === 'save_currency_preferences') {
            data.preferences = args.preferences;
            localStorage.setItem(key, JSON.stringify(data));
            return data.preferences;
        }
        return previousCurrencyInvoke(command, args);
    };
'''


def test_currency(page):
    page.evaluate(CURRENCY_MOCK)
    page.locator('[data-page="currency"]').click()
    expect(page.locator('#currency-status')).to_contain_text('Frankfurter')
    page.get_by_role('textbox', name='Amount', exact=True).fill('2.5')
    expect(page.locator('#currency-result')).to_contain_text('45,658')
    page.get_by_role('button', name='Swap currencies').click()
    expect(page.get_by_label('From currency')).to_have_value('IDR')
    expect(page.get_by_label('To currency')).to_have_value('USD')
    page.get_by_role('button', name='Favourite this pair').click()
    expect(page.get_by_role('button', name='IDR → USD')).to_be_visible()
    page.evaluate("localStorage.setItem('currency-test-offline', '1')")
    page.get_by_role('button', name='Refresh rates').click()
    expect(page.locator('#currency-status')).to_contain_text('Saved rates')
    page.get_by_role('button', name='USD → IDR').click()
    expect(page.locator('#currency-result')).to_contain_text('45,658')
    page.get_by_role('textbox', name='Amount', exact=True).fill('oops')
    expect(page.locator('#currency-result')).to_have_text('—')
    expect(page.get_by_role('button', name='Copy', exact=True)).to_be_disabled()
    page.evaluate("localStorage.removeItem('currency-test-offline')")

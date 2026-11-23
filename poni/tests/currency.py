from playwright.sync_api import expect


CURRENCY_MOCK = '''
    const previousCurrencyInvoke = window.__TAURI__.core.invoke;
    window.__TAURI__.core.invoke = async (command, args = {}) => {
        const key = 'currency-test-data';
        const pair = {from: 'USD', to: 'IDR'};
        const stored = JSON.parse(localStorage.getItem(key) || 'null');
        const data = stored || {preferences: {pair, favourites: [pair]}, local: 'IDR', locale: 'en-US', ecb: null, open: null, errors: {}};
        if (command === 'currency_snapshot') return {...data, due: !stored || Boolean(localStorage.getItem('currency-test-offline'))};
        if (command === 'refresh_currency_rates') {
            if (localStorage.getItem('currency-test-offline')) {
                return {...data, errors:{ecb:'Network unavailable', open:'Network unavailable'}};
            }
            data.ecb = {base:'EUR', date:'2026-11-20', rates:{USD: 1.099, IDR: 20071.37}, fetched_at:1795132800};
            data.open = {base:'USD', date:'2026-11-23', rates:{IDR: 18210, EUR: 0.910, AED: 3.6725}, fetched_at:1795392152};
            localStorage.setItem(key, JSON.stringify(data));
            return data;
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
    tab = page.locator('[data-page="currency"]')
    tab.click()
    expect(page.locator('#currency-source')).to_have_text('ECB')
    amount = page.get_by_role('textbox', name='Amount', exact=True)
    expect(amount).to_have_attribute('placeholder', '100')
    amount.fill('2,5')
    expect(page.locator('#currency-result')).to_contain_text('45,658')
    page.get_by_role('button', name='Swap currencies').click()
    expect(page.get_by_role('button', name='From currency')).to_have_text('IDR · Indonesian Rupiah⌄')
    expect(page.get_by_role('button', name='To currency')).to_have_text('USD · US Dollar⌄')
    amount.fill('50rb')
    expect(page.locator('#currency-result')).to_contain_text('2.74')
    page.get_by_role('button', name='Favourite this pair').click()
    expect(page.get_by_role('button', name='IDR → USD')).to_be_visible()
    page.get_by_role('button', name='To currency').click()
    page.keyboard.press('Escape')
    expect(page.get_by_role('listbox')).to_have_count(0)
    expect(page.locator('#open')).to_be_visible()
    page.get_by_role('button', name='To currency').click()
    page.get_by_role('option', name='AED · United Arab Emirates Dirham').click()
    expect(page.locator('#currency-source')).to_have_text('ExchangeRate-API')
    expect(page.locator('#currency-result')).to_contain_text('10.08')
    page.evaluate("localStorage.setItem('currency-test-offline', '1')")
    page.locator('[data-page="home"]').click()
    tab.click()
    expect(page.locator('#currency-status')).to_contain_text('couldn’t get newer ones')
    page.get_by_role('button', name='USD → IDR').click()
    amount.fill('2.5')
    expect(page.locator('#currency-result')).to_contain_text('45,658')
    amount.fill('oops')
    expect(page.locator('#currency-result')).to_have_text('—')
    expect(page.get_by_role('button', name='Copy', exact=True)).to_be_disabled()
    page.evaluate("localStorage.removeItem('currency-test-offline')")

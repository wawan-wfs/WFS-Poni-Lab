from playwright.sync_api import expect


def test_next_modules(page):
    page.evaluate('''() => {
      const original = window.__TAURI__.core.invoke;
      let enabled = false;
      let awake = false;
      let cleared = false;
      let prayer = null;
      const radio = {volume: 60, country: 'ID', favourites: [], recent: []};
      const station = {id: 'fip', name: 'FIP', url: 'https://audio.example/fip.mp3', country: 'FR', codec: 'MP3', tags: ''};
      window.__TAURI__.core.invoke = async (command, args) => {
        switch (command) {
          case 'control_snapshot':
            return {available: true, keep_awake: awake, volume: {muted: false, level: 40}, microphone_muted: null};
          case 'set_keep_awake':
            awake = args.enabled;
            return awake;
          case 'screentime_summary':
            return {available: true, enabled, total: cleared ? 0 : 60, switches: 0, hours: Array(24).fill(0),
              apps: cleared ? [] : [['notepad.exe', 60]]};
          case 'set_screentime_enabled':
            enabled = args.enabled;
            return;
          case 'clear_screentime':
            cleared = true;
            return;
          case 'get_data':
            return {...await original(command, args), prayer_settings: prayer};
          case 'set_prayer_settings':
            prayer = args.settings;
            return {prayer_settings: prayer};
          case 'prayer_day': {
            const slots = {Imsak:'04:17', Sunrise:'05:35', Fajr:'04:27', Dhuhr:'12:05', Asr:'15:15', Maghrib:'18:04', Isha:'19:15'};
            return {
              timings: Object.fromEntries(Object.entries(slots).map(([name, time]) => [name, args.date + 'T' + time + ':00+07:00'])),
              meta: {timezone: 'Asia/Jakarta'},
            };
          }
          case 'get_radio':
            return structuredClone(radio);
          case 'find_radio_stations':
            return [station];
          case 'update_radio_stations':
            if (args.action === 'favourite') radio.favourites.push(args.station);
            return structuredClone(radio);
          case 'open_support_link':
            window.lastSupportLink = args.destination;
            return;
          default:
            return original(command, args);
        }
      };
    }''')

    page.locator('[data-page="control"]').click()
    keep_awake = page.get_by_role('button', name='Keep awake')
    expect(keep_awake).to_be_enabled()
    keep_awake.click()
    expect(keep_awake).to_have_attribute('aria-pressed', 'true')
    keep_awake.click()
    expect(keep_awake).to_have_attribute('aria-pressed', 'false')

    page.locator('[data-page="screentime"]').click()
    screen = page.locator('#page-screentime')
    expect(screen.get_by_text('notepad.exe')).to_be_visible()
    screen.get_by_role('checkbox', name='Track screen time').check()
    expect(screen.get_by_role('checkbox', name='Track screen time')).to_be_checked()
    page.once('dialog', lambda dialog: dialog.accept())
    screen.get_by_role('button', name='Clear history').click()
    expect(screen.get_by_role('status')).to_have_text('No activity recorded')

    page.locator('[data-page="prayer"]').click()
    page.get_by_role('searchbox', name='Prayer city').fill('Jakarta')
    page.locator('#prayer-search').get_by_role('button', name='Search').click()
    page.locator('#prayer-results').get_by_role('button', name='Jakarta, Indonesia').click()
    expect(page.locator('#prayer-method')).to_have_value('20')
    page.locator('#prayer-save').click()
    expect(page.locator('#prayer-place')).to_contain_text('Asia/Jakarta')
    expect(page.locator('#prayer-extras')).to_contain_text('Qibla')
    expect(page.locator('#prayer-next')).not_to_be_empty()

    page.locator('[data-page="radio"]').click()
    radio = page.locator('#page-radio')
    expect(radio.get_by_role('button', name='FIP', exact=True)).to_be_visible()
    radio.get_by_role('button', name='Favourite FIP', exact=True).click()
    radio.get_by_role('button', name='Favourites', exact=True).click()
    expect(radio.get_by_role('button', name='FIP', exact=True)).to_be_visible()

    page.locator('[data-page="support"]').click()
    support = page.locator('#page-support')
    expect(support.get_by_text('Bos Digital', exact=False)).to_be_visible()
    support.get_by_role('button', name='Star Poni on GitHub').click()
    assert page.evaluate('window.lastSupportLink') == 'github'

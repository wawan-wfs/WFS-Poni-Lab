from playwright.sync_api import expect


def test_worldclock(page):
    page.locator('[data-page="worldclock"]').click()
    world = page.locator('#page-worldclock')
    city = world.get_by_role('combobox', name='Add a city')

    expect(city).to_be_enabled()
    city.fill('jak')
    city.press('ArrowDown')
    expect(world.get_by_role('option', name='Jakarta', exact=False).first).to_have_attribute('aria-selected', 'true')
    city.press('Enter')
    jakarta = world.locator('.world-row').filter(has=page.get_by_text('Jakarta', exact=True))
    expect(jakarta).to_be_visible()
    expect(jakarta.locator('.world-subtitle')).to_contain_text('+7 h')

    planner = jakarta.get_by_role('slider')
    midpoint = {'x': planner.bounding_box()['width'] / 2, 'y': 7}
    planner.hover(position=midpoint)
    expect(jakarta.locator('.world-time')).to_have_text('19:00')
    expect(world.get_by_role('button', name='Now', exact=True)).to_be_hidden()
    world.get_by_text('Here', exact=True).hover()
    expect(jakarta.locator('.world-marker')).to_be_hidden()

    planner.click(position=midpoint)
    world.get_by_text('Here', exact=True).hover()
    expect(jakarta.locator('.world-time')).to_have_text('19:00')
    expect(world.get_by_role('button', name='Now', exact=True)).to_be_visible()
    planner.press('End')
    expect(jakarta.locator('.world-time')).to_have_text('06:45')
    expect(jakarta.locator('.world-subtitle')).to_contain_text('tomorrow')
    world.get_by_role('button', name='Now', exact=True).click()
    expect(jakarta.locator('.world-marker')).to_be_hidden()

    world.get_by_role('button', name='Add a city', exact=True).click()
    city.fill('sao paulo')
    expect(world.get_by_role('option').first).to_contain_text('São Paulo')
    city.press('Enter')
    expect(world.get_by_text('São Paulo', exact=True)).to_be_visible()

    world.get_by_role('button', name='Edit places').click()
    world.get_by_role('button', name='Move São Paulo up').click()
    expect(world.locator('.world-places .world-row').first.get_by_label('Rename São Paulo')).to_be_visible()
    name = world.get_by_label('Rename São Paulo')
    name.fill('Brazil')
    name.press('Enter')
    expect(world.get_by_label('Rename Brazil')).to_be_visible()
    world.get_by_role('button', name='Done').click()
    expect(world.locator('.world-places .world-row').first.get_by_text('Brazil', exact=True)).to_be_visible()

    page.reload()
    page.locator('#closed').dispatch_event('pointerenter')
    page.locator('[data-page="worldclock"]').click()
    expect(world.get_by_text('Brazil', exact=True)).to_be_visible()
    world.get_by_role('button', name='Edit places').click()
    world.get_by_role('button', name='Remove Jakarta').click()
    expect(world.get_by_label('Rename Jakarta')).to_have_count(0)
    expect(world.get_by_label('Rename Brazil')).to_be_visible()

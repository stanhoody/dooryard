import { describe, expect, test } from 'claude-code/testing'

import { BAND, FAKE, PANE, done, typed, world } from './world'

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

describe('the pane', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`shows the card in full with 1 2 3 r b (${surface})`, FAKE, async ($, on) => {
      const { clock } = world(on, [surface])
      await $.session.start({ ...START, surface })
      await $.turn.start({ text: '', turnId: 't1' })
      await clock.advance(2000)
      const pane = await $.ui.mount({ ...PANE, surface })
      expect(await pane.find({ type: 'Text', text: '"rewriting the same migration for the third time, send coffee"' })).toBeDefined()
      expect((await pane.find({ type: 'Text', text: /Lisbon/ }))?.text).toBe('mira · Lisbon · 02:10')
      const keys = (await pane.findAll({ type: 'Button' })).map(b => [b.key, b.props.hotkey])
      expect(keys).toEqual([
        ['hi', '1'], ['next', '2'], ['post', '3'], ['report', 'r'], ['block', 'b'],
      ])
    })
  }

  test('3 on the band opens the post field, focused; Enter posts the card', FAKE, async ($, on) => {
    const { clock, opened, toasts, store } = world(on, ['terminal'])
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    const band = await $.ui.mount({ ...BAND(true), surface: 'terminal' })
    await band.press({ key: 'post' })
    expect(opened.at(-1)).toEqual({ id: 'yard', title: 'dooryard', rows: 9, focus: true })

    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await pane.find({ type: 'Text', text: /Adults only/ }))).toBeDefined()
    await pane.input({ key: 'post', text: 'waiting on a 40-minute build, Lisbon' })
    expect(toasts.at(-1)).toBe('your card is live while this turn runs')
    expect(store.get('seenPostRules')).toBe(true)
    expect(await pane.find({ key: 'post', type: 'Input' })).toBeUndefined()
  })

  test('a card over 80 characters is not sent', FAKE, async ($, on) => {
    const { clock, toasts } = world(on, ['terminal'])
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    const band = await $.ui.mount({ ...BAND(true), surface: 'terminal' })
    await band.press({ key: 'post' })
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.input({ key: 'post', text: 'x'.repeat(81) })
    expect(toasts.at(-1)).toBe('80 characters max')
  })

  test('r picks a report category from a Select', FAKE, async ($, on) => {
    const { clock, toasts } = world(on, ['terminal'])
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'report' })
    const picker = await pane.find({ type: 'Select', key: 'report' })
    expect(picker?.props.label).toBe("Report mira's card")
    await pane.select({ key: 'report', value: 'spam' })
    expect(toasts.at(-1)).toMatch(/^Reported\./)
  })

  test('b blocks at once on this machine and deals another card', FAKE, async ($, on) => {
    const { clock, toasts, store } = world(on, ['terminal'])
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'block' })
    expect(store.get('blocked')).toEqual(['mira'])
    expect(toasts.at(-1)).toBe("Blocked. mira is gone from this machine and can't reach you here again.")
    expect(await pane.find({ type: 'Text', text: /mira/ })).toBeUndefined()
    expect((await pane.find({ type: 'Text', text: /Berlin/ }))?.text).toBe('tomas · Berlin · 03:10')
  })

  test('a mutual hi brings 4 reply and a text field', FAKE, async ($, on) => {
    const { clock, toasts } = world(on, ['terminal'])
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'next' })
    await pane.press({ key: 'next' })
    expect((await pane.find({ type: 'Text', text: /Osaka/ }))?.text).toMatch(/^aiko/)
    expect(await pane.find({ key: 'reply' })).toBeUndefined()
    await pane.press({ key: 'hi' })
    expect(toasts.at(-1)).toBe('mutual with aiko · 4 reply · Tab, then x ends it and blocks')
    expect((await pane.find({ key: 'reply' }))?.props.hotkey).toBe('4')
    await pane.press({ key: 'reply' })
    await pane.input({ key: 'reply', text: 'same, ci is red' })
    expect((await pane.find({ type: 'Text', text: /ci is red/ }))?.text).toBe('you: same, ci is red')
  })

  test('the pane counts down with the band and closes', FAKE, async ($, on) => {
    const { clock, closed } = world(on, ['terminal'])
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(3000)
    await $.turn.complete(done('t1'))
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await pane.find({ type: 'Text' }))?.text).toBe('turn done · closing in 3')
    const before = closed.length
    await clock.advance(3000)
    expect(closed.length).toBe(before + 1)
  })
})

describe('/dooryard', () => {
  test('registers /dooryard to run mid-turn and opens the pane focused', FAKE, async ($, on) => {
    const { commands, opened } = world(on, ['terminal'])
    await $.session.start(START)
    expect(commands).toEqual(['dooryard'])
    expect(await $.command.run(typed('dooryard', ''))).toEqual({})
    expect(opened.at(-1)).toEqual({ id: 'yard', title: 'dooryard', rows: 9, focus: true })
  })

  test('/dooryard off stops the band and /dooryard on brings it back', FAKE, async ($, on) => {
    const { clock, store } = world(on, ['terminal'])
    await $.session.start(START)
    const off = await $.command.run(typed('dooryard', 'off'))
    expect(off.text).toBe('dooryard off. /dooryard on brings it back.')
    expect(store.get('enabled')).toBe(false)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(3000)
    const quiet = await $.ui.mount({ ...BAND(true), surface: 'terminal' })
    expect(await quiet.find({ type: 'Text', text: /dooryard/ })).toBeUndefined()
    await $.turn.complete(done('t1'))

    const back = await $.command.run(typed('dooryard', 'on'))
    expect(back.text).toBe('dooryard on. Your card posts only while your agent runs. /dooryard off stops it.')
    await $.turn.start({ text: '', turnId: 't2' })
    await clock.advance(2000)
    const band = await $.ui.mount({ ...BAND(true), surface: 'terminal' })
    expect(await band.find({ type: 'Text', text: /waiting/ })).toBeDefined()
  })

  test('/dooryard off mid-turn closes the band at once', FAKE, async ($, on) => {
    const { clock } = world(on, ['terminal'])
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2500)
    await $.command.run(typed('dooryard', 'off'))
    const band = await $.ui.mount({ ...BAND(true), surface: 'terminal' })
    expect(await band.find({ type: 'Text', text: /dooryard/ })).toBeUndefined()
  })
})

describe('opening unasked', () => {
  test('opens the pane at 2 seconds only where it docks as a sidebar', FAKE, async ($, on) => {
    const { clock, opened } = world(on, ['terminal'])
    await $.session.start(START)
    // The band was drawn once on a fullscreen terminal
    await (await $.ui.mount({ ...BAND(false, true), surface: 'terminal' })).unmount()
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    expect(opened).toEqual([{ id: 'yard', title: 'dooryard', rows: 9 }])
  })

  test('below the engine floor the pane stays shut and the band is the product', FAKE, async ($, on) => {
    const { clock, opened, closed } = world(on, ['terminal'], { isPlaced: false })
    await $.session.start(START)
    await (await $.ui.mount({ ...BAND(false, true), surface: 'terminal' })).unmount()
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    expect(opened.length).toBe(1)
    expect(closed.at(-1)).toBe('yard')
    const band = await $.ui.mount({ ...BAND(true, true), surface: 'terminal' })
    expect(await band.find({ type: 'Text', text: /waiting/ })).toBeDefined()
  })

  test('never on the main screen', FAKE, async ($, on) => {
    const { clock, opened } = world(on, ['terminal'])
    await $.session.start(START)
    await (await $.ui.mount({ ...BAND(false, false), surface: 'terminal' })).unmount()
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    expect(opened).toEqual([])
  })
})


describe('VS Code', () => {
  test('draws the strings without key hints, since its buttons have no hotkeys', FAKE, async ($, on) => {
    const { clock, toasts } = world(on, ['vscode'])
    await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
    await pane.press({ key: 'hi' })
    expect(toasts.at(-1)).toBe('hi sent to mira. If they say hi back, a thread opens.')
    // The fake's third poster, aiko, said hi first: this hi makes it mutual
    await pane.press({ key: 'next' })
    await pane.press({ key: 'next' })
    await pane.press({ key: 'hi' })
    expect(toasts.at(-1)).toBe('mutual with aiko')
    expect((await pane.find({ type: 'Text', text: /^mutual with/ }))?.text).toBe('mutual with aiko')
  })
})

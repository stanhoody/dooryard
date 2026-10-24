import { describe, expect, test } from 'claude-code/testing'

import { BAND, done, world } from './world'

describe('the band', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`shows only while working, from 2 seconds in (${surface})`, async ($, on) => {
      const { clock } = world(on, [surface])
      await $.session.start({ surface, isInteractive: true, cwd: '/work' })

      const idle = await $.ui.mount({ ...BAND(false), surface })
      expect(await idle.find({ type: 'Text', text: /dooryard/ })).toBeUndefined()
      await idle.unmount()

      await $.turn.start({ text: '', turnId: 't1' })
      await clock.advance(1900)
      const early = await $.ui.mount({ ...BAND(true), surface })
      expect(await early.find({ type: 'Text', text: /dooryard/ })).toBeUndefined()
      await early.unmount()

      await clock.advance(100)
      const band = await $.ui.mount({ ...BAND(true), surface })
      expect((await band.find({ type: 'Text', text: /waiting/ }))?.text).toBe(
        'dooryard · 37 waiting · "rewriting the same migration for the third time, send coffee, Lisbon, 02:10"',
      )
      expect((await band.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['hi', 'next', 'post'])
      expect((await band.find({ key: 'hi' }))?.props.hotkey).toBe('1')
      await band.unmount()
    })
  }

  test('hands back 3 seconds after the turn, counting down', async ($, on) => {
    const { clock } = world(on, ['terminal'])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(6000)
    await $.turn.complete(done('t1'))

    const lineAfter = async (ms: number) => {
      await clock.advance(ms)
      const band = await $.ui.mount({ ...BAND(false), surface: 'terminal' })
      const line = (await band.find({ type: 'Text', text: /dooryard/ }))?.text
      await band.unmount()
      return line
    }
    expect(await lineAfter(0)).toBe('dooryard · turn done · closing in 3')
    expect(await lineAfter(1000)).toBe('dooryard · turn done · closing in 2')
    expect(await lineAfter(1000)).toBe('dooryard · turn done · closing in 1')
    expect(await lineAfter(1000)).toBeUndefined()
  })

  test('closes at once on an interrupted turn', async ($, on) => {
    const { clock } = world(on, ['terminal'])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(3000)
    await $.turn.complete(done('t1', true))
    const band = await $.ui.mount({ ...BAND(false), surface: 'terminal' })
    expect(await band.find({ type: 'Text', text: /dooryard/ })).toBeUndefined()
  })

  test('a turn under 2 seconds never draws and has no countdown', async ($, on) => {
    const { clock } = world(on, ['terminal'])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(1500)
    await $.turn.complete(done('t1'))
    await clock.advance(1000)
    const band = await $.ui.mount({ ...BAND(false), surface: 'terminal' })
    expect(await band.find({ type: 'Text', text: /dooryard/ })).toBeUndefined()
  })

  test("a subagent's turn does not open the band", async ($, on) => {
    const { clock } = world(on, ['terminal'])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: '', turnId: 'a1', agentId: 'agent-1' })
    await clock.advance(3000)
    const band = await $.ui.mount({ ...BAND(true), surface: 'terminal' })
    expect(await band.find({ type: 'Text', text: /dooryard/ })).toBeUndefined()
  })

  test('a session with no surface does nothing', async ($, on) => {
    const { clock, statuses } = world(on, [])
    await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(3000)
    const band = await $.ui.mount({ ...BAND(true), surface: 'terminal' })
    expect(await band.find({ type: 'Text', text: /dooryard/ })).toBeUndefined()
    expect(statuses).toEqual([])
  })

  test('1 says hi once and 2 deals the next card', async ($, on) => {
    const { clock, toasts } = world(on, ['terminal'])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    const band = await $.ui.mount({ ...BAND(true), surface: 'terminal' })
    await band.press({ key: 'hi' })
    expect(toasts).toEqual(['hi sent to mira. If they say hi back, 4 opens a thread.'])
    expect(await band.find({ key: 'hi' })).toBeUndefined()
    await band.press({ key: 'next' })
    expect((await band.find({ type: 'Text', text: /waiting/ }))?.text).toMatch(/shipping a mod tonight/)
    expect(await band.find({ key: 'hi' })).toBeDefined()
  })
})

describe('the VS Code status line', () => {
  test('carries the band line without hotkeys, under 200 characters', async ($, on) => {
    const { clock, statuses } = world(on, ['vscode'])
    await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(1000)
    expect(statuses).toEqual([])
    await clock.advance(1000)
    expect(statuses.at(-1)).toBe('dooryard · 37 waiting · "rewriting the same migration for the third time, send coffee, Lisbon, 02:10"')
    expect(statuses.every(s => s === undefined || s.length <= 200)).toBe(true)
    await $.turn.complete(done('t1'))
    await clock.advance(3000)
    expect(statuses.at(-1)).toBeUndefined()
  })

  test('the terminal never sets it', async ($, on) => {
    const { clock, statuses } = world(on, ['terminal'])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(8000)
    await $.turn.complete(done('t1'))
    await clock.advance(3000)
    expect(statuses).toEqual([])
  })
})

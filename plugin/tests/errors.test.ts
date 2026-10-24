import { describe, expect, test } from 'claude-code/testing'

import { CARD, LIVE, STATE, TOKEN, error, serve } from './server'
import { BAND, PANE, world } from './world'

// What the person sees when the server says no or says nothing (api.md §2),
// the notices it returns once (§4), and a turn/start that failed once (§1).

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

describe('errors and notices', () => {
  test("a cooldown shows the server's string, a silent failure a plain line", LIVE, async ($, on) => {
    const { clock, toasts } = world(on, ['terminal'], { stored: { token: TOKEN } })
    serve(on, one => {
      if (one.path === '/hellos') return error(403, 'cooldown', 'cooldown.hi_wait')
      if (one.path === '/cards') return error(503, 'unavailable')
      return undefined
    })
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'hi' })
    expect(toasts.at(-1)).toBe('first hi opens 1 hour after sign-in')
    await pane.press({ key: 'post' })
    await pane.input({ key: 'post', text: 'waiting on a build' })
    expect(toasts.at(-1)).toBe('server unavailable')
  })

  test('a notice the server returns once stays on the pane until it closes', LIVE, async ($, on) => {
    const { clock } = world(on, ['terminal'], { stored: { token: TOKEN } })
    let polls = 0
    serve(on, one => {
      if (!one.path.startsWith('/state')) return undefined
      polls += 1
      const notices = polls === 1 ? [{ copy_key: 'decision.warning', params: { what: 'card', category: 'spam' } }] : []
      return { status: 200, json: { ...STATE, notices } }
    })
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(10_000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await pane.find({ type: 'Text', text: /^Warning/ }))?.text).toBe(
      'Warning: your card broke the rule on spam. The next one switches you to watch-only.',
    )
  })

  test('a failed turn/start is tried again while the agent works', LIVE, async ($, on) => {
    const { clock } = world(on, ['terminal'], { stored: { token: TOKEN } })
    let starts = 0
    serve(on, one => {
      if (one.path !== '/turn/start') return undefined
      starts += 1
      return starts === 1 ? error(503, 'unavailable') : undefined
    })
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    const down = await $.ui.mount({ ...BAND(true), surface: 'terminal' })
    expect((await down.find({ type: 'Text', text: /dooryard/ }))?.text).toBe('dooryard · server unavailable')
    await down.unmount()
    await clock.advance(5000)
    expect(starts).toBe(2)
    const band = await $.ui.mount({ ...BAND(true), surface: 'terminal' })
    expect((await band.find({ type: 'Text', text: /waiting/ }))?.text).toBe(
      `dooryard · 12 waiting · "${CARD.text}, ${CARD.city}, ${CARD.local_time}"`,
    )
  })

  test('a phone alone draws nothing and sends nothing', LIVE, async ($, on) => {
    const { clock } = world(on, ['mobile'], { stored: { token: TOKEN } })
    const { sent } = serve(on)
    await $.session.start({ ...START, surface: null })
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(10_000)
    expect(sent).toEqual([])
  })
})

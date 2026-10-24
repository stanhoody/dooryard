import { describe, expect, test } from 'claude-code/testing'

import { BASE, CARD, LIVE, STATE, TOKEN, error, serve } from './server'
import { BAND, PANE, done, world } from './world'

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

// The live backend against contracts/api.md v1.0, with Claude Code's
// $.http.fetch answered here: what the mod sends, where, and when.

describe('the live backend', () => {
  test('starts the turn, deals, and polls every poll_ms only while working', LIVE, async ($, on) => {
    const { clock } = world(on, ['terminal'], { stored: { token: TOKEN } })
    const { sent, urls } = serve(on)
    await $.session.start(START)
    await $.turn.start({ text: 'never sent anywhere', turnId: 't1' })
    await clock.advance(2000)

    expect(sent.slice(0, 2)).toEqual([
      { method: 'POST', path: '/turn/start', body: { surface: 'terminal' }, auth: `Bearer ${TOKEN}` },
      { method: 'POST', path: '/deal', body: { turn_id: 'b1' }, auth: `Bearer ${TOKEN}` },
    ])
    const band = await $.ui.mount({ ...BAND(true), surface: 'terminal' })
    expect((await band.find({ type: 'Text', text: /waiting/ }))?.text).toBe(
      'dooryard · 12 waiting · "rewriting auth, Berlin, 23:10"',
    )

    await clock.advance(10_000)
    expect(sent.filter(one => one.path === '/state?turn_id=b1').length).toBe(2)
    await $.turn.complete(done('t1'))
    expect(sent.at(-1)).toEqual({ method: 'POST', path: '/turn/end', body: { turn_id: 'b1' }, auth: `Bearer ${TOKEN}` })
    const before = sent.length
    await clock.advance(60_000)
    expect(sent.length).toBe(before)

    // One host, and nothing of the prompt in any request
    expect(urls.every(url => url.startsWith(`${BASE}/api/v1/`))).toBe(true)
    expect(JSON.stringify(sent).includes('never sent anywhere')).toBe(false)
  })

  test('hello sends the card and the turn', LIVE, async ($, on) => {
    const { clock, toasts } = world(on, ['terminal'], { stored: { token: TOKEN } })
    const { sent } = serve(on, one =>
      one.path === '/hellos' ? { status: 201, json: { hello: { id: 'h2' }, mutual: false } } : undefined,
    )
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'hi' })
    expect(sent.find(one => one.path === '/hellos')?.body).toEqual({ card_id: 'c9', turn_id: 'b1' })
    expect(toasts.at(-1)).toBe('hi sent to berlin_ops. If they say hi back, 4 opens a thread.')
    expect(await pane.find({ key: 'hi' })).toBeUndefined()
  })

  test('block writes the store before it tells the server', LIVE, async ($, on) => {
    const { clock, store, trail } = world(on, ['terminal'], { stored: { token: TOKEN } })
    serve(on, one => {
      if (one.path !== '/blocks') return undefined
      trail.push(`server ${JSON.stringify(one.body)}`)
      return { status: 200, json: { ok: true } }
    })
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'block' })
    await clock.settle()
    expect(trail).toEqual(['store blocked', 'server {"handle":"berlin_ops"}'])
    expect(store.get('blocked')).toEqual(['berlin_ops'])
  })

  test('a DM arrives as a 4-second toast', LIVE, async ($, on) => {
    const { clock, toasts } = world(on, ['terminal'], { stored: { token: TOKEN } })
    let polls = 0
    const { sent } = serve(on, one => {
      if (one.path.startsWith('/state')) {
        polls += 1
        const threads = polls === 1 ? [{ id: 't4', handle: 'berlin_ops', unread: 1, hidden: 0 }] : []
        return { status: 200, json: { ...STATE, threads } }
      }
      if (one.path === '/threads/t4/messages') {
        return {
          status: 200,
          json: { messages: [{ id: 'm7', from: 'them', text: 'same, ci is red', sent_at: '2026-10-23T18:41:02Z', checkin: false }], hidden: 0 },
        }
      }
      return undefined
    })
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(5000)
    expect(sent.some(one => one.method === 'GET' && one.path === '/threads/t4/messages')).toBe(true)
    expect(toasts.at(-1)).toBe('berlin_ops: same, ci is red')
  })

  test('a nudged DM goes again with confirm on Enter', LIVE, async ($, on) => {
    const { clock } = world(on, ['terminal'], { stored: { token: TOKEN } })
    const { sent } = serve(on, one => {
      if (one.path === '/hellos') {
        return { status: 201, json: { hello: { id: 'h2' }, mutual: true, thread: { id: 't4', handle: 'berlin_ops', city: 'Berlin', local_time: '23:10' } } }
      }
      if (one.path === '/threads/t4/messages' && one.method === 'POST') {
        const body = one.body as { text: string; confirm: boolean }
        return body.confirm
          ? { status: 201, json: { message: { id: 'm8', from: 'me', text: body.text, sent_at: '2026-10-23T18:42:00Z', checkin: false } } }
          : error(409, 'nudge', 'nudge.harassment')
      }
      return undefined
    })
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'hi' })
    await pane.press({ key: 'reply' })
    await pane.input({ key: 'reply', text: 'you absolute walnut' })
    expect((await pane.find({ type: 'Text', text: /Hold on/ }))?.text).toBe('Hold on. This reads as an insult. Enter sends it as is, or edit it first.')
    expect((await pane.find({ type: 'Input', key: 'reply' }))?.props.value).toBe('you absolute walnut')
    await pane.input({ key: 'reply', text: 'you absolute walnut' })
    const posts = sent.filter(one => one.path === '/threads/t4/messages' && one.method === 'POST')
    expect(posts.map(one => one.body)).toEqual([
      { text: 'you absolute walnut', confirm: false },
      { text: 'you absolute walnut', confirm: true },
    ])
    expect((await pane.find({ type: 'Text', text: /walnut/ }))?.text).toBe('you: you absolute walnut')
  })

  test('a 401 clears the token and says so', LIVE, async ($, on) => {
    const { clock, store } = world(on, ['terminal'], { stored: { token: TOKEN } })
    serve(on, one => (one.path === '/turn/start' ? error(401, 'unauthorized') : undefined))
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    expect(store.has('token')).toBe(false)
    const band = await $.ui.mount({ ...BAND(true), surface: 'terminal' })
    expect((await band.find({ type: 'Text', text: /dooryard/ }))?.text).toBe('dooryard · signed out · /dooryard signs you in')
  })

  test('no answer in 8 seconds keeps the hook budget and shows the server as down', LIVE, async ($, on) => {
    const { clock } = world(on, ['terminal'], { stored: { token: TOKEN } })
    serve(on, one => (one.path === '/turn/start' ? 'never' : undefined))
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    await clock.advance(6000)
    const band = await $.ui.mount({ ...BAND(true), surface: 'terminal' })
    expect((await band.find({ type: 'Text', text: /dooryard/ }))?.text).toBe('dooryard · server unavailable')
  })

  test('hello open, hi back, hidden folder, report and end hit their endpoints', LIVE, async ($, on) => {
    const { clock, toasts, store } = world(on, ['terminal'], { stored: { token: TOKEN } })
    const thread = { id: 't4', handle: 'berlin_ops', city: 'Berlin', local_time: '23:10' }
    let isMutual = false
    const { sent } = serve(on, one => {
      if (one.path.startsWith('/state')) {
        const threads = isMutual ? [{ id: 't4', handle: 'berlin_ops', unread: 0, hidden: 1 }] : []
        return { status: 200, json: { ...STATE, hi_waiting: isMutual ? 0 : 1, threads } }
      }
      if (one.path === '/hellos/h1/back') isMutual = true
      if (one.path === '/hellos/open') {
        return { status: 200, json: { hello: { id: 'h1', handle: 'berlin_ops', city: 'Berlin', local_time: '23:10', sent_at: '2026-10-23T18:40:00Z', can_hi_back: true } } }
      }
      if (one.path === '/hellos/h1/back') return { status: 201, json: { thread } }
      if (one.path === '/threads/t4/hidden') {
        return { status: 200, json: { messages: [{ id: 'm9', from: 'them', text: 'tucked away', sent_at: '2026-10-23T18:43:00Z', checkin: true }] } }
      }
      if (one.path === '/reports') return { status: 201, json: { ok: true, copy_key: 'report.sent' } }
      if (one.path === '/threads/t4/end') return { status: 200, json: { ok: true } }
      if (one.path === '/blocks') return { status: 200, json: { ok: true } }
      return undefined
    })
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    // The first poll, 5 seconds in, brings hi_waiting
    await clock.advance(5000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await pane.find({ key: 'see' }))?.props.hotkey).toBe('o')
    await pane.press({ key: 'see' })
    await pane.press({ key: 'hi-back' })
    expect(sent.find(one => one.path === '/hellos/h1/back')?.method).toBe('POST')

    // The next poll counts one message in the hidden folder: Tab, then h shows it
    await clock.advance(5000)
    expect((await pane.find({ type: 'Text', text: /hidden message/ }))?.text).toBe('1 hidden message · Tab, then h shows it')
    await pane.press({ key: 'hidden' })
    expect(sent.some(one => one.path === '/threads/t4/hidden' && one.method === 'POST')).toBe(true)
    expect((await pane.find({ type: 'Text', text: /tucked away/ }))?.text).toBe('berlin_ops: tucked away')
    expect(await pane.find({ type: 'Text', text: /^Did that bother you/ })).toBeDefined()

    await pane.press({ key: 'report' })
    await pane.select({ key: 'report', value: 'harassment' })
    // The report names the thread and their last message, the hidden one now shown
    expect(sent.find(one => one.path === '/reports')?.body).toEqual({ category: 'harassment', thread_id: 't4', message_id: 'm9' })
    expect(toasts.at(-1)).toMatch(/^Reported\./)

    await pane.press({ key: 'end' })
    expect(sent.some(one => one.path === '/threads/t4/end')).toBe(true)
    expect(store.get('blocked')).toEqual(['berlin_ops'])
    expect(toasts.at(-1)).toBe('Thread ended and berlin_ops blocked.')
  })
})

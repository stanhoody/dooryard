import { describe, expect, test } from 'claude-code/testing'

import { LIVE, TOKEN, serve } from './server'
import { FAKE, PANE, typed, world } from './world'
import type { Route } from './server'

// Sign-in by code and link (api.md §3): the pane shows the code and an https
// Link, the mod polls, the token lands in $.store. The age check is the web
// page's, never the pane's.

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

const pairing = (url: string): Route => {
  let polls = 0
  return one => {
    if (one.path === '/pair/start') {
      return {
        status: 201,
        json: { code: 'K7QM2X', device_secret: 'q3Vb-secret', url, expires_at: '2026-10-23T01:20:00Z', poll_ms: 2000 },
      }
    }
    if (one.path === '/pair/poll') {
      polls += 1
      return { status: 200, json: polls < 2 ? { status: 'pending' } : { status: 'approved', token: TOKEN, handle: 'lisbon_dev' } }
    }
    if (one.path === '/signout') return { status: 200, json: { ok: true } }
    return undefined
  }
}

describe('sign-in', () => {
  test('shows a code and an https Link, polls, and keeps the token', LIVE, async ($, on) => {
    const { clock, store, toasts, opened } = world(on, ['terminal'])
    const { sent } = serve(on, pairing('https://dooryard.test/pair?code=K7QM2X'))
    await $.session.start(START)
    await $.command.run(typed('dooryard', ''))
    expect(opened.at(-1)?.focus).toBe(true)

    expect(sent[0]).toEqual({
      method: 'POST',
      path: '/pair/start',
      body: { surface: 'terminal', client_version: '2.1.299' },
      auth: undefined,
    })
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await pane.find({ type: 'Link' }))?.props.href).toBe('https://dooryard.test/pair?code=K7QM2X')
    expect((await pane.find({ type: 'Text', text: /code K7QM2X/ }))?.text).toBe(
      ' · code K7QM2X · the pane picks it up on its own',
    )
    // The 18+ check lives on the web page; the secret never shows
    expect(await pane.find({ text: /18/ })).toBeUndefined()
    expect(await pane.find({ text: /q3Vb/ })).toBeUndefined()

    await clock.advance(2000)
    expect(store.has('token')).toBe(false)
    await clock.advance(2000)
    expect(sent.filter(one => one.path === '/pair/poll').map(one => [one.body, one.auth])).toEqual([
      [{ device_secret: 'q3Vb-secret' }, undefined],
      [{ device_secret: 'q3Vb-secret' }, undefined],
    ])
    expect(store.get('token')).toBe(TOKEN)
    expect(toasts.at(-1)).toBe('signed in as lisbon_dev')

    // Approved: nothing polls the pairing any more
    const polls = sent.length
    await clock.advance(10_000)
    expect(sent.length).toBe(polls)
  })

  test('a link with an @ draws as text, not as a Link', LIVE, async ($, on) => {
    world(on, ['desktop'])
    serve(on, pairing('https://dooryard.test/pair?code=K7QM2X&who=a@b'))
    await $.session.start({ ...START, surface: 'desktop' })
    await $.command.run(typed('dooryard', ''))
    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await pane.find({ type: 'Link' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /who=a@b/ })).toBeDefined()
  })

  test('back stops the polling', LIVE, async ($, on) => {
    const { clock } = world(on, ['terminal'])
    const { sent } = serve(on, pairing('https://dooryard.test/pair?code=K7QM2X'))
    await $.session.start(START)
    await $.command.run(typed('dooryard', ''))
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'back' })
    await clock.advance(10_000)
    expect(sent.filter(one => one.path === '/pair/poll')).toEqual([])
  })

  test('sign-out revokes the token and clears the store', LIVE, async ($, on) => {
    const { store } = world(on, ['terminal'], { stored: { token: TOKEN, blocked: ['berlin_ops'], seenPostRules: true } })
    const { sent } = serve(on, pairing('https://dooryard.test/pair?code=K7QM2X'))
    await $.session.start(START)
    const answer = await $.command.run(typed('dooryard', 'signout'))
    expect(sent.at(-1)).toEqual({ method: 'POST', path: '/signout', body: undefined, auth: `Bearer ${TOKEN}` })
    expect([...store.keys()]).toEqual([])
    expect(answer.text).toBe('signed out · /dooryard signs you in')
  })

  test('the fake backend signs in by itself for the demo', FAKE, async ($, on) => {
    const { clock, store, toasts } = world(on, ['terminal'])
    await $.session.start(START)
    await $.command.run(typed('dooryard', 'signin'))
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await pane.find({ type: 'Link' }))?.props.href).toBe('https://example.com/pair?code=K7QM2X')
    await clock.advance(6000)
    expect(store.get('token')).toBe('fake-token')
    expect(toasts.at(-1)).toBe('signed in as you')
  })

  test('an expired code gets two fresh ones at most, then the polling stops', LIVE, async ($, on) => {
    const { clock } = world(on, ['terminal'])
    const { sent } = serve(on, one =>
      one.path === '/pair/start'
        ? { status: 201, json: { code: 'K7QM2X', device_secret: 's', url: 'https://dooryard.test/pair', expires_at: '2026-10-23T01:00:00Z', poll_ms: 2000 } }
        : undefined,
    )
    await $.session.start(START)
    await $.command.run(typed('dooryard', ''))
    await clock.advance(20_000)
    expect(sent.filter(one => one.path === '/pair/start').length).toBe(3)
    expect(sent.filter(one => one.path === '/pair/poll')).toEqual([])
    const before = sent.length
    await clock.advance(20_000)
    expect(sent.length).toBe(before)
  })

  test('sign-out mid-turn ends the turn with the token before revoking it', LIVE, async ($, on) => {
    const { clock } = world(on, ['terminal'], { stored: { token: TOKEN } })
    const { sent } = serve(on, pairing('https://dooryard.test/pair?code=K7QM2X'))
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    await $.command.run(typed('dooryard', 'signout'))
    const tail = sent.slice(-2).map(one => [one.path, one.auth])
    expect(tail).toEqual([
      ['/turn/end', `Bearer ${TOKEN}`],
      ['/signout', `Bearer ${TOKEN}`],
    ])
  })
})

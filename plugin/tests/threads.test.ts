import { describe, expect, test } from 'claude-code/testing'

import { LIVE, STATE, TOKEN, serve } from './server'
import type { Route } from './server'
import { PANE, world } from './world'

// Threads (api.md §7): a fetch marks messages read, so the mod fetches only the
// thread it shows and never skips a message that arrived while it sent one.

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const
const T4 = { id: 't4', handle: 'berlin_ops', city: 'Berlin', local_time: '23:10' }
const message = (id: string, from: 'me' | 'them', text: string) =>
  ({ id, from, text, sent_at: '2026-10-23T18:41:02Z', checkin: false }) as const

const mutual: Route = one =>
  one.path === '/hellos' ? { status: 201, json: { hello: { id: 'h2' }, mutual: true, thread: T4 } } : undefined

describe('threads', () => {
  test('their message sent while I wrote still arrives', LIVE, async ($, on) => {
    const { clock } = world(on, ['terminal'], { stored: { token: TOKEN } })
    const { sent } = serve(on, mutual, one => {
      if (one.path.startsWith('/state')) {
        return { status: 200, json: { ...STATE, threads: [{ id: 't4', handle: 'berlin_ops', unread: 1, hidden: 0 }] } }
      }
      if (one.path === '/threads/t4/messages' && one.method === 'GET') {
        return { status: 200, json: { messages: [message('m5', 'them', 'first')], hidden: 0 } }
      }
      if (one.path === '/threads/t4/messages?after=m5') {
        return { status: 200, json: { messages: [message('m6', 'them', 'while you typed'), message('m7', 'me', 'mine')], hidden: 0 } }
      }
      if (one.path === '/threads/t4/messages' && one.method === 'POST') {
        return { status: 201, json: { message: message('m7', 'me', 'mine') } }
      }
      return undefined
    })
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'hi' })
    await clock.advance(3000)
    await pane.press({ key: 'reply' })
    await pane.input({ key: 'reply', text: 'mine' })
    await clock.advance(5000)

    expect(sent.some(one => one.path === '/threads/t4/messages?after=m5')).toBe(true)
    expect(sent.some(one => one.path === '/threads/t4/messages?after=m7')).toBe(false)
    // Each row is a Text holding a dim name Text: the rows are the ones with words after the name
    const lines = (await pane.findAll({ type: 'Text', text: /^(you|berlin_ops): \S/ })).map(one => one.text)
    expect(lines).toEqual(['berlin_ops: first', 'you: mine', 'berlin_ops: while you typed'])
  })

  test('another thread is listed, not fetched, until it is opened', LIVE, async ($, on) => {
    const { clock } = world(on, ['terminal'], { stored: { token: TOKEN } })
    const { sent } = serve(on, mutual, one => {
      if (one.path.startsWith('/state')) {
        return {
          status: 200,
          json: {
            ...STATE,
            threads: [
              { id: 't4', handle: 'berlin_ops', unread: 0, hidden: 0 },
              { id: 't5', handle: 'oslo_dev', unread: 2, hidden: 0 },
            ],
          },
        }
      }
      if (one.path === '/threads/t5/messages') {
        return { status: 200, json: { messages: [message('n1', 'them', 'hey'), message('n2', 'them', 'you there?')], hidden: 0 } }
      }
      return undefined
    })
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'hi' })
    await clock.advance(8000)
    expect(sent.some(one => one.path.startsWith('/threads/t5'))).toBe(false)
    expect((await pane.find({ key: 'thread-t5' }))?.props.label).toBe('oslo_dev · 2 new')

    await pane.press({ key: 'thread-t5' })
    expect(sent.some(one => one.path === '/threads/t5/messages')).toBe(true)
    expect((await pane.find({ type: 'Text', text: /you there/ }))?.text).toBe('oslo_dev: you there?')
  })

  test('a 410 says who ended the thread, as the server keys it', LIVE, async ($, on) => {
    const { clock, toasts } = world(on, ['terminal'], { stored: { token: TOKEN } })
    serve(on, mutual, one =>
      one.path === '/threads/t4/messages' && one.method === 'POST'
        ? { status: 410, json: { error: { code: 'gone', copy_key: 'thread.ended.by_you', params: { handle: 'berlin_ops' } } } }
        : undefined,
    )
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'hi' })
    await pane.press({ key: 'reply' })
    await pane.input({ key: 'reply', text: 'still there?' })
    expect(toasts.at(-1)).toBe('Thread ended and berlin_ops blocked.')
    expect(await pane.find({ key: 'reply' })).toBeUndefined()
  })
})

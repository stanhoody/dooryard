import { describe, expect, test } from 'claude-code/testing'

import { photoBox } from '../hooks/photo'
import { CARD, LIVE, STATE, TOKEN, error, serve } from './server'
import type { Route } from './server'
import { PANE, world } from './world'

// Photo cards (api.md §11, 1.2): the terminal draws an Image, every other
// surface a dim line. The poster gets a one-time link to a web page (api.md
// 1.5); the mod reads no file. After a failed age check the key hides.

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const withPhoto: Route = one => {
  if (one.path === '/deal') return { status: 200, json: { card: { ...CARD, has_photo: true } } }
  if (one.path === '/cards/c9/photo' && one.method === 'GET') {
    return { status: 200, json: { png_base64: PNG, columns: 40, rows: 20, alt: 'photo from berlin_ops' } }
  }
  return undefined
}

const passed: Route = one => {
  const state = { ...STATE, me: { ...STATE.me, age_gate: 'pass' } }
  if (one.path === '/turn/start') return { status: 201, json: { turn_id: 'b1', poll_ms: 5000, state } }
  if (one.path.startsWith('/state')) return { status: 200, json: state }
  if (one.path === '/cards') return { status: 201, json: { card: { id: 'mine1', text: 'x', handle: 'lisbon_dev' } } }
  return undefined
}

describe('the viewer', () => {
  test('the terminal draws the photo as an Image', LIVE, async ($, on) => {
    const { clock } = world(on, ['terminal'], { stored: { token: TOKEN } })
    serve(on, withPhoto)
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const image = await pane.find({ type: 'Image' })
    expect(image?.props.source).toEqual({ png: PNG })
    expect(image?.props.alt).toBe('photo from berlin_ops')
    expect([image?.props.columns, image?.props.rows]).toEqual([40, 20])
  })

  for (const surface of ['desktop', 'vscode'] as const) {
    test(`${surface} draws the dim line and never fetches the photo`, LIVE, async ($, on) => {
      const { clock } = world(on, [surface], { stored: { token: TOKEN } })
      const { sent } = serve(on, withPhoto)
      await $.session.start({ ...START, surface })
      await $.turn.start({ text: '', turnId: 't1' })
      await clock.advance(2000)
      const pane = await $.ui.mount({ ...PANE, surface })
      expect(await pane.find({ type: 'Text', text: /photo not shown/ })).toBeDefined()
      expect(sent.some(one => one.path.endsWith('/photo'))).toBe(false)
    })
  }
})

describe('the poster', () => {
  const linked: Route = one =>
    one.path === '/cards/mine1/photo-link'
      ? { status: 201, json: { url: 'https://dooryard.test/photo?link=abc', expires_at: '2026-10-30T12:10:00.000Z' } }
      : undefined

  test('p asks for a one-time link and the pane shows it; no file is read', LIVE, async ($, on) => {
    const reads: string[] = []
    on('fs.read', ($, e) => {
      reads.push(e.path)
      return { value: { base64: PNG } }
    })
    const { clock } = world(on, ['terminal'], { stored: { token: TOKEN } })
    const { sent } = serve(on, passed, linked)
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(5000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await pane.find({ key: 'photo' })).toBeUndefined()
    await pane.press({ key: 'post' })
    await pane.input({ key: 'post', text: 'waiting on a build' })
    expect((await pane.find({ key: 'photo', type: 'Button' }))?.props.hotkey).toBe('p')

    await pane.press({ key: 'photo' })
    expect(sent.some(one => one.path === '/cards/mine1/photo-link' && one.method === 'POST')).toBe(true)
    expect((await pane.find({ type: 'Link' }))?.props.href).toBe('https://dooryard.test/photo?link=abc')
    expect(await pane.find({ type: 'Text', text: /^Photos are permanent/ })).toBeDefined()
    expect(await pane.find({ type: 'Input' })).toBeUndefined()
    expect(reads).toEqual([])
  })

  test('a refused link shows the server line and stays on the card', LIVE, async ($, on) => {
    const { clock, toasts } = world(on, ['terminal'], { stored: { token: TOKEN } })
    serve(on, passed, one => (one.path === '/cards/mine1/photo-link' ? error(403, 'cooldown') : undefined))
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(5000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'post' })
    await pane.input({ key: 'post', text: 'waiting on a build' })
    await pane.press({ key: 'photo' })
    expect(await pane.find({ type: 'Link' })).toBeUndefined()
    expect(toasts.length).toBeGreaterThan(0)
  })

  test('after a failed age check the photo key stays hidden', LIVE, async ($, on) => {
    const { clock } = world(on, ['terminal'], { stored: { token: TOKEN } })
    const failed = { ...STATE, me: { ...STATE.me, age_gate: 'fail' } }
    serve(on, one => {
      if (one.path === '/turn/start') return { status: 201, json: { turn_id: 'b1', poll_ms: 5000, state: failed } }
      if (one.path.startsWith('/state')) return { status: 200, json: failed }
      if (one.path === '/cards') return { status: 201, json: { card: { id: 'mine1' } } }
      return undefined
    })
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(5000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'post' })
    await pane.input({ key: 'post', text: 'waiting on a build' })
    expect(await pane.find({ key: 'photo' })).toBeUndefined()
  })
})

test('photo box fits the pane', () => {
  expect(photoBox(40, 20, 60)).toEqual({ columns: 40, rows: 20 })
  expect(photoBox(80, 40, 60)).toEqual({ columns: 60, rows: 30 })
})

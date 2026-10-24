import { describe, expect, test } from 'claude-code/testing'

import { photoBox, photoMime } from '../hooks/photo'
import { CARD, LIVE, STATE, TOKEN, error, serve } from './server'
import type { Route } from './server'
import { PANE, world } from './world'

// Photo cards (api.md §11): the terminal draws an Image, every other surface
// a dim line; the poster types one path, sees that photos are permanent, and
// the mod reads that one file. Off until the server's age check says pass.

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
  test('one path, photos are permanent, one read, one POST', LIVE, async ($, on) => {
    const reads: { path: string; as: string }[] = []
    on('fs.read', ($, e) => {
      reads.push({ path: e.path, as: e.as })
      return { value: { base64: PNG } }
    })
    const { clock, toasts } = world(on, ['terminal'], { stored: { token: TOKEN } })
    const { sent } = serve(on, passed, one =>
      one.path === '/cards/mine1/photo' ? { status: 201, json: { status: 'held' } } : undefined,
    )
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(5000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await pane.find({ key: 'photo' })).toBeUndefined()
    await pane.press({ key: 'post' })
    await pane.input({ key: 'post', text: 'waiting on a build' })
    expect((await pane.find({ key: 'photo', type: 'Button' }))?.props.hotkey).toBe('p')

    await pane.press({ key: 'photo' })
    await pane.input({ key: 'photo', text: 'desk.png' })
    expect(await pane.find({ type: 'Text', text: /^Photos are permanent/ })).toBeDefined()
    expect(reads).toEqual([])
    await pane.input({ key: 'photo', text: 'desk.png' })
    expect(reads.length).toBe(1)
    expect(reads[0]?.path.endsWith('desk.png')).toBe(true)
    expect(reads[0]?.as).toBe('bytes')
    expect(sent.find(one => one.path === '/cards/mine1/photo')?.body).toEqual({
      image_base64: PNG,
      mime: 'image/png',
      ack_permanent: true,
    })
    expect(toasts.at(-1)).toBe('Photo on hold while a human looks. Your text card is live.')
  })

  test('off while the age check has not passed', LIVE, async ($, on) => {
    const { clock } = world(on, ['terminal'], { stored: { token: TOKEN } })
    serve(on, one => (one.path === '/cards' ? { status: 201, json: { card: { id: 'mine1' } } } : undefined))
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(5000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'post' })
    await pane.input({ key: 'post', text: 'waiting on a build' })
    expect(await pane.find({ key: 'photo' })).toBeUndefined()
  })

  test('over 2 MiB is not sent; the age gate answer shows its link', LIVE, async ($, on) => {
    let big = true
    on('fs.read', () => ({ value: { base64: big ? 'A'.repeat(2_796_205) : PNG } }))
    const { clock, toasts } = world(on, ['terminal'], { stored: { token: TOKEN } })
    const { sent } = serve(on, passed, one => {
      if (one.path !== '/cards/mine1/photo') return undefined
      const answer = error(403, 'age_gate_required')
      return { status: 403, json: { error: { ...answer.json.error, params: { url: 'https://age.example/check?s=1' } } } }
    })
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(5000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'post' })
    await pane.input({ key: 'post', text: 'waiting on a build' })
    await pane.press({ key: 'photo' })
    await pane.input({ key: 'photo', text: 'big.jpg' })
    await pane.input({ key: 'photo', text: 'big.jpg' })
    expect(toasts.at(-1)).toBe('2 MiB max')
    expect(sent.some(one => one.path === '/cards/mine1/photo')).toBe(false)

    big = false
    await pane.input({ key: 'photo', text: 'big.jpg' })
    expect(sent.find(one => one.path === '/cards/mine1/photo')?.body).toMatchObject({ mime: 'image/jpeg' })
    expect((await pane.find({ type: 'Link' }))?.props.href).toBe('https://age.example/check?s=1')
  })
})

test('photo helpers: the two types and a box that fits the pane', () => {
  expect(photoMime('a/Desk.PNG')).toBe('image/png')
  expect(photoMime('b.jpeg')).toBe('image/jpeg')
  expect(photoMime('c.gif')).toBeUndefined()
  expect(photoBox(40, 20, 60)).toEqual({ columns: 40, rows: 20 })
  expect(photoBox(80, 40, 60)).toEqual({ columns: 60, rows: 30 })
})

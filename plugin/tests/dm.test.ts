import { expect, test } from 'claude-code/testing'

import { BAND, PANE, world } from './world'

// The demo path on the fake backend, as the G0 video shows it: post a card,
// someone says hi, see who, hi back, write, and their answer lands as a toast.

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

test('post, a hi comes in, hi back, and their answer lands as a toast', async ($, on) => {
  const { clock, toasts } = world(on, ['terminal'])
  await $.session.start(START)
  await $.turn.start({ text: '', turnId: 't1' })
  await clock.advance(2000)

  const band = await $.ui.mount({ ...BAND(true), surface: 'terminal' })
  await band.press({ key: 'post' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.input({ key: 'post', text: 'waiting on a 40-minute build, Lisbon' })

  // Ten seconds after the card went live the fake's hello lands; the polls see it
  await clock.advance(15_000)
  expect((await band.find({ type: 'Text', text: /waiting/ }))?.text).toMatch(/· 1 hi waiting ·/)
  await pane.press({ key: 'see' })
  expect((await pane.find({ type: 'Text', text: /said hi/ }))?.text).toBe('kai said hi')
  await pane.press({ key: 'hi-back' })
  expect(toasts.at(-1)).toBe('mutual with kai · 4 reply · Tab, then x ends it and blocks')

  await pane.input({ key: 'reply', text: 'same, ci is red' })
  expect((await pane.find({ type: 'Text', text: /ci is red/ }))?.text).toBe('you: same, ci is red')
  await clock.advance(10_000)
  expect(toasts.at(-1)).toBe('kai: same here. what is it building?')
  expect((await pane.find({ type: 'Text', text: /what is it building/ }))?.text).toBe('kai: same here. what is it building?')

  await pane.press({ key: 'end' })
  expect(toasts.at(-1)).toBe('Thread ended and kai blocked.')
  expect(await pane.find({ key: 'reply' })).toBeUndefined()
})

test('the storyboard loop: 2 skips, 1 says hi, the hi comes back with one line', async ($, on) => {
  const { clock, toasts } = world(on, ['terminal'])
  await $.session.start(START)
  await $.turn.start({ text: '', turnId: 't1' })
  await clock.advance(2000)
  const band = await $.ui.mount({ ...BAND(true), surface: 'terminal' })
  await band.press({ key: 'next' })
  expect((await band.find({ type: 'Text', text: /waiting/ }))?.text).toMatch(/shipping a mod tonight/)
  await band.press({ key: 'hi' })
  expect(toasts.at(-1)).toBe('hi sent to tomas. If they say hi back, 4 opens a thread.')

  // Six seconds later tomas says hi back; the next poll opens the thread with their line
  await clock.advance(10_000)
  expect(toasts.at(-1)).toBe('tomas: ha, same. what are you shipping?')
  // 4 is on the band now: from an empty prompt it opens the thread in the pane, focused
  expect((await band.find({ key: 'reply' }))?.props.hotkey).toBe('4')
  await band.press({ key: 'reply' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.find({ type: 'Text', text: /what are you shipping/ }))?.text).toBe('tomas: ha, same. what are you shipping?')
  await pane.input({ key: 'reply', text: 'a band for the wait' })
  expect((await pane.find({ type: 'Text', text: /band for the wait/ }))?.text).toBe('you: a band for the wait')
})

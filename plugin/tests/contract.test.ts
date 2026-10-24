import { expect, test } from 'claude-code/testing'
import type { PluginRegisterUses, Register } from 'claude-code'

import { LIVE, TOKEN, serve } from './server'
import { PANE, world } from './world'

// What the mod may hook and call (concept §4 and §6, AGENTS.md): turn.start,
// turn.complete, interface events and its own command; no prompt.*, tool.*,
// session.messages, env or process. Read off the engine's own scan of the
// module, the one `claude plugin validate` prints, at the moment it loads.

const ALLOWED_EVENTS = [
  'session.start',
  'command.run',
  'turn.start',
  'turn.complete',
  'ui.render',
  'ui.press',
  'ui.input',
  'ui.select',
  'ui.close',
]

const ALLOWED_CALLS = [
  /^ui\./,
  /^state\./,
  /^store\./,
  /^clock\./,
  /^http\.fetch$/,
  /^command\.register$/,
  /^session\.(surfaces|version)$/,
  // The one disclosed read: the photo path the person types (E02-S6)
  /^fs\.read$/,
]

// Loaded ahead of Yard in an environment of its own, it logs what the engine
// scanned in Yard's module; the test's own ui.log hook beneath catches it
const scan: Register = on => {
  on('plugin.register', async ($, e, next) => {
    if (e.name === 'dooryard') $.ui.log(`scan ${JSON.stringify(e.uses)}`, { to: 'debug' })
    return next(e)
  })
}
const scanner = { name: 'scanner', tier: 'prepend', register: scan } as const

test('hooks only turns, the interface and its own command', { plugins: [scanner] }, async ($, on) => {
  on('plugin.register', () => ({ allow: true }))
  const { logs } = world(on, ['terminal'])
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const line = logs.find(text => text.startsWith('scan '))
  if (line === undefined) throw new Error('the scan of dooryard never arrived')
  const uses = JSON.parse(line.slice('scan '.length)) as PluginRegisterUses

  // Not a vacuous scan: the band's own hooks and calls are in it
  expect(uses.events).toContain('turn.start')
  expect(uses.calls).toContain('ui.status')
  for (const event of uses.events) expect(ALLOWED_EVENTS).toContain(event)
  expect(uses.events.filter(event => /^(prompt|tool)\.|^session\.messages$|^env\.|^process\./.test(event))).toEqual([])
  for (const call of uses.calls) expect(ALLOWED_CALLS.some(rule => rule.test(call))).toBe(true)
  expect(uses.env).toBeUndefined()
})

test('a double press says hi once per card', LIVE, async ($, on) => {
  const { clock } = world(on, ['terminal'], { stored: { token: TOKEN } })
  // The first hello never answers, so the second press lands while it is in flight
  const { sent } = serve(on, one => (one.path === '/hellos' ? 'never' : undefined))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.start({ text: '', turnId: 't1' })
  await clock.advance(2000)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  void pane.press({ key: 'hi' })
  void pane.press({ key: 'hi' })
  await clock.advance(1000)
  expect(sent.filter(one => one.path === '/hellos').length).toBe(1)
})

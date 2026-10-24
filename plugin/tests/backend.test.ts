import { expect, test } from 'claude-code/testing'

import { createBackend } from '../hooks/backend'
import type { Backend, Io } from '../hooks/backend'

/** The world a backend reaches, with no network: a fixed clock, no token. */
const at = (ms: number): Io => ({
  now: () => Promise.resolve(ms),
  fetch: () => Promise.reject(new Error('no network in this test')),
  sleep: () => new Promise(() => undefined),
  token: () => Promise.resolve(undefined),
  signedOut: () => Promise.resolve(),
})

function fake(nowMs = 0): Backend {
  const choice = createBackend({ backend: 'fake', api_url: '' }, at(nowMs))
  if (!('backend' in choice)) throw new Error('no fake backend')
  return choice.backend
}

test('the backend option picks the fake by default', async () => {
  expect(fake().kind).toBe('fake')
})

test('live needs an https API URL', async () => {
  const problem = { problem: 'live backend needs an https API URL' }
  expect(createBackend({ backend: 'live', api_url: '' }, at(0))).toEqual(problem)
  expect(createBackend({ backend: 'live', api_url: 'http://dooryard.example' }, at(0))).toEqual(problem)
  expect(createBackend({ backend: 'live', api_url: 'https://user@yard.example' }, at(0))).toEqual(problem)
  const choice = createBackend({ backend: 'live', api_url: 'https://dooryard.example/' }, at(0))
  expect('backend' in choice && choice.backend.kind).toBe('live')
  const local = createBackend({ backend: 'live', api_url: 'http://localhost:3000' }, at(0))
  expect('backend' in local && local.backend.kind).toBe('live')
})

test('the fake deals cards round-robin with a count and local time', async () => {
  const backend = fake(Date.UTC(2026, 9, 23, 1, 10))
  const started = await backend.turnStart('terminal')
  if (!started.ok) throw new Error('no turn')
  expect(started.value.state.waiting > 0).toBe(true)
  const first = await backend.deal(started.value.turnId)
  expect(first).toEqual({
    ok: true,
    value: {
      id: 'fake-card-mira', text: 'rewriting the same migration for the third time, send coffee', handle: 'mira', city: 'Lisbon',
      localTime: '02:10', hasPhoto: false, canHi: true,
    },
  })
  const second = await backend.deal(started.value.turnId)
  expect(second.ok && second.value?.handle).toBe('tomas')
})

test('the fake takes one hello per card and needs a live turn', async () => {
  const backend = fake()
  const started = await backend.turnStart('terminal')
  if (!started.ok) throw new Error('no turn')
  const turn = started.value.turnId
  expect(await backend.hello('fake-card-mira', turn)).toEqual({ ok: true, value: { mutual: false } })
  expect(await backend.hello('fake-card-mira', turn)).toEqual({
    ok: false, code: 'already_said_hi', copyKey: 'hi.limit.card',
  })
  await backend.turnEnd(turn)
  expect(await backend.state(turn)).toEqual({ ok: false, code: 'gone' })
  expect(await backend.deal(turn)).toEqual({ ok: false, code: 'no_live_turn' })
})

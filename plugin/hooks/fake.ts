import type { YardCard, YardMessage, YardServerState, YardThread } from '../types'
import type { ApiResult, Backend } from './backend'

// The fake backend for the G0 demo: made-up posters, kept in memory, gone on
// reload. It answers in the shapes of contracts/api.md v1.0 and mimics the
// few rules the pane shows: one hello per card, a card lives only while its
// turn is live, the poll answers 410 for a turn that is not live, a mutual
// hello opens a thread, the other side writes back.

type Poster = {
  handle: string
  text: string
  city: string
  utcOffsetMin: number
  /** The poster said hi to me first, so my hi makes it mutual. */
  saidHiFirst?: true
  /** The poster says hi back a few seconds after my hi, and writes one line. */
  saysHiBack?: true
}

// The first two cards are the storyboard copy of E05 video.md §2, for the G0
// cut, which never goes public: card one, 2 skips to card two, 1 says hi, the
// hi comes back with one line.
const POSTERS: readonly Poster[] = [
  { handle: 'mira', text: 'rewriting the same migration for the third time, send coffee', city: 'Lisbon', utcOffsetMin: 60 },
  { handle: 'tomas', text: "shipping a mod tonight, agent's on the tests", city: 'Berlin', utcOffsetMin: 120, saysHiBack: true },
  { handle: 'aiko', text: 'porting a shader to WebGPU', city: 'Osaka', utcOffsetMin: 540, saidHiFirst: true },
  { handle: 'devon', text: 'fixing the flaky e2e test, again', city: 'Austin', utcOffsetMin: -300 },
  { handle: 'lena', text: 'letting it write the tests I skipped', city: 'Warsaw', utcOffsetMin: 120, saidHiFirst: true },
  { handle: 'ravi', text: 'bisecting a memory leak', city: 'Pune', utcOffsetMin: 330 },
  { handle: 'noor', text: 'generating 400 fixtures', city: 'Cairo', utcOffsetMin: 180 },
  { handle: 'kai', text: 'teaching it our deploy script', city: 'Vancouver', utcOffsetMin: -420 },
]

/** The poster whose hello reaches my card once it has been live a while. */
const ADMIRER = POSTERS[7]!
const DRIFT = [0, 1, 2, -1, 3, -2, 1, 0, -3, 2] as const
const HELLO_AFTER_MS = 10_000
const REPLY_AFTER_MS = 6_000
const REPLY = 'same here. what is it building?'
const HI_BACK_AFTER_MS = 6_000
const HI_BACK_LINE = 'ha, same. what are you shipping?'

function localTime(nowMs: number, utcOffsetMin: number): string {
  const minutes = Math.floor(nowMs / 60_000) + utcOffsetMin
  const inDay = ((minutes % 1440) + 1440) % 1440
  const hh = String(Math.floor(inDay / 60)).padStart(2, '0')
  const mm = String(inDay % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

const ok = <T>(value: T): ApiResult<T> => ({ ok: true, value })

type FakeThread = {
  poster: Poster
  list: YardMessage[]
  /** Index into `list` of the first message I have not fetched. */
  read: number
  replyAt: number | null
}

export function createFake(now: () => Promise<number>): Backend {
  let waiting = 37
  let polls = 0
  let turns = 0
  let dealt = 0
  let sent = 0
  const live = new Set<string>()
  const greeted = new Set<string>()
  const blocked = new Set<string>()
  const threads = new Map<string, FakeThread>()
  let myCard: { id: string; turnId: string; postedAt: number } | null = null
  let hello: 'none' | 'waiting' | 'opened' = 'none'
  let pairPolls = 0
  let hiBack: { poster: Poster; at: number } | null = null

  const message = (from: 'me' | 'them', line: string, nowMs: number): YardMessage => {
    sent += 1
    return { id: `fake-message-${sent}`, from, text: line, sentAt: new Date(nowMs).toISOString(), checkin: false }
  }

  /** The other side writes back a few seconds after my first message. */
  const settle = (nowMs: number) => {
    for (const one of threads.values()) {
      if (one.replyAt !== null && nowMs >= one.replyAt) {
        one.list.push(message('them', REPLY, nowMs))
        one.replyAt = null
      }
    }
    if (myCard !== null && hello === 'none' && nowMs - myCard.postedAt >= HELLO_AFTER_MS) hello = 'waiting'
    if (hiBack !== null && nowMs >= hiBack.at && !blocked.has(hiBack.poster.handle)) {
      // Their hi back makes it mutual; the thread opens with their one line
      const id = `fake-thread-${hiBack.poster.handle}`
      threads.set(id, { poster: hiBack.poster, list: [message('them', HI_BACK_LINE, nowMs)], read: 0, replyAt: null })
      hiBack = null
    }
  }

  const threadOf = (poster: Poster, nowMs: number): YardThread => {
    const id = `fake-thread-${poster.handle}`
    if (!threads.has(id)) threads.set(id, { poster, list: [], read: 0, replyAt: null })
    return { id, handle: poster.handle, city: poster.city, localTime: localTime(nowMs, poster.utcOffsetMin) }
  }

  const state = async (): Promise<YardServerState> => {
    const nowMs = await now()
    settle(nowMs)
    waiting = Math.max(8, waiting + (DRIFT[polls % DRIFT.length] ?? 0))
    polls += 1
    return {
      waiting,
      hiWaiting: hello === 'waiting' ? 1 : 0,
      myCard: myCard === null ? null : { id: myCard.id, hellos: hello === 'none' ? 0 : 1 },
      threads: [...threads.entries()].map(([id, one]) => ({
        id,
        handle: one.poster.handle,
        unread: one.list.slice(one.read).filter(m => m.from === 'them').length,
        hidden: 0,
      })),
      ageGate: 'none',
      notices: [],
      bandNotice: null,
    }
  }

  const cardAt = (index: number, nowMs: number): YardCard => {
    const poster = POSTERS[index % POSTERS.length] ?? POSTERS[0]!
    const id = `fake-card-${poster.handle}`
    return {
      id,
      text: poster.text,
      handle: poster.handle,
      city: poster.city,
      localTime: localTime(nowMs, poster.utcOffsetMin),
      hasPhoto: false,
      canHi: !greeted.has(id),
    }
  }

  const notLive = <T>(): ApiResult<T> => ({ ok: false, code: 'no_live_turn' })
  const ended = <T>(handle = ''): ApiResult<T> => ({
    ok: false,
    code: 'gone',
    copyKey: 'thread.ended.by_them',
    params: { handle },
  })

  return {
    kind: 'fake',
    // The fake pairing approves itself on the third poll, as if signed in on the web
    pairStart: async () => {
      pairPolls = 0
      const nowMs = await now()
      return ok({
        code: 'K7QM2X',
        deviceSecret: 'fake-secret',
        url: 'https://example.com/pair?code=K7QM2X',
        expiresAt: new Date(nowMs + 600_000).toISOString(),
        pollMs: 2000,
      })
    },
    pairPoll: async deviceSecret => {
      if (deviceSecret !== 'fake-secret') return { ok: false, code: 'gone' }
      pairPolls += 1
      return ok(pairPolls < 3 ? { status: 'pending' } : { status: 'approved', token: 'fake-token', handle: 'you' })
    },
    signout: async () => ok(null),
    turnStart: async () => {
      turns += 1
      const turnId = `fake-turn-${turns}`
      live.add(turnId)
      return ok({ turnId, pollMs: 5000, state: await state() })
    },
    state: async turnId => (live.has(turnId) ? ok(await state()) : { ok: false, code: 'gone' }),
    turnEnd: async turnId => {
      live.delete(turnId)
      if (myCard?.turnId === turnId) myCard = null
      return ok(null)
    },
    deal: async turnId => {
      if (!live.has(turnId)) return notLive()
      // Round-robin, never across a block
      for (let step = 0; step < POSTERS.length; step += 1) {
        const card = cardAt(dealt, await now())
        dealt += 1
        if (!blocked.has(card.handle)) return ok(card)
      }
      return ok(null)
    },
    post: async (turnId, text) => {
      if (!live.has(turnId)) return notLive()
      const line = text.trim()
      if (line.length === 0 || line.length > 80) return { ok: false, code: 'invalid', copyKey: 'post.too_long' }
      myCard = { id: `fake-card-mine-${turns}`, turnId, postedAt: await now() }
      return ok({ id: myCard.id })
    },
    hello: async (cardId, turnId) => {
      if (!live.has(turnId)) return notLive()
      if (greeted.has(cardId)) return { ok: false, code: 'already_said_hi', copyKey: 'hi.limit.card' }
      const poster = POSTERS.find(one => `fake-card-${one.handle}` === cardId)
      if (poster === undefined || blocked.has(poster.handle)) return { ok: false, code: 'not_found' }
      greeted.add(cardId)
      if (poster.saysHiBack === true) hiBack = { poster, at: (await now()) + HI_BACK_AFTER_MS }
      if (poster.saidHiFirst !== true) return ok({ mutual: false })
      return ok({ mutual: true, thread: threadOf(poster, await now()) })
    },
    helloOpen: async () => {
      settle(await now())
      if (hello !== 'waiting' || blocked.has(ADMIRER.handle)) return ok(null)
      hello = 'opened'
      const nowMs = await now()
      return ok({
        id: 'fake-hello-1',
        handle: ADMIRER.handle,
        city: ADMIRER.city,
        localTime: localTime(nowMs, ADMIRER.utcOffsetMin),
        canHiBack: true,
      })
    },
    helloBack: async helloId => {
      if (helloId !== 'fake-hello-1' || blocked.has(ADMIRER.handle)) return { ok: false, code: 'not_found' }
      return ok(threadOf(ADMIRER, await now()))
    },
    messages: async (threadId, after) => {
      const one = threads.get(threadId)
      if (one === undefined) return ended()
      settle(await now())
      const from = after === undefined ? 0 : one.list.findIndex(m => m.id === after) + 1
      one.read = one.list.length
      return ok({ messages: one.list.slice(from), hidden: 0 })
    },
    send: async (threadId, text) => {
      const one = threads.get(threadId)
      if (one === undefined) return ended()
      const line = text.trim()
      if (line.length === 0 || line.length > 500) return { ok: false, code: 'invalid', copyKey: 'dm.too_long' }
      const nowMs = await now()
      const mine = message('me', line, nowMs)
      if (!one.list.some(m => m.from === 'me')) one.replyAt = nowMs + REPLY_AFTER_MS
      one.list.push(mine)
      one.read = one.list.length
      return ok(mine)
    },
    hidden: async threadId => (threads.has(threadId) ? ok([]) : ended()),
    end: async threadId => {
      const one = threads.get(threadId)
      if (one !== undefined) blocked.add(one.poster.handle)
      threads.delete(threadId)
      return ok(null)
    },
    // api.md §11: photos answer 501 until the age gate (E03-S7) is built
    photo: async () => ({ ok: false, code: 'not_implemented' }),
    postPhoto: async () => ({ ok: false, code: 'not_implemented' }),
    block: async handle => {
      blocked.add(handle)
      threads.delete(`fake-thread-${handle}`)
      return ok(null)
    },
    report: async () => ok({ copyKey: 'report.sent' }),
  }
}

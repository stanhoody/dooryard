import type { HttpInit } from 'claude-code'

import type { YardCard, YardHello, YardMessage, YardPhoto, YardServerState, YardThread } from '../types'
import type { ApiResult, Backend, Io } from './backend'

// The live backend: contracts/api.md v1.0 over $.http.fetch, text JSON only,
// to the one host the `api_url` option names and to nothing else. Every
// answer is read field by field; a field it does not know is ignored.

/** api.md §1: no answer within 8 seconds is a failure; the last state stays drawn. */
const CAP_MS = 8000
/** api.md §13: the server says how often to poll; never faster than this. */
const MIN_POLL_MS = 2000

type Raw = Record<string, unknown>

function record(value: unknown): Raw {
  return typeof value === 'object' && value !== null ? (value as Raw) : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function strings(value: unknown): Readonly<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const [key, one] of Object.entries(record(value))) {
    if (typeof one === 'string' || typeof one === 'number') out[key] = String(one)
  }
  return out
}

function toCard(value: unknown): YardCard | null {
  const raw = record(value)
  if (typeof raw.id !== 'string') return null
  return {
    id: raw.id,
    text: text(raw.text),
    handle: text(raw.handle),
    city: text(raw.city),
    localTime: text(raw.local_time),
    hasPhoto: raw.has_photo === true,
    canHi: raw.can_hi !== false,
  }
}

function toState(value: unknown): YardServerState {
  const raw = record(value)
  const mine = record(raw.my_card)
  const gate = record(raw.me).age_gate
  const incident = text(record(record(raw.band_notice).params).notice)
  return {
    waiting: count(raw.waiting),
    hiWaiting: count(raw.hi_waiting),
    myCard: typeof mine.id === 'string' ? { id: mine.id, hellos: count(mine.hellos) } : null,
    threads: (Array.isArray(raw.threads) ? raw.threads : []).map(record).map(one => ({
      id: text(one.id),
      handle: text(one.handle),
      unread: count(one.unread),
      hidden: count(one.hidden),
    })),
    ageGate: gate === 'pending' || gate === 'pass' || gate === 'fail' ? gate : 'none',
    notices: (Array.isArray(raw.notices) ? raw.notices : [])
      .map(record)
      .filter(one => typeof one.copy_key === 'string')
      .map(one => ({ copyKey: text(one.copy_key), params: { ...strings(one.params) } })),
    bandNotice: incident === '' ? null : incident,
  }
}

function toPhoto(cardId: string, raw: Raw): YardPhoto {
  return {
    cardId,
    png: text(raw.png_base64),
    columns: Math.min(255, Math.max(1, count(raw.columns) || 40)),
    rows: Math.min(255, Math.max(1, count(raw.rows) || 20)),
    alt: text(raw.alt) || ' ',
  }
}

function toThread(value: unknown): YardThread {
  const raw = record(value)
  return { id: text(raw.id), handle: text(raw.handle), city: text(raw.city), localTime: text(raw.local_time) }
}

function toMessage(value: unknown): YardMessage {
  const raw = record(value)
  return {
    id: text(raw.id),
    from: raw.from === 'me' ? 'me' : 'them',
    text: text(raw.text),
    sentAt: text(raw.sent_at),
    checkin: raw.checkin === true,
  }
}

function toHello(value: unknown): YardHello | null {
  const raw = record(value)
  if (typeof raw.id !== 'string') return null
  return {
    id: raw.id,
    handle: text(raw.handle),
    city: text(raw.city),
    localTime: text(raw.local_time),
    canHiBack: raw.can_hi_back === true,
  }
}

const messageList = (value: unknown) => (Array.isArray(value) ? value.map(toMessage) : [])

export function createLive(base: string, io: Io): Backend {
  const root = `${base}/api/v1`

  /** One request; pairing goes without the token (api.md §1, Auth). */
  async function call(method: 'GET' | 'POST', path: string, body?: unknown, isSigned = true): Promise<ApiResult<Raw>> {
    const headers: Record<string, string> = {}
    if (isSigned) {
      const token = await io.token()
      if (token === undefined) return { ok: false, code: 'unauthorized' }
      headers.Authorization = `Bearer ${token}`
    }
    const init: HttpInit = { method, headers }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    try {
      const answer = await Promise.race([io.fetch(`${root}${path}`, init), io.sleep(CAP_MS).then(() => null)])
      if (answer === null) return { ok: false, code: 'unavailable' }
      let parsed: unknown
      try {
        parsed = JSON.parse(answer.text)
      } catch {
        return { ok: false, code: answer.ok ? 'server_error' : 'unavailable' }
      }
      if (answer.ok) return { ok: true, value: record(parsed) }
      const error = record(record(parsed).error)
      const code = typeof error.code === 'string' ? error.code : 'server_error'
      if (code === 'unauthorized') await io.signedOut()
      const copyKey = typeof error.copy_key === 'string' ? error.copy_key : undefined
      return { ok: false, code, ...(copyKey === undefined ? {} : { copyKey }), params: strings(error.params) }
    } catch {
      return { ok: false, code: 'unavailable' }
    }
  }

  /** The same answer with its value read into the mod's shape. */
  async function read<T>(answer: Promise<ApiResult<Raw>>, shape: (raw: Raw) => T): Promise<ApiResult<T>> {
    const settled = await answer
    return settled.ok ? { ok: true, value: shape(settled.value) } : settled
  }

  const id = (value: string) => encodeURIComponent(value)

  return {
    kind: 'live',
    pairStart: (surface, clientVersion) =>
      read(call('POST', '/pair/start', { surface, client_version: clientVersion }, false), raw => ({
        code: text(raw.code),
        deviceSecret: text(raw.device_secret),
        url: text(raw.url),
        expiresAt: text(raw.expires_at),
        pollMs: Math.max(MIN_POLL_MS, count(raw.poll_ms) || 2000),
      })),
    pairPoll: deviceSecret =>
      read(call('POST', '/pair/poll', { device_secret: deviceSecret }, false), raw =>
        raw.status === 'approved' && typeof raw.token === 'string'
          ? { status: 'approved' as const, token: raw.token, handle: text(raw.handle) }
          : { status: 'pending' as const },
      ),
    signout: () => read(call('POST', '/signout'), () => null),
    turnStart: surface =>
      read(call('POST', '/turn/start', { surface }), raw => ({
        turnId: text(raw.turn_id),
        pollMs: Math.max(MIN_POLL_MS, count(raw.poll_ms) || 5000),
        state: toState(raw.state),
      })),
    state: turnId => read(call('GET', `/state?turn_id=${id(turnId)}`), toState),
    turnEnd: turnId => read(call('POST', '/turn/end', { turn_id: turnId }), () => null),
    deal: turnId => read(call('POST', '/deal', { turn_id: turnId }), raw => toCard(raw.card)),
    post: (turnId, line) =>
      read(call('POST', '/cards', { turn_id: turnId, text: line }), raw => ({ id: text(record(raw.card).id) })),
    hello: (cardId, turnId) =>
      read(call('POST', '/hellos', { card_id: cardId, turn_id: turnId }), raw =>
        raw.mutual === true && raw.thread !== undefined
          ? { mutual: true, thread: toThread(raw.thread) }
          : { mutual: false },
      ),
    helloOpen: () => read(call('POST', '/hellos/open'), raw => toHello(raw.hello)),
    helloBack: helloId => read(call('POST', `/hellos/${id(helloId)}/back`), raw => toThread(raw.thread)),
    messages: (threadId, after) =>
      read(
        call('GET', `/threads/${id(threadId)}/messages${after === undefined ? '' : `?after=${id(after)}`}`),
        raw => ({ messages: messageList(raw.messages), hidden: count(raw.hidden) }),
      ),
    send: (threadId, line, confirm) =>
      read(call('POST', `/threads/${id(threadId)}/messages`, { text: line, confirm }), raw =>
        toMessage(raw.message),
      ),
    hidden: threadId => read(call('POST', `/threads/${id(threadId)}/hidden`), raw => messageList(raw.messages)),
    end: threadId => read(call('POST', `/threads/${id(threadId)}/end`), () => null),
    photo: cardId => read(call('GET', `/cards/${id(cardId)}/photo`), raw => toPhoto(cardId, raw)),
    postPhoto: (cardId, imageBase64, mime) =>
      read(
        call('POST', `/cards/${id(cardId)}/photo`, { image_base64: imageBase64, mime, ack_permanent: true }),
        raw => ({ status: raw.status === 'held' ? ('held' as const) : ('live' as const) }),
      ),
    block: handle => read(call('POST', '/blocks', { handle }), () => null),
    report: (category, target) =>
      read(
        call(
          'POST',
          '/reports',
          'cardId' in target
            ? { category, card_id: target.cardId }
            : { category, thread_id: target.threadId, ...(target.messageId === undefined ? {} : { message_id: target.messageId }) },
        ),
        raw => ({ copyKey: text(raw.copy_key) || 'report.sent' }),
      ),
  }
}

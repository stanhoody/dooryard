import type { HttpInit, On } from 'claude-code'

// A fake Yard server for the live backend's tests: Claude Code's $.http.fetch
// answered from routes, with a record of what the mod sent.

export const BASE = 'https://dooryard.test'
export const LIVE = { options: { backend: 'live', api_url: BASE } } as const
export const TOKEN = 'tok_0123456789abcdefghijklmnopqrstuvwxyzABCDE'

export type Sent = { method: string; path: string; body: unknown; auth: string | undefined }
export type Answer = { status: number; json: unknown } | 'never'
export type Route = (sent: Sent) => Answer | undefined

export const STATE = {
  waiting: 12,
  hi_waiting: 0,
  my_card: null,
  threads: [],
  me: { handle: 'lisbon_dev', watch_only_until: null, new_until: null, age_gate: 'none' },
  notices: [],
}

export const CARD = {
  id: 'c9', text: 'rewriting auth', handle: 'berlin_ops', city: 'Berlin',
  local_time: '23:10', has_photo: false, can_hi: true,
}

export const error = (status: number, code: string, copy_key?: string) =>
  ({ status, json: { error: { code, ...(copy_key === undefined ? {} : { copy_key }), params: {} } } }) as const

/** The default server: a live turn, one card, a State with nothing waiting for me. */
export const BASIC: Route = sent => {
  if (sent.path === '/turn/start') return { status: 201, json: { turn_id: 'b1', poll_ms: 5000, state: STATE } }
  if (sent.path === '/deal') return { status: 200, json: { card: CARD } }
  if (sent.path.startsWith('/state')) return { status: 200, json: STATE }
  if (sent.path === '/turn/end') return { status: 200, json: { ok: true } }
  return undefined
}

export function serve(on: On, ...routes: Route[]) {
  const sent: Sent[] = []
  const urls: string[] = []
  on('http.fetch', ($, e) => {
    urls.push(e.url)
    const init: HttpInit = e.init ?? {}
    const one: Sent = {
      method: init.method ?? 'GET',
      path: e.url.slice(`${BASE}/api/v1`.length),
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      auth: init.headers?.Authorization,
    }
    sent.push(one)
    for (const route of [...routes, BASIC]) {
      const answer = route(one)
      if (answer === 'never') return new Promise(() => undefined)
      if (answer !== undefined) {
        return {
          value: {
            status: answer.status,
            ok: answer.status < 300,
            headers: { 'content-type': 'application/json' },
            text: JSON.stringify(answer.json),
          },
        }
      }
    }
    const none: Record<string, string> = {}
    return { value: { status: 404, ok: false, headers: none, text: JSON.stringify({ error: { code: 'not_found' } }) } }
  })
  return { sent, urls }
}

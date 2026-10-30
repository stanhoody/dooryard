import type { HttpInit, HttpResponse, PluginOptions } from 'claude-code'

import type {
  YardCard,
  YardHello,
  YardMessage,
  YardPairing,
  YardPhoto,
  YardReportCategory,
  YardServerState,
  YardThread,
} from '../types'
import { createLive } from './api'
import { createFake } from './fake'

/** An answer from the server: the value, or the error's code and copy key (api.md §2). */
export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; copyKey?: string; params?: Readonly<Record<string, string>> }

export type Surface = 'terminal' | 'desktop' | 'vscode'

/**
 * What the mod asks of the server, one method per endpoint of api.md v1.0.
 * The mod draws and calls; every rule is the server's.
 */
export type Backend = {
  kind: 'fake' | 'live'
  /** POST /pair/start, no token: a code and a link; the secret stays in the mod. */
  pairStart: (
    surface: Surface,
    clientVersion: string,
  ) => Promise<ApiResult<YardPairing & { deviceSecret: string; pollMs: number }>>
  /** POST /pair/poll, no token: pending until the person approves on the web page. */
  pairPoll: (
    deviceSecret: string,
  ) => Promise<ApiResult<{ status: 'pending' } | { status: 'approved'; token: string; handle: string }>>
  /** POST /signout: revokes this token. */
  signout: () => Promise<ApiResult<null>>
  /** POST /turn/start: a main-conversation turn began. */
  turnStart: (surface: Surface) => Promise<ApiResult<{ turnId: string; pollMs: number; state: YardServerState }>>
  /** GET /state: the poll while the turn runs; it keeps the turn live. */
  state: (turnId: string) => Promise<ApiResult<YardServerState>>
  /** POST /turn/end: the turn ended; my card retires. */
  turnEnd: (turnId: string) => Promise<ApiResult<null>>
  /** POST /deal: one card for this wait, or null when nobody else has one live. */
  deal: (turnId: string) => Promise<ApiResult<YardCard | null>>
  /** POST /cards: my card for this turn. */
  post: (turnId: string, text: string) => Promise<ApiResult<{ id: string }>>
  /** POST /hellos: the fixed hello to a card dealt to me; mutual opens a thread. */
  hello: (cardId: string, turnId: string) => Promise<ApiResult<{ mutual: boolean; thread?: YardThread }>>
  /** POST /hellos/open: my oldest unopened hello, and who sent it. */
  helloOpen: () => Promise<ApiResult<YardHello | null>>
  /** POST /hellos/{id}/back: hi back, which makes it mutual. */
  helloBack: (helloId: string) => Promise<ApiResult<YardThread>>
  /** GET /threads/{id}/messages: what came after `after`, oldest first. */
  messages: (threadId: string, after?: string) => Promise<ApiResult<{ messages: YardMessage[]; hidden: number }>>
  /** POST /threads/{id}/messages: one DM; `confirm` answers a nudge. */
  send: (threadId: string, text: string, confirm: boolean) => Promise<ApiResult<YardMessage>>
  /** POST /threads/{id}/hidden: the h key, the hidden folder moved into the thread. */
  hidden: (threadId: string) => Promise<ApiResult<YardMessage[]>>
  /** POST /threads/{id}/end: the x key, ends the thread for both and blocks. */
  end: (threadId: string) => Promise<ApiResult<null>>
  /** GET /cards/{id}/photo: the PNG of a dealt card's live photo. */
  photo: (cardId: string) => Promise<ApiResult<YardPhoto>>
  /** POST /cards/{id}/photo-link: a one-time link to the web page that posts my card's photo. */
  photoLink: (cardId: string) => Promise<ApiResult<{ url: string }>>
  /** POST /blocks: both directions, for good. */
  block: (handle: string) => Promise<ApiResult<null>>
  /** POST /reports: a category and the card or thread, no free text. */
  report: (
    category: YardReportCategory,
    target: { cardId: string } | { threadId: string; messageId?: string },
  ) => Promise<ApiResult<{ copyKey: string }>>
}

/** What the backends reach the world through: all of it the host's, through `$`. */
export type Io = {
  now: () => Promise<number>
  fetch: (url: string, init: HttpInit) => Promise<HttpResponse>
  /** Resolves after `ms`; the 8-second cap races it (api.md §1). */
  sleep: (ms: number) => Promise<void>
  /** The sign-in token from `$.store`, when there is one. */
  token: () => Promise<string | undefined>
  /** api.md §1: a 401 clears the token and shows sign-in. */
  signedOut: () => Promise<void>
}

export type BackendChoice = { backend: Backend } | { problem: string }

/** https, or plain http to this machine for local development (api.md §1). */
export function isApiBase(url: string): boolean {
  return /^https:\/\/[^/@\s]+$/.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)
}

/**
 * Picks the backend the `backend` option names: `fake` keeps cards and
 * counts in memory; `live` talks to the one host in `api_url`.
 */
export function createBackend(options: PluginOptions, io: Io): BackendChoice {
  if (options.backend !== 'live') return { backend: createFake(io.now) }
  const url = typeof options.api_url === 'string' ? options.api_url.replace(/\/+$/, '') : ''
  if (!isApiBase(url)) return { problem: 'live backend needs an https API URL' }
  return { backend: createLive(url, io) }
}

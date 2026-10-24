import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import type { YardMessage, YardPaneMode, YardReportCategory, YardServerState, YardThread } from '../types'
import { bandLead, STATUS_MAX } from './band'
import { createBackend } from './backend'
import type { Backend, Surface } from './backend'
import { copy, copyOn, errorLine, isCopyKey } from './copy'
import { MAX_PHOTO_BASE64, photoBox, photoMime } from './photo'

// Dooryard (codename yard): a band above the prompt while the agent works. The mod handles only
// turn.start, turn.complete, interface events and its own command; it reads
// no prompt, transcript, environment or file. Every rule lives on the server.

/** The band opens 2 seconds into a turn and hands back 3 seconds after it (intermission). */
const OPEN_AFTER_MS = 2000
const HANDBACK_SECONDS = 3
const PANE = 'yard'
/** The rows the pane asks for while it sits inline above the prompt. */
const PANE_ROWS = 9
/** A failed turn/start is tried again this often while the agent works. */
const RETRY_MS = 5000
const CATEGORIES: readonly YardReportCategory[] = ['spam', 'harassment', 'sexual', 'hate', 'other']

const phase = atom({ plugin: 'dooryard', key: 'phase' } as const, 'idle')
const countdown = atom({ plugin: 'dooryard', key: 'countdown' } as const, 0)
const server = atom({ plugin: 'dooryard', key: 'server' } as const, null)
const card = atom({ plugin: 'dooryard', key: 'card' } as const, null)
const problem = atom({ plugin: 'dooryard', key: 'problem' } as const, null)
const mode = atom({ plugin: 'dooryard', key: 'mode' } as const, 'card')
const thread = atom({ plugin: 'dooryard', key: 'thread' } as const, null)
const messages = atom({ plugin: 'dooryard', key: 'messages' } as const, [])
const hidden = atom({ plugin: 'dooryard', key: 'hidden' } as const, 0)
const hello = atom({ plugin: 'dooryard', key: 'hello' } as const, null)
const nudge = atom({ plugin: 'dooryard', key: 'nudge' } as const, null)
const pairing = atom({ plugin: 'dooryard', key: 'pairing' } as const, null)
const photo = atom({ plugin: 'dooryard', key: 'photo' } as const, null)
const photoPath = atom({ plugin: 'dooryard', key: 'photoPath' } as const, null)
const ageGateUrl = atom({ plugin: 'dooryard', key: 'ageGateUrl' } as const, null)
const notices = atom({ plugin: 'dooryard', key: 'notices' } as const, [])

// The module's own variables: a reload starts them over, as it drops the timers.
let options: PluginOptions = {}
let backend: Backend | undefined
let configProblem: string | null = null
let surfaces: readonly string[] = []
let isEnabled = true
let isWorking = false
/** Bumped at every turn start and end, so late answers of an old turn are dropped. */
let generation = 0
let turnId: string | null = null
let openTimer: Timer | undefined
let pollTimer: Timer | undefined
let tickTimer: Timer | undefined
let isPolling = false
let isStarting = false
let isOpeningHello = false
let lastStatus: string | undefined
/** What the last drawing said: does this surface dock a pane beside the transcript? */
let isFullscreen: boolean | undefined
/** The person closed the pane by hand (ctrl+x x): no more opening it unasked this session. */
let closedForSession = false
let seenPostRules = false
let blocked: readonly string[] = []
/** What the report picker reports: the card shown, or the open thread. */
let reportTarget: 'card' | 'thread' = 'card'
/** The newest message fetched per thread: the `after` of the next fetch. */
const lastSeen = new Map<string, string>()
const helloInFlight = new Set<string>()
/** api.md §3: the pairing's secret stays in the mod, in memory, never shown or stored. */
let deviceSecret: string | undefined
let pairTimer: Timer | undefined
let isPairPolling = false
let pairRestarts = 0
/** My card in this turn, once posted: the only card a photo can go on. */
let myCardId: string | null = null
/** Who runs the age check, as the server's `age_gate_required` names it (api.md 1.2). */
let ageGateVendor = ''

/** The surfaces that draw Yard: the band, the status line or the pane. */
function isDrawable(name: string): name is Surface {
  return name === 'terminal' || name === 'desktop' || name === 'vscode'
}

/** Toasts reach every attached surface: hints go only where some surface draws hotkeys. */
function toastSurface(): string {
  const drawing = surfaces.filter(isDrawable)
  return drawing.length > 0 && drawing.every(name => name === 'vscode') ? 'vscode' : 'terminal'
}

function surface(): Surface {
  if (surfaces.includes('terminal')) return 'terminal'
  if (surfaces.includes('desktop')) return 'desktop'
  return 'vscode'
}

/** Desktop and VS Code draw a Link only for https or localhost with no `@` (mods interface docs). */
function isLinkable(url: string): boolean {
  return (url.startsWith('https://') || url.startsWith('http://localhost')) && !url.includes('@') && url.length <= 2048
}

/** The appeal page (api.md 1.3): on Dooryard's own host; the fake's example host for the demo. */
function appealUrl(): string {
  const base = typeof options.api_url === 'string' ? options.api_url.replace(/\/+$/, '') : ''
  return backend?.kind === 'live' && base !== '' ? `${base}/appeal` : 'https://example.com/appeal'
}

function isCategory(value: string): value is YardReportCategory {
  return (CATEGORIES as readonly string[]).includes(value)
}

async function leadText($: EngineInterface, withCard = true) {
  return bandLead({
    phase: await read($, phase),
    countdown: await read($, countdown),
    server: await read($, server),
    card: await read($, card),
    problem: await read($, problem),
    withCard,
  })
}

/** VS Code has no band: the same line rides the status line there, without hotkeys. */
async function refreshStatus($: EngineInterface) {
  const text = surfaces.includes('vscode') ? (await leadText($))?.slice(0, STATUS_MAX) : undefined
  if (text === lastStatus) return
  lastStatus = text
  $.ui.status(text)
}

async function finish($: EngineInterface) {
  tickTimer?.cancel()
  await update($, phase, () => 'idle')
  await update($, countdown, () => 0)
  await update($, server, () => null)
  await update($, card, () => null)
  await update($, problem, now => (now === copy('yard.signed_out') ? now : configProblem))
  await update($, hello, () => null)
  await update($, nudge, () => null)
  await update($, photo, () => null)
  await update($, photoPath, () => null)
  await update($, ageGateUrl, () => null)
  myCardId = null
  await refreshStatus($)
  // A sign-in in progress keeps its pane past the turn's end
  if (deviceSecret !== undefined) return
  await update($, mode, () => 'card')
  await $.ui.close({ id: PANE })
}

/** Stops this turn's work at once: timers, the poll, the server's turn. */
async function goQuiet($: EngineInterface) {
  isWorking = false
  generation += 1
  openTimer?.cancel()
  pollTimer?.cancel()
  if (backend !== undefined && turnId !== null) void backend.turnEnd(turnId).catch(() => undefined)
  turnId = null
  await finish($)
}

/** api.md §1: a 401 clears the token; sign-in shows on the next `/dooryard` (E02-S5). */
async function signedOut($: EngineInterface) {
  await $.store.delete('token')
  await update($, problem, () => copy('yard.signed_out'))
  await refreshStatus($)
}

async function hasToken($: EngineInterface) {
  const token = await $.store.get('token')
  return typeof token === 'string' && token.length > 0
}

async function stopPairing($: EngineInterface) {
  pairTimer?.cancel()
  pairTimer = undefined
  deviceSecret = undefined
  await update($, pairing, () => null)
}

/** api.md §3: a code and an https link; the person signs in and attests 18+ on the web page. */
async function startSignIn($: EngineInterface) {
  if (backend === undefined) return
  await stopPairing($)
  surfaces = await $.session.surfaces()
  const version = (await $.session.version()).version.slice(0, 32)
  const answer = await backend.pairStart(surface(), version)
  if (!answer.ok) {
    $.ui.toast(errorLine(answer))
    await update($, mode, now => (now === 'signin' ? 'card' : now))
    return
  }
  const { deviceSecret: secret, pollMs, ...shown } = answer.value
  deviceSecret = secret
  await update($, pairing, () => shown)
  await update($, mode, () => 'signin')
  // Two sign-ins may overlap while the server is slow: only the last one polls
  pairTimer?.cancel()
  pairTimer = $.clock.every(pollMs, () => void pollPairing($))
}

/** The code expired (410, or past `expires_at`): a fresh one, twice at most, then stop. */
async function pairingExpired($: EngineInterface) {
  await stopPairing($)
  if (pairRestarts < 2) {
    pairRestarts += 1
    await startSignIn($)
  } else {
    await update($, mode, now => (now === 'signin' ? 'card' : now))
  }
}

async function pollPairing($: EngineInterface) {
  const secret = deviceSecret
  if (backend === undefined || secret === undefined || isPairPolling) return
  isPairPolling = true
  try {
    const shown = await read($, pairing)
    if (shown !== null && (await $.clock.now()) > Date.parse(shown.expiresAt)) {
      await pairingExpired($)
      return
    }
    const answer = await backend.pairPoll(secret)
    // An answer for a code that is no longer the one shown changes nothing
    if (deviceSecret !== secret) return
    if (answer.ok && answer.value.status === 'approved') {
      await $.store.set('token', answer.value.token)
      await stopPairing($)
      pairRestarts = 0
      await update($, problem, () => configProblem)
      await update($, mode, () => 'card')
      $.ui.toast(copy('yard.signin.done', { handle: answer.value.handle }))
      // Signed in mid-turn: the turn joins the yard now
      if (isWorking && turnId === null) void beginTurn($, generation)
      return
    }
    if (!answer.ok && answer.code === 'gone') await pairingExpired($)
  } finally {
    isPairPolling = false
  }
}

/** api.md §3: revoke the token, then clear what this mod keeps on the machine. */
async function signOut($: EngineInterface) {
  // End the live turn while the token still works, so the card retires at once (api.md §4)
  const live = turnId
  turnId = null
  if (backend !== undefined && live !== null) await backend.turnEnd(live).catch(() => undefined)
  if (backend !== undefined && (await hasToken($))) await backend.signout().catch(() => undefined)
  for (const key of await $.store.keys()) await $.store.delete(key)
  blocked = []
  seenPostRules = false
  isEnabled = true
  await stopPairing($)
  await goQuiet($)
  await update($, problem, () => (backend?.kind === 'live' ? copy('yard.signed_out') : configProblem))
  return { text: copy('yard.signed_out') }
}

/**
 * Opens the pane on the person's press or command: `$.ui.open` goes out first,
 * inside their input, so the engine places it at any width (mods interface docs).
 */
async function openPane($: EngineInterface, next: YardPaneMode, wantsFocus: boolean) {
  const pane = { id: PANE, title: 'dooryard', rows: PANE_ROWS }
  const opening = $.ui.open(wantsFocus ? { ...pane, focus: true } : pane)
  await update($, mode, () => next)
  await opening
}

/** Deals until a card from someone not blocked on this machine comes, or none. */
async function dealVisible($: EngineInterface) {
  const mine = generation
  if (backend === undefined || turnId === null) return
  for (let tries = 0; tries < 3; tries += 1) {
    const dealt = await backend.deal(turnId)
    // A deal that lands after the turn ended stays out of the next one
    if (mine !== generation || !dealt.ok) return
    if (dealt.value === null || !blocked.includes(dealt.value.handle)) {
      const value = dealt.value
      await update($, card, () => value)
      await update($, photo, () => null)
      // Only the terminal draws an Image (mods reference, elements): fetch it only there
      if (value?.hasPhoto === true && surfaces.includes('terminal')) void loadPhoto($, value.id)
      await refreshStatus($)
      return
    }
  }
  await update($, card, () => null)
  await refreshStatus($)
}

async function loadPhoto($: EngineInterface, cardId: string) {
  const mine = generation
  if (backend === undefined) return
  const answer = await backend.photo(cardId)
  if (mine !== generation || !answer.ok || (await read($, card))?.id !== cardId) return
  const fetched = answer.value
  await update($, photo, () => fetched)
}

/** The first Enter takes the path and shows `photo.permanent`; the second posts. */
async function photoSubmit($: EngineInterface, value: string) {
  const path = value.trim()
  if (path.length === 0) return
  if (photoMime(path) === undefined) {
    $.ui.toast(copy('photo.placeholder'))
    return
  }
  if ((await read($, photoPath)) !== path) {
    await update($, photoPath, () => path)
    return
  }
  await uploadPhoto($, path)
}

/** The one file the mod reads: the path the person typed, once (README, What it reads). */
async function uploadPhoto($: EngineInterface, path: string) {
  const mime = photoMime(path)
  if (backend === undefined || myCardId === null || mime === undefined) return
  let base64: string
  try {
    base64 = (await $.fs.read(path, { as: 'bytes' })).base64
  } catch {
    $.ui.toast(copy('photo.unreadable'))
    return
  }
  if (base64.length > MAX_PHOTO_BASE64) {
    $.ui.toast(copy('photo.too_big'))
    return
  }
  const answer = await backend.postPhoto(myCardId, base64, mime)
  if (answer.ok) {
    $.ui.toast(answer.value.status === 'held' ? copy('photo.held') : copy('post.live'))
    await update($, photoPath, () => null)
    await update($, mode, () => 'card')
    return
  }
  const url = answer.params?.url
  if (answer.code === 'age_gate_required' && url !== undefined && isLinkable(url)) {
    // api.md 1.2: the one-time check before a first photo; its page is the link
    ageGateVendor = answer.params?.vendor ?? ''
    await update($, ageGateUrl, () => url)
    return
  }
  $.ui.toast(answer.code === 'too_large' ? copy('photo.too_big') : errorLine(answer))
}

async function addMessages($: EngineInterface, fresh: readonly YardMessage[]) {
  await update($, messages, list => {
    const known = new Set(list.map(one => one.id))
    return [...list, ...fresh.filter(one => !known.has(one.id))].slice(-50)
  })
}

/** The thread the pane shows, fresh: its own messages, hidden count and no nudge left over. */
async function openThread($: EngineInterface, next: YardThread | null) {
  await update($, thread, () => next)
  await update($, messages, () => [])
  await update($, hidden, () => 0)
  await update($, nudge, () => null)
}

async function switchThread($: EngineInterface, threadId: string, handle: string) {
  await openThread($, { id: threadId, handle, city: '', localTime: '' })
  await update($, mode, () => 'reply')
  await fetchMessages($, threadId, handle)
}

/** A 410 on a thread: the server's key says who ended it (api.md 1.1), `by_them` when it says none. */
async function threadEnded($: EngineInterface, threadId: string, handle: string, copyKey?: string) {
  if ((await read($, thread))?.id !== threadId) return
  await openThread($, null)
  await update($, mode, now => (now === 'reply' ? 'card' : now))
  $.ui.toast(copy(isCopyKey(copyKey) ? copyKey : 'thread.ended.by_them', { handle }))
}

/** api.md §7: fetch a thread while the pane shows it, or once when it has unread. */
async function fetchMessages($: EngineInterface, threadId: string, handle: string) {
  if (backend === undefined) return
  const answer = await backend.messages(threadId, lastSeen.get(threadId))
  if (!answer.ok) {
    if (answer.code === 'gone') await threadEnded($, threadId, handle, answer.copyKey)
    return
  }
  const fresh = answer.value.messages
  const newest = fresh.at(-1)
  if (newest === undefined) return
  lastSeen.set(threadId, newest.id)
  if ((await read($, thread))?.id === threadId) {
    await addMessages($, fresh)
    await update($, hidden, () => answer.value.hidden)
  }
  const theirs = fresh.filter(one => one.from === 'them').at(-1)
  // A DM arrival: a toast, 4 seconds by default (mods reference, limits)
  if (theirs !== undefined) $.ui.toast(copy('dm.toast', { handle, preview: theirs.text.slice(0, 40) }))
}

/**
 * api.md §7: a fetch marks messages read, so only the open thread is fetched;
 * the card view lists the others with their unread count, and a press opens one.
 */
async function syncThreads($: EngineInterface, state: YardServerState) {
  if (state.notices.length > 0) {
    // Returned once by the server: kept until the pane has shown them and closed
    const fresh = state.notices.filter(one => isCopyKey(one.copyKey))
    await update($, notices, list => [...list, ...fresh].slice(-5))
  }
  let open = await read($, thread)
  const first = state.threads.find(one => !blocked.includes(one.handle))
  // A thread my earlier hi opened on their side shows up in the State first
  if (open === null && first !== undefined) {
    open = { id: first.id, handle: first.handle, city: '', localTime: '' }
    await openThread($, open)
  }
  const listed = state.threads.find(one => one.id === open?.id)
  if (listed === undefined) return
  await update($, hidden, () => listed.hidden)
  const isShowing = (await read($, mode)) === 'reply'
  if (listed.unread > 0 || isShowing) await fetchMessages($, listed.id, listed.handle)
}

async function poll($: EngineInterface, mine: number) {
  if (isPolling || backend === undefined || turnId === null || mine !== generation) return
  isPolling = true
  try {
    const answer = await backend.state(turnId)
    if (mine !== generation) return
    if (answer.ok) {
      const before = await read($, server)
      if (JSON.stringify(before) !== JSON.stringify(answer.value)) {
        await update($, server, () => answer.value)
        await refreshStatus($)
      }
      await syncThreads($, answer.value)
    } else if (answer.code === 'gone' && isWorking) {
      // The server timed the turn out; the agent still works, so start again
      pollTimer?.cancel()
      turnId = null
      void beginTurn($, mine)
    }
  } catch {
    // Keep the last state drawn; the next period asks again
  } finally {
    isPolling = false
  }
}

/** A failed turn/start leaves a retry running while the agent works; sign-in ends the need. */
function armRetry($: EngineInterface, mine: number) {
  pollTimer?.cancel()
  pollTimer = $.clock.every(RETRY_MS, () => void retryTurn($, mine))
}

async function retryTurn($: EngineInterface, mine: number) {
  if (mine !== generation || !isWorking || turnId !== null || isStarting) return
  pollTimer?.cancel()
  await beginTurn($, mine)
}

async function beginTurn($: EngineInterface, mine: number) {
  if (backend === undefined || isStarting) return
  isStarting = true
  try {
    const started = await backend.turnStart(surface())
    if (mine !== generation) {
      if (started.ok) void backend.turnEnd(started.value.turnId).catch(() => undefined)
      return
    }
    if (!started.ok) {
      const isSignedOut = started.code === 'unauthorized'
      await update($, problem, () => (isSignedOut ? copy('yard.signed_out') : copy('error.unavailable')))
      if (!isSignedOut) armRetry($, mine)
      await refreshStatus($)
      return
    }
    turnId = started.value.turnId
    await update($, problem, now => (now === copy('error.unavailable') ? configProblem : now))
    await update($, server, () => started.value.state)
    await dealVisible($)
    if (mine !== generation) return
    pollTimer?.cancel()
    pollTimer = $.clock.every(started.value.pollMs, () => void poll($, mine))
    await syncThreads($, started.value.state)
    await refreshStatus($)
  } catch {
    if (mine === generation) {
      await update($, problem, () => copy('error.unavailable'))
      armRetry($, mine)
    }
  } finally {
    isStarting = false
  }
}

async function openBand($: EngineInterface, mine: number) {
  if (mine !== generation) return
  await update($, phase, () => 'band')
  await refreshStatus($)
  // Unasked, a pane only as a sidebar: the engine places it from 144 columns,
  // 110 once the person opened it; below that the band is the product
  if (isFullscreen !== true || closedForSession) return
  const opened = await $.ui.open({ id: PANE, title: 'dooryard', rows: PANE_ROWS })
  if (!opened.isPlaced) await $.ui.close({ id: PANE })
}

async function tick($: EngineInterface, mine: number) {
  if (mine !== generation) return
  const left = (await read($, countdown)) - 1
  // A queued prompt may have started a turn during that read
  if (mine !== generation) return
  if (left <= 0) {
    await finish($)
    return
  }
  await update($, countdown, () => left)
  await refreshStatus($)
}

async function sayHi($: EngineInterface) {
  const shown = await read($, card)
  if (backend === undefined || turnId === null || shown === null || !shown.canHi) return
  if (helloInFlight.has(shown.id)) return
  helloInFlight.add(shown.id)
  try {
    const answer = await backend.hello(shown.id, turnId)
    if (answer.ok || answer.code === 'already_said_hi') {
      await update($, card, now => (now !== null && now.id === shown.id ? { ...now, canHi: false } : now))
    }
    if (!answer.ok) {
      $.ui.toast(errorLine(answer, { handle: shown.handle }))
      return
    }
    const opened = answer.value.thread
    if (answer.value.mutual && opened !== undefined) {
      await openThread($, opened)
      $.ui.toast(copyOn(toastSurface(), 'hi.mutual', { handle: opened.handle }))
    } else {
      $.ui.toast(copyOn(toastSurface(), 'hi.sent', { handle: shown.handle }))
    }
  } finally {
    helloInFlight.delete(shown.id)
  }
}

/** api.md §6: the sender is revealed only here, one hello at a time. */
async function openHello($: EngineInterface) {
  // Each open uses up one hello on the server: never two at once, never over one shown
  if (backend === undefined || isOpeningHello || (await read($, hello)) !== null) return
  isOpeningHello = true
  try {
    const answer = await backend.helloOpen()
    if (!answer.ok) {
      $.ui.toast(errorLine(answer))
      return
    }
    if (answer.value === null || blocked.includes(answer.value.handle)) return
    const opened = answer.value
    await update($, hello, () => opened)
    await update($, mode, () => 'hello')
    await update($, server, now => (now === null ? now : { ...now, hiWaiting: Math.max(0, now.hiWaiting - 1) }))
  } finally {
    isOpeningHello = false
  }
}

async function hiBack($: EngineInterface) {
  const opened = await read($, hello)
  if (backend === undefined || opened === null || !opened.canHiBack) return
  const answer = await backend.helloBack(opened.id)
  await update($, hello, () => null)
  if (!answer.ok) {
    $.ui.toast(errorLine(answer, { handle: opened.handle }))
    await update($, mode, () => 'card')
    return
  }
  const fresh = answer.value
  await openThread($, fresh)
  await update($, mode, () => 'reply')
  $.ui.toast(copyOn(toastSurface(), 'hi.mutual', { handle: fresh.handle }))
}

async function postCard($: EngineInterface, text: string) {
  const line = text.trim()
  if (line.length === 0) return
  if (line.length > 80) {
    $.ui.toast(copy('post.too_long'))
    return
  }
  if (backend === undefined || turnId === null) {
    $.ui.toast(copy('pane.idle'))
    return
  }
  const answer = await backend.post(turnId, line)
  if (!answer.ok) {
    $.ui.toast(errorLine(answer))
    return
  }
  myCardId = answer.value.id
  if (!seenPostRules) {
    seenPostRules = true
    await $.store.set('seenPostRules', true)
  }
  $.ui.toast(copy('post.live'))
  await update($, mode, () => 'card')
}

async function startReport($: EngineInterface, target: 'card' | 'thread') {
  reportTarget = target
  await update($, mode, () => 'report')
}

async function reportPicked($: EngineInterface, value: string) {
  if (backend === undefined || !isCategory(value)) return
  const back: YardPaneMode = reportTarget === 'thread' ? 'reply' : 'card'
  const open = await read($, thread)
  const shown = await read($, card)
  const theirs = (await read($, messages)).filter(one => one.from === 'them').at(-1)
  const answer =
    reportTarget === 'thread' && open !== null
      ? await backend.report(value, { threadId: open.id, ...(theirs === undefined ? {} : { messageId: theirs.id }) })
      : shown !== null
        ? await backend.report(value, { cardId: shown.id })
        : undefined
  if (answer?.ok === true) $.ui.toast(isCopyKey(answer.value.copyKey) ? copy(answer.value.copyKey) : copy('report.sent'))
  else if (answer?.ok === false) $.ui.toast(errorLine(answer))
  await update($, mode, () => back)
}

/** api.md §8: the local blocklist first, at once; the server's block is the rule. */
async function blockHandle($: EngineInterface, handle: string, toast = copy('block.done', { handle })) {
  blocked = [...new Set([...blocked, handle])]
  await $.store.set('blocked', blocked)
  await update($, card, now => (now?.handle === handle ? null : now))
  await update($, hello, now => (now?.handle === handle ? null : now))
  if ((await read($, thread))?.handle === handle) await openThread($, null)
  await update($, mode, () => 'card')
  $.ui.toast(toast)
  if (backend !== undefined) void backend.block(handle).catch(() => undefined)
  if ((await read($, card)) === null) await dealVisible($)
}

async function blockShown($: EngineInterface) {
  const shown = await read($, card)
  if (shown !== null) await blockHandle($, shown.handle)
}

async function blockHello($: EngineInterface) {
  const opened = await read($, hello)
  if (opened !== null) await blockHandle($, opened.handle)
}

async function blockThread($: EngineInterface) {
  const open = await read($, thread)
  if (open !== null) await blockHandle($, open.handle)
}

/** The x key: the server ends the thread for both and blocks; this machine blocks too. */
async function endThread($: EngineInterface) {
  const open = await read($, thread)
  if (backend === undefined || open === null) return
  const answer = await backend.end(open.id)
  if (!answer.ok) {
    $.ui.toast(errorLine(answer, { handle: open.handle }))
    return
  }
  await blockHandle($, open.handle, copy('thread.ended.by_you', { handle: open.handle }))
}

async function showHidden($: EngineInterface) {
  const open = await read($, thread)
  if (backend === undefined || open === null) return
  const answer = await backend.hidden(open.id)
  if (!answer.ok) {
    $.ui.toast(errorLine(answer, { handle: open.handle }))
    return
  }
  await addMessages($, answer.value)
  await update($, hidden, () => 0)
}

async function sendReply($: EngineInterface, text: string) {
  const open = await read($, thread)
  const line = text.trim()
  if (backend === undefined || open === null || line.length === 0) return
  if (line.length > 500) {
    $.ui.toast(copy('dm.too_long'))
    return
  }
  // api.md §7: a nudged message goes again with `confirm` on Enter
  const held = await read($, nudge)
  const answer = await backend.send(open.id, line, held !== null && held.text === line)
  if (answer.ok) {
    // `lastSeen` stays at the last fetch: their message sent meanwhile still comes
    await update($, nudge, () => null)
    await addMessages($, [answer.value])
    return
  }
  if (answer.code === 'nudge') {
    const key = isCopyKey(answer.copyKey) ? answer.copyKey : 'nudge.generic'
    await update($, nudge, () => ({ text: line, copyKey: key }))
    return
  }
  if (answer.code === 'gone') await threadEnded($, open.id, open.handle, answer.copyKey)
  else $.ui.toast(errorLine(answer, { handle: open.handle }))
}

async function runCommand($: EngineInterface, args: string) {
  const word = args.trim().toLowerCase()
  if (word === 'on') {
    isEnabled = true
    await $.store.set('enabled', true)
    return { text: copy('yard.on') }
  }
  if (word === 'off') {
    isEnabled = false
    await $.store.set('enabled', false)
    await stopPairing($)
    await goQuiet($)
    return { text: copy('yard.off') }
  }
  if (word === 'signout') return signOut($)
  if (word === 'appeal') {
    // api.md 1.3: appeals are a web page, one per decision; the answer comes back as a notice
    await openPane($, 'appeal', true)
    return {}
  }
  if (word === 'signin') {
    await openPane($, 'signin', true)
    await startSignIn($)
    return {}
  }
  if (word !== '') return { text: 'usage: /dooryard, /dooryard on, /dooryard off, /dooryard signin, /dooryard signout, /dooryard appeal' }
  if (!isEnabled) return { text: copy('yard.off') }
  if (backend?.kind === 'live' && !(await hasToken($))) {
    await openPane($, 'signin', true)
    await startSignIn($)
    return {}
  }
  await openPane($, 'card', true)
  return {}
}

export const register: Register = (on, given) => {
  options = given

  on('session.start', async ($, e, next) => {
    const choice = createBackend(options, {
      now: () => $.clock.now(),
      fetch: (url, init) => $.http.fetch(url, init),
      sleep: ms => new Promise<void>(resolve => void $.clock.after(ms, resolve)),
      token: async () => {
        const token = await $.store.get('token')
        return typeof token === 'string' && token.length > 0 ? token : undefined
      },
      signedOut: () => signedOut($),
    })
    backend = 'backend' in choice ? choice.backend : undefined
    configProblem = 'problem' in choice ? choice.problem : null
    await $.command.register({
      name: 'dooryard',
      description: 'Dooryard: open the card pane while your agent works',
      argumentHint: '[on|off|signin|signout|appeal]',
      immediate: true,
    })
    isEnabled = (await $.store.get('enabled')) !== false
    seenPostRules = (await $.store.get('seenPostRules')) === true
    const saved = await $.store.get('blocked')
    blocked = Array.isArray(saved) ? saved.filter(one => typeof one === 'string') : []
    // A reload loses the module's timers, so start from idle
    await finish($)
    $.ui.log(backend !== undefined ? `dooryard: ${backend.kind} backend` : `dooryard: ${configProblem}`, {
      to: 'debug',
    })
    return next(e)
  })

  on('command.run', { command: 'dooryard' }, async ($, e) => runCommand($, e.args))

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    // Another session on this machine may have run /dooryard off or on
    isEnabled = (await $.store.get('enabled')) !== false
    if (!isEnabled) return next(e)
    surfaces = await $.session.surfaces()
    // claude -p, cloud sessions, a phone alone and hosts that attach no surface draw nothing: stay out
    if (!surfaces.some(isDrawable)) return next(e)

    isWorking = true
    generation += 1
    const mine = generation
    tickTimer?.cancel()
    openTimer?.cancel()
    if ((await read($, phase)) === 'handback') {
      // A queued prompt started at once: keep the band up
      await update($, phase, () => 'band')
    } else {
      await update($, phase, () => 'armed')
      openTimer = $.clock.after(OPEN_AFTER_MS, () => void openBand($, mine))
    }
    void beginTurn($, mine)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined || !isWorking) return next(e)
    isWorking = false
    generation += 1
    openTimer?.cancel()
    pollTimer?.cancel()
    if (backend !== undefined && turnId !== null) void backend.turnEnd(turnId).catch(() => undefined)
    turnId = null

    if ((await read($, phase)) === 'band' && !e.isAborted) {
      const mine = generation
      await update($, countdown, () => HANDBACK_SECONDS)
      await update($, phase, () => 'handback')
      await refreshStatus($)
      tickTimer = $.clock.every(1000, () => void tick($, mine))
    } else {
      // Under 2 seconds, nothing was shown; interrupted, the person is at the keys
      await finish($)
    }
    return next(e)
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    // Nothing polls the pairing once its pane is gone; its notices have been shown;
    // a photo path typed but not confirmed is dropped, so closing never posts it
    await stopPairing($)
    await update($, notices, () => [])
    await update($, photoPath, () => null)
    if (e.origin.kind === 'person') {
      closedForSession = true
      $.ui.toast(copy('yard.closed_pane'))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.viewport?.isFullscreen !== undefined) isFullscreen = e.viewport.isFullscreen
    const now = await read($, phase)
    const isShown = !e.props.hasSurvey && (now === 'handback' || (now === 'band' && e.props.isWorking))
    if (!isShown) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const lead = await leadText($)
    const shown = await read($, card)
    const open = await read($, thread)
    const others = await next(e)
    const isBand = now === 'band'

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Box flexShrink={1}>
            <Text wrap="truncate-end">{lead}</Text>
          </Box>
          {isBand && shown !== null && shown.canHi && (
            <Box flexShrink={0}>
              <Text dimColor> · </Text>
              <Button
                key="hi"
                plain
                hotkey="1"
                label="hi"
                onPress={() => void openPane($, 'card', false).then(() => sayHi($))}
              />
            </Box>
          )}
          {isBand && shown !== null && (
            <Box flexShrink={0}>
              <Text dimColor> · </Text>
              <Button
                key="next"
                plain
                hotkey="2"
                label="next"
                onPress={() => void openPane($, 'card', false).then(() => dealVisible($))}
              />
            </Box>
          )}
          {isBand && (
            <Box flexShrink={0}>
              <Text dimColor> · </Text>
              <Button key="post" plain hotkey="3" label="post" onPress={() => void openPane($, 'post', true)} />
            </Box>
          )}
          {isBand && open !== null && (
            // On the band, so 4 from an empty prompt opens the thread (copy.md hi.sent, hi.mutual):
            // a digit in the prompt reaches only band buttons (mods interface docs, keyboard focus)
            <Box flexShrink={0}>
              <Text dimColor> · </Text>
              <Button key="reply" plain hotkey="4" label="reply" onPress={() => void openPane($, 'reply', true)} />
            </Box>
          )}
        </Box>
        {others}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.viewport?.isFullscreen !== undefined) isFullscreen = e.viewport.isFullscreen
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>Dooryard draws on the terminal, Desktop and VS Code</Text>
    }
    const { Box, Text, Button, Input, Select, Link } = $.ui.resolve(e)
    const now = await read($, phase)
    const view = await read($, mode)
    const shown = await read($, card)
    const open = await read($, thread)
    const toCard = () => void update($, mode, () => 'card')
    const back = <Button key="back" plain label="back" onPress={toCard} />

    if (view === 'signin') {
      const shownPairing = await read($, pairing)
      if (shownPairing === null) return <Text dimColor>dooryard</Text>
      const [before, after] = copy('yard.signin', { code: shownPairing.code }).split('{url}')
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap">
            <Text>{before}</Text>
            {isLinkable(shownPairing.url) ? <Link href={shownPairing.url} /> : <Text>{shownPairing.url}</Text>}
            <Text>{after}</Text>
          </Box>
          <Button key="back" plain label="back" onPress={() => void stopPairing($).then(toCard)} />
        </Box>
      )
    }

    if (view === 'appeal') {
      return (
        <Box flexDirection="column">
          <Link href={appealUrl()} />
          <Button key="back" plain label="back" onPress={toCard} />
        </Box>
      )
    }

    if (!isEnabled) return <Text dimColor>{copy('yard.off')}</Text>
    if (now === 'handback') {
      return <Text dimColor>{copy('pane.handback', { seconds: await read($, countdown) })}</Text>
    }

    if (view === 'photo') {
      const held = await read($, photoPath)
      const gate = await read($, ageGateUrl)
      return (
        <Box flexDirection="column">
          <Text dimColor>{copy('photo.rule')}</Text>
          {held !== null && <Text>{copy('photo.permanent')}</Text>}
          {held !== null && <Text dimColor>{copy('photo.permanent.confirm')}</Text>}
          {gate !== null && ageGateVendor !== '' && <Text>{copy('photo.age_gate', { vendor: ageGateVendor })}</Text>}
          {gate !== null && <Link href={gate} />}
          <Input
            key="photo"
            placeholder={copy('photo.placeholder')}
            value={held ?? ''}
            submitLabel={held === null ? 'next' : 'post'}
            autoFocus
            onSubmit={value => void photoSubmit($, value)}
          />
          <Button
            key="back"
            plain
            label="back"
            onPress={() => void update($, photoPath, () => null).then(toCard)}
          />
        </Box>
      )
    }

    if (view === 'post') {
      return (
        <Box flexDirection="column">
          {!seenPostRules && <Text dimColor>{copy('post.first_time')}</Text>}
          <Input
            key="post"
            placeholder={copy('post.placeholder')}
            value=""
            submitLabel="post"
            autoFocus
            onSubmit={value => void postCard($, value)}
          />
          {back}
        </Box>
      )
    }

    if (view === 'report') {
      const handle = reportTarget === 'thread' ? open?.handle : shown?.handle
      return (
        <Box flexDirection="column">
          <Select
            key="report"
            label={copy('report.title', { handle: handle ?? '', what: reportTarget === 'thread' ? 'message' : 'card' })}
            options={CATEGORIES.map(value => ({ value }))}
            autoFocus
            onSelect={value => void reportPicked($, value)}
          />
          <Button
            key="back"
            plain
            label="back"
            onPress={() => void update($, mode, () => (reportTarget === 'thread' ? 'reply' : 'card'))}
          />
        </Box>
      )
    }

    if (view === 'hello') {
      const opened = await read($, hello)
      if (opened !== null) {
        return (
          <Box flexDirection="column">
            <Text>{copy('hi.received.head', { handle: opened.handle })}</Text>
            <Text dimColor>
              {copy('card.meta', { handle: opened.handle, city: opened.city, local_time: opened.localTime })}
            </Text>
            <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
              {opened.canHiBack && <Button key="hi-back" plain hotkey="1" label="hi back" onPress={() => void hiBack($)} />}
              <Button key="next" plain hotkey="2" label="next" onPress={() => void update($, hello, () => null).then(toCard)} />
              <Button key="block" plain hotkey="b" label="block" onPress={() => void blockHello($)} />
            </Box>
          </Box>
        )
      }
    }

    if (view === 'reply' && open !== null) {
      const list = await read($, messages)
      const held = await read($, nudge)
      const tucked = await read($, hidden)
      const theirs = list.filter(one => one.from === 'them').at(-1)
      const room = Math.max(1, e.props.scroll.bodyRows - 6)
      const head = open.city === '' ? open.handle : copy('card.meta', { handle: open.handle, city: open.city, local_time: open.localTime })
      return (
        <Box flexDirection="column">
          <Text dimColor>{head}</Text>
          {list.length === 0 && <Text dimColor>{copyOn(e.surface, 'dm.first_open.1')}</Text>}
          {list.length === 0 && <Text dimColor>{copy('dm.first_open.2')}</Text>}
          {list.slice(-room).map(message => (
            <Text wrap="wrap">
              <Text dimColor>{message.from === 'me' ? 'you' : open.handle}: </Text>
              {message.text}
            </Text>
          ))}
          {theirs?.checkin === true && list.at(-1)?.id === theirs.id && (
            <Text dimColor>{copyOn(e.surface, 'checkin.bother')}</Text>
          )}
          {tucked > 0 && (
            <Text dimColor>
              {tucked === 1 ? copyOn(e.surface, 'hidden.one') : copyOn(e.surface, 'hidden.many', { n: tucked })}
            </Text>
          )}
          {held !== null && (
            <Text color="warning">{copy(isCopyKey(held.copyKey) ? held.copyKey : 'nudge.generic')}</Text>
          )}
          <Input
            key="reply"
            placeholder={copy('dm.placeholder')}
            value={held?.text ?? ''}
            submitLabel="send"
            autoFocus
            onSubmit={value => void sendReply($, value)}
          />
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {tucked > 0 && <Button key="hidden" plain hotkey="h" label="show" onPress={() => void showHidden($)} />}
            <Button key="report" plain hotkey="r" label="report" onPress={() => void startReport($, 'thread')} />
            <Button key="block" plain hotkey="b" label="block" onPress={() => void blockThread($)} />
            <Button key="end" plain hotkey="x" label="end" onPress={() => void endThread($)} />
            {back}
          </Box>
        </Box>
      )
    }

    const lead = await leadText($, false)
    const state = await read($, server)
    const waiting = state?.hiWaiting ?? 0
    const lines = await read($, notices)
    const others = (state?.threads ?? []).filter(
      one => one.unread > 0 && one.id !== open?.id && !blocked.includes(one.handle),
    )
    // The age gate is live (api.md 1.2): a first photo post answers with the
    // check's link; after a failed check the key stays hidden for the 30 days
    const canPhoto = myCardId !== null && state !== null && state.ageGate !== 'fail'
    const picture = shown?.hasPhoto === true ? await read($, photo) : null
    const image =
      e.surface === 'terminal' && picture !== null && picture.cardId === shown?.id
        ? (() => {
            const { Image } = $.ui.resolve(e)
            const box = photoBox(picture.columns, picture.rows, e.props.bodyColumns)
            return <Image key="photo" source={{ png: picture.png }} columns={box.columns} rows={box.rows} alt={picture.alt} />
          })()
        : null
    return (
      <Box flexDirection="column">
        {lines.map(line => (
          <Text color="warning" wrap="wrap">
            {isCopyKey(line.copyKey) ? copy(line.copyKey, line.params) : ''}
          </Text>
        ))}
        <Text dimColor wrap="truncate-end">
          {lead ?? copy('pane.idle')}
        </Text>
        {shown !== null && <Text wrap="wrap">{`"${shown.text}"`}</Text>}
        {shown !== null && (
          <Text dimColor>
            {copy('card.meta', { handle: shown.handle, city: shown.city, local_time: shown.localTime })}
          </Text>
        )}
        {image}
        {shown?.hasPhoto === true && image === null && <Text dimColor>{copy('card.photo.not_drawn')}</Text>}
        {open !== null && <Text dimColor>{copyOn(e.surface, 'hi.mutual', { handle: open.handle })}</Text>}
        {others.map(one => (
          <Button
            key={`thread-${one.id}`}
            plain
            label={copy('thread.unread', { handle: one.handle, n: one.unread })}
            onPress={() => void switchThread($, one.id, one.handle)}
          />
        ))}
        {now === 'band' && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {shown !== null && shown.canHi && (
              <Button key="hi" plain hotkey="1" label="hi" onPress={() => void sayHi($)} />
            )}
            {shown !== null && <Button key="next" plain hotkey="2" label="next" onPress={() => void dealVisible($)} />}
            <Button key="post" plain hotkey="3" label="post" onPress={() => void update($, mode, () => 'post')} />
            {open !== null && (
              <Button key="reply" plain hotkey="4" label="reply" onPress={() => void update($, mode, () => 'reply')} />
            )}
            {waiting > 0 && <Button key="see" plain hotkey="o" label="see who" onPress={() => void openHello($)} />}
            {canPhoto && (
              <Button key="photo" plain hotkey="p" label="add photo" onPress={() => void update($, mode, () => 'photo')} />
            )}
            {shown !== null && (
              <Button key="report" plain hotkey="r" label="report" onPress={() => void startReport($, 'card')} />
            )}
            {shown !== null && <Button key="block" plain hotkey="b" label="block" onPress={() => void blockShown($)} />}
          </Box>
        )}
      </Box>
    )
  })
}

// The baked-in strings the pane shows when the server's copy (GET /copy,
// E03-S5) is not there. Keys and text from E04 copy.md, 2026-10-23 draft.
// E01 settled the short form, 2026-10-23: `dooryard` in the band line and
// `/dooryard` as the command; Dooryard where copy.md names the product Yard.
// Copy keys stay as E04 wrote them (`yard.on`, ...): the server sends them.
// The band's hotkeys are Buttons, so the band strings stop before them.

export const COPY = {
  /** The head of `band.line` and `band.line.vscode`: `dooryard · {waiting} waiting`. */
  'band.count': 'dooryard · {waiting} waiting',
  'band.hi.one': '1 hi waiting',
  'band.hi.many': '{n} hi waiting',
  'band.alone': "dooryard · you're the only one waiting",
  'band.notice': 'dooryard · {notice}',
  'card.meta': '{handle} · {city} · {local_time}',
  'pane.handback': 'turn done · closing in {seconds}',
  /** Not in copy.md yet: the pane's line between turns. Flagged to E04. */
  'pane.idle': 'cards show while your agent works',
  'hi.sent': 'hi sent to {handle}. If they say hi back, 4 opens a thread.',
  'hi.limit.card': 'one hi per card',
  'hi.limit.person': 'you said hi to {handle} in the last 24 hours',
  'hi.limit.day': '20 hi a day is the cap · back tomorrow',
  'cooldown.new': 'New here. First 24 hours: 5 hi a day, stricter filters, no photos.',
  'cooldown.hi_wait': 'first hi opens 1 hour after sign-in',
  'hi.mutual': 'mutual with {handle} · 4 reply · Tab, then x ends it and blocks',
  'post.placeholder': "one line about what you're waiting on · work, city, time · 80 chars",
  'post.first_time':
    'Everyone in the dooryard sees your card while your agent runs. Adults only. No links, no selling, nothing sexual.',
  'post.live': 'your card is live while this turn runs',
  'post.too_long': '80 characters max',
  'post.rate': '6 card changes an hour is the cap',
  'post.rejected.link': 'no links or handles in cards',
  'post.rejected.spam': 'no selling or recruiting in cards',
  'post.rejected.sexual': 'cards stay about work. Nothing sexual.',
  'post.rejected.harassment': "cards aren't for insults",
  'post.rejected.hate': "that word isn't allowed here",
  'post.watch_only': 'posting is off until {until} · /dooryard appeal',
  'report.title': "Report {handle}'s {what}",
  'report.sent': 'Reported. A human looks within 24 hours. Two reports from different people pull it at once.',
  'block.done': "Blocked. {handle} is gone from this machine and can't reach you here again.",
  'dm.first_open.1': 'Text only. Deleted when the thread ends, unless someone reported it. Tab, then x ends it and blocks.',
  'dm.first_open.2': "A mod loaded before Dooryard on either machine can read this text. Dooryard can't stop that.",
  'dm.placeholder': 'reply · 500 chars',
  'dm.too_long': '500 characters max',
  'dm.toast': '{handle}: {preview}',
  'dm.rate.fast': 'slow down · 1 message every 2 seconds',
  'dm.rate.hour': '60 messages an hour per thread is the cap',
  'dm.rate.day': '300 messages a day is the cap',
  /** The head of `hi.received`; its keys are the hello view's Buttons. */
  'hi.received.head': '{handle} said hi',
  'nudge.generic': 'Hold on. This can land wrong. Enter sends it as is, or edit it first.',
  'nudge.sexual': 'Hold on. This reads as sexual. Dooryard removes accounts for that. Enter sends it as is, or edit it first.',
  'nudge.harassment': 'Hold on. This reads as an insult. Enter sends it as is, or edit it first.',
  'nudge.hate': 'Hold on. That word reads as a slur. Enter sends it as is, or edit it first.',
  'hidden.one': '1 hidden message · Tab, then h shows it',
  'hidden.many': '{n} hidden messages · Tab, then h shows them',
  'hidden.toast': '{handle}: 1 hidden message',
  'checkin.bother': 'Did that bother you? Tab, then r report · b block',
  'thread.ended.by_you': 'Thread ended and {handle} blocked.',
  'thread.ended.by_them': '{handle} ended the thread.',
  'report.limit': '10 reports a day is the cap',
  'report.pulled.poster': 'Your {what} is on hold after reports. A human looks within 24 hours.',
  'report.outcome.none': 'We looked at your report on {handle}. No rule broken this time. Thanks for flagging.',
  'report.outcome.action': 'We looked at your report on {handle}. Action taken. Thanks.',
  'decision.warning': 'Warning: your {what} broke the rule on {category}. The next one switches you to watch-only.',
  'decision.watch_only': 'Watch-only for {days} days: {category}. You can read, not post. /dooryard appeal',
  'appeal.upheld': 'Appeal reviewed. The decision stands.',
  'appeal.reversed': 'Appeal reviewed. The decision is reversed and the strike removed.',
  'photo.removed.takedown':
    'Your photo was removed after a request about an intimate image shared without consent. Text cards still work.',
  'decision.permanent': 'Your Dooryard account is closed: {category}. /dooryard appeal',
  /** Not in copy.md yet: the line for an error the server sent no string for. Flagged to E04. */
  'error.unavailable': 'server unavailable',
  'error.generic': "that didn't go through",
  /** Not in copy.md yet: another thread with new messages, in the card view. Flagged to E04. */
  'thread.unread': '{handle} · {n} new',
  /** Not in copy.md yet: the line a 401 leaves until sign-in (E02-S5). Flagged to E04. */
  'yard.signed_out': 'signed out · /dooryard signs you in',
  'yard.on': 'dooryard on. Your card posts only while your agent runs. /dooryard off stops it.',
  'yard.off': 'dooryard off. /dooryard on brings it back.',
  'yard.closed_pane': 'pane closed for this session · /dooryard reopens it',
  'card.photo.not_drawn': 'photo not shown here: pictures draw only in kitty, Ghostty and iTerm2',
  'photo.rule': "Desk, screen, city, coffee. No nudity. No one else's face without their ok. Checked on upload.",
  'photo.permanent': 'Photos are permanent. Anyone who sees your card can save it. Dooryard strips location data, nothing else.',
  'photo.permanent.confirm': 'Enter posts it · Ctrl+X then X closes without posting',
  'photo.age_gate': 'One-time age check before your first photo: {vendor}. Dooryard keeps pass or fail, never the images.',
  'photo.age_gate.link': '{url}',
  'photo.age_gate.failed': "Age check didn't pass. Text cards still work. Try again in 30 days.",
  'photo.rejected.nudity': 'Photo not posted: it reads as nudity. Desk, screen, city, coffee.',
  'photo.rejected.blocked': 'Photo not posted: it matches an image Dooryard removed.',
  'photo.held': 'Photo on hold while a human looks. Your text card is live.',
  'photo.too_big': '2 MiB max',
  'photo.cooldown': 'photos open 7 days after sign-in',
  /** Not in copy.md yet: the photo field's placeholder. Flagged to E04. */
  'photo.placeholder': 'path to a .png or .jpg on this machine',
  /** Not in copy.md yet: a photo path that cannot be read. Flagged to E04. */
  'photo.unreadable': "can't read that file",
  'yard.signin': 'Sign in at {url} · code {code} · the pane picks it up on its own',
  'yard.signin.done': 'signed in as {handle}',
} as const

export type CopyKey = keyof typeof COPY

export function isCopyKey(key: string | undefined): key is CopyKey {
  return key !== undefined && Object.hasOwn(COPY, key)
}

/** What the server answered on an error (api.md §2): the code, and a copy key when it sent one. */
export type ErrorAnswer = { code: string; copyKey?: string; params?: Readonly<Record<string, string>> }

/**
 * The one line an error shows: the server's string when the mod has it, else a
 * plain line by code, so no press ends in silence.
 */
export function errorLine(answer: ErrorAnswer, params: Readonly<Record<string, string | number>> = {}): string {
  if (isCopyKey(answer.copyKey)) return copy(answer.copyKey, { ...params, ...answer.params })
  if (answer.code === 'unavailable' || answer.code === 'server_error') return copy('error.unavailable')
  return copy('error.generic')
}

/**
 * VS Code draws no hotkeys (mods interface docs, "Keyboard focus and
 * hotkeys"), so there the key hints are cut from these strings, nothing else
 * changed (copy.md rule: E02 drops the key hints there); `hi.sent` has its own
 * line in copy.md, `hi.sent.vscode`.
 */
const BARE: Partial<Record<CopyKey, string>> = {
  'hi.sent': 'hi sent to {handle}. If they say hi back, a thread opens.',
  'hi.mutual': 'mutual with {handle}',
  'dm.first_open.1': 'Text only. Deleted when the thread ends, unless someone reported it.',
  'hidden.one': '1 hidden message',
  'hidden.many': '{n} hidden messages',
  'checkin.bother': 'Did that bother you?',
}

/** `copy`, with the key hints cut where the surface draws no hotkeys. */
export function copyOn(
  surface: string,
  key: CopyKey,
  params: Readonly<Record<string, string | number>> = {},
): string {
  const bare = surface === 'vscode' ? BARE[key] : undefined
  return bare === undefined ? copy(key, params) : fill(bare, params)
}

function fill(text: string, params: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole))
}

/** The string under `key` with each `{name}` filled from `params`. */
export function copy(key: CopyKey, params: Readonly<Record<string, string | number>> = {}): string {
  return fill(COPY[key], params)
}

import { mock } from 'claude-code/testing'
import type { On, PaneOpenArgs } from 'claude-code'

// What Claude Code answers beneath the mod in a test, with a record of what
// the mod asked for: status lines, toasts, panes opened and closed, the store.

/** A Thursday 01:10 UTC: the fake's Lisbon poster reads 02:10. */
export const T0 = Date.UTC(2026, 9, 23, 1, 10)

export type SurfaceName = 'terminal' | 'desktop' | 'vscode' | 'mobile'

export const BAND = (isWorking: boolean, isFullscreen?: boolean) =>
  ({
    plugin: 'dooryard',
    component: 'AbovePrompt',
    ...(isFullscreen === undefined ? {} : { viewport: { columns: 150, rows: 40, isFullscreen } }),
    props: {
      hasSurvey: false,
      isWorking,
      maxRows: 10,
      bodyColumns: 120,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  }) as const

export const PANE = {
  plugin: 'dooryard',
  component: 'Pane',
  requestId: 'yard',
  viewport: { columns: 150, rows: 40, isFullscreen: true },
  props: {
    title: 'dooryard',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

/** A command typed at the prompt of a 120-column terminal. */
export const typed = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as const

export const done = (turnId: string, isAborted = false) =>
  ({ turnId, answer: '', durationMs: 5000, isAborted, reason: isAborted ? 'aborted' : 'answer' }) as const

export function world(
  on: On,
  surfaces: readonly SurfaceName[],
  { isPlaced = true, stored = {} }: { isPlaced?: boolean; stored?: Record<string, unknown> } = {},
) {
  const clock = mock.clock(on, { now: T0 })
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  const opened: PaneOpenArgs[] = []
  const closed: string[] = []
  const commands: string[] = []
  const logs: string[] = []
  /** Every store write, in order, as `store <key>`; a test may add its own lines. */
  const trail: string[] = []
  const store = new Map<string, unknown>(Object.entries(stored))

  on('session.start', () => ({ cwd: '/work' }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('command.register', ($, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    trail.push(`store ${e.key}`)
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.version', () => ({ value: { version: '2.1.299', base: '2.1.299' } }))
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    opened.push(e)
    return { value: isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'under 144 columns' } }
  })
  on('ui.close', ($, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  // What Claude Code itself draws in the band: nothing of its own here
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))

  return { clock, statuses, toasts, opened, closed, commands, store, logs, trail }
}

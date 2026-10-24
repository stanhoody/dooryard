import type { YardCard, YardPhase, YardServerState } from '../types'
import { copy } from './copy'

/** The VS Code panel cuts a status line at 200 characters (mods interface docs). */
export const STATUS_MAX = 200

export type BandInput = {
  phase: YardPhase
  countdown: number
  server: YardServerState | null
  card: YardCard | null
  problem: string | null
  /** False for the pane's head line, which draws the card below in full. */
  withCard?: boolean
}

/**
 * The band's text before its hotkeys, which is also the VS Code status line
 * (`band.line.vscode`); undefined while nothing should draw.
 */
export function bandLead({ phase, countdown, server, card, problem, withCard = true }: BandInput): string | undefined {
  if (phase === 'handback') return `dooryard · ${copy('pane.handback', { seconds: countdown })}`
  if (phase !== 'band') return undefined
  if (problem !== null) return copy('band.notice', { notice: problem })
  if (server === null) return 'dooryard'

  const parts = [
    server.waiting === 0 && card === null
      ? copy('band.alone')
      : copy('band.count', { waiting: server.waiting }),
  ]
  if (server.hiWaiting > 0) {
    parts.push(server.hiWaiting === 1 ? copy('band.hi.one') : copy('band.hi.many', { n: server.hiWaiting }))
  }
  if (card !== null && withCard) parts.push(`"${card.text}, ${card.city}, ${card.localTime}"`)
  return parts.join(' · ')
}

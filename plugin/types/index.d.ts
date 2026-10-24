// Dooryard's contract (codename yard in paths): the values the band and the pane draw from ($.state,
// held by the host for the session) and the keys the mod keeps on this
// machine ($.store, shared by every session, 4 MiB in all). The shapes
// follow contracts/api.md v1.0 in camelCase.

/** A card as a viewer sees it (api.md §5): one line of text, up to 80 characters. */
export type YardCard = {
  id: string
  text: string
  /** The poster's handle, without the `@`. */
  handle: string
  /** The poster's own city setting. */
  city: string
  /** The poster's wall-clock time, `HH:MM`, from the server. */
  localTime: string
  hasPhoto: boolean
  /** False once I said hi on this card or to this person in 24 hours. */
  canHi: boolean
}

/** One open thread, as the State lists it (api.md §4). */
export type YardThreadInfo = {
  id: string
  handle: string
  unread: number
  hidden: number
}

/** What the 5-second poll answers (api.md §4, the State object). */
export type YardServerState = {
  /** Other people with a live turn, me excluded. */
  waiting: number
  /** Hellos to me, unopened, under 24 hours old. */
  hiWaiting: number
  /** My live card and the hellos it got, or null. */
  myCard: { id: string; hellos: number } | null
  threads: YardThreadInfo[]
  /** `me.age_gate`: the one-time age check photo cards need (api.md §11). */
  ageGate: 'none' | 'pending' | 'pass' | 'fail'
  /** Lines the server returns once, for the next pane open (api.md §4). */
  notices: YardNotice[]
  /** An incident switch's band line while it is on, else null (api.md 1.3, `band_notice`). */
  bandNotice: string | null
}

/** One line the server returns once (api.md §4, `notices`): a copy key and its values. */
export type YardNotice = { copyKey: string; params: Record<string, string> }

/** A card's photo as the terminal draws it in an `Image` (api.md §11). */
export type YardPhoto = {
  cardId: string
  /** A whole PNG, base64, at most 2 MiB decoded. */
  png: string
  columns: number
  rows: number
  alt: string
}

/**
 * A thread opened by a mutual hello (api.md §6), as the pane shows its head.
 * `city` and `localTime` are empty when the thread came from the State list.
 */
export type YardThread = {
  id: string
  handle: string
  city: string
  localTime: string
}

/** One DM (api.md §7, the Message object). Text only. */
export type YardMessage = {
  id: string
  from: 'me' | 'them'
  text: string
  sentAt: string
  /** Show `checkin.bother` under it: it came through a nudge or the hidden folder. */
  checkin: boolean
}

/** An opened hello: who said hi (api.md §6, POST /hellos/open). */
export type YardHello = {
  id: string
  handle: string
  city: string
  localTime: string
  canHiBack: boolean
}

/** A pairing the pane shows while the person signs in on the web (api.md §3). */
export type YardPairing = {
  /** 6 characters, shown in the pane; alone it grants nothing. */
  code: string
  /** The https sign-in page, drawn as a Link. */
  url: string
  expiresAt: string
}

/** A DM the server nudged (409): Enter sends it again with `confirm`. */
export type YardNudge = { text: string; copyKey: string }

/**
 * What the pane shows: the card, the post field, the report picker, an
 * opened hello, a thread, the sign-in code, the photo path, the appeal link.
 */
export type YardPaneMode = 'card' | 'post' | 'report' | 'hello' | 'reply' | 'signin' | 'photo' | 'appeal'

/** api.md §9: the report categories, no free text. */
export type YardReportCategory = 'spam' | 'harassment' | 'sexual' | 'hate' | 'other'

/**
 * Where Yard stands in the turn: `idle` (nothing draws), `armed` (a turn
 * runs, under 2 seconds in), `band` (the band shows), `handback` (the turn
 * ended, the countdown runs).
 */
export type YardPhase = 'idle' | 'armed' | 'band' | 'handback'

/** The keys Yard keeps in `$.store`, with their values. */
export type YardStore = {
  /** False after `/yard off`, until `/yard on`. Absent reads as true. */
  enabled: boolean
  /** Handles I blocked, without the `@`. Hidden on this machine at once. */
  blocked: string[]
  /** The sign-in token the pairing endpoint handed over. Absent until sign-in. */
  token: string
  /** True once the person has seen the posting rules (`post.first_time`). */
  seenPostRules: boolean
}

declare module 'claude-code' {
  interface PluginState {
    dooryard: {
      phase: YardPhase
      /** Seconds left in the hand-back countdown. */
      countdown: number
      /** The last State the server answered this turn; null between turns. */
      server: YardServerState | null
      /** The card dealt to me for this wait. */
      card: YardCard | null
      /** One line the band shows instead of the count: a backend problem. */
      problem: string | null
      /** What the pane shows. */
      mode: YardPaneMode
      /** The thread a mutual hello opened, while this session knows it. */
      thread: YardThread | null
      /** The messages of that thread the pane has. */
      messages: YardMessage[]
      /** Messages of that thread in the hidden folder. */
      hidden: number
      /** The hello opened from the pane, while it shows it. */
      hello: YardHello | null
      /** The DM the server nudged, waiting on Enter. */
      nudge: YardNudge | null
      /** The sign-in code and link while the pane shows them. */
      pairing: YardPairing | null
      /** The photo of the card dealt to me, when it has one and the terminal draws it. */
      photo: YardPhoto | null
      /** The photo path typed once; the second Enter, after `photo.permanent`, posts it. */
      photoPath: string | null
      /** The age-check link the server asked for, while the photo field shows it. */
      ageGateUrl: string | null
      /** Notices kept until the pane has shown them and closed. */
      notices: YardNotice[]
    }
  }
}

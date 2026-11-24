// pitch recognition: the rules. a real pitch leaves his hand on its real path, and you
// only see it until it's a set distance from the plate. then it's gone, and you call what
// it was and tap where you think it crossed. every few pitches it vanishes earlier.
//
// hitters have to decide about 20 to 25 feet out, so the first level shows you more than a
// hitter gets and the last shows you less than half of that.

import { deal, mulberry32 } from './game'
import type { AtBat, Pitch, PitchCall } from './types'

export interface Level {
  /** feet from the front of the plate where the ball disappears */
  gone: number
  /** points are multiplied by this */
  mult: number
}

export const LEVELS: Level[] = [
  { gone: 20, mult: 1 },
  { gone: 27, mult: 2 },
  { gone: 33, mult: 3 },
  { gone: 39, mult: 4 },
  { gone: 44, mult: 5 },
]
/** pitches per level */
export const PER_LEVEL = 3
export const RUN_LENGTH = LEVELS.length * PER_LEVEL
/** seconds to make the call once the ball is gone */
export const CALL_SECONDS = 6

export const POINTS = { pitch: 10, spot: 5 } as const
/** a tap this close to where it crossed, in feet, gets every spot point. a ball is about
 * 0.24 ft across, so that's about a ball's width either way */
export const NEAR = 0.3
/** and this far or more gets none */
export const FAR = 1.5

export function levelOf(index: number): Level {
  return LEVELS[Math.min(LEVELS.length - 1, Math.floor(index / PER_LEVEL))]
}

/** one pitch to call, with the at-bat it came from for who's pitching and batting */
export interface Card {
  ab: AtBat
  pitch: Pitch
}

export interface RecCall {
  pitch: PitchCall | null
  /** where you tapped, plate_x and plate_z in feet, or null if you didn't */
  spot: [number, number] | null
}

export interface RecGrade {
  pitch: boolean
  /** feet from your tap to where it crossed */
  miss: number | null
  spotPoints: number
  points: number
}

export function gradeRec(call: RecCall, truth: Pitch, level: Level): RecGrade {
  const pitch = call.pitch === truth.pitch
  let miss: number | null = null
  let spotPoints = 0
  if (call.spot) {
    miss = Math.hypot(call.spot[0] - truth.plate[0], call.spot[1] - truth.plate[1])
    const share = Math.min(1, Math.max(0, (FAR - miss) / (FAR - NEAR)))
    spotPoints = Math.round(POINTS.spot * share)
  }
  return {
    pitch,
    miss,
    spotPoints,
    points: ((pitch ? POINTS.pitch : 0) + spotPoints) * level.mult,
  }
}

/** the most a run can score */
export const BEST = LEVELS.reduce((a, l) => a + (POINTS.pitch + POINTS.spot) * l.mult, 0) * PER_LEVEL

/** every pitch in the game as a card */
export function cards(atBats: AtBat[]): Card[] {
  return atBats.flatMap((ab) => ab.pitches.map((pitch) => ({ ab, pitch })))
}

/** the pitches for a run. sorted first so a seed always deals the same ones, and no
 * pitcher shows up more than twice in a row */
export function dealRun(all: Card[], seed: number, n = RUN_LENGTH): Card[] {
  const pool = [...all].sort((a, b) =>
    `${a.ab.id}:${a.pitch.n}`.localeCompare(`${b.ab.id}:${b.pitch.n}`),
  )
  const shuffled = deal(pool, pool.length, mulberry32(seed))
  const out: Card[] = []
  const later: Card[] = []
  for (const c of shuffled) {
    if (out.length === n) break
    const prev = out.slice(-2)
    if (prev.length === 2 && prev.every((p) => p.ab.pitcher.id === c.ab.pitcher.id)) {
      later.push(c)
      continue
    }
    out.push(c)
  }
  return out.concat(later).slice(0, n)
}

export function daySeed(key: string): number {
  // a different stream from the daily at-bats on the same day
  return Number(key.replaceAll('-', '')) * 7 + 3
}

export class Run {
  readonly cards: Card[]
  readonly results: RecGrade[] = []
  index = 0

  constructor(cards: Card[]) {
    if (!cards.length) throw new Error('a run needs pitches')
    this.cards = cards
  }

  get card(): Card {
    return this.cards[this.index]
  }

  get level(): Level {
    return levelOf(this.index)
  }

  get done(): boolean {
    return this.results.length === this.cards.length
  }

  call(c: RecCall): RecGrade {
    if (this.results.length !== this.index) throw new Error('this pitch was already called')
    const g = gradeRec(c, this.card.pitch, this.level)
    this.results.push(g)
    return g
  }

  next(): boolean {
    if (this.results.length <= this.index) throw new Error('call this pitch first')
    if (this.index >= this.cards.length - 1) return false
    this.index += 1
    return true
  }

  get score(): number {
    return this.results.reduce((a, r) => a + r.points, 0)
  }

  get read(): number {
    return this.results.filter((r) => r.pitch).length
  }
}

/** green: right pitch and a close tap. yellow: one of them. white: neither */
export function recSquare(g: RecGrade): string {
  const close = g.spotPoints >= POINTS.spot / 2
  return g.pitch && close ? '🟩' : g.pitch || close ? '🟨' : '⬜'
}

export function recShare(day: number, results: RecGrade[], site: string): string {
  const score = results.reduce((a, r) => a + r.points, 0)
  const read = results.filter((r) => r.pitch).length
  const rows = []
  for (let i = 0; i < results.length; i += PER_LEVEL) {
    rows.push(results.slice(i, i + PER_LEVEL).map(recSquare).join(''))
  }
  return [
    `batter up #${day} ⚾ pitch recognition`,
    `${score} pts · read ${read}/${results.length}`,
    rows.join(' '),
    site,
  ].join('\n')
}

/** baseball savant's page for this exact pitch, with the broadcast clip */
export function clipUrl(p: Pitch): string | null {
  return p.clip ? `https://baseballsavant.mlb.com/sporty-videos?playId=${p.clip}` : null
}

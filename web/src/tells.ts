// what you get to read before a pitch: the pitcher's real scouting book, his real arm
// slot, and a few made up tells in his delivery.
//
// the book (public/data/scouting.json, from batter-up scout) is real: his mix by count and
// by the pitch before, where each pitch goes, and where his hand is when each one comes
// out. real pitchers almost never tip their pitches, so on top of that every pitcher gets
// one or two tells that are made up for the game: where his glove sits at the set, how
// high he kicks, how long he holds. which tells he has, and which pitches they point to,
// come from a seed on his id, so they're the same every day and you can learn them. how
// honest they are depends on how guarded he is: relievers give a lot away, aces hardly
// anything. the real pitch is known ahead of time, so a tell is drawn to match it most of
// the time and is a coin flip the rest

import { mulberry32 } from './game'
import type { AtBat, Pitch, PitchCall } from './types'

/** where a pitch crosses, from the catcher's view. left and right become in and away */
export type Way = 'up' | 'down' | 'left' | 'right'
export const WAYS: Way[] = ['up', 'down', 'left', 'right']

type Mix = Partial<Record<PitchCall, number>>

export interface SideBook {
  pitches: number
  mix: Mix
  counts: Record<string, Mix>
  after: Partial<Record<PitchCall, Mix>>
  location: Partial<Record<PitchCall, Partial<Record<Way, number>>>>
}

export interface PitcherBook {
  pitches: number
  games: number
  starter: boolean
  whiff: number
  tier: Tier
  repertoire: PitchCall[]
  favorite: PitchCall | null
  /** how often his release point alone names the pitch */
  slotRead: number
  /** mean x, mean z, sd x, sd z of where each pitch comes out, in feet */
  release: Partial<Record<PitchCall, [number, number, number, number]>>
  sides: Record<'L' | 'R', SideBook>
}

export interface Scouting {
  version: number
  seasons: number[]
  buckets: Record<string, string[]>
  pitchers: Record<string, PitcherBook>
}

export type Tier = 1 | 2 | 3

export const TIERS: Record<Tier, { name: string; blurb: string; tells: number; honest: number }> =
  {
    1: { name: 'open book', blurb: 'a reliever who gives a lot away', tells: 2, honest: 0.9 },
    2: { name: 'tips some', blurb: 'a starter who hides most of it', tells: 2, honest: 0.75 },
    3: { name: 'poker face', blurb: 'an ace, he barely tips anything', tells: 1, honest: 0.65 },
  }

export type CueKind = 'glove' | 'kick' | 'hold'
export const CUE_KINDS: CueKind[] = ['glove', 'kick', 'hold']
export const CUES: Record<CueKind, { name: string; levels: [string, string] }> = {
  glove: { name: 'glove at the set', levels: ['at his chest', 'at his belt'] },
  kick: { name: 'leg kick', levels: ['high kick', 'slide step'] },
  hold: { name: 'time in the set', levels: ['quick', 'long hold'] },
}

export type Level = 0 | 1
export type Cues = Record<CueKind, Level>

export interface Tell {
  kind: CueKind
  /** which way the cue goes for each of his pitches */
  levels: Partial<Record<PitchCall, Level>>
}

export const HARD: PitchCall[] = ['fastball', 'sinker', 'cutter']

/** pitches seen before the scouts tell you each of his tells */
export const UNLOCK = [5, 12]

/** a string to a 32 bit seed (fnv-1a) */
export function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** the same as batter_up.scout.direction: whichever way it's furthest from the middle,
 * in half-zones. 0.83 ft is half the plate plus the ball */
export function wayOf(plate: [number, number], sz: [number, number]): Way {
  const [x, z] = plate
  const [bot, top] = sz
  const dx = x / 0.83
  const dz = (z - (top + bot) / 2) / ((top - bot) / 2)
  if (Math.abs(dz) >= Math.abs(dx)) return dz >= 0 ? 'up' : 'down'
  return dx >= 0 ? 'right' : 'left'
}

// the model's 13 spots folded into the four ways. a corner is half each of its two sides
// and the middle box is a quarter of each
const ZONE_WAYS: Partial<Record<Way, number>>[] = [
  { up: 0.5, left: 0.5 },
  { up: 1 },
  { up: 0.5, right: 0.5 },
  { left: 1 },
  { up: 0.25, down: 0.25, left: 0.25, right: 0.25 },
  { right: 1 },
  { down: 0.5, left: 0.5 },
  { down: 1 },
  { down: 0.5, right: 0.5 },
  { up: 1 },
  { down: 1 },
  { left: 1 },
  { right: 1 },
]

export function wayOdds(zoneOdds: number[]): Record<Way, number> {
  const out: Record<Way, number> = { up: 0, down: 0, left: 0, right: 0 }
  zoneOdds.forEach((p, i) => {
    for (const [w, share] of Object.entries(ZONE_WAYS[i] ?? {})) out[w as Way] += p * share!
  })
  return out
}

export function bestWay(odds: Record<Way, number>): Way {
  return WAYS.reduce((a, b) => (odds[b] > odds[a] ? b : a))
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** what he throws, most used first: from the book, or from this at-bat's mix without one */
export function repertoire(ab: AtBat, book?: PitcherBook): PitchCall[] {
  if (book?.repertoire.length) return book.repertoire
  const mix = ab.pitcher.mix
  const thrown = (Object.keys(mix) as PitchCall[]).filter((c) => (mix[c] ?? 0) >= 0.02)
  return thrown.sort((a, b) => mix[b]! - mix[a]!)
}

export function tierOf(book?: PitcherBook): Tier {
  return book?.tier ?? 1
}

/**
 * his made up tells. the first splits hard stuff from soft stuff (or, if he only has one
 * kind, his pitches by how often he throws them), the second splits each of those again,
 * so two tells together can name up to four pitches. which cue carries which tell, and
 * which way round, is seeded on his id
 */
export function tellsFor(pitcherId: number, pitches: PitchCall[], tier: Tier): Tell[] {
  const random = mulberry32(hash(`tells:${pitcherId}`))
  const kinds = shuffle(CUE_KINDS, random)
  const flipA = (random() < 0.5 ? 1 : 0) as Level
  const flipB = (random() < 0.5 ? 1 : 0) as Level
  const hard = pitches.filter((c) => HARD.includes(c))
  const soft = pitches.filter((c) => !HARD.includes(c))
  const mixed = hard.length > 0 && soft.length > 0
  const a: Tell['levels'] = {}
  const b: Tell['levels'] = {}
  pitches.forEach((c, i) => {
    const group = HARD.includes(c) ? hard : soft
    const j = group.indexOf(c)
    a[c] = ((mixed ? (HARD.includes(c) ? 0 : 1) : i % 2) ^ flipA) as Level
    b[c] = ((mixed ? j % 2 : Math.floor(i / 2) % 2) ^ flipB) as Level
  })
  const tells: Tell[] = [
    { kind: kinds[0], levels: a },
    { kind: kinds[1], levels: b },
  ]
  return tells.slice(0, TIERS[tier].tells)
}

/** what he shows on this pitch. a cue he has a tell on matches the real pitch as often as
 * he's honest, and is a coin flip otherwise. a cue he has no tell on is always a coin flip */
export function cuesFor(ab: AtBat, p: Pitch, tells: Tell[], tier: Tier): Cues {
  const random = mulberry32(hash(`cues:${ab.id}:${p.n}`))
  const out = {} as Cues
  for (const kind of CUE_KINDS) {
    const roll = random()
    const coin = (random() < 0.5 ? 0 : 1) as Level
    const level = tells.find((t) => t.kind === kind)?.levels[p.pitch]
    out[kind] = level !== undefined && roll < TIERS[tier].honest ? level : coin
  }
  return out
}

/** the pitches a tell points to when the cue shows `level` */
export function pointsTo(tell: Tell, level: Level, pitches: PitchCall[]): PitchCall[] {
  return pitches.filter((c) => tell.levels[c] === level)
}

/**
 * the real arm slot: how far this pitch's release is from where each of his pitches
 * usually comes out, in that pitch's own spread. lower is closer. it's the one tell in
 * the game that's really there, and for most pitchers it's faint
 */
export function slotFit(p: Pitch, book?: PitcherBook): { call: PitchCall; distance: number }[] {
  if (!book) return []
  const [x, , z] = p.release
  return (Object.entries(book.release) as [PitchCall, [number, number, number, number]][])
    .map(([call, [mx, mz, sx, sz]]) => ({
      call,
      distance: Math.hypot((x - mx) / Math.max(sx, 0.03), (z - mz) / Math.max(sz, 0.03)),
    }))
    .sort((a, b) => a.distance - b.distance)
}

/** how far up or down his arm is on this pitch versus his usual, in his own spreads,
 * for the 3d pitcher to lean his arm by */
export function slotTilt(p: Pitch, book?: PitcherBook): number {
  if (!book) return 0
  const all = Object.values(book.release)
  if (!all.length) return 0
  const mz = all.reduce((a, r) => a + r![1], 0) / all.length
  const sz = all.reduce((a, r) => a + r![3], 0) / all.length
  return Math.max(-2.5, Math.min(2.5, (p.release[2] - mz) / Math.max(sz, 0.05)))
}

// the book, for this spot in the at-bat

export const BUCKET_NAMES: Record<string, string> = {
  first: 'first pitch',
  early: 'early in the count',
  behind: 'when he’s behind',
  'two strikes': 'with two strikes',
  full: 'full count',
}

export function bucketOf(count: string, buckets: Record<string, string[]>): string | null {
  for (const [name, counts] of Object.entries(buckets)) if (counts.includes(count)) return name
  return null
}

export interface BookLine {
  label: string
  mix: Mix
}

/** the lines of his book that fit right now: vs this side, in this count, after the last pitch */
export function bookLines(
  book: PitcherBook | undefined,
  buckets: Record<string, string[]>,
  ab: AtBat,
  p: Pitch,
  last: Pitch | undefined,
): BookLine[] {
  if (!book) return []
  const side = book.sides[ab.batter.stands]
  const sideName = ab.batter.stands === 'L' ? 'lefties' : 'righties'
  const lines: BookLine[] = []
  if (Object.keys(side.mix).length) lines.push({ label: `to ${sideName}`, mix: side.mix })
  const bucket = bucketOf(p.count, buckets)
  if (bucket && Object.keys(side.counts[bucket] ?? {}).length) {
    lines.push({ label: BUCKET_NAMES[bucket] ?? bucket, mix: side.counts[bucket] })
  }
  if (last) {
    const after = side.after[last.pitch]
    if (after && Object.keys(after).length) lines.push({ label: `after a ${last.pitch}`, mix: after })
  }
  return lines
}

// your notebook: every cue you've seen him show, and what the pitch turned out to be

export interface Notes {
  seen: number
  cues: Record<CueKind, [Mix, Mix]>
}

export function emptyNotes(): Notes {
  return { seen: 0, cues: { glove: [{}, {}], kick: [{}, {}], hold: [{}, {}] } }
}

export function record(notes: Notes, cues: Cues, actual: PitchCall): Notes {
  const next: Notes = JSON.parse(JSON.stringify(notes))
  next.seen += 1
  for (const kind of CUE_KINDS) {
    const row = next.cues[kind][cues[kind]]
    row[actual] = (row[actual] ?? 0) + 1
  }
  return next
}

/** how many of his tells the scouts have told you about, after `seen` pitches */
export function unlocked(seen: number, tells: Tell[]): Tell[] {
  return tells.filter((_, i) => seen >= UNLOCK[i])
}

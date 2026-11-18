// the rules, kept apart from the page so they can be tested on their own

import type { AtBat, Pitch, PitchCall, Zone } from './types'

export interface Guess {
  pitch: PitchCall
  zone: Zone
}

export interface Grade {
  pitch: boolean
  zone: boolean
  points: number
}

export interface PitchResult {
  pitch: Pitch
  you: Grade
  model: Grade
}

/** 2 for the pitch type, 1 for the zone, 1 more for both. 4 is a perfect call */
export const POINTS = { pitch: 2, zone: 1, both: 1 } as const
export const PERFECT = POINTS.pitch + POINTS.zone + POINTS.both

export function grade(guess: Guess, truth: Pitch): Grade {
  const pitch = guess.pitch === truth.pitch
  const zone = guess.zone === truth.zone
  const points =
    (pitch ? POINTS.pitch : 0) + (zone ? POINTS.zone : 0) + (pitch && zone ? POINTS.both : 0)
  return { pitch, zone, points }
}

export function modelGuess(p: Pitch): Guess {
  return { pitch: p.model.call[0], zone: p.model.call[1] }
}

/** one sitting: a few at-bats, one pitch at a time, you and the model calling each */
export class Session {
  readonly atBats: AtBat[]
  readonly results: PitchResult[][]
  atBatIndex = 0
  pitchIndex = 0

  constructor(atBats: AtBat[]) {
    if (atBats.length === 0) throw new Error('a session needs at least one at-bat')
    this.atBats = atBats
    this.results = atBats.map(() => [])
  }

  get atBat(): AtBat {
    return this.atBats[this.atBatIndex]
  }

  get pitch(): Pitch {
    return this.atBat.pitches[this.pitchIndex]
  }

  /** pitches already thrown in this at-bat, the ones you get to see */
  get history(): Pitch[] {
    return this.atBat.pitches.slice(0, this.pitchIndex)
  }

  get atBatDone(): boolean {
    return this.results[this.atBatIndex].length === this.atBat.pitches.length
  }

  get done(): boolean {
    return this.atBatIndex === this.atBats.length - 1 && this.atBatDone
  }

  call(guess: Guess): PitchResult {
    if (this.atBatDone) throw new Error('this at-bat is over')
    if (this.results[this.atBatIndex].length !== this.pitchIndex) {
      throw new Error('this pitch was already called')
    }
    const result = {
      pitch: this.pitch,
      you: grade(guess, this.pitch),
      model: grade(modelGuess(this.pitch), this.pitch),
    }
    this.results[this.atBatIndex].push(result)
    return result
  }

  /** move on after a call. returns false when the session is over */
  next(): boolean {
    if (this.results[this.atBatIndex].length <= this.pitchIndex) {
      throw new Error('call this pitch first')
    }
    if (this.pitchIndex < this.atBat.pitches.length - 1) {
      this.pitchIndex += 1
      return true
    }
    if (this.atBatIndex < this.atBats.length - 1) {
      this.atBatIndex += 1
      this.pitchIndex = 0
      return true
    }
    return false
  }

  totals(): { you: number; model: number; pitches: number; perfect: number } {
    const all = this.results.flat()
    return {
      you: sum(all.map((r) => r.you.points)),
      model: sum(all.map((r) => r.model.points)),
      pitches: all.length,
      perfect: all.length * PERFECT,
    }
  }
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}

/** small seeded random number generator, so a seed always deals the same at-bats */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function deal<T>(items: T[], n: number, random: () => number): T[] {
  const pool = [...items]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, Math.min(n, pool.length))
}

/** what happened on the pitch, the way you'd say it */
export function describe(result: string): string {
  const words: Record<string, string> = {
    ball: 'ball',
    blocked_ball: 'ball in the dirt',
    called_strike: 'called strike',
    swinging_strike: 'swinging strike',
    swinging_strike_blocked: 'swinging strike',
    foul: 'foul',
    foul_tip: 'foul tip',
    foul_bunt: 'foul bunt',
    missed_bunt: 'missed bunt',
    hit_into_play: 'in play',
    hit_by_pitch: 'hit by pitch',
    pitchout: 'pitchout',
  }
  return words[result] ?? result.replaceAll('_', ' ')
}

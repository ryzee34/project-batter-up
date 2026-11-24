import { describe, expect, it } from 'vitest'

import {
  CUE_KINDS,
  TIERS,
  bookLines,
  cuesFor,
  emptyNotes,
  pointsTo,
  record,
  slotFit,
  tellsFor,
  unlocked,
  wayOdds,
  wayOf,
  type PitcherBook,
} from './tells'
import type { AtBat, Pitch, PitchCall } from './types'

function pitch(n: number, call: PitchCall, release: [number, number, number] = [-2, 54, 6]): Pitch {
  return {
    n,
    count: '0-0',
    pitch: call,
    zone: '5',
    name: call,
    mph: 90,
    spin: 2200,
    result: 'ball',
    plate: [0, 2.5],
    sz: [1.6, 3.4],
    release,
    flight: [5, -130, -5, -10, 28, -20],
    model: { call: ['fastball', '5'], pitch: [], zone: [] },
    baseline: ['fastball', '5'],
  }
}

const ab = { id: 'g-1', pitcher: { id: 42, mix: {} }, batter: { stands: 'L' } } as unknown as AtBat
const mix: PitchCall[] = ['fastball', 'slider', 'changeup', 'cutter']

describe('wayOf', () => {
  it('names the way a pitch is furthest from the middle of the zone', () => {
    expect(wayOf([0, 3.8], [1.6, 3.4])).toBe('up')
    expect(wayOf([0.3, 1.0], [1.6, 3.4])).toBe('down')
    expect(wayOf([-1.2, 2.6], [1.6, 3.4])).toBe('left')
    expect(wayOf([0.9, 2.4], [1.6, 3.4])).toBe('right')
  })

  it('folds the 13 spots into four ways that still add up to one', () => {
    const odds = wayOdds([0.1, 0, 0, 0, 0.4, 0, 0, 0, 0, 0, 0.5, 0, 0])
    expect(odds.up).toBeCloseTo(0.05 + 0.1)
    expect(odds.down).toBeCloseTo(0.6)
    expect(odds.left + odds.right + odds.up + odds.down).toBeCloseTo(1)
  })
})

describe('tells', () => {
  it('gives a pitcher the same tells every time', () => {
    expect(tellsFor(42, mix, 1)).toEqual(tellsFor(42, mix, 1))
    expect(tellsFor(42, mix, 1)).not.toEqual(tellsFor(43, mix, 1))
  })

  it('splits hard from soft first, then splits each of those again', () => {
    const [a, b] = tellsFor(42, mix, 1)
    expect(a.levels.fastball).toBe(a.levels.cutter)
    expect(a.levels.slider).toBe(a.levels.changeup)
    expect(a.levels.fastball).not.toBe(a.levels.slider)
    expect(b.levels.fastball).not.toBe(b.levels.cutter)
    expect(b.levels.slider).not.toBe(b.levels.changeup)
    // together they name all four
    const codes = mix.map((c) => `${a.levels[c]}${b.levels[c]}`)
    expect(new Set(codes).size).toBe(4)
    expect(pointsTo(a, a.levels.fastball!, mix).sort()).toEqual(['cutter', 'fastball'])
  })

  it('gives aces fewer tells', () => {
    expect(tellsFor(42, mix, 1)).toHaveLength(TIERS[1].tells)
    expect(tellsFor(42, mix, 3)).toHaveLength(TIERS[3].tells)
  })

  it('shows the tell for the real pitch about as often as he is honest', () => {
    const tells = tellsFor(42, mix, 1)
    const [a] = tells
    let match = 0
    const n = 2000
    for (let i = 0; i < n; i++) {
      const p = pitch(i, 'slider')
      const cues = cuesFor({ ...ab, id: `g-${i}` }, p, tells, 1)
      if (cues[a.kind] === a.levels.slider) match += 1
      // the same pitch always shows the same cues
      expect(cuesFor({ ...ab, id: `g-${i}` }, p, tells, 1)).toEqual(cues)
    }
    const expected = TIERS[1].honest + (1 - TIERS[1].honest) / 2
    expect(match / n).toBeGreaterThan(expected - 0.04)
    expect(match / n).toBeLessThan(expected + 0.04)
  })

  it('unlocks the scouts notes as you see more of him', () => {
    const tells = tellsFor(42, mix, 1)
    expect(unlocked(0, tells)).toHaveLength(0)
    expect(unlocked(100, tells)).toHaveLength(2)
  })

  it('keeps a notebook of every cue and what came', () => {
    const cues = { glove: 0, kick: 1, hold: 0 } as const
    let notes = record(emptyNotes(), cues, 'slider')
    notes = record(notes, cues, 'slider')
    expect(notes.seen).toBe(2)
    expect(notes.cues.kick[1].slider).toBe(2)
    expect(CUE_KINDS.every((k) => notes.cues[k][1 - cues[k]].slider === undefined)).toBe(true)
  })
})

describe('the book', () => {
  const book = {
    tier: 1,
    repertoire: ['fastball', 'curveball'],
    release: { fastball: [-2, 5.6, 0.1, 0.1], curveball: [-2, 6.2, 0.1, 0.1] },
    sides: {
      L: {
        pitches: 100,
        mix: { fastball: 0.6, curveball: 0.4 },
        counts: { first: { fastball: 0.8, curveball: 0.2 } },
        after: { fastball: { curveball: 0.7, fastball: 0.3 } },
        location: {},
      },
    },
  } as unknown as PitcherBook

  it('picks out the lines that fit this pitch', () => {
    const lines = bookLines(book, { first: ['0-0'] }, ab, pitch(2, 'curveball'), pitch(1, 'fastball'))
    expect(lines.map((l) => l.label)).toEqual(['to lefties', 'first pitch', 'after a fastball'])
  })

  it('reads the arm slot against where each pitch usually comes out', () => {
    expect(slotFit(pitch(1, 'curveball', [-2, 54, 6.15]), book)[0].call).toBe('curveball')
    expect(slotFit(pitch(1, 'fastball', [-2, 54, 5.62]), book)[0].call).toBe('fastball')
  })
})

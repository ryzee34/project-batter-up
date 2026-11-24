import { describe, expect, it } from 'vitest'

import { flight } from './flight'
import {
  BEST,
  FAR,
  LEVELS,
  NEAR,
  POINTS,
  RUN_LENGTH,
  Run,
  cards,
  clipUrl,
  dealRun,
  gradeRec,
  levelOf,
  recShare,
} from './recognize'
import type { AtBat, Pitch, PitchCall } from './types'

function pitch(n: number, call: PitchCall): Pitch {
  return {
    n,
    count: '0-0',
    pitch: call,
    zone: '5',
    name: call,
    mph: 90,
    spin: 2200,
    result: 'ball',
    plate: [0.2, 2.4],
    sz: [1.6, 3.4],
    release: [-2, 54, 6],
    flight: [5, -130, -5, -10, 28, -20],
    model: { call: ['fastball', '5'], pitch: [], zone: [] },
    baseline: ['fastball', '5'],
  }
}

function atBat(id: string, pitcher: number, n: number): AtBat {
  return {
    id,
    pitcher: { id: pitcher },
    pitches: Array.from({ length: n }, (_, i) => pitch(i + 1, i % 2 ? 'slider' : 'fastball')),
  } as unknown as AtBat
}

describe('grading a call', () => {
  const truth = pitch(1, 'slider')
  it('pays for the pitch and for a tap near where it crossed, times the level', () => {
    const level = LEVELS[2]
    const g = gradeRec({ pitch: 'slider', spot: [0.2, 2.4] }, truth, level)
    expect(g).toMatchObject({ pitch: true, miss: 0, spotPoints: POINTS.spot })
    expect(g.points).toBe((POINTS.pitch + POINTS.spot) * level.mult)
  })

  it('gives fewer spot points the further off the tap is, and none past FAR', () => {
    const at = (d: number) => gradeRec({ pitch: null, spot: [0.2 + d, 2.4] }, truth, LEVELS[0])
    expect(at(NEAR).spotPoints).toBe(POINTS.spot)
    expect(at((NEAR + FAR) / 2).spotPoints).toBeLessThan(POINTS.spot)
    expect(at((NEAR + FAR) / 2).spotPoints).toBeGreaterThan(0)
    expect(at(FAR + 0.1).spotPoints).toBe(0)
  })

  it('scores nothing for no call', () => {
    expect(gradeRec({ pitch: null, spot: null }, truth, LEVELS[4]).points).toBe(0)
  })
})

describe('a run', () => {
  const abs = [atBat('a', 1, 6), atBat('b', 2, 6), atBat('c', 3, 6)]

  it('gets harder every few pitches', () => {
    expect(levelOf(0)).toBe(LEVELS[0])
    expect(levelOf(RUN_LENGTH - 1)).toBe(LEVELS.at(-1))
    for (let i = 1; i < LEVELS.length; i++) expect(LEVELS[i].gone).toBeGreaterThan(LEVELS[i - 1].gone)
  })

  it('deals the same pitches for the same seed, without one pitcher three times running', () => {
    const all = cards(abs)
    const a = dealRun(all, 11)
    expect(a).toHaveLength(RUN_LENGTH)
    expect(dealRun([...all].reverse(), 11)).toEqual(a)
    expect(dealRun(all, 12)).not.toEqual(a)
    for (let i = 2; i < a.length; i++) {
      const ids = [a[i - 2], a[i - 1], a[i]].map((c) => c.ab.pitcher.id)
      if (new Set(ids).size === 1) throw new Error(`pitcher ${ids[0]} three in a row at ${i}`)
    }
  })

  it('walks through every pitch and adds up the score', () => {
    const run = new Run(dealRun(cards(abs), 5, 4))
    let total = 0
    do {
      const g = run.call({ pitch: run.card.pitch.pitch, spot: run.card.pitch.plate })
      total += g.points
    } while (run.next())
    expect(run.done).toBe(true)
    expect(run.read).toBe(4)
    expect(run.score).toBe(total)
    expect(() => run.call({ pitch: null, spot: null })).toThrow()
  })

  it('shares a spoiler free line per level', () => {
    const g = (pitch: boolean, spotPoints: number) => ({ pitch, miss: 0, spotPoints, points: 10 })
    const text = recShare(8, [g(true, 5), g(false, 5), g(false, 0)], 'example.com')
    expect(text).toBe('batter up #8 ⚾ pitch recognition\n30 pts · read 1/3\n🟩🟨⬜\nexample.com')
    expect(BEST).toBeGreaterThan(0)
  })

  it('links to savant only when the clip was found', () => {
    expect(clipUrl(pitch(1, 'slider'))).toBeNull()
    expect(clipUrl({ ...pitch(1, 'slider'), clip: 'abc' })).toContain('playId=abc')
  })
})

describe('flight.when', () => {
  it('finds when the ball is a given distance out', () => {
    const f = flight(pitch(1, 'fastball'))
    const t = f.when(30)
    expect(f.at(t)[1]).toBeCloseTo(30)
    expect(t).toBeGreaterThan(f.release)
    expect(t).toBeLessThan(f.plate)
  })
})

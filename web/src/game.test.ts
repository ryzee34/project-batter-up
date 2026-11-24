import { describe as group, expect, it } from 'vitest'

import { HOT, PERFECT, Session, deal, describe, grade, modelGuess, mulberry32 } from './game'
import type { Way } from './tells'
import type { AtBat, Pitch, PitchCall, Zone } from './types'

// where a pitch crosses for each way, with the zone from 1.6 to 3.4 ft
const PLATE: Record<Way, [number, number]> = {
  up: [0.1, 3.9],
  down: [-0.2, 1.2],
  left: [-1.3, 2.6],
  right: [1.1, 2.3],
}

function pitch(n: number, call: PitchCall, way: Way, model: [PitchCall, Zone]): Pitch {
  const zone: Zone = { up: 'chase_up', down: 'chase_down', left: 'chase_left', right: 'chase_right' }[way] as Zone
  const zoneOdds = Array(13).fill(0)
  zoneOdds[['1', '2', '3', '4', '5', '6', '7', '8', '9', 'chase_up', 'chase_down', 'chase_left', 'chase_right'].indexOf(model[1])] = 1
  return {
    n,
    count: '0-0',
    pitch: call,
    zone,
    name: call,
    mph: 90,
    spin: 2200,
    result: 'ball',
    plate: PLATE[way],
    sz: [1.6, 3.4],
    release: [-2, 54, 6],
    flight: [5, -130, -5, -10, 28, -20],
    model: { call: model, pitch: [], zone: zoneOdds },
    baseline: ['fastball', '5'],
  }
}

function atBat(id: string, pitches: Pitch[]): AtBat {
  return {
    id,
    date: '2026-05-01',
    team: 'LAD',
    opponent: 'SF',
    home: true,
    inning: 1,
    half: 'top',
    outs: 0,
    runners: [false, false, false],
    score: { pitching: 0, batting: 0 },
    pitcher: { id: 1, name: 'A', throws: 'R', pitchesToday: 0, mix: {}, mixVsSide: {} },
    batter: { id: 2, name: 'B', stands: 'L' },
    result: 'strikeout',
    des: 'B strikes out.',
    pitches,
  }
}

group('grade', () => {
  const truth = pitch(1, 'slider', 'down', ['slider', '8'])
  it('pays 3 for the pitch and 1 for the way it went', () => {
    expect(grade({ pitch: 'slider', way: 'down' }, truth)).toEqual({
      pitch: true,
      way: true,
      streak: 1,
      points: PERFECT,
    })
    expect(grade({ pitch: 'slider', way: 'up' }, truth).points).toBe(3)
    expect(grade({ pitch: 'fastball', way: 'down' }, truth).points).toBe(1)
    expect(grade({ pitch: 'fastball', way: 'left' }, truth).points).toBe(0)
  })

  it('doubles the points once you read enough pitches in a row, and resets on a miss', () => {
    expect(grade({ pitch: 'slider', way: 'down' }, truth, HOT - 2).points).toBe(PERFECT)
    expect(grade({ pitch: 'slider', way: 'down' }, truth, HOT - 1)).toMatchObject({
      streak: HOT,
      points: PERFECT * 2,
    })
    expect(grade({ pitch: 'fastball', way: 'down' }, truth, 5)).toMatchObject({
      streak: 0,
      points: 1,
    })
  })

  it('folds the model\'s spot into a way', () => {
    expect(modelGuess(truth)).toEqual({ pitch: 'slider', way: 'down' })
  })
})

group('Session', () => {
  const abs = [
    atBat('a', [
      pitch(1, 'fastball', 'up', ['fastball', '2']),
      pitch(2, 'slider', 'down', ['fastball', 'chase_down']),
    ]),
    atBat('b', [pitch(1, 'changeup', 'down', ['sinker', '7'])]),
  ]

  it('walks through every pitch of every at-bat, scoring you and the model', () => {
    const s = new Session(abs)
    expect(s.history).toEqual([])
    s.call({ pitch: 'fastball', way: 'up' })
    expect(s.next()).toBe(true)
    expect(s.history.map((p) => p.n)).toEqual([1])
    s.call({ pitch: 'slider', way: 'left' })
    expect(s.atBatDone).toBe(true)
    expect(s.next()).toBe(true)
    expect(s.atBat.id).toBe('b')
    expect(s.history).toEqual([])
    // the third read in a row, across at-bats, counts double
    s.call({ pitch: 'changeup', way: 'down' })
    expect(s.done).toBe(true)
    expect(s.next()).toBe(false)
    expect(s.totals()).toEqual({
      you: 4 + 3 + 8,
      // the model's 7 splits between down and left, and down comes first
      model: 4 + 1 + 1,
      pitches: 3,
      youRead: 3,
      modelRead: 1,
      best: 3,
    })
  })

  it('will not let you call a pitch twice or skip one', () => {
    const s = new Session(abs)
    expect(() => s.next()).toThrow()
    s.call({ pitch: 'fastball', way: 'up' })
    expect(() => s.call({ pitch: 'fastball', way: 'up' })).toThrow()
  })
})

group('deal', () => {
  it('deals the same hand for the same seed', () => {
    const items = Array.from({ length: 40 }, (_, i) => i)
    const a = deal(items, 5, mulberry32(20261118))
    const b = deal(items, 5, mulberry32(20261118))
    const c = deal(items, 5, mulberry32(20261119))
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    expect(new Set(a).size).toBe(5)
  })
})

group('describe', () => {
  it('says pitch results in words', () => {
    expect(describe('swinging_strike_blocked')).toBe('swinging strike')
    expect(describe('something_new')).toBe('something new')
  })
})

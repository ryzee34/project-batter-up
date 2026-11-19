import { describe as group, expect, it } from 'vitest'

import { PERFECT, Session, deal, describe, grade, mulberry32 } from './game'
import type { AtBat, Pitch, PitchCall, Zone } from './types'

function pitch(n: number, call: PitchCall, zone: Zone, model: [PitchCall, Zone]): Pitch {
  return {
    n,
    count: '0-0',
    pitch: call,
    zone,
    name: call,
    mph: 90,
    spin: 2200,
    result: 'ball',
    plate: [0, 2.5],
    sz: [1.6, 3.4],
    release: [-2, 54, 6],
    flight: [5, -130, -5, -10, 28, -20],
    model: { call: model, pitch: [], zone: [] },
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
  const truth = pitch(1, 'slider', '9', ['slider', '9'])
  it('pays 2 for the pitch, 1 for the zone and 1 more for both', () => {
    expect(grade({ pitch: 'slider', zone: '9' }, truth)).toEqual({
      pitch: true,
      zone: true,
      points: PERFECT,
    })
    expect(grade({ pitch: 'slider', zone: '1' }, truth).points).toBe(2)
    expect(grade({ pitch: 'fastball', zone: '9' }, truth).points).toBe(1)
    expect(grade({ pitch: 'fastball', zone: 'chase_up' }, truth).points).toBe(0)
  })
})

group('Session', () => {
  const abs = [
    atBat('a', [pitch(1, 'fastball', '2', ['fastball', '2']), pitch(2, 'slider', 'chase_down', ['fastball', 'chase_down'])]),
    atBat('b', [pitch(1, 'changeup', '8', ['sinker', '7'])]),
  ]

  it('walks through every pitch of every at-bat, scoring you and the model', () => {
    const s = new Session(abs)
    expect(s.history).toEqual([])
    s.call({ pitch: 'fastball', zone: '2' })
    expect(s.next()).toBe(true)
    expect(s.history.map((p) => p.n)).toEqual([1])
    s.call({ pitch: 'slider', zone: '5' })
    expect(s.atBatDone).toBe(true)
    expect(s.next()).toBe(true)
    expect(s.atBat.id).toBe('b')
    expect(s.history).toEqual([])
    s.call({ pitch: 'changeup', zone: '8' })
    expect(s.done).toBe(true)
    expect(s.next()).toBe(false)
    expect(s.totals()).toEqual({ you: 4 + 2 + 4, model: 4 + 1 + 0, pitches: 3, perfect: 12 })
  })

  it('will not let you call a pitch twice or skip one', () => {
    const s = new Session(abs)
    expect(() => s.next()).toThrow()
    s.call({ pitch: 'fastball', zone: '2' })
    expect(() => s.call({ pitch: 'fastball', zone: '2' })).toThrow()
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

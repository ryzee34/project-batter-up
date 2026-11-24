import { describe, expect, it } from 'vitest'

import { dailyAtBats, dayKey, dayNumber, result, shareText, streak } from './daily'
import type { PitchResult } from './game'
import type { AtBat } from './types'

const abs = Array.from({ length: 40 }, (_, i) => ({ id: `ab-${i}` }) as AtBat)

describe('daily', () => {
  it('turns the day over at midnight in los angeles, not utc', () => {
    // 7:30 am utc on the 19th is still 11:30 pm on the 18th in LA
    expect(dayKey(new Date('2026-11-19T07:30:00Z'))).toBe('2026-11-18')
    expect(dayKey(new Date('2026-11-19T08:30:00Z'))).toBe('2026-11-19')
  })

  it('numbers days from launch', () => {
    expect(dayNumber('2026-11-17')).toBe(1)
    expect(dayNumber('2026-12-17')).toBe(31)
  })

  it('deals everyone the same at-bats for a day, whatever order they load in', () => {
    const a = dailyAtBats(abs, '2026-11-20', 3).map((ab) => ab.id)
    const b = dailyAtBats([...abs].reverse(), '2026-11-20', 3).map((ab) => ab.id)
    const c = dailyAtBats(abs, '2026-11-21', 3).map((ab) => ab.id)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('shares a spoiler free grid', () => {
    const g = (points: number, pitch: boolean, way: boolean) => ({ points, pitch, way, streak: 0 })
    const r = (you: ReturnType<typeof g>, model: ReturnType<typeof g>) => ({ you, model }) as PitchResult
    const res = result('2026-11-19', [
      [r(g(4, true, true), g(1, false, true)), r(g(0, false, false), g(2, false, true))],
      [r(g(2, false, true), g(4, true, true))],
    ])
    expect(res).toMatchObject({ you: 6, model: 7, grid: ['🟩⬜', '🟨'] })
    expect(shareText(res)).toBe(
      'batter up #3 ⚾ lost to the model\nme 6 · model 7\n🟩⬜\n🟨\nryzee34.github.io/project-batter-up',
    )
  })

  it('counts a streak back from today', () => {
    expect(streak(['2026-11-18', '2026-11-19', '2026-11-20'], '2026-11-20')).toBe(3)
    expect(streak(['2026-11-18', '2026-11-20'], '2026-11-20')).toBe(1)
    expect(streak([], '2026-11-20')).toBe(0)
  })
})

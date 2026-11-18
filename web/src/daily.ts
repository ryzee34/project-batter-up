// today's at-bats: the same three for everyone, picked from the date in los angeles

import { PERFECT, deal, mulberry32, type PitchResult } from './game'
import type { AtBat } from './types'

export const LAUNCH = '2026-11-17'
export const SITE = 'ryzee34.github.io/project-batter-up'

/** yyyy-mm-dd in los angeles, so the day turns over at dodger stadium's midnight */
export function dayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function dayNumber(key: string): number {
  const ms = Date.parse(`${key}T00:00:00Z`) - Date.parse(`${LAUNCH}T00:00:00Z`)
  return Math.floor(ms / 86_400_000) + 1
}

export function dailyAtBats(all: AtBat[], key: string, n: number): AtBat[] {
  // sort first so the deal doesn't depend on the order the json happens to be in
  const pool = [...all].sort((a, b) => a.id.localeCompare(b.id))
  return deal(pool, n, mulberry32(Number(key.replaceAll('-', ''))))
}

export function square(points: number): string {
  return points === PERFECT ? '🟩' : points > 0 ? '🟨' : '⬜'
}

export interface Result {
  key: string
  you: number
  model: number
  grid: string[]
}

export function result(key: string, results: PitchResult[][]): Result {
  const all = results.flat()
  return {
    key,
    you: all.reduce((a, r) => a + r.you.points, 0),
    model: all.reduce((a, r) => a + r.model.points, 0),
    grid: results.map((ab) => ab.map((r) => square(r.you.points)).join('')),
  }
}

export function shareText(r: Result): string {
  const verdict = r.you > r.model ? 'beat the model' : r.you === r.model ? 'tied the model' : 'lost to the model'
  return [
    `batter up #${dayNumber(r.key)} ⚾ ${verdict}`,
    `me ${r.you} · model ${r.model}`,
    ...r.grid,
    SITE,
  ].join('\n')
}

/** consecutive days played, counting back from `key` */
export function streak(played: string[], key: string): number {
  const days = new Set(played)
  let n = 0
  let day = Date.parse(`${key}T00:00:00Z`)
  while (days.has(new Date(day).toISOString().slice(0, 10))) {
    n += 1
    day -= 86_400_000
  }
  return n
}

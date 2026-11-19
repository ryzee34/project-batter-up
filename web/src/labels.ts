import type { PitchCall, Zone } from './types'

export const PITCHES: Record<PitchCall, { short: string; color: string; key: string }> = {
  fastball: { short: 'FF', color: '#ef5a4f', key: 'f' },
  sinker: { short: 'SI', color: '#f39a3d', key: 's' },
  cutter: { short: 'FC', color: '#e8c547', key: 'c' },
  slider: { short: 'SL', color: '#55b7e8', key: 'l' },
  curveball: { short: 'CU', color: '#7f8cf0', key: 'u' },
  changeup: { short: 'CH', color: '#5fcf8a', key: 'h' },
  splitter: { short: 'FS', color: '#c48ae8', key: 'p' },
}

export const PITCH_ORDER: PitchCall[] = [
  'fastball',
  'sinker',
  'cutter',
  'slider',
  'curveball',
  'changeup',
  'splitter',
]

/**
 * where a zone is, the way a broadcast says it: in and away depend on the batter. the
 * grid is the catcher's view, so a righty stands on the left and the left column is in
 */
export function spot(zone: Zone, stands: 'L' | 'R' = 'R'): string {
  if (zone === 'chase') return 'chase'
  const n = Number(zone) - 1
  const row = ['up', '', 'down'][Math.floor(n / 3)]
  const sides = stands === 'R' ? ['in', '', 'away'] : ['away', '', 'in']
  const col = sides[n % 3]
  if (!row && !col) return 'middle middle'
  if (!row) return col
  if (!col) return row
  return `${row} and ${col}`
}

/** a spot in a sentence: "chase" reads better as "off the plate" */
export function spotPhrase(zone: Zone, stands: 'L' | 'R' = 'R'): string {
  return zone === 'chase' ? 'off the plate' : spot(zone, stands)
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`
}

export function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

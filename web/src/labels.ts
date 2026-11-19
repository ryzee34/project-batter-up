import type { Chase, PitchCall, Zone } from './types'

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

export const CHASES: Chase[] = ['chase_up', 'chase_down', 'chase_left', 'chase_right']

export function isChase(zone: Zone): zone is Chase {
  return zone.startsWith('chase')
}

/** which way in and away are from the catcher's view: a righty stands on the left */
export function sides(stands: 'L' | 'R'): { left: string; right: string } {
  return stands === 'R' ? { left: 'in', right: 'away' } : { left: 'away', right: 'in' }
}

/**
 * where a zone is, the way a broadcast says it: in and away depend on the batter. the
 * grid is the catcher's view, so a righty stands on the left and the left column is in
 */
export function spot(zone: Zone, stands: 'L' | 'R' = 'R'): string {
  const { left, right } = sides(stands)
  if (isChase(zone)) {
    const way = { chase_up: 'up', chase_down: 'down', chase_left: left, chase_right: right }[zone]
    return `chase ${way}`
  }
  const n = Number(zone) - 1
  const row = ['up', '', 'down'][Math.floor(n / 3)]
  const col = [left, '', right][n % 3]
  if (!row && !col) return 'middle middle'
  if (!row) return col
  if (!col) return row
  return `${row} and ${col}`
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

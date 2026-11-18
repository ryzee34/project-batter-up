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

export function zoneLabel(zone: Zone): string {
  if (zone === 'chase') return 'chase'
  const n = Number(zone) - 1
  const row = ['up', 'middle', 'down'][Math.floor(n / 3)]
  const col = ['left', 'center', 'right'][n % 3]
  if (row === 'middle' && col === 'center') return 'middle middle'
  return `${row} ${col}`
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

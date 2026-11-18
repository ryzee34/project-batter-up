// the strike zone as you see it from behind the plate. the box is the zone, the frame
// around it is the chase area. plate_x runs -1.5 to 1.5 ft across the frame and the zone
// always sits in the middle half vertically, whoever is batting

import { PITCHES, escape } from './labels'
import type { Pitch, Zone } from './types'

const HALF_WIDTH = 1.5
const PLATE_HALF = 0.83

export interface Marks {
  selected?: Zone
  you?: Zone
  model?: Zone
  heat?: number[]
  pitch?: Pitch
  history?: Pitch[]
  stands?: 'L' | 'R'
}

export function position(p: Pitch): { left: number; top: number } {
  const [x, z] = p.plate
  const [bot, top] = p.sz
  const left = ((x + HALF_WIDTH) / (2 * HALF_WIDTH)) * 100
  const height = ((z - bot) / (top - bot)) * 50 + 25
  return { left: clamp(left, 2, 98), top: clamp(100 - height, 2, 98) }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

function dot(p: Pitch, cls: string, label = ''): string {
  const { left, top } = position(p)
  const color = PITCHES[p.pitch].color
  return `<span class="dot ${cls}" style="left:${left}%;top:${top}%;--c:${color}">${label}</span>`
}

export function zoneGrid(m: Marks, interactive: boolean): string {
  // shade relative to the likeliest spot, or a spread out guess looks like no guess
  const peak = m.heat ? Math.max(...m.heat) : 1
  const shade = (v: number) => ((v / peak) * 70).toFixed(1)
  const inset = ((HALF_WIDTH - PLATE_HALF) / (2 * HALF_WIDTH)) * 100
  const cells = Array.from({ length: 9 }, (_, i) => {
    const zone = String(i + 1) as Zone
    const heat = m.heat ? shade(m.heat[i]) : 0
    return `<button class="cell ${tags(m, zone)}" data-zone="${zone}" ${interactive ? '' : 'tabindex="-1"'}
      style="--heat:${heat}%" aria-label="zone ${zone}">
      ${badges(m, zone)}
    </button>`
  }).join('')
  const history = (m.history ?? []).map((p) => dot(p, 'past', String(p.n))).join('')
  const actual = m.pitch ? dot(m.pitch, 'actual') : ''
  const chaseHeat = m.heat ? (Number(shade(m.heat[9])) * 0.45).toFixed(1) : 0
  const batter = m.stands
    ? `<span class="batter ${m.stands === 'R' ? 'left' : 'right'}">${m.stands}HB</span>`
    : ''
  return `
    <div class="zone-frame ${interactive ? 'interactive' : ''} ${tags(m, 'chase')}" data-zone="chase"
      role="group" aria-label="strike zone, catcher's view" style="--chase-heat:${chaseHeat}%">
      ${batter}
      <div class="strike-zone" style="left:${inset}%;right:${inset}%">${cells}</div>
      <span class="chase-label">chase ${badges(m, 'chase')}</span>
      ${history}${actual}
    </div>`
}

function tags(m: Marks, zone: Zone): string {
  return [
    m.selected === zone ? 'selected' : '',
    m.pitch?.zone === zone ? 'truth' : '',
  ].join(' ')
}

function badges(m: Marks, zone: Zone): string {
  const out = []
  if (m.you === zone) out.push('<i class="badge you">you</i>')
  if (m.model === zone) out.push('<i class="badge model">model</i>')
  return out.length ? `<span class="badges">${out.join('')}</span>` : escape('')
}

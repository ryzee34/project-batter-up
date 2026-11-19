// the strike zone as you see it from behind the plate. the box is the zone, and the frame
// around it is cut into four chase areas by the lines from its corners to the zone's.
// plate_x runs -1.5 to 1.5 ft across the frame and the zone always sits in the middle
// half vertically, whoever is batting

import { CHASES, PITCHES, sides, spot } from './labels'
import type { Chase, Pitch, Zone } from './types'

const HALF_WIDTH = 1.5
const PLATE_HALF = 0.83

export interface Marks {
  selected?: Zone
  you?: Zone
  model?: Zone
  heat?: number[]
  pitch?: Pitch
  history?: Pitch[]
  stands: 'L' | 'R'
}

export function position(p: Pitch): { left: number; top: number } {
  const [x, z] = p.plate
  const [bot, top] = p.sz
  const left = ((x + HALF_WIDTH) / (2 * HALF_WIDTH)) * 100
  const height = ((z - bot) / (top - bot)) * 50 + 25
  return { left: clamp(left, 3, 97), top: clamp(100 - height, 3, 97) }
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
  const attrs = (zone: Zone) => {
    const label = spot(zone, m.stands)
    return interactive
      ? `aria-pressed="${m.selected === zone}" title="${label}" aria-label="${label}"`
      : 'tabindex="-1" aria-hidden="true"'
  }
  const cells = Array.from({ length: 9 }, (_, i) => {
    const zone = String(i + 1) as Zone
    const heat = m.heat ? shade(m.heat[i]) : 0
    return `<button class="cell ${tags(m, zone)}" data-zone="${zone}" ${attrs(zone)}
      style="--heat:${heat}%">${badges(m, zone)}</button>`
  }).join('')
  // each chase area is a trapezoid between the frame and the zone. the big areas get a
  // lighter shade than a cell with the same odds, or they'd swamp the zone
  const l = inset
  const r = 100 - inset
  const shapes: Record<Chase, string> = {
    chase_up: `0 0, 100% 0, ${r}% 25%, ${l}% 25%`,
    chase_down: `0 100%, 100% 100%, ${r}% 75%, ${l}% 75%`,
    chase_left: `0 0, ${l}% 25%, ${l}% 75%, 0 100%`,
    chase_right: `100% 0, ${r}% 25%, ${r}% 75%, 100% 100%`,
  }
  const where = sides(m.stands)
  const names: Record<Chase, string> = {
    chase_up: 'up',
    chase_down: 'down',
    chase_left: where.left,
    chase_right: where.right,
  }
  const chases = CHASES.map((zone, i) => {
    const heat = m.heat ? (Number(shade(m.heat[9 + i])) * 0.6).toFixed(1) : 0
    return `<button class="chase-area ${zone} ${tags(m, zone)}" data-zone="${zone}" ${attrs(zone)}
      style="clip-path:polygon(${shapes[zone]});--heat:${heat}%">
      <span class="chase-label"><span>${names[zone]}</span>${badges(m, zone)}</span>
    </button>`
  }).join('')
  const seams = [
    [0, 0, l, 25],
    [100, 0, r, 25],
    [0, 100, l, 75],
    [100, 100, r, 75],
  ]
    .map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`)
    .join('')
  const history = (m.history ?? []).map((p) => dot(p, 'past', String(p.n))).join('')
  const actual = m.pitch ? dot(m.pitch, 'actual') : ''
  return `
    <div class="zone-frame ${interactive ? 'interactive' : ''}" role="group"
      aria-label="strike zone, catcher's view">
      ${chases}
      <svg class="seams" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${seams}</svg>
      <span class="batter-box ${m.stands === 'R' ? 'left' : 'right'}" aria-hidden="true">
        <i></i>${m.stands === 'R' ? 'righty' : 'lefty'}
      </span>
      <div class="strike-zone" style="left:${inset}%;right:${inset}%">${cells}</div>
      <span class="plate" aria-hidden="true"></span>
      ${history}${actual}
    </div>`
}

function tags(m: Marks, zone: Zone): string {
  return [m.selected === zone ? 'selected' : '', m.pitch?.zone === zone ? 'truth' : ''].join(' ')
}

function badges(m: Marks, zone: Zone): string {
  const out = []
  if (m.you === zone) out.push('<i class="badge you">you</i>')
  if (m.model === zone) out.push('<i class="badge model">model</i>')
  return out.length ? `<span class="badges">${out.join('')}</span>` : ''
}

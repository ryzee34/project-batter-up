// the strike zone as you see it from behind the plate, cut into the four ways a pitch can
// go: up, down, and off either side, which are in and away for whoever is batting. the
// lines run from the corners of the frame to the middle of the zone, so a pitch belongs to
// whichever way it's furthest out, the same rule as tells.wayOf.
// plate_x runs -1.5 to 1.5 ft across the frame and the zone always sits in the middle
// half vertically, whoever is batting

import { PITCHES, sides } from './labels'
import { WAYS, wayOf, type Way } from './tells'
import type { Pitch } from './types'

const HALF_WIDTH = 1.5
const PLATE_HALF = 0.83

export interface Marks {
  selected?: Way
  you?: Way
  model?: Way
  heat?: Record<Way, number>
  pitch?: Pitch
  history?: Pitch[]
  stands: 'L' | 'R'
}

/** a way the way a broadcast says it: in and away depend on the batter */
export function wayName(way: Way, stands: 'L' | 'R'): string {
  const { left, right } = sides(stands)
  return { up: 'up', down: 'down', left, right }[way]
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

const SHAPES: Record<Way, string> = {
  up: '0 0, 100% 0, 50% 50%',
  down: '0 100%, 100% 100%, 50% 50%',
  left: '0 0, 50% 50%, 0 100%',
  right: '100% 0, 50% 50%, 100% 100%',
}
// the old chase classes put each label in the right part of the frame
const LABEL_SPOT: Record<Way, string> = {
  up: 'chase_up',
  down: 'chase_down',
  left: 'chase_left',
  right: 'chase_right',
}

export function zoneGrid(m: Marks, interactive: boolean): string {
  const peak = m.heat ? Math.max(...WAYS.map((w) => m.heat![w])) : 1
  const truth = m.pitch ? wayOf(m.pitch.plate, m.pitch.sz) : undefined
  const inset = ((HALF_WIDTH - PLATE_HALF) / (2 * HALF_WIDTH)) * 100
  const areas = WAYS.map((way) => {
    const label = wayName(way, m.stands)
    const heat = m.heat ? ((m.heat[way] / peak) * 45).toFixed(1) : 0
    const attrs = interactive
      ? `aria-pressed="${m.selected === way}" title="${label}" aria-label="${label}"`
      : 'tabindex="-1" aria-hidden="true"'
    const cls = [m.selected === way ? 'selected' : '', truth === way ? 'truth' : ''].join(' ')
    return `<button class="chase-area way ${LABEL_SPOT[way]} ${cls}" data-way="${way}" ${attrs}
      style="clip-path:polygon(${SHAPES[way]});--heat:${heat}%">
      <span class="chase-label"><span>${label}</span>${badges(m, way)}</span>
    </button>`
  }).join('')
  const seams = [
    [0, 0],
    [100, 0],
    [0, 100],
    [100, 100],
  ]
    .map(([x, y]) => `<line x1="${x}" y1="${y}" x2="50" y2="50"/>`)
    .join('')
  const history = (m.history ?? []).map((p) => dot(p, 'past', String(p.n))).join('')
  const actual = m.pitch ? dot(m.pitch, 'actual') : ''
  return `
    <div class="zone-frame ${interactive ? 'interactive' : ''}" role="group"
      aria-label="where it crosses the plate, catcher's view">
      ${areas}
      <svg class="seams" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${seams}</svg>
      <span class="batter-box ${m.stands === 'R' ? 'left' : 'right'}" aria-hidden="true">
        <i></i>${m.stands === 'R' ? 'righty' : 'lefty'}
      </span>
      <div class="strike-zone empty" style="left:${inset}%;right:${inset}%"></div>
      <span class="plate" aria-hidden="true"></span>
      ${history}${actual}
    </div>`
}

function badges(m: Marks, way: Way): string {
  const out = []
  if (m.you === way) out.push('<i class="badge you">you</i>')
  if (m.model === way) out.push('<i class="badge model">model</i>')
  return out.length ? `<span class="badges">${out.join('')}</span>` : ''
}

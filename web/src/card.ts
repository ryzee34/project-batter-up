// the share card: a 1200x630 png of today's grid, made on a canvas in the browser

import { SITE, dayNumber, type Result } from './daily'

const COLORS: Record<string, string> = { '🟩': '#2c7a47', '🟨': '#c08609', '⬜': '#d4c8ab' }

const INK = '#1d1a14'
const MUTED = '#6b6250'
const RED = '#b5321e'
const DISPLAY = '"Alfa Slab One", Rockwell, Georgia, serif'
const BODY = '"Libre Franklin Variable", "Libre Franklin", system-ui, sans-serif'

export function drawCard(r: Result): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 630
  const g = canvas.getContext('2d')!

  // cream card stock with a double rule round the edge, like the page
  g.fillStyle = '#f5eedc'
  g.fillRect(0, 0, 1200, 630)
  g.strokeStyle = INK
  g.lineWidth = 4
  g.strokeRect(18, 18, 1164, 594)
  g.lineWidth = 1.5
  g.strokeRect(30, 30, 1140, 570)

  g.fillStyle = INK
  g.font = `400 100px ${DISPLAY}`
  g.fillText('BATTER UP', 72, 160)
  stitches(g, 76, 182, 540)
  g.fillStyle = MUTED
  g.font = `600 30px ${BODY}`
  g.fillText(`#${dayNumber(r.key)} · ${r.key}`, 76, 240)

  const verdict = r.you > r.model ? 'BEAT THE MODEL' : r.you === r.model ? 'DEAD EVEN' : 'THE MODEL WINS'
  g.fillStyle = RED
  g.font = `400 46px ${DISPLAY}`
  g.fillText(verdict, 72, 330)

  g.font = `600 26px ${BODY}`
  g.fillStyle = MUTED
  g.fillText('YOU', 76, 390)
  g.fillText('MODEL', 256, 390)
  g.font = `400 100px ${DISPLAY}`
  g.fillStyle = INK
  g.fillText(String(r.you), 72, 490)
  g.fillStyle = '#b37d08'
  g.fillText(String(r.model), 252, 490)

  // one row of squares per at-bat
  const size = 46
  const gap = 12
  r.grid.forEach((row, y) => {
    Array.from(row).forEach((sq, x) => {
      g.fillStyle = COLORS[sq] ?? COLORS['⬜']
      roundRect(g, 620 + x * (size + gap), 250 + y * (size + gap + 8), size, size, 4)
    })
  })

  g.fillStyle = MUTED
  g.font = `500 26px ${BODY}`
  g.fillText(SITE, 76, 565)
  return canvas
}

/** the red stitching under the name: a row of little v's */
function stitches(g: CanvasRenderingContext2D, x: number, y: number, w: number) {
  g.strokeStyle = RED
  g.lineWidth = 3
  g.beginPath()
  for (let i = x; i < x + w; i += 14) {
    g.moveTo(i, y)
    g.lineTo(i + 5, y + 8)
    g.lineTo(i + 10, y)
  }
  g.stroke()
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
  g.fill()
}

export async function shareCard(r: Result): Promise<'shared' | 'saved'> {
  // the card uses the page's fonts, make sure they're in before drawing
  await Promise.all([
    document.fonts?.load(`700 110px ${DISPLAY}`),
    document.fonts?.load(`600 30px ${BODY}`),
  ]).catch(() => undefined)
  const blob = await new Promise<Blob | null>((ok) => drawCard(r).toBlob(ok, 'image/png'))
  if (!blob) throw new Error("couldn't draw the card")
  const file = new File([blob], `batter-up-${r.key}.png`, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'batter up' })
    return 'shared'
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'saved'
}

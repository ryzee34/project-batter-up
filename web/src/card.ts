// the share card: a 1200x630 png of today's grid, made on a canvas in the browser

import { SITE, dayNumber, type Result } from './daily'

const COLORS: Record<string, string> = { '🟩': '#3fd17f', '🟨': '#f5c542', '⬜': '#33465c' }

const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif'
const BODY = '"Inter Variable", Inter, system-ui, sans-serif'

export function drawCard(r: Result): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 630
  const g = canvas.getContext('2d')!

  const bg = g.createRadialGradient(600, -80, 50, 600, -80, 950)
  bg.addColorStop(0, '#1a3a5c')
  bg.addColorStop(1, '#08121e')
  g.fillStyle = bg
  g.fillRect(0, 0, 1200, 630)

  const title = g.createLinearGradient(0, 70, 0, 150)
  title.addColorStop(0, '#ffffff')
  title.addColorStop(1, '#9cc2ff')
  g.fillStyle = title
  g.font = `700 110px ${DISPLAY}`
  g.fillText('BATTER UP', 72, 160)
  g.fillStyle = '#8ea4ba'
  g.font = `600 30px ${BODY}`
  g.fillText(`#${dayNumber(r.key)} · ${r.key}`, 76, 210)

  const verdict = r.you > r.model ? 'BEAT THE MODEL' : r.you === r.model ? 'DEAD EVEN' : 'THE MODEL WINS'
  g.fillStyle = '#f2f5f9'
  g.font = `700 52px ${DISPLAY}`
  g.fillText(verdict, 72, 320)

  g.font = `600 26px ${BODY}`
  g.fillStyle = '#8ea4ba'
  g.fillText('YOU', 76, 380)
  g.fillText('MODEL', 256, 380)
  g.font = `700 110px ${DISPLAY}`
  g.fillStyle = '#f2f5f9'
  g.fillText(String(r.you), 72, 480)
  g.fillStyle = '#f5c542'
  g.fillText(String(r.model), 252, 480)

  // one row of squares per at-bat
  const size = 46
  const gap = 12
  r.grid.forEach((row, y) => {
    Array.from(row).forEach((sq, x) => {
      g.fillStyle = COLORS[sq] ?? COLORS['⬜']
      roundRect(g, 620 + x * (size + gap), 250 + y * (size + gap + 8), size, size, 9)
    })
  })

  g.fillStyle = '#8ea4ba'
  g.font = `500 26px ${BODY}`
  g.fillText(SITE, 76, 570)
  return canvas
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

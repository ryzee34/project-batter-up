// the share card: a 1200x630 png of today's grid, made on a canvas in the browser

import { SITE, dayNumber, type Result } from './daily'

const COLORS: Record<string, string> = { '🟩': '#5fcf8a', '🟨': '#e8c547', '⬜': '#3a4f66' }

export function drawCard(r: Result): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 630
  const g = canvas.getContext('2d')!
  const mono = 'ui-monospace, "SF Mono", Menlo, monospace'

  const bg = g.createRadialGradient(600, 0, 50, 600, 0, 900)
  bg.addColorStop(0, '#16304a')
  bg.addColorStop(1, '#0d1b2a')
  g.fillStyle = bg
  g.fillRect(0, 0, 1200, 630)

  g.fillStyle = '#f4f1ea'
  g.font = `bold 72px ${mono}`
  g.fillText('batter up', 72, 130)
  g.fillStyle = '#8da2b5'
  g.font = `36px ${mono}`
  g.fillText(`#${dayNumber(r.key)} · ${r.key}`, 72, 185)

  g.font = `bold 56px ${mono}`
  g.fillStyle = '#f4f1ea'
  g.fillText(`me ${r.you}`, 72, 300)
  g.fillStyle = '#e8c547'
  g.fillText(`model ${r.model}`, 72, 375)
  g.fillStyle = '#8da2b5'
  g.font = `32px ${mono}`
  const verdict = r.you > r.model ? 'beat the model' : r.you === r.model ? 'dead even' : 'the model wins'
  g.fillText(verdict, 72, 430)

  // one row of squares per at-bat
  const size = 46
  const gap = 12
  r.grid.forEach((row, y) => {
    Array.from(row).forEach((sq, x) => {
      g.fillStyle = COLORS[sq] ?? '#3a4f66'
      roundRect(g, 640 + x * (size + gap), 230 + y * (size + gap + 8), size, size, 8)
    })
  })

  g.fillStyle = '#8da2b5'
  g.font = `28px ${mono}`
  g.fillText(SITE, 72, 560)
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

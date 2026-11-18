// the pitch from the catcher's crouch, in three.js.
//
// statcast measures in feet with x to the catcher's right, y out toward the mound and z
// up. three.js wants y up and the camera looking down -z, so a statcast point (x, y, z)
// goes to (x, z, -y). one unit is one foot.

import * as THREE from 'three'

import { FRONT_OF_PLATE, flight, type Flight } from './flight'
import { PITCHES } from './labels'
import type { Pitch, Zone } from './types'

const PLATE_HALF = 17 / 24
const ZONE_HALF = 0.83
const BALL_RADIUS = 0.121
const SLOW = 0.22
const TRAIL_STEPS = 60

function v(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y)
}

export interface ReplayMarks {
  you?: Zone
  model?: Zone
}

export class Replay {
  readonly canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(28, 4 / 3, 0.1, 400)
  private ball: THREE.Mesh
  private trail: THREE.Line
  private zone = new THREE.Group()
  private marks = new THREE.Group()
  private batter = new THREE.Group()
  private frame = 0
  private flight: Flight | null = null
  private started = 0
  private resize: ResizeObserver

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.canvas = this.renderer.domElement
    this.canvas.className = 'replay-canvas'

    this.scene.background = new THREE.Color('#0a1520')
    this.scene.fog = new THREE.Fog('#0a1520', 90, 260)
    // the umpire's eyes, over the catcher's shoulder: far enough back to see the whole
    // zone and the mound, low enough to see the break
    this.camera.position.copy(v(0, -7.5, 3.4))
    this.camera.lookAt(v(0, 30, 2.4))

    this.scene.add(new THREE.HemisphereLight('#cfe3ff', '#1c3a22', 1.4))
    const lights = new THREE.DirectionalLight('#ffffff', 1.6)
    lights.position.set(-30, 80, 40)
    this.scene.add(lights)

    this.field()
    this.scene.add(this.zone, this.marks, this.batter)

    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 24, 16),
      new THREE.MeshStandardMaterial({ color: '#f7f3ea', roughness: 0.5 }),
    )
    this.scene.add(this.ball)

    const trail = new THREE.BufferGeometry()
    trail.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array((TRAIL_STEPS + 1) * 3), 3),
    )
    trail.setDrawRange(0, 0)
    this.trail = new THREE.Line(
      trail,
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 }),
    )
    // the trail's bounds change every frame, so don't let three skip drawing it
    this.trail.frustumCulled = false
    this.scene.add(this.trail)

    this.resize = new ResizeObserver(() => this.fit())
    this.resize.observe(this.canvas)
  }

  private field(): void {
    const grass = new THREE.Mesh(
      new THREE.CircleGeometry(400, 64),
      new THREE.MeshStandardMaterial({ color: '#1f5a2e', roughness: 1 }),
    )
    grass.rotation.x = -Math.PI / 2
    this.scene.add(grass)

    const dirt = new THREE.MeshStandardMaterial({ color: '#8a5a3b', roughness: 1 })
    const homeCircle = new THREE.Mesh(new THREE.CircleGeometry(13, 48), dirt)
    homeCircle.rotation.x = -Math.PI / 2
    homeCircle.position.y = 0.01
    this.scene.add(homeCircle)

    const mound = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.5, 0.8, 48), dirt)
    mound.position.copy(v(0, 60.5, 0.4))
    this.scene.add(mound)
    const rubber = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.1, 0.5),
      new THREE.MeshStandardMaterial({ color: '#ffffff' }),
    )
    rubber.position.copy(v(0, 60.5, 0.85))
    this.scene.add(rubber)

    // home plate, the pointy end toward the catcher
    const shape = new THREE.Shape()
    shape.moveTo(-PLATE_HALF, FRONT_OF_PLATE)
    shape.lineTo(PLATE_HALF, FRONT_OF_PLATE)
    shape.lineTo(PLATE_HALF, FRONT_OF_PLATE / 2)
    shape.lineTo(0, 0)
    shape.lineTo(-PLATE_HALF, FRONT_OF_PLATE / 2)
    shape.closePath()
    const plate = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshStandardMaterial({ color: '#f4f1ea' }),
    )
    // the shape is drawn in (x, y) with y toward the mound, lay it flat
    plate.rotation.x = Math.PI / 2
    plate.rotation.z = Math.PI
    plate.scale.x = -1
    plate.position.y = 0.03
    this.scene.add(plate)

    // a pitcher, roughly, so there's something to throw from
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.75, 3.2, 6, 12),
      new THREE.MeshStandardMaterial({ color: '#e8ecf2' }),
    )
    body.position.copy(v(0, 61.5, 3.2))
    this.scene.add(body)
  }

  private drawZone(p: Pitch, marks: ReplayMarks): void {
    this.zone.clear()
    this.marks.clear()
    const [bot, top] = p.sz
    const y = FRONT_OF_PLATE
    const line = new THREE.LineBasicMaterial({ color: '#e6eef6', transparent: true, opacity: 0.9 })
    const faint = new THREE.LineBasicMaterial({ color: '#e6eef6', transparent: true, opacity: 0.25 })
    const box = (x1: number, z1: number, x2: number, z2: number, m: THREE.Material) =>
      new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          v(x1, y, z1),
          v(x2, y, z1),
          v(x2, y, z2),
          v(x1, y, z2),
        ]),
        m,
      )
    this.zone.add(box(-ZONE_HALF, bot, ZONE_HALF, top, line))
    const w = (2 * ZONE_HALF) / 3
    const h = (top - bot) / 3
    for (let i = 1; i < 3; i++) {
      this.zone.add(box(-ZONE_HALF + i * w, bot, -ZONE_HALF + i * w, top, faint))
      this.zone.add(box(-ZONE_HALF, bot + i * h, ZONE_HALF, bot + i * h, faint))
    }

    const cell = (zone: Zone, color: string, inset: number) => {
      if (zone === 'chase') {
        const pad = 0.18 + inset
        this.marks.add(
          box(-ZONE_HALF - pad, bot - pad, ZONE_HALF + pad, top + pad, new THREE.LineBasicMaterial({ color })),
        )
        return
      }
      const n = Number(zone) - 1
      const row = Math.floor(n / 3)
      const col = n % 3
      const x1 = -ZONE_HALF + col * w
      const z2 = top - row * h
      const quad = new THREE.Mesh(
        new THREE.PlaneGeometry(w - inset * 2, h - inset * 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false }),
      )
      quad.position.copy(v(x1 + w / 2, y + 0.01, z2 - h / 2))
      this.marks.add(quad)
    }
    if (marks.model) cell(marks.model, '#e8c547', 0.02)
    if (marks.you) cell(marks.you, '#ffffff', 0.08)
  }

  private drawBatter(stands: 'L' | 'R', height: number): void {
    this.batter.clear()
    // a righty stands on the catcher's left
    const x = stands === 'R' ? -3.2 : 3.2
    const mat = new THREE.MeshStandardMaterial({ color: '#25384c', transparent: true, opacity: 0.4 })
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, height - 2.2, 6, 12), mat)
    body.position.copy(v(x, 0.9, height / 2))
    this.batter.add(body)
  }

  private fit(): void {
    const { clientWidth: w, clientHeight: h } = this.canvas
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /** throw the pitch: once at real speed, then again slowed down with its path traced */
  play(p: Pitch, stands: 'L' | 'R', marks: ReplayMarks = {}): void {
    this.flight = flight(p)
    this.drawZone(p, marks)
    this.drawBatter(stands, Math.max(5.6, p.sz[1] * 1.85))
    const color = PITCHES[p.pitch].color
    ;(this.trail.material as THREE.LineBasicMaterial).color.set(color)
    this.trail.geometry.setDrawRange(0, 0)
    this.started = performance.now()
    this.fit()
    cancelAnimationFrame(this.frame)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      this.draw(Infinity)
      return
    }
    const tick = () => {
      const done = this.draw(performance.now() - this.started)
      if (!done) this.frame = requestAnimationFrame(tick)
    }
    tick()
  }

  replay(): void {
    if (!this.flight) return
    this.started = performance.now() - this.realTimeMs() - 400
    cancelAnimationFrame(this.frame)
    const tick = () => {
      if (!this.draw(performance.now() - this.started)) this.frame = requestAnimationFrame(tick)
    }
    tick()
  }

  private realTimeMs(): number {
    const f = this.flight!
    return (f.plate - f.release) * 1000
  }

  /** draws the frame at `ms` since the throw. returns true once everything has played */
  private draw(ms: number): boolean {
    const f = this.flight!
    const fast = this.realTimeMs()
    const pause = 400
    const slow = fast / SLOW
    let t: number
    let tracing = false
    let done = false
    if (ms < fast) {
      t = f.release + ms / 1000
    } else if (ms < fast + pause) {
      t = f.plate
    } else if (ms < fast + pause + slow) {
      t = f.release + ((ms - fast - pause) / 1000) * SLOW
      tracing = true
    } else {
      t = f.plate
      tracing = true
      done = true
    }
    const [x, y, z] = f.at(t)
    this.ball.position.copy(v(x, y, z))
    if (tracing) {
      const position = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i <= TRAIL_STEPS; i++) {
        const [px, py, pz] = f.at(f.release + ((t - f.release) * i) / TRAIL_STEPS)
        position.setXYZ(i, px, pz, -py)
      }
      position.needsUpdate = true
      this.trail.geometry.setDrawRange(0, TRAIL_STEPS + 1)
    } else {
      this.trail.geometry.setDrawRange(0, 0)
    }
    this.renderer.render(this.scene, this.camera)
    return done
  }

  dispose(): void {
    cancelAnimationFrame(this.frame)
    this.resize.disconnect()
    this.renderer.dispose()
  }
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

// the ballpark, in three.js, from just behind the catcher. it stays on screen the whole
// game: the pitcher idles on the mound while you call the pitch, then winds up and throws
// the real one, on its real path, into the zone.
//
// statcast measures in feet with x to the catcher's right, y out toward the mound and z
// up. three.js wants y up and the camera looking down -z, so a statcast point (x, y, z)
// goes to (x, z, -y). one unit is one foot.

import * as THREE from 'three'

import { FRONT_OF_PLATE, flight, type Flight } from './flight'
import { PITCHES } from './labels'
import {
  PLAIN,
  buildPlayer,
  delivery,
  setPose,
  stance,
  swing,
  type Player,
  type Style,
} from './players'
import type { Pitch } from './types'

const PLATE_HALF = 17 / 24
const BALL_RADIUS = 0.121
const SLOW = 0.22
const TRAIL_STEPS = 60
/** half the width of the frame the game draws around the zone, in feet */
export const FRAME_HALF = 1.5
/** seconds from the start of the windup to the ball leaving his hand */
const WINDUP = 1.15
/** where in the delivery the ball comes out, as a share of the whole motion */
const RELEASE_AT = 0.8
/** where the delivery stops while you read it: arm up, just before the ball comes out */
export const FREEZE = 0.7
const MOUND_TOP = 0.8
const RUBBER = 60.5

function v(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y)
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** idle on the mound, reading (the delivery up to the freeze, then held), throwing */
type Mode = 'idle' | 'reading' | 'throwing' | 'gone' | 'done'

export class Stage {
  readonly canvas: HTMLCanvasElement
  /** called whenever the zone moves on screen, so the page can line its zone up */
  onLayout: (() => void) | null = null
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(12, 4 / 3, 1, 1400)
  /** a tight shot of the pitcher, drawn in a corner while you read him */
  private pitcherCam = new THREE.PerspectiveCamera(6, 0.8, 1, 400)
  /** draw the pitcher cam in the corner */
  showCam = false
  private style: Style = PLAIN
  /** seconds he holds the set before he starts his motion */
  private hold = 0.5
  private onRead: (() => void) | null = null
  /** pitch recognition: the flight time the ball disappears at, and what to call then */
  private goneT: number | null = null
  private onGone: (() => void) | null = null
  private goneS = 0
  private ball: THREE.Mesh
  private trail: THREE.Line
  private pitcher: Player
  private batter: Player
  private pitcherSpot = new THREE.Group()
  private batterSpot = new THREE.Group()
  private sz: [number, number] = [1.6, 3.4]
  private mode: Mode = 'idle'
  private pitch: Pitch | null = null
  private flight: Flight | null = null
  private swings = false
  private started = 0
  private onLanded: (() => void) | null = null
  private resize: ResizeObserver
  private clock = new THREE.Clock()

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.canvas = this.renderer.domElement
    this.canvas.className = 'stage-canvas'

    this.scene.background = sky()
    this.scene.fog = new THREE.Fog('#16283c', 260, 900)
    this.lights()
    this.field()
    this.stadium()

    this.pitcher = buildPlayer({ jersey: '#f4f6f8', trim: '#1d4f9c', skin: '#c58c64' })
    this.pitcherSpot.add(this.pitcher.root)
    this.scene.add(this.pitcherSpot)
    this.batter = buildPlayer({ jersey: '#9aa4b0', trim: '#3a2f6b', skin: '#8d5a3c', bat: true })
    this.batterSpot.add(this.batter.root)
    this.scene.add(this.batterSpot)
    this.setPlayers('R', 'R')

    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS * 1.25, 24, 16),
      new THREE.MeshStandardMaterial({ color: '#fbf8f0', roughness: 0.4, emissive: '#555' }),
    )
    this.ball.castShadow = true
    this.ball.visible = false
    this.scene.add(this.ball)

    const trail = new THREE.BufferGeometry()
    trail.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array((TRAIL_STEPS + 1) * 3), 3),
    )
    trail.setDrawRange(0, 0)
    this.trail = new THREE.Line(
      trail,
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 }),
    )
    // the trail's bounds change every frame, so don't let three skip drawing it
    this.trail.frustumCulled = false
    this.scene.add(this.trail)

    this.aim()
    this.resize = new ResizeObserver(() => this.fit())
    this.resize.observe(this.canvas)
    this.renderer.setAnimationLoop(() => this.tick())
  }

  // the camera sits well back behind the plate, about eye high, with a long lens, the way
  // a broadcast frames it: the zone up close and the pitcher right behind it. the lens is
  // picked so the frame around the zone takes a set share of the width, wider on a phone
  // so it's big enough to tap, and tilted so the zone sits a bit below the middle
  private aim(): void {
    const aspect = this.camera.aspect
    const eye = v(0, -34, 4.6)
    const share = aspect >= 1 ? 0.3 : 0.6
    const below = aspect >= 1 ? 0.13 : 0.17
    const dist = 34 + FRONT_OF_PLATE
    const across = 2 * Math.atan(FRAME_HALF / share / dist)
    const vertical = 2 * Math.atan(Math.tan(across / 2) / aspect)
    const [bot, top] = this.sz
    const toZone = Math.atan((eye.y - (bot + top) / 2) / dist)
    const pitch = toZone - below * vertical
    this.camera.position.copy(eye)
    this.camera.fov = THREE.MathUtils.radToDeg(vertical)
    this.camera.lookAt(eye.x, eye.y - Math.tan(pitch) * 100, eye.z - 100)
    this.camera.updateProjectionMatrix()
  }

  private lights(): void {
    this.scene.add(new THREE.HemisphereLight('#d6e6ff', '#2a4a2a', 1.1))
    const key = new THREE.DirectionalLight('#fff6e8', 2.2)
    key.position.copy(v(-60, -40, 120))
    key.target.position.copy(v(0, 30, 0))
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    const cam = key.shadow.camera
    cam.left = -45
    cam.right = 45
    cam.top = 45
    cam.bottom = -45
    cam.near = 10
    cam.far = 400
    key.shadow.bias = -0.0005
    this.scene.add(key, key.target)
    const fill = new THREE.DirectionalLight('#9ec4ff', 0.6)
    fill.position.copy(v(80, 100, 60))
    this.scene.add(fill)
  }

  private field(): void {
    const grass = new THREE.Mesh(
      new THREE.CircleGeometry(700, 96),
      new THREE.MeshStandardMaterial({ map: mowed(), roughness: 1 }),
    )
    grass.rotation.x = -Math.PI / 2
    grass.receiveShadow = true
    this.scene.add(grass)

    const dirt = new THREE.MeshStandardMaterial({ color: '#9a6744', roughness: 1 })
    const flat = (geo: THREE.BufferGeometry, x: number, y: number, lift: number, mat = dirt) => {
      const m = new THREE.Mesh(geo, mat)
      m.rotation.x = -Math.PI / 2
      m.position.copy(v(x, y, lift))
      m.receiveShadow = true
      this.scene.add(m)
      return m
    }
    // the infield dirt is an arc 95 feet out from the rubber, with the grass square cut
    // out of it and the base paths around
    flat(new THREE.CircleGeometry(95, 96, 0, Math.PI), 0, RUBBER, 0.02)
    const infield = new THREE.Shape()
    const side = 90 / Math.SQRT2
    infield.moveTo(0, 6)
    infield.lineTo(side - 4, side)
    infield.lineTo(0, 2 * side - 4)
    infield.lineTo(-side + 4, side)
    infield.closePath()
    const infieldGrass = new THREE.MeshStandardMaterial({ map: mowed(), roughness: 1 })
    flat(new THREE.ShapeGeometry(infield), 0, 0, 0.03, infieldGrass)
    flat(new THREE.CircleGeometry(13, 48), 0, 0, 0.04)
    flat(new THREE.CircleGeometry(9, 48), 0, RUBBER, 0.04)

    const mound = new THREE.Mesh(new THREE.CylinderGeometry(6, 9, MOUND_TOP, 48), dirt)
    mound.position.copy(v(0, RUBBER, MOUND_TOP / 2))
    mound.receiveShadow = true
    this.scene.add(mound)
    const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 })
    const rubber = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 0.5), white)
    rubber.position.copy(v(0, RUBBER, MOUND_TOP + 0.05))
    this.scene.add(rubber)

    // bases and foul lines
    for (const [x, y] of [
      [side, side],
      [0, 2 * side],
      [-side, side],
    ]) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.25, 1.25), white)
      base.position.copy(v(x, y, 0.12))
      base.rotation.y = Math.PI / 4
      this.scene.add(base)
    }
    for (const dir of [-1, 1]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 330), white)
      line.rotation.x = -Math.PI / 2
      line.rotation.z = (dir * Math.PI) / 4
      line.position.copy(v((dir * 330) / 2 / Math.SQRT2, 330 / 2 / Math.SQRT2, 0.05))
      this.scene.add(line)
    }

    // home plate, the pointy end toward the catcher
    const shape = new THREE.Shape()
    shape.moveTo(-PLATE_HALF, FRONT_OF_PLATE)
    shape.lineTo(PLATE_HALF, FRONT_OF_PLATE)
    shape.lineTo(PLATE_HALF, FRONT_OF_PLATE / 2)
    shape.lineTo(0, 0)
    shape.lineTo(-PLATE_HALF, FRONT_OF_PLATE / 2)
    shape.closePath()
    const plate = new THREE.Mesh(new THREE.ShapeGeometry(shape), white)
    plate.rotation.x = Math.PI / 2
    plate.rotation.z = Math.PI
    plate.scale.x = -1
    plate.position.y = 0.06
    this.scene.add(plate)
    // the batter's boxes, chalk outlines either side of the plate
    const chalk = new THREE.LineBasicMaterial({ color: '#f2efe6' })
    for (const dir of [-1, 1]) {
      const x1 = dir * 0.5 + dir * PLATE_HALF
      const x2 = x1 + dir * 4
      const pts = [
        v(x1, -3, 0.07),
        v(x2, -3, 0.07),
        v(x2, 3, 0.07),
        v(x1, 3, 0.07),
        v(x1, -3, 0.07),
      ]
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), chalk))
    }
  }

  private stadium(): void {
    // the outfield wall, a padded ring with a yellow line along the top
    const wallRadius = 395
    const arc = Math.PI * 0.62
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(wallRadius, wallRadius, 10, 96, 1, true, -arc / 2, arc),
      new THREE.MeshStandardMaterial({ color: '#173a5e', roughness: 0.9, side: THREE.BackSide }),
    )
    wall.position.copy(v(0, 0, 5))
    wall.rotation.y = Math.PI
    this.scene.add(wall)
    const stripe = new THREE.Mesh(
      new THREE.CylinderGeometry(
        wallRadius - 0.2,
        wallRadius - 0.2,
        0.6,
        96,
        1,
        true,
        -arc / 2,
        arc,
      ),
      new THREE.MeshBasicMaterial({ color: '#f2c94c', side: THREE.BackSide }),
    )
    stripe.position.copy(v(0, 0, 10))
    stripe.rotation.y = Math.PI
    this.scene.add(stripe)

    // the stands, rising behind the wall, full of little lights for faces
    const stands = new THREE.Mesh(
      new THREE.CylinderGeometry(
        wallRadius + 160,
        wallRadius + 10,
        120,
        96,
        1,
        true,
        -arc / 2 - 0.25,
        arc + 0.5,
      ),
      new THREE.MeshStandardMaterial({ map: crowd(), roughness: 1, side: THREE.BackSide }),
    )
    stands.position.copy(v(0, 0, 70))
    stands.rotation.y = Math.PI
    this.scene.add(stands)

    // light towers, with panels that glow
    const glow = new THREE.MeshBasicMaterial({ color: '#fffbe8' })
    const pole = new THREE.MeshStandardMaterial({ color: '#2b3540' })
    for (const angle of [-0.55, -0.2, 0.2, 0.55]) {
      const r = wallRadius + 120
      const x = Math.sin(angle) * r
      const y = Math.cos(angle) * r
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.5, 190, 8), pole)
      mast.position.copy(v(x, y, 95))
      this.scene.add(mast)
      const bank = new THREE.Mesh(new THREE.BoxGeometry(40, 18, 2), glow)
      bank.position.copy(v(x, y, 195))
      bank.lookAt(v(0, 0, 0))
      this.scene.add(bank)
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: haloTexture(),
          color: '#fff3c4',
          transparent: true,
          depthWrite: false,
        }),
      )
      halo.scale.set(140, 110, 1)
      halo.position.copy(bank.position)
      this.scene.add(halo)
    }
  }

  /** who's pitching and batting: which arm he throws with and where the batter stands */
  setPlayers(throws: 'L' | 'R', stands: 'L' | 'R'): void {
    // a lefty is a righty in the mirror
    this.pitcher.root.scale.x = throws === 'L' ? -1 : 1
    this.batter.root.scale.x = stands === 'L' ? -1 : 1
    // a righty stands on the catcher's left, chest to the plate
    this.batterSpot.position.copy(v(stands === 'R' ? -3.3 : 3.3, 0.3, 0))
    this.batterSpot.rotation.y = stands === 'R' ? Math.PI / 2 : -Math.PI / 2
    this.batter.root.rotation.y = 0
    this.pitcherSpot.position.copy(v(throws === 'R' ? -0.6 : 0.6, RUBBER, MOUND_TOP))
    this.pitcherSpot.rotation.y = 0
    setPose(this.pitcher, delivery(0))
    setPose(this.batter, stance())
  }

  /** the strike zone for this batter, which sets where the zone sits on screen */
  setZone(sz: [number, number]): void {
    this.sz = sz
    this.aim()
    this.onLayout?.()
  }

  /** back to the set position, ball in the glove, for the next pitch */
  ready(p: Pitch, throws: 'L' | 'R', stands: 'L' | 'R'): void {
    this.mode = 'idle'
    this.style = PLAIN
    this.hold = 0.5
    this.onRead = null
    this.pitch = null
    this.flight = null
    this.ball.visible = false
    this.trail.geometry.setDrawRange(0, 0)
    this.setPlayers(throws, stands)
    this.setZone(p.sz)
  }

  /** the read: he comes set showing this pitch's tells, holds, starts his motion and
   * stops just before he lets go. `read` fires when he's stopped. a throw of the same
   * pitch picks up from there */
  read(
    p: Pitch,
    throws: 'L' | 'R',
    stands: 'L' | 'R',
    style: Style,
    hold: number,
    read: () => void,
  ): void {
    this.ready(p, throws, stands)
    this.style = style
    this.hold = hold
    this.pitch = p
    this.matchRelease(p)
    this.onRead = read
    this.mode = 'reading'
    this.started = performance.now()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.started -= (hold + WINDUP * FREEZE) * 1000
    }
  }

  /** the pitch: windup, then the real flight at full speed. `landed` fires when it
   * reaches the plate, then it plays again slowed down with its path traced */
  throw(
    p: Pitch,
    throws: 'L' | 'R',
    stands: 'L' | 'R',
    landed: () => void,
    gone?: { at: number; then: () => void },
  ): void {
    const fromRead = this.mode === 'reading' && this.pitch === p
    this.onRead = null
    this.goneT = null
    this.onGone = gone?.then ?? null
    this.setPlayers(throws, stands)
    this.setZone(p.sz)
    this.pitch = p
    this.flight = flight(p)
    if (gone) this.goneT = this.flight.when(gone.at + FRONT_OF_PLATE)
    this.swings = /swing|foul|hit_into_play|bunt/.test(p.result)
    this.onLanded = landed
    ;(this.trail.material as THREE.LineBasicMaterial).color.set(PITCHES[p.pitch].color)
    this.trail.geometry.setDrawRange(0, 0)
    this.matchRelease(p)
    this.mode = 'throwing'
    this.started = performance.now()
    // carry on from where the read stopped, so the arm doesn't go back to the set
    if (fromRead) this.started -= (this.hold + WINDUP * FREEZE) * 1000
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.started -= this.timeline().end * 1000
    }
  }

  /** pitch recognition: the call is in, so show the rest of the flight from where it vanished */
  finish(landed: () => void): void {
    if (this.mode !== 'gone') return
    this.goneT = null
    this.onLanded = landed
    this.mode = 'throwing'
    this.started = performance.now() - this.goneS * 1000
  }

  /** watch it again from the set */
  replay(): void {
    if (this.mode === 'gone') return
    if (!this.pitch) return
    this.onLanded = null
    if (this.mode === 'reading') {
      this.started = performance.now()
      return
    }
    this.mode = 'throwing'
    this.started = performance.now()
  }

  /** where the pitcher cam sits on the canvas, in css pixels */
  camRect(): Rect {
    const w = this.canvas.clientWidth
    const width = Math.round(Math.min(240, Math.max(110, w * 0.26)))
    return { left: 10, top: 10, width, height: Math.round(width * 1.25) }
  }

  // slide the pitcher so his hand is where statcast saw the ball come out
  private matchRelease(p: Pitch): void {
    this.pitcherSpot.position.copy(v(0, RUBBER, MOUND_TOP))
    setPose(this.pitcher, delivery(RELEASE_AT, this.style))
    this.scene.updateMatrixWorld(true)
    const hand = this.pitcher.ballHand.getWorldPosition(new THREE.Vector3())
    const want = v(p.release[0], p.release[1], p.release[2])
    this.pitcherSpot.position.x += want.x - hand.x
    // only part of the gap in depth, so a long stride doesn't pull him off the mound
    this.pitcherSpot.position.z += Math.max(-3, Math.min(3, want.z - hand.z))
    setPose(this.pitcher, delivery(0))
  }

  private timeline() {
    const f = this.flight!
    const fly = f.plate - f.release
    const release = this.hold + WINDUP * RELEASE_AT
    const land = release + fly
    const slowStart = land + 0.7
    const slowEnd = slowStart + fly / SLOW
    return { fly, release, land, slowStart, slowEnd, end: slowEnd + 0.2 }
  }

  private tick(): void {
    const dt = this.clock.getDelta()
    const now = performance.now()
    if (this.mode === 'idle') {
      // breathing, a little sway, the batter waggling the bat
      const t = now / 1000
      setPose(this.pitcher, delivery(0), Math.sin(t * 1.6) * 0.03)
      setPose(this.batter, stance(), Math.sin(t * 2.3) * 0.06)
    } else if (this.mode === 'reading') {
      this.reading((now - this.started) / 1000, now / 1000)
    } else if (this.flight && this.mode !== 'gone') {
      this.animate((now - this.started) / 1000)
    }
    void dt
    this.renderer.setScissorTest(false)
    this.renderer.setViewport(0, 0, this.canvas.clientWidth, this.canvas.clientHeight)
    this.renderer.render(this.scene, this.camera)
    if (this.showCam) this.drawCam()
  }

  /** the delivery up to the freeze, then held there with the ball still in his hand */
  private reading(s: number, t: number): void {
    const u = (s - this.hold) / WINDUP
    const breathe = u < 0 ? Math.sin(t * 1.6) * 0.02 : 0
    setPose(this.pitcher, delivery(Math.max(0, Math.min(FREEZE, u)), this.style), breathe)
    setPose(this.batter, stance(), Math.sin(t * 2.3) * 0.06)
    if (u >= FREEZE && this.onRead) {
      const done = this.onRead
      this.onRead = null
      done()
    }
  }

  /** the pitcher cam: the same spot behind the plate with a much longer lens */
  private drawCam(): void {
    const r = this.camRect()
    const h = this.canvas.clientHeight
    const cam = this.pitcherCam
    const at = this.pitcherSpot.getWorldPosition(new THREE.Vector3())
    // he strides about 4 ft toward the plate, so aim a little in front of the rubber
    const target = new THREE.Vector3(at.x, at.y + 4.2, at.z + 1.8)
    cam.position.copy(v(0, -34, 4.6))
    cam.aspect = r.width / r.height
    const dist = cam.position.distanceTo(target)
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(4.4 / dist))
    cam.lookAt(target)
    cam.updateProjectionMatrix()
    const y = h - r.top - r.height
    this.renderer.setScissorTest(true)
    this.renderer.setScissor(r.left, y, r.width, r.height)
    this.renderer.setViewport(r.left, y, r.width, r.height)
    // the batter would block the view, so he steps out of this shot
    this.batter.root.visible = false
    this.renderer.render(this.scene, cam)
    this.batter.root.visible = true
    this.renderer.setScissorTest(false)
  }

  private animate(s: number): void {
    const f = this.flight!
    const tl = this.timeline()
    // the pitcher's motion runs once from the start, then holds the follow through
    setPose(this.pitcher, delivery(Math.max(0, Math.min(1, (s - this.hold) / WINDUP)), this.style))
    // the batter swings when the real batter did, timed to meet the ball at the plate
    const swingStart = tl.land - 0.22
    setPose(
      this.batter,
      // in pitch recognition he holds until you've called it, a swing would give it away
      this.swings && this.goneT === null && s > swingStart
        ? swing(Math.min(1, (s - swingStart) / 0.35))
        : stance(),
    )

    let t: number | null = null
    let tracing = false
    if (s < tl.release) {
      t = null
    } else if (s < tl.land) {
      t = f.release + (s - tl.release)
    } else if (s < tl.slowStart) {
      t = f.plate
    } else if (s < tl.slowEnd) {
      t = f.release + (s - tl.slowStart) * SLOW
      tracing = true
    } else {
      t = f.plate
      tracing = true
      this.mode = 'done'
    }
    // once per throw, even if a slow frame (or reduced motion) skips past the landing
    if (s >= tl.land && this.onLanded) {
      const done = this.onLanded
      this.onLanded = null
      done()
    }
    // pitch recognition: past the point it disappears, everything holds until you call it
    if (this.goneT !== null && t !== null && t >= this.goneT) {
      this.ball.visible = false
      this.mode = 'gone'
      this.goneS = s
      const then = this.onGone
      this.onGone = null
      then?.()
      return
    }
    this.ball.visible = t !== null
    if (t !== null) {
      const [x, y, z] = f.at(t)
      this.ball.position.copy(v(x, y, z))
    }
    if (tracing && t !== null) {
      const position = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i <= TRAIL_STEPS; i++) {
        const [px, py, pz] = f.at(f.release + ((t - f.release) * i) / TRAIL_STEPS)
        position.setXYZ(i, px, pz, -py)
      }
      position.needsUpdate = true
      this.trail.geometry.setDrawRange(0, TRAIL_STEPS + 1)
    } else if (s < tl.slowStart) {
      this.trail.geometry.setDrawRange(0, 0)
    }
  }

  /** where the frame around the zone lands on the canvas, in css pixels. the frame runs
   * the width of FRAME_HALF either side and half a zone above and below it */
  frame(): Rect {
    const [bot, top] = this.sz
    const h = top - bot
    const mid = (top + bot) / 2
    const w = this.canvas.clientWidth
    const hh = this.canvas.clientHeight
    const at = (x: number, z: number) => {
      const p = v(x, FRONT_OF_PLATE, z).project(this.camera)
      return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * hh }
    }
    const l = at(-FRAME_HALF, mid).x
    const r = at(FRAME_HALF, mid).x
    const t = at(0, top + h / 2).y
    const b = at(0, bot - h / 2).y
    return { left: l, top: t, width: r - l, height: b - t }
  }

  private fit(): void {
    const { clientWidth: w, clientHeight: h } = this.canvas
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.aim()
    this.renderer.render(this.scene, this.camera)
    this.onLayout?.()
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null)
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

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const texture = new THREE.CanvasTexture(c)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** a night sky over a lit ballpark: dark up top, glowing toward the stands */
function sky(): THREE.Texture {
  return canvasTexture(4, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256)
    grad.addColorStop(0, '#040912')
    grad.addColorStop(0.5, '#0d1f36')
    grad.addColorStop(0.8, '#24476e')
    grad.addColorStop(1, '#3d6690')
    g.fillStyle = grad
    g.fillRect(0, 0, 4, 256)
  })
}

/** grass with mowing stripes running out toward the mound */
function mowed(): THREE.Texture {
  const texture = canvasTexture(64, 64, (g) => {
    g.fillStyle = '#2a7a3b'
    g.fillRect(0, 0, 64, 64)
    g.fillStyle = '#226a32'
    g.fillRect(0, 0, 32, 64)
  })
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(60, 60)
  texture.anisotropy = 8
  return texture
}

/** rows of seats with a crowd in them: specks of shirts and faces on dark stands */
function crowd(): THREE.Texture {
  const texture = canvasTexture(1024, 256, (g) => {
    g.fillStyle = '#0b1522'
    g.fillRect(0, 0, 1024, 256)
    const colors = ['#2f6fd6', '#f4f6f8', '#c9d4e0', '#1d3f75', '#e8c547', '#d8a080', '#8a5a3c']
    let seed = 7
    const rand = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    for (let row = 0; row < 256; row += 4) {
      // a dark band every so often for the aisles and decks
      if (row % 64 < 6) continue
      for (let x = 0; x < 1024; x += 3) {
        if (rand() < 0.4) continue
        g.fillStyle = colors[Math.floor(rand() * colors.length)]
        g.globalAlpha = 0.18 + rand() * 0.32
        g.fillRect(x, row, 2, 2)
      }
    }
    g.globalAlpha = 1
  })
  texture.wrapS = THREE.RepeatWrapping
  texture.repeat.set(3, 1)
  return texture
}

function haloTexture(): THREE.Texture {
  return canvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(0.3, 'rgba(255,255,255,0.25)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
  })
}

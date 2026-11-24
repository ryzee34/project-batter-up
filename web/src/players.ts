// a pitcher and a batter built out of capsules and spheres, and the poses that move them.
// they're drawn in code, so there are no model files to license or download.
//
// a player stands at the origin facing +z with y up, so his right hand is on the -x side.
// a lefty is the same player mirrored. joints are rotations in radians: for limbs that
// hang down (arms, legs) a negative x swings them forward, for the torso and head a
// positive x leans them forward

import * as THREE from 'three'

export type Joint =
  | 'torso'
  | 'head'
  | 'rShoulder'
  | 'rElbow'
  | 'lShoulder'
  | 'lElbow'
  | 'rHip'
  | 'rKnee'
  | 'lHip'
  | 'lKnee'
  | 'bat'

export interface Pose {
  joints: Partial<Record<Joint, [number, number, number]>>
  /** turn of the whole body */
  turn: number
  /** how far he's moved toward the plate, and how far his hips have dropped */
  forward: number
  drop: number
}

export interface Player {
  root: THREE.Group
  body: THREE.Group
  joints: Record<Joint, THREE.Group>
  /** the hand the ball leaves from */
  ballHand: THREE.Group
}

interface Colors {
  jersey: string
  trim: string
  skin: string
  bat?: boolean
}

const LEG = 1.45
const ARM = 0.95

export function buildPlayer(colors: Colors): Player {
  const mat = (color: string, rough = 0.75) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough })
  const jersey = mat(colors.jersey)
  const trim = mat(colors.trim)
  const skin = mat(colors.skin, 0.6)
  const dark = mat('#1d2228')

  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const group = (parent: THREE.Object3D, x: number, y: number, z = 0) => {
    const g = new THREE.Group()
    g.position.set(x, y, z)
    parent.add(g)
    return g
  }
  const part = (
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    m: THREE.Material,
    y: number,
    z = 0,
  ) => {
    const mesh = new THREE.Mesh(geo, m)
    mesh.position.set(0, y, z)
    mesh.castShadow = true
    parent.add(mesh)
    return mesh
  }
  const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 6, 14)

  const hips = group(body, 0, LEG * 2 + 0.1)
  part(hips, new THREE.SphereGeometry(0.5, 16, 12).scale(1.05, 0.6, 0.75), jersey, 0)
  // a belt
  part(hips, new THREE.CylinderGeometry(0.5, 0.5, 0.12, 20).scale(1, 1, 0.75), trim, 0.22)

  const torso = group(hips, 0, 0.2)
  part(torso, capsule(0.52, 0.95).scale(1.12, 1, 0.75), jersey, 0.85)
  // a number on the back would be a team's, so just a stripe down the front
  part(torso, new THREE.BoxGeometry(0.08, 1.3, 0.04), trim, 0.85, 0.4)
  const head = group(torso, 0, 1.75)
  part(head, new THREE.CylinderGeometry(0.16, 0.18, 0.3, 12), skin, 0.05)
  part(head, new THREE.SphereGeometry(0.36, 20, 16).scale(0.92, 1.05, 1), skin, 0.42)
  if (colors.bat) {
    // a batting helmet with an ear flap
    part(head, new THREE.SphereGeometry(0.42, 20, 14, 0, Math.PI * 2, 0, Math.PI / 1.8), trim, 0.5)
  } else {
    part(head, new THREE.SphereGeometry(0.39, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), trim, 0.55)
    part(
      head,
      new THREE.CylinderGeometry(0.34, 0.34, 0.04, 20, 1, false, -Math.PI / 2, Math.PI).scale(
        1,
        1,
        0.9,
      ),
      trim,
      0.55,
      0.12,
    )
  }

  const arm = (side: number) => {
    const shoulder = group(torso, side * 0.68, 1.42)
    part(shoulder, new THREE.SphereGeometry(0.24, 14, 10), jersey, 0)
    part(shoulder, capsule(0.17, ARM - 0.3), jersey, -ARM / 2)
    const elbow = group(shoulder, 0, -ARM)
    part(elbow, capsule(0.14, ARM - 0.3), skin, -ARM / 2)
    const hand = group(elbow, 0, -ARM)
    part(hand, new THREE.SphereGeometry(0.15, 12, 10), skin, -0.05)
    return { shoulder, elbow, hand }
  }
  const right = arm(-1)
  const left = arm(1)
  if (!colors.bat) {
    // the glove on his left hand
    part(
      left.hand,
      new THREE.SphereGeometry(0.3, 14, 10).scale(1, 1.2, 0.6),
      mat('#6b3f22', 0.9),
      -0.15,
    )
  }
  const bat = group(right.hand, 0, -0.05)
  if (colors.bat) {
    part(bat, new THREE.CylinderGeometry(0.11, 0.045, 2.8, 14), mat('#c99a5b', 0.5), -1.4)
  }

  const leg = (side: number) => {
    const hip = group(hips, side * 0.3, -0.05)
    part(hip, capsule(0.24, LEG - 0.45), jersey, -LEG / 2)
    const knee = group(hip, 0, -LEG)
    part(knee, capsule(0.2, LEG - 0.5), jersey, -LEG / 2 + 0.1)
    // high socks in the team color, then shoes
    part(knee, new THREE.CylinderGeometry(0.19, 0.17, 0.6, 12), trim, -LEG + 0.45)
    part(knee, new THREE.BoxGeometry(0.34, 0.2, 0.75), dark, -LEG + 0.05, 0.15)
    return { hip, knee }
  }
  const rLeg = leg(-1)
  const lLeg = leg(1)

  return {
    root,
    body,
    ballHand: right.hand,
    joints: {
      torso,
      head,
      rShoulder: right.shoulder,
      rElbow: right.elbow,
      lShoulder: left.shoulder,
      lElbow: left.elbow,
      rHip: rLeg.hip,
      rKnee: rLeg.knee,
      lHip: lLeg.hip,
      lKnee: lLeg.knee,
      bat,
    },
  }
}

/** puts a player in a pose. `breathe` adds a little rise and fall on top of it */
export function setPose(p: Player, pose: Pose, breathe = 0): void {
  for (const name of Object.keys(p.joints) as Joint[]) {
    const [x, y, z] = pose.joints[name] ?? [0, 0, 0]
    p.joints[name].rotation.set(x, y, z)
  }
  p.joints.torso.rotation.x += breathe
  p.body.rotation.y = pose.turn
  p.body.position.set(0, pose.drop + breathe * 0.4, pose.forward)
}

function smooth(u: number): number {
  return u * u * (3 - 2 * u)
}

function blend(a: Pose, b: Pose, u: number): Pose {
  const k = smooth(Math.min(1, Math.max(0, u)))
  const mix = (x: number, y: number) => x + (y - x) * k
  const joints: Pose['joints'] = {}
  const names = new Set([...Object.keys(a.joints), ...Object.keys(b.joints)]) as Set<Joint>
  for (const name of names) {
    const ja = a.joints[name] ?? [0, 0, 0]
    const jb = b.joints[name] ?? [0, 0, 0]
    joints[name] = [mix(ja[0], jb[0]), mix(ja[1], jb[1]), mix(ja[2], jb[2])]
  }
  return {
    joints,
    turn: mix(a.turn, b.turn),
    forward: mix(a.forward, b.forward),
    drop: mix(a.drop, b.drop),
  }
}

function along(keys: [number, Pose][], t: number): Pose {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, p1] = keys[i]
    const [t0, p0] = keys[i - 1]
    if (t <= t1) return blend(p0, p1, (t - t0) / (t1 - t0))
  }
  return keys[keys.length - 1][1]
}

// a righty out of the stretch: set, leg lift, stride with the arm cocked, release out
// in front, then the follow through. the glove side faces the plate until he opens up
const SET: Pose = {
  turn: -1.35,
  forward: 0,
  drop: 0,
  joints: {
    torso: [0.04, 0, 0],
    head: [0, 1.25, 0],
    rShoulder: [-0.55, 0, 0.25],
    rElbow: [-1.75, 0, 0],
    lShoulder: [-0.55, 0, -0.25],
    lElbow: [-1.75, 0, 0],
    rKnee: [0.08, 0, 0],
    lKnee: [0.08, 0, 0],
  },
}
const LIFT: Pose = {
  turn: -1.55,
  forward: 0,
  drop: -0.05,
  joints: {
    torso: [-0.1, 0, 0],
    head: [0, 1.35, 0],
    rShoulder: [-0.45, 0, 0.25],
    rElbow: [-1.9, 0, 0],
    lShoulder: [-0.45, 0, -0.25],
    lElbow: [-1.9, 0, 0],
    rKnee: [0.18, 0, 0],
    lHip: [-1.5, 0, 0],
    lKnee: [1.7, 0, 0],
  },
}
const COCK: Pose = {
  turn: -0.95,
  forward: 2.6,
  drop: -0.55,
  joints: {
    torso: [0.1, 0, 0],
    head: [0, 0.9, 0],
    rShoulder: [0, -0.5, -1.55],
    rElbow: [0, 0, -1.5],
    lShoulder: [-1.45, 0, 0.45],
    lElbow: [-0.35, 0, 0],
    rHip: [0.35, 0, 0],
    rKnee: [0.55, 0, 0],
    lHip: [-0.95, 0, 0.5],
    lKnee: [0.45, 0, 0],
  },
}
const RELEASE: Pose = {
  turn: 0.1,
  forward: 4.2,
  drop: -0.85,
  joints: {
    torso: [0.65, 0, 0],
    head: [-0.35, 0, 0],
    rShoulder: [-2.5, 0, -0.35],
    rElbow: [-0.25, 0, 0],
    lShoulder: [-0.6, 0, -0.3],
    lElbow: [-1.9, 0, 0],
    rHip: [0.6, 0, 0],
    rKnee: [0.9, 0, 0],
    lHip: [-0.9, 0, 0.1],
    lKnee: [0.35, 0, 0],
  },
}
const FOLLOW: Pose = {
  turn: 0.45,
  forward: 4.8,
  drop: -0.7,
  joints: {
    torso: [0.95, 0, 0],
    head: [-0.6, 0, 0],
    rShoulder: [-0.6, 0, 0.7],
    rElbow: [-0.7, 0, 0],
    lShoulder: [-0.3, 0, -0.4],
    lElbow: [-1.6, 0, 0],
    rHip: [0.45, 0, 0],
    rKnee: [1.6, 0, 0],
    lHip: [-0.6, 0, 0],
    lKnee: [0.4, 0, 0],
  },
}

/** the made up tells he can show, and the real arm slot, as the 3d pitcher plays them */
export interface Style {
  /** 0 hands at the chest at the set, 1 down at the belt */
  glove: 0 | 1
  /** 0 a high leg kick, 1 a slide step */
  kick: 0 | 1
  /** how far above or below his usual arm slot this one comes from, in his own spreads */
  tilt: number
}

export const PLAIN: Style = { glove: 0, kick: 0, tilt: 0 }

function tweak(pose: Pose, joints: Pose['joints']): Pose {
  return { ...pose, joints: { ...pose.joints, ...joints } }
}

// hands down at the belt instead of up at the chest
const SET_LOW = tweak(SET, {
  rShoulder: [-0.2, 0, 0.3],
  rElbow: [-1.15, 0, 0],
  lShoulder: [-0.2, 0, -0.3],
  lElbow: [-1.15, 0, 0],
})
// a slide step: the knee barely comes up and he stays tall
const LIFT_SLIDE = tweak(LIFT, {
  rKnee: [0.1, 0, 0],
  lHip: [-0.55, 0, 0.1],
  lKnee: [0.6, 0, 0],
})

/** the delivery, from 0 (set) to 1 (follow through). the ball comes out at 0.8 */
export function delivery(t: number, style: Style = PLAIN): Pose {
  // a higher slot drops the arm side less and lifts the arm more, both exaggerated so
  // you can see a few inches of real difference from the plate
  const tilt = style.tilt * 0.14
  const arm = (pose: Pose): Pose =>
    tweak(pose, {
      rShoulder: [
        pose.joints.rShoulder![0] - tilt * 0.4,
        pose.joints.rShoulder![1],
        pose.joints.rShoulder![2] + tilt,
      ],
      torso: [pose.joints.torso![0], pose.joints.torso![1], -tilt * 0.6],
    })
  return along(
    [
      [0, style.glove ? SET_LOW : SET],
      [0.32, style.kick ? LIFT_SLIDE : LIFT],
      [0.62, arm(COCK)],
      [0.8, arm(RELEASE)],
      [1, FOLLOW],
    ],
    t,
  )
}

// a righty in the box, chest to the plate, head turned to the pitcher on his left, hands
// up by his back shoulder with the bat tipped back
const STANCE: Pose = {
  turn: 0,
  forward: 0,
  drop: -0.25,
  joints: {
    torso: [0.3, -0.25, 0],
    head: [-0.1, 1.15, 0],
    rShoulder: [-0.75, 0, 0.15],
    rElbow: [-2.1, 0, 0],
    lShoulder: [-1.15, 0, -0.55],
    lElbow: [-1.45, 0, 0],
    bat: [-0.6, 0, 0.3],
    rHip: [-0.25, 0, -0.15],
    rKnee: [0.45, 0, 0],
    lHip: [-0.25, 0, 0.15],
    lKnee: [0.45, 0, 0],
  },
}
const CONTACT: Pose = {
  turn: 0,
  forward: 0,
  drop: -0.35,
  joints: {
    torso: [0.35, 1.0, 0],
    head: [0.1, 0.4, 0],
    rShoulder: [-1.35, 0, 0.3],
    rElbow: [-0.5, 0, 0],
    lShoulder: [-1.45, 0, 0.2],
    lElbow: [-0.2, 0, 0],
    bat: [0.2, 0, -1.2],
    rHip: [-0.1, 0.4, -0.1],
    rKnee: [0.6, 0, 0],
    lHip: [-0.5, 0, 0.3],
    lKnee: [0.15, 0, 0],
  },
}
const FINISH: Pose = {
  turn: 0,
  forward: 0,
  drop: -0.2,
  joints: {
    torso: [0.15, 1.9, 0],
    head: [0, -0.3, 0],
    rShoulder: [-1.9, 0, 0.9],
    rElbow: [-1.3, 0, 0],
    lShoulder: [-1.7, 0, 0.9],
    lElbow: [-1.5, 0, 0],
    bat: [1.6, 0, -0.4],
    rHip: [0, 0.6, 0],
    rKnee: [0.7, 0, 0],
    lHip: [-0.3, 0, 0.3],
    lKnee: [0.1, 0, 0],
  },
}

export function stance(): Pose {
  return STANCE
}

/** a swing, 0 at the stance, about halfway at contact, 1 at the finish */
export function swing(t: number): Pose {
  return along(
    [
      [0, STANCE],
      [0.45, CONTACT],
      [1, FINISH],
    ],
    t,
  )
}

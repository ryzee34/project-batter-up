// a pitch's path, from statcast's nine numbers. statcast fits each pitch to constant
// acceleration and reports velocity and acceleration at y = 50 ft (distance from the back
// of home plate toward the mound), with x to the catcher's right and z up, all in feet.
// position at y = 50 isn't in the data we keep, so we solve for it backwards from where
// the ball crossed the front of the plate

import type { Pitch } from './types'

export const FRONT_OF_PLATE = 17 / 12
export const Y0 = 50

export interface Flight {
  /** time at release, negative because t = 0 is at y = 50 */
  release: number
  /** time the ball crosses the front of the plate */
  plate: number
  at(t: number): [number, number, number]
  /** the time the ball is `y` feet from the back of the plate */
  when(y: number): number
}

/** the times y(t) hits `y`, earliest first */
function timesAt(y: number, vy0: number, ay: number): [number, number] {
  // Y0 + vy0 t + ay t^2 / 2 = y
  const a = ay / 2
  const disc = vy0 * vy0 - 4 * a * (Y0 - y)
  if (disc < 0) throw new Error('the ball never gets there')
  const root = Math.sqrt(disc)
  const t1 = (-vy0 - root) / (2 * a)
  const t2 = (-vy0 + root) / (2 * a)
  return t1 < t2 ? [t1, t2] : [t2, t1]
}

export function flight(p: Pitch): Flight {
  const [vx0, vy0, vz0, ax, ay, az] = p.flight
  // the ball is moving toward the plate (vy0 < 0) and slowing down (ay > 0), so the first
  // crossing is the one we want
  const plate = timesAt(FRONT_OF_PLATE, vy0, ay)[0]
  const release = timesAt(p.release[1], vy0, ay)[0]
  const x0 = p.plate[0] - vx0 * plate - (ax * plate * plate) / 2
  const z0 = p.plate[1] - vz0 * plate - (az * plate * plate) / 2
  return {
    release,
    plate,
    when(y) {
      return timesAt(y, vy0, ay)[0]
    },
    at(t) {
      return [
        x0 + vx0 * t + (ax * t * t) / 2,
        Y0 + vy0 * t + (ay * t * t) / 2,
        z0 + vz0 * t + (az * t * t) / 2,
      ]
    },
  }
}

/** inches of break versus a ball with no spin, the way broadcasts talk about it */
export function breakInches(p: Pitch): { horizontal: number; vertical: number } {
  const f = flight(p)
  const t = f.plate - f.release
  const [, , , ax, , az] = p.flight
  return {
    horizontal: Math.round(((ax * t * t) / 2) * 12),
    vertical: Math.round((((az + 32.174) * t * t) / 2) * 12),
  }
}

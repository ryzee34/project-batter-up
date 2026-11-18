import { describe, expect, it } from 'vitest'

import { FRONT_OF_PLATE, flight } from './flight'
import type { Pitch } from './types'

// a real looking 95 mph four seamer from a righty, ending up and away to a lefty
const pitch = {
  plate: [0.6, 3.1],
  release: [-1.9, 54.1, 5.8],
  flight: [6.2, -138.0, -4.1, -9.5, 29.0, -15.2],
} as unknown as Pitch

describe('flight', () => {
  const f = flight(pitch)

  it('crosses the front of the plate at the reported spot', () => {
    const [x, y, z] = f.at(f.plate)
    expect(y).toBeCloseTo(FRONT_OF_PLATE, 6)
    expect(x).toBeCloseTo(0.6, 6)
    expect(z).toBeCloseTo(3.1, 6)
  })

  it('starts at the release point distance', () => {
    expect(f.release).toBeLessThan(0)
    expect(f.at(f.release)[1]).toBeCloseTo(54.1, 6)
  })

  it('takes about four tenths of a second, like a 95 mph pitch does', () => {
    expect(f.plate - f.release).toBeGreaterThan(0.38)
    expect(f.plate - f.release).toBeLessThan(0.46)
  })
})

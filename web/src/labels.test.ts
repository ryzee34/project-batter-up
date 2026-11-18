import { describe, expect, it } from 'vitest'

import { spot, spotPhrase } from './labels'

describe('spot', () => {
  it('puts in on the side the batter stands, from the catcher', () => {
    expect(spot('1', 'R')).toBe('up and in')
    expect(spot('9', 'R')).toBe('down and away')
    expect(spot('1', 'L')).toBe('up and away')
    expect(spot('6', 'L')).toBe('in')
  })

  it('names the middle and the chase', () => {
    expect(spot('5', 'R')).toBe('middle middle')
    expect(spot('2', 'L')).toBe('up')
    expect(spot('8', 'R')).toBe('down')
    expect(spot('chase', 'R')).toBe('chase')
    expect(spotPhrase('chase', 'L')).toBe('off the plate')
  })
})

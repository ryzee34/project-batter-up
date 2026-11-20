import { describe, expect, it } from 'vitest'

import { isChase, spot } from './labels'

describe('spot', () => {
  it('puts in on the side the batter stands, from the catcher', () => {
    expect(spot('1', 'R')).toBe('up and in')
    expect(spot('9', 'R')).toBe('down and away')
    expect(spot('1', 'L')).toBe('up and away')
    expect(spot('6', 'L')).toBe('in')
  })

  it('names the middle', () => {
    expect(spot('5', 'R')).toBe('middle middle')
    expect(spot('2', 'L')).toBe('up')
    expect(spot('8', 'R')).toBe('down')
  })

  it('names a chase for the side it missed, in and away for the batter', () => {
    expect(spot('chase_up', 'R')).toBe('chase up')
    expect(spot('chase_down', 'L')).toBe('chase down')
    expect(spot('chase_left', 'R')).toBe('chase in')
    expect(spot('chase_left', 'L')).toBe('chase away')
    expect(spot('chase_right', 'L')).toBe('chase in')
    expect(isChase('chase_up')).toBe(true)
    expect(isChase('5')).toBe(false)
  })
})

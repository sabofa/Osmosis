import { describe, expect, it } from 'vitest'
import { markerShape } from './featureMarker'

describe('markerShape', () => {
  it('gives a plain plotted point the default dot', () => {
    expect(markerShape(null)).toBe('dot')
    expect(markerShape(undefined)).toBe('dot')
  })

  // The whole point of the rework: these must not look alike.
  it('gives every feature kind a shape distinct from its neighbours', () => {
    expect(markerShape('x-intercept')).not.toBe(markerShape('local-max'))
    expect(markerShape('local-max')).not.toBe(markerShape('local-min'))
    expect(markerShape('inflection')).not.toBe(markerShape('local-max'))
    expect(markerShape('intersection')).not.toBe(markerShape('x-intercept'))
  })

  it('points a maximum up and a minimum down', () => {
    expect(markerShape('local-max')).toBe('triangle-up')
    expect(markerShape('local-min')).toBe('triangle-down')
  })

  it('uses the same shape for both intercept kinds, since both are roots', () => {
    expect(markerShape('x-intercept')).toBe('ring')
    expect(markerShape('y-intercept')).toBe('ring')
  })
})

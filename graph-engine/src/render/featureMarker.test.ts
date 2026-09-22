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

  // The inequality test above only proves inflection and intersection differ
  // from *each other* and from a couple of neighbours — it would still pass
  // if their shapes were swapped. Pin both to literals so that swap would be
  // caught.
  it('pins the shapes that the inequality test alone would not catch being swapped', () => {
    expect(markerShape('inflection')).toBe('square')
    expect(markerShape('intersection')).toBe('diamond')
  })

  // Nothing emits these kinds yet (conic features are later work), but
  // pinning them now means the mapping is fully covered from the start —
  // a future change to SHAPES can't silently drift one of these without a
  // test noticing, even before anything on the scene/detection side reads it.
  it('pins the shapes for feature kinds nothing emits yet', () => {
    expect(markerShape('center')).toBe('dot')
    expect(markerShape('focus')).toBe('diamond')
    expect(markerShape('conic-vertex')).toBe('triangle-up')
  })
})

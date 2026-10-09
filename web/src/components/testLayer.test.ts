import { describe, it, expect, vi } from 'vitest'
import { testLayerFor } from './testLayer'

describe('testLayerFor', () => {
  it('includes the anchor when both ends are set', () => {
    const l = testLayerFor({ anchorStart: 3, anchorEnd: 9, anchorLabel: 'Q1', markers: [] })
    expect(l.anchor).toEqual({ start: 3, end: 9, label: 'Q1' })
  })
  it('has no anchor when either end is missing', () => {
    expect(testLayerFor({ anchorStart: null, anchorEnd: 9, anchorLabel: null, markers: [] }).anchor).toBeNull()
    expect(testLayerFor({ anchorStart: 3, anchorEnd: null, anchorLabel: null, markers: [] }).anchor).toBeNull()
  })
  it('keeps a zero start as an anchor', () => {
    expect(testLayerFor({ anchorStart: 0, anchorEnd: 4, anchorLabel: null, markers: [] }).anchor).toEqual({ start: 0, end: 4, label: null })
  })
  it('maps markers to id/offset and activation calls onJump with the id', () => {
    const onJump = vi.fn()
    const l = testLayerFor({
      anchorStart: null,
      anchorEnd: null,
      anchorLabel: null,
      markers: [{ id: 'q7', document_marker_offset: 42 }],
      onJump,
    })
    expect(l.markers).toEqual([{ id: 'q7', offset: 42 }])
    l.onMarkerActivate!('q7')
    expect(onJump).toHaveBeenCalledWith('q7')
  })
})

import { describe, expect, it } from 'vitest'
import { createInteraction, WHEEL_SETTLE_MS } from './interaction'

// A clock the test moves by hand.
function clock() {
  let t = 5000
  return {
    now: () => t,
    advance(ms: number) {
      t += ms
    },
  }
}

describe('createInteraction', () => {
  it('is idle until something happens', () => {
    const c = clock()
    const i = createInteraction(c.now)
    expect(i.isDragging()).toBe(false)
    expect(i.isInteracting()).toBe(false)
    expect(i.wheelSettleIn()).toBeNull()
    expect(i.takeWheelSettled()).toBe(false)
  })

  it('a drag is interacting until the pointer goes up, and the end of one that moved asks for a settle rebuild', () => {
    const c = clock()
    const i = createInteraction(c.now)
    i.pointerDown()
    expect(i.isDragging()).toBe(true)
    expect(i.isInteracting()).toBe(true)
    i.pointerMove()
    c.advance(10_000)
    expect(i.isInteracting()).toBe(true)
    expect(i.pointerUp()).toBe(true)
    expect(i.isDragging()).toBe(false)
    expect(i.isInteracting()).toBe(false)
  })

  it('asks for the settle rebuild once: a second pointer up (the window hears every one) asks for nothing', () => {
    const c = clock()
    const i = createInteraction(c.now)
    i.pointerDown()
    i.pointerMove()
    expect(i.pointerUp()).toBe(true)
    expect(i.pointerUp()).toBe(false)
  })

  it('a press and release that never moved the view has nothing to settle', () => {
    const c = clock()
    const i = createInteraction(c.now)
    i.pointerDown()
    expect(i.pointerUp()).toBe(false)
    expect(i.isInteracting()).toBe(false)
    // and the next drag starts clean: the move of one drag is not carried into the next
    i.pointerDown()
    expect(i.pointerUp()).toBe(false)
  })

  it('a wheel event makes the view interacting for WHEEL_SETTLE_MS, to the millisecond', () => {
    expect(WHEEL_SETTLE_MS).toBe(150)
    const c = clock()
    const i = createInteraction(c.now)
    i.wheel()
    expect(i.isInteracting()).toBe(true)
    expect(i.isDragging()).toBe(false)
    c.advance(WHEEL_SETTLE_MS - 1)
    expect(i.isInteracting()).toBe(true)
    c.advance(1)
    expect(i.isInteracting()).toBe(false)
  })

  it('a wheel burst settles once, WHEEL_SETTLE_MS after its last event, and each event pushes it back', () => {
    const c = clock()
    const i = createInteraction(c.now)
    i.wheel()
    expect(i.wheelSettleIn()).toBe(WHEEL_SETTLE_MS)
    c.advance(100)
    expect(i.wheelSettleIn()).toBe(WHEEL_SETTLE_MS - 100)
    expect(i.takeWheelSettled()).toBe(false)
    i.wheel()
    c.advance(100)
    // 100 ms after the second event, not 200 after the first
    expect(i.wheelSettleIn()).toBe(WHEEL_SETTLE_MS - 100)
    expect(i.takeWheelSettled()).toBe(false)
    c.advance(WHEEL_SETTLE_MS - 100)
    expect(i.wheelSettleIn()).toBe(0)
    expect(i.takeWheelSettled()).toBe(true)
    // taken: nothing is pending, and it does not fire a second time
    expect(i.wheelSettleIn()).toBeNull()
    expect(i.takeWheelSettled()).toBe(false)
  })

  it('a wheel burst during a drag keeps the view interacting after the wheel is quiet, until the pointer is up', () => {
    const c = clock()
    const i = createInteraction(c.now)
    i.pointerDown()
    i.wheel()
    c.advance(WHEEL_SETTLE_MS)
    expect(i.isInteracting()).toBe(true)
    i.pointerMove()
    expect(i.pointerUp()).toBe(true)
    expect(i.isInteracting()).toBe(false)
  })

  // fix round 1: a wheel turned with the button held moved the view, though the pointer did not; its settle was lost when the
  // wheel burst's own timer found a drag in progress and left the settling to the pointer up, which then saw no move
  it('a wheel turned during a press moved the view: the pointer up still asks for the settle', () => {
    const c = clock()
    const i = createInteraction(c.now)
    i.pointerDown()
    i.wheel()
    c.advance(WHEEL_SETTLE_MS)
    expect(i.takeWheelSettled()).toBe(true)
    expect(i.pointerUp()).toBe(true)
    // and a wheel with no press does not leave a move behind for the next press
    i.wheel()
    i.pointerDown()
    expect(i.pointerUp()).toBe(false)
  })

  // fix round 1 (I2): the viewport's pixels drive the sampling, so a resize is a view change. The first size is the baseline
  // (the observer reports once when it starts), and only a different size asks for a rebuild.
  describe('viewportChanged', () => {
    it('is false for the size the renderer started with, and for the same size again', () => {
      const i = createInteraction(clock().now)
      expect(i.viewportChanged(800, 600)).toBe(false)
      expect(i.viewportChanged(800, 600)).toBe(false)
    })
    it('is true when either side changes, once for each change', () => {
      const i = createInteraction(clock().now)
      i.viewportChanged(800, 600)
      expect(i.viewportChanged(801, 600)).toBe(true)
      expect(i.viewportChanged(801, 600)).toBe(false)
      expect(i.viewportChanged(801, 400)).toBe(true)
      expect(i.viewportChanged(800, 600)).toBe(true)
    })
    it('a canvas that was not displayed (1 x 1) and comes up at its size is a change', () => {
      const i = createInteraction(clock().now)
      i.viewportChanged(1, 1)
      expect(i.viewportChanged(640, 480)).toBe(true)
    })
    it('is independent of a gesture: a resize during a drag is still a change, and does not end the drag', () => {
      const i = createInteraction(clock().now)
      i.viewportChanged(800, 600)
      i.pointerDown()
      expect(i.viewportChanged(700, 600)).toBe(true)
      expect(i.isDragging()).toBe(true)
    })
  })
})

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
})

import { describe, expect, it } from 'vitest'
import { createInteraction, viewChangeAction, WHEEL_SETTLE_MS } from './interaction'

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
    expect(i.settleIn()).toBeNull()
    expect(i.takeSettled()).toBe(false)
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
    expect(i.settleIn()).toBe(WHEEL_SETTLE_MS)
    c.advance(100)
    expect(i.settleIn()).toBe(WHEEL_SETTLE_MS - 100)
    expect(i.takeSettled()).toBe(false)
    i.wheel()
    c.advance(100)
    // 100 ms after the second event, not 200 after the first
    expect(i.settleIn()).toBe(WHEEL_SETTLE_MS - 100)
    expect(i.takeSettled()).toBe(false)
    c.advance(WHEEL_SETTLE_MS - 100)
    expect(i.settleIn()).toBe(0)
    expect(i.takeSettled()).toBe(true)
    // taken: nothing is pending, and it does not fire a second time
    expect(i.settleIn()).toBeNull()
    expect(i.takeSettled()).toBe(false)
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
    expect(i.takeSettled()).toBe(true)
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

    // fix round 2: dragging a splitter is a stream of sizes, one a frame, and each asked for a FULL rebuild. A resize is a gesture
    // like a wheel turn: interacting (coarse) while the sizes keep coming, and one settle when they stop.
    it('a stream of sizes is one burst: interacting while they come and for WHEEL_SETTLE_MS after the last, then one settle', () => {
      const c = clock()
      const i = createInteraction(c.now)
      i.viewportChanged(800, 600)
      // the baseline is no gesture
      expect(i.isInteracting()).toBe(false)
      expect(i.settleIn()).toBeNull()
      for (let w = 790; w >= 700; w -= 10) {
        c.advance(16)
        expect(i.viewportChanged(w, 600)).toBe(true)
        expect(i.isInteracting()).toBe(true)
        // each size moves the settle back to a full WHEEL_SETTLE_MS from now
        expect(i.settleIn()).toBe(WHEEL_SETTLE_MS)
        expect(i.takeSettled()).toBe(false)
      }
      c.advance(WHEEL_SETTLE_MS - 1)
      expect(i.isInteracting()).toBe(true)
      expect(i.takeSettled()).toBe(false)
      c.advance(1)
      expect(i.isInteracting()).toBe(false)
      expect(i.takeSettled()).toBe(true)
      expect(i.takeSettled()).toBe(false)
      expect(i.settleIn()).toBeNull()
    })
    it('the size reported again unchanged (the observer firing for nothing) is no gesture', () => {
      const c = clock()
      const i = createInteraction(c.now)
      i.viewportChanged(800, 600)
      c.advance(1000)
      expect(i.viewportChanged(800, 600)).toBe(false)
      expect(i.isInteracting()).toBe(false)
      expect(i.settleIn()).toBeNull()
    })
    it('a resize and a wheel turn are one burst: the settle waits for the later of them', () => {
      const c = clock()
      const i = createInteraction(c.now)
      i.viewportChanged(800, 600)
      i.wheel()
      c.advance(100)
      i.viewportChanged(700, 600)
      c.advance(100)
      // 200 ms after the wheel, 100 after the resize
      expect(i.isInteracting()).toBe(true)
      expect(i.settleIn()).toBe(WHEEL_SETTLE_MS - 100)
      c.advance(WHEEL_SETTLE_MS - 100)
      expect(i.takeSettled()).toBe(true)
    })
    it('a canvas resized while the button is held moved the view: the pointer up still settles it', () => {
      const c = clock()
      const i = createInteraction(c.now)
      i.viewportChanged(800, 600)
      i.pointerDown()
      i.viewportChanged(700, 600)
      c.advance(WHEEL_SETTLE_MS)
      expect(i.takeSettled()).toBe(true)
      expect(i.pointerUp()).toBe(true)
    })
  })
})

describe('viewChangeAction', () => {
  const built = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }
  const shifted = (dx: number, scale = 1) => {
    const cx = dx
    const h = 10 * scale
    return { xMin: cx - h, xMax: cx + h, yMin: -h, yMax: h }
  }
  const act = (current: typeof built, over: Partial<{ built: typeof built | null; interacting: boolean; resized: boolean }> = {}) =>
    viewChangeAction({ built, current, interacting: true, resized: false, ...over })

  it('skips a small pan', () => expect(act(shifted(2))).toBe('skip'))
  it('rebuilds coarsely once a pan passes the overscan (25% of the span: 5 units)', () => {
    expect(act(shifted(5))).toBe('skip')
    expect(act(shifted(5.1))).toBe('coarse')
  })
  it('rebuilds coarsely at a 2x zoom in or out', () => {
    expect(act(shifted(0, 0.5))).toBe('coarse')
    expect(act(shifted(0, 2))).toBe('coarse')
  })
  it('skips a 1.4x zoom that stays inside the overscan', () => {
    expect(act(shifted(0, 1 / 1.4))).toBe('skip')
    expect(act(shifted(0, 1.2))).toBe('skip')
  })
  it('is full when not interacting, even for an unchanged view', () => expect(act(built, { interacting: false })).toBe('full'))
  it('is coarse after a resize, or with nothing built', () => {
    expect(act(built, { resized: true })).toBe('coarse')
    expect(act(built, { built: null })).toBe('coarse')
  })

  it('a scripted pan (60 steps of 5 px at 800 px over 20 units) rebuilds far less than every frame', () => {
    let t = 0
    const i = createInteraction(() => t)
    i.pointerDown()
    let b = built
    let rebuilds = 0
    let before = 0
    for (let step = 1; step <= 60; step++) {
      t += 16
      i.pointerMove()
      const dx = -(step * 5 * 20) / 800
      const current = shifted(dx)
      before++
      if (viewChangeAction({ built: b, current, interacting: i.isInteracting(), resized: false }) !== 'skip') {
        rebuilds++
        b = current
      }
    }
    // old behaviour: one rebuild per frame (60); now: one, when the pan passes the overscan
    expect(before).toBe(60)
    expect(rebuilds).toBe(1)
  })
})

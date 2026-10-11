import { describe, expect, it } from 'vitest'
import { GestureRecognizer, type Intent, type PointerKind, type PointerSample } from './input'
import {
  KEY_PAN_FRACTION,
  KEY_ZOOM_STEP,
  PINCH_WHEEL_SENSITIVITY,
  WHEEL_LINE_PX,
  WHEEL_PAGE_PX,
  WHEEL_SENSITIVITY,
} from './feel'

const SCREEN = { width: 800, height: 400 }

function make() {
  return new GestureRecognizer({ screen: () => SCREEN })
}

function ptr(id: number, x: number, y: number, t: number, kind: PointerKind = 'mouse', button = 0, shiftKey?: boolean): PointerSample {
  return shiftKey === undefined ? { id, x, y, t, kind, button } : { id, x, y, t, kind, button, shiftKey }
}

const kinds = (intents: Intent[]) => intents.map((i) => i.kind)

describe('click or drag', () => {
  it('a 3 px press and release is one click and no drag intents', () => {
    const g = make()
    const out = [
      ...g.pointerDown(ptr(1, 100, 100, 0)),
      ...g.pointerMove(ptr(1, 103, 100, 10)),
      ...g.pointerUp(ptr(1, 103, 100, 20)),
    ]
    expect(out).toEqual([{ kind: 'click', at: { x: 103, y: 100 }, pointer: 'mouse', additive: false, t: 20 }])
  })

  it('a 5 px move emits dragStart and a drag with dx = 5', () => {
    const g = make()
    g.pointerDown(ptr(1, 100, 100, 0))
    const out = g.pointerMove(ptr(1, 105, 100, 10))
    expect(out).toEqual([
      { kind: 'dragStart', t: 10 },
      { kind: 'drag', dx: 5, dy: 0, t: 10 },
    ])
  })

  it('the drag deltas sum to the displacement of the pointer, and the release is a dragEnd, not a click', () => {
    const g = make()
    g.pointerDown(ptr(1, 100, 100, 0))
    const path: Array<[number, number]> = [
      [102, 101],
      [106, 104],
      [120, 90],
      [140, 130],
      [133, 128],
    ]
    const all: Intent[] = []
    path.forEach(([x, y], i) => all.push(...g.pointerMove(ptr(1, x, y, 10 + i))))
    all.push(...g.pointerUp(ptr(1, 133, 128, 30)))
    let sx = 0
    let sy = 0
    for (const i of all) {
      if (i.kind === 'drag') {
        sx += i.dx
        sy += i.dy
      }
    }
    expect(sx).toBeCloseTo(33)
    expect(sy).toBeCloseTo(28)
    expect(kinds(all).filter((k) => k === 'dragStart')).toHaveLength(1)
    expect(all.at(-1)).toEqual({ kind: 'dragEnd', t: 30 })
    expect(kinds(all)).not.toContain('click')
  })

  it('a drag that returns near the start is still a drag, not a click', () => {
    const g = make()
    g.pointerDown(ptr(1, 100, 100, 0))
    g.pointerMove(ptr(1, 120, 100, 5))
    g.pointerMove(ptr(1, 101, 100, 10))
    expect(kinds(g.pointerUp(ptr(1, 101, 100, 15)))).toEqual(['dragEnd'])
  })

  it('only the primary mouse button acts; touch and pen always do', () => {
    const g = make()
    expect(g.pointerDown(ptr(1, 0, 0, 0, 'mouse', 2))).toEqual([])
    expect(g.pointerMove(ptr(1, 50, 0, 5, 'mouse', 2))).toEqual([])
    expect(g.pointerUp(ptr(1, 50, 0, 10, 'mouse', 2))).toEqual([])
    const t = make()
    t.pointerDown(ptr(2, 0, 0, 0, 'touch', 0))
    expect(kinds(t.pointerUp(ptr(2, 0, 0, 5, 'touch', 0)))).toEqual(['click'])
    const p = make()
    p.pointerDown(ptr(3, 0, 0, 0, 'pen', 0))
    expect(kinds(p.pointerUp(ptr(3, 0, 0, 5, 'pen', 0)))).toEqual(['click'])
  })

  it('a cancelled drag ends and a cancelled press clicks nothing', () => {
    const g = make()
    g.pointerDown(ptr(1, 0, 0, 0))
    g.pointerMove(ptr(1, 10, 0, 5))
    expect(kinds(g.pointerCancel(ptr(1, 10, 0, 6)))).toEqual(['dragEnd'])
    g.pointerDown(ptr(2, 0, 0, 20))
    expect(g.pointerCancel(ptr(2, 0, 0, 21))).toEqual([])
  })
})

describe('lost releases', () => {
  it('a lost release of an ignored (right-button) press does not corrupt the next left press or hover', () => {
    const g = make()
    expect(g.pointerDown(ptr(1, 100, 100, 0, 'mouse', 2))).toEqual([])
    // The right button's release never arrives; the same id presses with the left button.
    expect(g.pointerDown(ptr(1, 120, 100, 10))).toEqual([])
    expect(g.pointerUp(ptr(1, 120, 100, 20))).toEqual([{ kind: 'click', at: { x: 120, y: 100 }, pointer: 'mouse', additive: false, t: 20 }])
    // A buttonless move is a hover, not a drag, and hover works again.
    expect(g.pointerMove(ptr(1, 160, 100, 40))).toEqual([{ kind: 'hover', at: { x: 160, y: 100 }, pointer: 'mouse' }])
  })

  it('a pointerDown for an id already down (its release was lost) ends the old drag and starts afresh', () => {
    const g = make()
    g.pointerDown(ptr(1, 100, 100, 0))
    expect(kinds(g.pointerMove(ptr(1, 130, 100, 5)))).toEqual(['dragStart', 'drag'])
    // The release never arrived; the next press for the same id closes the drag first.
    expect(g.pointerDown(ptr(1, 200, 100, 50))).toEqual([{ kind: 'dragEnd', t: 50 }])
    // The new press is clean: released in place it is a click, with no drag.
    expect(g.pointerUp(ptr(1, 200, 100, 60))).toEqual([{ kind: 'click', at: { x: 200, y: 100 }, pointer: 'mouse', additive: false, t: 60 }])
  })
})

describe('shift + click', () => {
  it('a click is not additive unless shift is held at the release', () => {
    const g = make()
    g.pointerDown(ptr(1, 100, 100, 0))
    expect(g.pointerUp(ptr(1, 100, 100, 10, 'mouse', 0, false))).toEqual([
      { kind: 'click', at: { x: 100, y: 100 }, pointer: 'mouse', additive: false, t: 10 },
    ])
    g.pointerDown(ptr(1, 100, 100, 500))
    expect(g.pointerUp(ptr(1, 100, 100, 510))).toEqual([
      { kind: 'click', at: { x: 100, y: 100 }, pointer: 'mouse', additive: false, t: 510 },
    ])
  })

  it('a click released with shift held is additive, whatever it was at the press', () => {
    const g = make()
    g.pointerDown(ptr(1, 100, 100, 0, 'mouse', 0, false))
    expect(g.pointerUp(ptr(1, 100, 100, 10, 'mouse', 0, true))).toEqual([
      { kind: 'click', at: { x: 100, y: 100 }, pointer: 'mouse', additive: true, t: 10 },
    ])
  })

  it('a shift-drag still drags, and is no click', () => {
    const g = make()
    g.pointerDown(ptr(1, 100, 100, 0, 'mouse', 0, true))
    const out = [...g.pointerMove(ptr(1, 140, 100, 10, 'mouse', 0, true)), ...g.pointerUp(ptr(1, 140, 100, 20, 'mouse', 0, true))]
    expect(kinds(out)).toEqual(['dragStart', 'drag', 'dragEnd'])
  })

  it('two quick shift-clicks are two toggles, never a double-click reset', () => {
    const g = make()
    const shiftClick = (x: number, t: number) => [
      ...g.pointerDown(ptr(1, x, 100, t, 'mouse', 0, true)),
      ...g.pointerUp(ptr(1, x, 100, t + 10, 'mouse', 0, true)),
    ]
    expect(kinds(shiftClick(100, 0))).toEqual(['click'])
    expect(kinds(shiftClick(101, 100))).toEqual(['click'])
  })

  it('a shift-click does not pair with a plain click before it, nor after it', () => {
    const g = make()
    const click = (t: number, shiftKey: boolean) => [
      ...g.pointerDown(ptr(1, 100, 100, t, 'mouse', 0, shiftKey)),
      ...g.pointerUp(ptr(1, 100, 100, t + 10, 'mouse', 0, shiftKey)),
    ]
    expect(kinds(click(0, false))).toEqual(['click'])
    expect(kinds(click(100, true))).toEqual(['click'])
    expect(kinds(click(200, false))).toEqual(['click'])
  })
})

describe('double-click', () => {
  const click = (g: GestureRecognizer, x: number, y: number, t: number, id = 1) => [
    ...g.pointerDown(ptr(id, x, y, t)),
    ...g.pointerUp(ptr(id, x, y, t + 5)),
  ]

  it('two clicks 200 ms and 3 px apart: click, then click and reset', () => {
    const g = make()
    expect(kinds(click(g, 100, 100, 0))).toEqual(['click'])
    expect(kinds(click(g, 103, 100, 200))).toEqual(['click', 'reset'])
  })

  it('400 ms apart: no reset', () => {
    const g = make()
    click(g, 100, 100, 0)
    expect(kinds(click(g, 100, 100, 400))).toEqual(['click'])
  })

  it('10 px apart: no reset', () => {
    const g = make()
    click(g, 100, 100, 0)
    expect(kinds(click(g, 110, 100, 200))).toEqual(['click'])
  })

  it('a third click starts a new pair', () => {
    const g = make()
    click(g, 100, 100, 0)
    expect(kinds(click(g, 100, 100, 100))).toEqual(['click', 'reset'])
    expect(kinds(click(g, 100, 100, 200))).toEqual(['click'])
    expect(kinds(click(g, 100, 100, 300))).toEqual(['click', 'reset'])
  })

  it('a drag between two clicks breaks the pair', () => {
    const g = make()
    click(g, 100, 100, 0)
    g.pointerDown(ptr(1, 100, 100, 50))
    g.pointerMove(ptr(1, 150, 100, 60))
    g.pointerUp(ptr(1, 150, 100, 70))
    expect(kinds(click(g, 150, 100, 150))).toEqual(['click'])
  })
})

describe('two touches', () => {
  it('spreading from 100 px to 200 px apart gives one pinch with factor 2 at the midpoint', () => {
    const g = make()
    expect(g.pointerDown(ptr(1, 100, 100, 0, 'touch'))).toEqual([])
    expect(g.pointerDown(ptr(2, 200, 100, 1, 'touch'))).toEqual([])
    const out = g.pointerMove(ptr(2, 300, 100, 10, 'touch'))
    expect(out).toEqual([{ kind: 'pinch', at: { x: 200, y: 100 }, factor: 2, dx: 50, dy: 0, t: 10 }])
  })

  it('the second finger landing ends a drag in progress', () => {
    const g = make()
    g.pointerDown(ptr(1, 100, 100, 0, 'touch'))
    g.pointerMove(ptr(1, 120, 100, 5, 'touch'))
    expect(g.pointerDown(ptr(2, 200, 100, 8, 'touch'))).toEqual([{ kind: 'dragEnd', t: 8 }])
  })

  it('a pinch never clicks, however the fingers lift', () => {
    const g = make()
    g.pointerDown(ptr(1, 100, 100, 0, 'touch'))
    g.pointerDown(ptr(2, 200, 100, 1, 'touch'))
    const out = [...g.pointerUp(ptr(2, 200, 100, 5, 'touch')), ...g.pointerUp(ptr(1, 100, 100, 6, 'touch'))]
    expect(out).toEqual([])
  })

  it('lifting one touch then moving the other starts a fresh drag with no jump', () => {
    const g = make()
    g.pointerDown(ptr(1, 100, 100, 0, 'touch'))
    g.pointerDown(ptr(2, 200, 100, 1, 'touch'))
    g.pointerMove(ptr(2, 260, 100, 5, 'touch'))
    expect(g.pointerUp(ptr(1, 100, 100, 6, 'touch'))).toEqual([])
    const out = g.pointerMove(ptr(2, 262, 101, 10, 'touch'))
    expect(out).toEqual([
      { kind: 'dragStart', t: 10 },
      { kind: 'drag', dx: 2, dy: 1, t: 10 },
    ])
    expect(g.pointerMove(ptr(2, 270, 101, 15, 'touch'))).toEqual([{ kind: 'drag', dx: 8, dy: 0, t: 15 }])
    expect(g.pointerUp(ptr(2, 270, 101, 20, 'touch'))).toEqual([{ kind: 'dragEnd', t: 20 }])
  })

  it('a third finger is ignored', () => {
    const g = make()
    g.pointerDown(ptr(1, 100, 100, 0, 'touch'))
    g.pointerDown(ptr(2, 200, 100, 1, 'touch'))
    expect(g.pointerDown(ptr(3, 500, 500, 2, 'touch'))).toEqual([])
    expect(g.pointerMove(ptr(3, 600, 500, 3, 'touch'))).toEqual([])
    expect(g.pointerUp(ptr(3, 600, 500, 4, 'touch'))).toEqual([])
    expect(kinds(g.pointerMove(ptr(2, 300, 100, 5, 'touch')))).toEqual(['pinch'])
  })
})

describe('wheel', () => {
  const wheel = (deltaY: number, deltaMode: 0 | 1 | 2 = 0, ctrlKey = false) =>
    make().wheel({ x: 30, y: 40, deltaY, deltaMode, ctrlKey, t: 7 })

  it('deltaY 100 in pixels zooms by exp(-100 * sensitivity) at the pointer', () => {
    const [z] = wheel(100)
    expect(z.kind).toBe('zoom')
    if (z.kind !== 'zoom') return
    expect(z.at).toEqual({ x: 30, y: 40 })
    expect(z.t).toBe(7)
    expect(z.factor).toBeCloseTo(Math.exp(-100 * WHEEL_SENSITIVITY))
    expect(z.factor).toBeCloseTo(Math.exp(-0.15))
  })

  it('scrolling the other way zooms in', () => {
    const [z] = wheel(-100)
    expect(z.kind === 'zoom' && z.factor).toBeGreaterThan(1)
  })

  it('lines are 16 px each and pages are 400', () => {
    const [l] = wheel(3, 1)
    const [p] = wheel(1, 2)
    expect(l.kind === 'zoom' && l.factor).toBeCloseTo(Math.exp(-3 * WHEEL_LINE_PX * WHEEL_SENSITIVITY))
    expect(p.kind === 'zoom' && p.factor).toBeCloseTo(Math.exp(-WHEEL_PAGE_PX * WHEEL_SENSITIVITY))
  })

  it('ctrl uses the pinch sensitivity', () => {
    const [z] = wheel(10, 0, true)
    expect(z.kind === 'zoom' && z.factor).toBeCloseTo(Math.exp(-10 * PINCH_WHEEL_SENSITIVITY))
  })

  it('a wheel with no vertical delta emits nothing', () => {
    expect(wheel(0)).toEqual([])
  })
})

describe('hover', () => {
  it('a mouse or pen move with nothing down emits hover; leaving emits hover null', () => {
    const g = make()
    expect(g.pointerMove(ptr(1, 5, 6, 0, 'mouse'))).toEqual([{ kind: 'hover', at: { x: 5, y: 6 }, pointer: 'mouse' }])
    expect(g.pointerMove(ptr(2, 7, 8, 1, 'pen'))).toEqual([{ kind: 'hover', at: { x: 7, y: 8 }, pointer: 'pen' }])
    expect(g.pointerLeave('mouse')).toEqual([{ kind: 'hover', at: null, pointer: 'mouse' }])
  })

  it('touch moves never emit hover', () => {
    const g = make()
    expect(g.pointerMove(ptr(1, 5, 6, 0, 'touch'))).toEqual([])
    g.pointerDown(ptr(1, 5, 6, 1, 'touch'))
    expect(kinds(g.pointerMove(ptr(1, 5, 7, 2, 'touch')))).not.toContain('hover')
  })

  it('a mouse move with a button held emits no hover', () => {
    const g = make()
    g.pointerDown(ptr(1, 5, 6, 0))
    expect(kinds(g.pointerMove(ptr(1, 6, 6, 1)))).not.toContain('hover')
    expect(kinds(g.pointerMove(ptr(1, 30, 6, 2)))).not.toContain('hover')
  })

  it('a mouse move with a non-primary button held emits no hover either', () => {
    const g = make()
    g.pointerDown(ptr(1, 5, 6, 0, 'mouse', 2))
    expect(g.pointerMove(ptr(1, 9, 6, 1, 'mouse', 2))).toEqual([])
    g.pointerUp(ptr(1, 9, 6, 2, 'mouse', 2))
    expect(kinds(g.pointerMove(ptr(1, 9, 7, 3)))).toEqual(['hover'])
  })

  it('hover resumes after the button is released', () => {
    const g = make()
    g.pointerDown(ptr(1, 5, 6, 0))
    g.pointerUp(ptr(1, 5, 6, 1))
    expect(kinds(g.pointerMove(ptr(1, 9, 9, 2)))).toEqual(['hover'])
  })
})

describe('keys', () => {
  const key = (k: string) => make().key({ key: k, t: 3 })
  const centre = { x: SCREEN.width / 2, y: SCREEN.height / 2 }

  it('+ and = zoom in by the key step at the centre', () => {
    for (const k of ['+', '=']) {
      expect(key(k)).toEqual([{ kind: 'zoom', at: centre, factor: KEY_ZOOM_STEP, t: 3 }])
    }
  })

  it('- and _ zoom out by the key step at the centre', () => {
    for (const k of ['-', '_']) {
      expect(key(k)).toEqual([{ kind: 'zoom', at: centre, factor: 1 / KEY_ZOOM_STEP, t: 3 }])
    }
  })

  it('arrows pan by a fraction of the screen, the content moving against the arrow', () => {
    const fx = KEY_PAN_FRACTION * SCREEN.width
    const fy = KEY_PAN_FRACTION * SCREEN.height
    expect(key('ArrowLeft')).toEqual([{ kind: 'pan', dx: fx, dy: 0, t: 3 }])
    expect(key('ArrowRight')).toEqual([{ kind: 'pan', dx: -fx, dy: 0, t: 3 }])
    expect(key('ArrowUp')).toEqual([{ kind: 'pan', dx: 0, dy: fy, t: 3 }])
    expect(key('ArrowDown')).toEqual([{ kind: 'pan', dx: 0, dy: -fy, t: 3 }])
  })

  it('0 resets, Escape clears the selection, c and C toggle the coordinates', () => {
    expect(key('0')).toEqual([{ kind: 'reset', t: 3 }])
    expect(key('Escape')).toEqual([{ kind: 'clearSelection' }])
    expect(key('c')).toEqual([{ kind: 'toggleCoordinates' }])
    expect(key('C')).toEqual([{ kind: 'toggleCoordinates' }])
  })

  it('other keys emit nothing', () => {
    expect(key('x')).toEqual([])
    expect(key('Enter')).toEqual([])
  })

  it('the screen is read when the key is pressed, so a resize is honoured', () => {
    let size = { width: 100, height: 100 }
    const g = new GestureRecognizer({ screen: () => size })
    size = { width: 200, height: 60 }
    expect(g.key({ key: '+', t: 0 })).toEqual([{ kind: 'zoom', at: { x: 100, y: 30 }, factor: KEY_ZOOM_STEP, t: 0 }])
  })

  it('with no screen to act on, zoom and pan keys emit nothing but the rest still work', () => {
    const g = new GestureRecognizer()
    expect(g.key({ key: '+', t: 0 })).toEqual([])
    expect(g.key({ key: 'ArrowLeft', t: 0 })).toEqual([])
    expect(g.key({ key: '0', t: 0 })).toEqual([{ kind: 'reset', t: 0 }])
  })
})

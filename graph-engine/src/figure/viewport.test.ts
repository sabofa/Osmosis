import { describe, expect, it } from 'vitest'
import {
  clientToView,
  MAX_ZOOM,
  MIN_ZOOM,
  panView,
  parseViewBox,
  pixelsPerViewUnit,
  viewBoxAttribute,
  viewScale,
  wheelZoomFactor,
  zoomAbout,
  type ViewBox,
} from './viewport'

const FITTED: ViewBox = { x: -320, y: -240, width: 640, height: 480 }

// Where a point sits inside a view, as a fraction of it. Two views show the
// same point at the same place on screen exactly when these agree, which is
// what "the point stays put" means once the view has been rescaled.
function fractionOf(view: ViewBox, point: { x: number; y: number }) {
  return { x: (point.x - view.x) / view.width, y: (point.y - view.y) / view.height }
}

describe('parseViewBox', () => {
  it('reads the viewBox the renderer wrote', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -20 30 40" preserveAspectRatio="xMidYMid meet">'
    expect(parseViewBox(svg)).toEqual({ x: -10, y: -20, width: 30, height: 40 })
  })

  it('reads a fractional viewBox', () => {
    expect(parseViewBox('<svg viewBox="-1.5 2.25 3.5 4.75">')).toEqual({ x: -1.5, y: 2.25, width: 3.5, height: 4.75 })
  })

  it('is null for markup with no viewBox, rather than a box of NaNs', () => {
    expect(parseViewBox('<svg xmlns="http://www.w3.org/2000/svg">')).toBeNull()
    expect(parseViewBox('<svg viewBox="-10 -20 30">')).toBeNull()
    expect(parseViewBox('<svg viewBox="a b c d">')).toBeNull()
  })

  it('round-trips through the attribute it writes', () => {
    expect(parseViewBox(`<svg viewBox="${viewBoxAttribute(FITTED)}">`)).toEqual(FITTED)
  })
})

describe('panView', () => {
  it('translates the view without resizing it', () => {
    const panned = panView(FITTED, 40, -25)
    expect(panned.x).toBeCloseTo(FITTED.x + 40, 12)
    expect(panned.y).toBeCloseTo(FITTED.y - 25, 12)
    expect(panned.width).toBe(FITTED.width)
    expect(panned.height).toBe(FITTED.height)
  })

  it('leaves the view it was given alone', () => {
    const before = { ...FITTED }
    panView(FITTED, 10, 10)
    expect(FITTED).toEqual(before)
  })
})

describe('zoomAbout', () => {
  // The property that makes zooming feel right, and the one most often got
  // wrong: whatever is under the cursor has to stay under the cursor.
  it('holds the point it was given still', () => {
    const point = { x: 120, y: -60 }
    const zoomed = zoomAbout(FITTED, point, 2, FITTED)
    expect(fractionOf(zoomed, point).x).toBeCloseTo(fractionOf(FITTED, point).x, 12)
    expect(fractionOf(zoomed, point).y).toBeCloseTo(fractionOf(FITTED, point).y, 12)
  })

  it('holds a point that is nowhere near the centre', () => {
    const corner = { x: FITTED.x, y: FITTED.y }
    const zoomed = zoomAbout(FITTED, corner, 3.5, FITTED)
    expect(zoomed.x).toBeCloseTo(corner.x, 12)
    expect(zoomed.y).toBeCloseTo(corner.y, 12)
  })

  it('holds the point when zooming out as well as in', () => {
    const point = { x: -200, y: 130 }
    const zoomed = zoomAbout(FITTED, point, 0.5, FITTED)
    expect(fractionOf(zoomed, point).x).toBeCloseTo(fractionOf(FITTED, point).x, 12)
    expect(fractionOf(zoomed, point).y).toBeCloseTo(fractionOf(FITTED, point).y, 12)
  })

  it('holds the point across a chain of zooms about different places', () => {
    let view = FITTED
    view = zoomAbout(view, { x: 100, y: 100 }, 2, FITTED)
    view = zoomAbout(view, { x: -50, y: 0 }, 1.5, FITTED)
    const point = { x: 30, y: 40 }
    const before = fractionOf(view, point)
    const after = fractionOf(zoomAbout(view, point, 1.8, FITTED), point)
    expect(after.x).toBeCloseTo(before.x, 12)
    expect(after.y).toBeCloseTo(before.y, 12)
  })

  it('magnifies by the factor it was given, inside the limits', () => {
    expect(zoomAbout(FITTED, { x: 0, y: 0 }, 2, FITTED).width).toBeCloseTo(FITTED.width / 2, 12)
    expect(zoomAbout(FITTED, { x: 0, y: 0 }, 8, FITTED).width).toBeCloseTo(FITTED.width / 8, 12)
    // Pulling back stops at MIN_ZOOM, which is what asking for a quarter
    // runs into: the fitted view already shows the whole figure.
    expect(zoomAbout(FITTED, { x: 0, y: 0 }, 0.5, FITTED).width).toBeCloseTo(FITTED.width * 2, 12)
    expect(zoomAbout(FITTED, { x: 0, y: 0 }, 0.25, FITTED).width).toBeCloseTo(FITTED.width / MIN_ZOOM, 12)
  })

  it('keeps the aspect ratio, so a figure never stretches', () => {
    const zoomed = zoomAbout(FITTED, { x: 77, y: -13 }, 2.4, FITTED)
    expect(zoomed.width / zoomed.height).toBeCloseTo(FITTED.width / FITTED.height, 12)
  })

  it('clamps how far in it will go', () => {
    let view = FITTED
    for (let i = 0; i < 40; i++) view = zoomAbout(view, { x: 0, y: 0 }, 2, FITTED)
    expect(viewScale(FITTED, view)).toBeCloseTo(1 / MAX_ZOOM, 9)
  })

  it('clamps how far out it will go', () => {
    let view = FITTED
    for (let i = 0; i < 40; i++) view = zoomAbout(view, { x: 0, y: 0 }, 0.5, FITTED)
    expect(viewScale(FITTED, view)).toBeCloseTo(1 / MIN_ZOOM, 9)
  })

  it('still holds the point when the zoom is clamped', () => {
    // The case that makes the naive implementation wrong: the view is
    // rescaled by the *clamped* ratio, so the translation has to be computed
    // from that and not from the factor that was asked for.
    let view = FITTED
    for (let i = 0; i < 20; i++) view = zoomAbout(view, { x: 0, y: 0 }, 2, FITTED)
    const point = { x: view.x + view.width * 0.3, y: view.y + view.height * 0.8 }
    const clamped = zoomAbout(view, point, 4, FITTED)
    expect(fractionOf(clamped, point).x).toBeCloseTo(fractionOf(view, point).x, 9)
    expect(fractionOf(clamped, point).y).toBeCloseTo(fractionOf(view, point).y, 9)
  })
})

describe('wheelZoomFactor', () => {
  it('is 1 for no movement, so a stray event changes nothing', () => {
    expect(wheelZoomFactor(0)).toBe(1)
  })

  it('zooms in scrolling up and out scrolling down', () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1)
    expect(wheelZoomFactor(100)).toBeLessThan(1)
  })

  it('is symmetric, so a scroll and its opposite return to where they started', () => {
    expect(wheelZoomFactor(-120) * wheelZoomFactor(120)).toBeCloseTo(1, 12)
  })

  it('grows with the size of the movement', () => {
    expect(wheelZoomFactor(-200)).toBeGreaterThan(wheelZoomFactor(-100))
  })
})

describe('clientToView', () => {
  // The element is bigger than the view's aspect in one direction, so
  // "xMidYMid meet" letterboxes: the drawing is centred and there are bars
  // down two sides. Ignoring those is the classic off-by-a-margin bug.
  const element = { left: 50, top: 20, width: 800, height: 480 }

  it('maps the middle of the element to the middle of the view', () => {
    const middle = clientToView({ x: 50 + 400, y: 20 + 240 }, element, FITTED)
    expect(middle.x).toBeCloseTo(FITTED.x + FITTED.width / 2, 9)
    expect(middle.y).toBeCloseTo(FITTED.y + FITTED.height / 2, 9)
  })

  it('accounts for the letterbox rather than stretching to the element', () => {
    // 480/480 = 1 unit per pixel, so the 640-wide drawing occupies 640 of the
    // 800 pixels, with 80 pixels of bar on each side. The left edge of the
    // *drawing* is therefore 80 pixels in from the left edge of the element.
    const leftEdge = clientToView({ x: 50 + 80, y: 20 + 240 }, element, FITTED)
    expect(leftEdge.x).toBeCloseTo(FITTED.x, 9)
    // A click on the bar itself lands outside the drawing, which is the
    // honest answer rather than a clamped one.
    expect(clientToView({ x: 50, y: 20 + 240 }, element, FITTED).x).toBeLessThan(FITTED.x)
  })

  it('scales with the zoom, so the same pixel means a different place', () => {
    const zoomed = zoomAbout(FITTED, { x: 0, y: 0 }, 2, FITTED)
    const pixel = { x: 50 + 400 + 100, y: 20 + 240 }
    const before = clientToView(pixel, element, FITTED)
    const after = clientToView(pixel, element, zoomed)
    expect(Math.abs(after.x)).toBeLessThan(Math.abs(before.x))
  })

  it('reports the pixels a view unit is worth, for turning a drag into a pan', () => {
    expect(pixelsPerViewUnit(element, FITTED)).toBeCloseTo(1, 12)
    const zoomed = zoomAbout(FITTED, { x: 0, y: 0 }, 2, FITTED)
    expect(pixelsPerViewUnit(element, zoomed)).toBeCloseTo(2, 12)
  })

  it('survives an element with no size rather than dividing by zero', () => {
    const point = clientToView({ x: 0, y: 0 }, { left: 0, top: 0, width: 0, height: 0 }, FITTED)
    expect(Number.isFinite(point.x)).toBe(true)
    expect(Number.isFinite(point.y)).toBe(true)
  })
})

describe('viewScale', () => {
  // What a label has to be multiplied by to keep the same size on screen as
  // the view zooms. The figure grows; the text must not.
  it('is 1 at the fitted view', () => {
    expect(viewScale(FITTED, FITTED)).toBe(1)
  })

  it('shrinks the text in view units as the view magnifies', () => {
    const zoomed = zoomAbout(FITTED, { x: 0, y: 0 }, 4, FITTED)
    expect(viewScale(FITTED, zoomed)).toBeCloseTo(0.25, 12)
  })

  it('grows the text in view units as the view pulls back', () => {
    const pulled = zoomAbout(FITTED, { x: 0, y: 0 }, 0.5, FITTED)
    expect(viewScale(FITTED, pulled)).toBeCloseTo(2, 12)
  })

  it('does not change when the view is only panned', () => {
    expect(viewScale(FITTED, panView(FITTED, 300, -120))).toBeCloseTo(1, 12)
  })

  // A label written at 15 units in a view magnified 4x has to be written at
  // 3.75 units instead: 15 view units of a 4x view is four times the screen
  // size it was. This is the whole arithmetic of "labels keep their size".
  it('is exactly the factor that cancels the magnification', () => {
    const zoomed = zoomAbout(FITTED, { x: 0, y: 0 }, 4, FITTED)
    const onScreen = (size: number, view: ViewBox) => size / view.width
    expect(onScreen(15 * viewScale(FITTED, zoomed), zoomed)).toBeCloseTo(onScreen(15, FITTED), 12)
  })
})

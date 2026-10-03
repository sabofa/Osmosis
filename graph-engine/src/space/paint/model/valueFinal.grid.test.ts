import { describe, expect, it, vi } from 'vitest'
import { GRID_VIEWS, gridMargin, SEEDS, viewSignature } from './valueFinalFixture'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 600_000 })

// The value rule in the final picture of a sphere on a table (spec §12), at the defaults: the strokes after the planes, the plane
// steps, the brush-load mix and the gamut fit, the edge and line strokes, and the underpainting. (valueFinal.test.ts holds the parts;
// this holds the whole grid.)

describe('the final picture of a sphere on a table, at the defaults', () => {
  // Two views are one picture if they light the sphere the same way and the table too. The key light follows the camera in the model's own
  // view, so five cameras round one light-and-camera pair were five copies of one frame: the first grid's five azimuths.
  const distinct = (views: { opts: Parameters<typeof viewSignature>[0] }[]): boolean => {
    const sig = views.map((v) => viewSignature(v.opts))
    return sig.every((a, i) => sig.every((b, j) => i === j || Math.abs(a[0] - b[0]) >= 0.02 || Math.abs(a[1] - b[1]) >= 0.02))
  }

  it('is made of views that are different pictures: the default light, and five cameras each with its own light fixed in the world', () => {
    expect(GRID_VIEWS.length).toBe(6)
    expect(distinct(GRID_VIEWS)).toBe(true)
    // the five azimuths of the first grid (elevation 2, the light 30/5 following the camera) were not
    const old = [200, 20, 110, 290, 340].map((azimuth) => ({ opts: { azimuth, elevation: 2, lightAzimuth: 30, lightElevation: 5 } }))
    expect(distinct(old)).toBe(false)
  })

  it('has every shadow-family stroke darker than every half-tone stroke, and every shadow pixel of the underpainting darker than every half-tone pixel, by 0.05 and more (8 seeds x 6 views x 5 local colours)', () => {
    const r = gridMargin({}, SEEDS)
    // the five views with a terminator had both families to compare, in some frames of each (the sixth is lit all over: it is there for its outline)
    expect(r.comparedPerView.slice(0, 5).every((n) => n >= 8), String(r.comparedPerView)).toBe(true)
    expect(r.fewestShadow).toBeGreaterThanOrEqual(5)
    expect(r.fewestLight).toBeGreaterThanOrEqual(5)
    expect(r.fewestUnderShadow).toBeGreaterThanOrEqual(50)
    expect(r.fewestUnderLight).toBeGreaterThanOrEqual(50)
    // edge strokes and line strokes are in every frame: the shadow side's edges are held with the rest, and a line is no family at all
    expect(r.fewestEdgeShadow).toBeGreaterThanOrEqual(1)
    expect(r.fewestLines).toBeGreaterThan(10)
    expect(r.strokeMargin, r.strokeAt).toBeGreaterThanOrEqual(0.05)
    expect(r.underMargin, r.underAt).toBeGreaterThanOrEqual(0.05)
    // a bridge to the canvas on the lit side does not run into the shadow: it reaches no lower than a limb pixel's N·L (-0.134 in the view with the
    // light behind the camera, where the whole shadow is a sliver at the limb; -0.07 in the others)
    expect(r.canvasReach).toBeGreaterThanOrEqual(-0.14)
  })
})

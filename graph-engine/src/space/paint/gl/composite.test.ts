import { describe, expect, it } from 'vitest'
import { MOTTLE_SCALE, MOTTLE_SHIFT, MOTTLE_SIZE, MOTTLE_TURN, mottleCoord } from './composite'
import { COMPOSITE_FRAGMENT } from './shaders/composite'

describe('the canvas mottle: a second, turned copy so it does not repeat at the tile period', () => {
  it('reads the same place when the copy is the tile itself (no turn, scale 1, no shift): then weave + blur is the tile exactly', () => {
    expect(mottleCoord([0.3, 2.7], 0, 1, [0, 0])).toEqual([0.3, 2.7])
    expect(mottleCoord([-1.25, 0.5], 0, 1, [0, 0])).toEqual([-1.25, 0.5])
  })

  it('turns by 31 degrees, scales by 0.73 and shifts by (0.37, 0.61): one tile along reads (0.996, 0.986) (hand-computed)', () => {
    // cos 31 x 0.73 + 0.37 = 0.8572 x 0.73 + 0.37 = 0.9957; sin 31 x 0.73 + 0.61 = 0.5150 x 0.73 + 0.61 = 0.9860
    const q = mottleCoord([1, 0])
    expect(q[0]).toBeCloseTo(0.9957, 4)
    expect(q[1]).toBeCloseTo(0.986, 4)
    expect(mottleCoord([0, 0])).toEqual([MOTTLE_SHIFT[0], MOTTLE_SHIFT[1]])
    expect([MOTTLE_TURN, MOTTLE_SCALE, MOTTLE_SIZE]).toEqual([(31 * Math.PI) / 180, 0.73, 64])
  })

  it('does not repeat where the tile does: no whole number of tiles (within three) puts the mottle back on a lattice point', () => {
    // The weave repeats every tile, so the picture repeats when the mottle's coordinate moves by whole tiles too. The
    // copy's coordinate moves by 0.73 R (k, l) when the position moves k tiles across and l down: its distance to the nearest
    // whole tile is never under 0.17 for any k, l up to 3 (the nearest it comes within 3 is 0.177), so the mottle never lines up
    // with the weave's repeat there; the copy's own lattice is 1/0.73 = 1.37 tiles at its nearest.
    const origin = mottleCoord([0, 0])
    let nearest = Infinity
    for (let k = -3; k <= 3; k++) {
      for (let l = -3; l <= 3; l++) {
        if (k === 0 && l === 0) continue
        const q = mottleCoord([k, l])
        const dx = q[0] - origin[0]
        const dy = q[1] - origin[1]
        nearest = Math.min(nearest, Math.hypot(dx - Math.round(dx), dy - Math.round(dy)))
      }
    }
    expect(nearest).toBeGreaterThan(0.17)
    // and turned off (no turn, scale 1, no shift) it repeats at every tile, which is what the test would catch
    const same = mottleCoord([1, 0], 0, 1, [0, 0])
    expect(Math.hypot(same[0] - Math.round(same[0]), same[1] - Math.round(same[1]))).toBe(0)
  })

  it('is what the composite shader does: weave (the tile less its blur) plus the blur read at the copy', () => {
    const c = COMPOSITE_FRAGMENT
    expect(c).toContain('uniform sampler2D u_paperLow;')
    expect(c).toContain('vec3 paperColour(vec2 fragCoord)')
    expect(c).toContain('return tile - lowHere + texture(u_paperLow, q).rgb;')
    expect(c).toContain('vec2 q = vec2(u_mottle.x * p.x - u_mottle.y * p.y, u_mottle.y * p.x + u_mottle.x * p.y) * u_mottle.z + u_mottleShift;')
    expect(c).toContain('u_noCanvas ? u_flatTone : paperColour(gl_FragCoord.xy)')
  })
})

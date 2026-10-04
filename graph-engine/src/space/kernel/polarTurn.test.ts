import { describe, expect, it } from 'vitest'
import { parseSpec } from '../../parser/parseSpec'
import type { LineMark, SpaceScene } from '../scene/types'
import { createSpaceKernel } from './index'

// A polar curve's default range (no "for theta in [a, b]") is a full turn in the document's angle unit: 0 to 360
// under @angle: degrees, as the 2D engine draws it. Before, a lifted polar curve took the parser's radian default
// (2*pi) as degrees, and drew 6.28 degrees of the circle.

function sceneOf(spec: string): SpaceScene {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines).scene()
}

// The angle (degrees, 0..360) the polar circle's points sweep, from the first point.
function sweptDegrees(line: LineMark): number {
  const p = line.positions
  let most = 0
  const a0 = Math.atan2(p[1], p[0])
  for (let i = 0; i < p.length / 3; i++) {
    let d = ((Math.atan2(p[3 * i + 1], p[3 * i]) - a0) * 180) / Math.PI
    if (d < 0) d += 360
    most = Math.max(most, d)
  }
  return most
}

function polarLine(scene: SpaceScene): LineMark {
  const lines = scene.marks.filter((m): m is LineMark => m.kind === 'lines')
  expect(lines.length).toBeGreaterThan(0)
  return lines[0]
}

describe('a polar curve with the default range is a full turn in the angle unit', () => {
  it('under @angle: degrees, r = 1 draws the whole circle (0 to 360), not 2*pi degrees', () => {
    const line = polarLine(sceneOf('@angle: degrees\nr = 1\nz = x^2 + y^2 res: 8'))
    expect(sweptDegrees(line)).toBeGreaterThan(350)
    const p = line.positions
    const n = p.length / 3
    // closed: the last point is back at the first
    expect(Math.hypot(p[3 * (n - 1)] - p[0], p[3 * (n - 1) + 1] - p[1])).toBeLessThan(1e-6)
  })

  it('in radians (the default unit) the range is unchanged: 0 to 2*pi', () => {
    const line = polarLine(sceneOf('r = 1\nz = x^2 + y^2 res: 8'))
    expect(sweptDegrees(line)).toBeGreaterThan(350)
  })

  it('a written range is the author\'s, in degrees as written', () => {
    const line = polarLine(sceneOf('@angle: degrees\nr = 1 for theta in [0, 90]\nz = x^2 + y^2 res: 8'))
    const swept = sweptDegrees(line)
    expect(swept).toBeGreaterThan(85)
    expect(swept).toBeLessThan(95)
  })
})

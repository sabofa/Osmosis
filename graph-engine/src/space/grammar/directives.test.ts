import { describe, expect, it } from 'vitest'
import { defaultSpaceConfig, type Binding } from '../config'
import { parseSpaceDirective } from './directives'

function target() {
  return { space: defaultSpaceConfig(), bindings: [] as Binding[] }
}

function apply(key: string, value: string) {
  const t = target()
  expect(parseSpaceDirective(key, value, t)).toBe(true)
  return t
}

function refuse(key: string, value: string, message: RegExp) {
  expect(() => parseSpaceDirective(key, value, target())).toThrow(message)
}

describe('parseSpaceDirective: one valid and one invalid case per SP7 row', () => {
  it('leaves keys that are not space’s', () => {
    const t = target()
    expect(parseSpaceDirective('theme', 'dark', t)).toBe(false)
    expect(parseSpaceDirective('view', 'top', t)).toBe(false)
    expect(t).toEqual(target())
  })

  it('@bounds3d: any subset, any order, min < max', () => {
    expect(apply('bounds3d', 'z [0, 10], x [-3, 3], y [-2*pi, 2*pi]').space.bounds).toEqual({
      x: { min: -3, max: 3 },
      y: { min: -2 * Math.PI, max: 2 * Math.PI },
      z: { min: 0, max: 10 },
    })
    refuse('bounds3d', 'x [3, 3]', /less than/)
    refuse('bounds3d', 'w [0, 1]', /x, y or z/)
    refuse('bounds3d', 'x [0, 1], x [0, 2]', /twice/)
    refuse('bounds3d', 'x [0]', /\[a, b\]/)
  })

  it('@aspect: equal | auto | a:b:c with positive ratios', () => {
    expect(apply('aspect', 'equal').space.aspect).toEqual({ kind: 'equal' })
    expect(apply('aspect', 'auto').space.aspect).toEqual({ kind: 'auto' })
    expect(apply('aspect', '2:1:0.5').space.aspect).toEqual({ kind: 'ratio', x: 2, y: 1, z: 0.5 })
    refuse('aspect', '1:0:1', /positive/)
    refuse('aspect', 'square', /equal/)
  })

  it('@aspect: a:b is the 2D ratio; zero and negative are refused; the format message names both forms', () => {
    expect(apply('aspect', '2:1').space.aspect).toEqual({ kind: 'ratioXY', x: 2, y: 1 })
    expect(apply('aspect', '0.5 : 1').space.aspect).toEqual({ kind: 'ratioXY', x: 0.5, y: 1 })
    refuse('aspect', '2:0', /@aspect ratios must be positive/)
    refuse('aspect', '0:0', /@aspect ratios must be positive/)
    refuse('aspect', '-2:1', /@aspect ratios must be positive/)
    refuse('aspect', '-1:1:1', /@aspect ratios must be positive/)
    refuse('aspect', 'a:b', /@aspect must be/)
    refuse('aspect', '1:2:3:4', /two ratios "a:b" \(2D\) or three ratios "a:b:c" \(3D\), got "1:2:3:4"/)
    refuse('aspect', 'square', /@aspect must be "equal", "auto", two ratios "a:b" \(2D\) or three ratios "a:b:c" \(3D\), got "square"/)
  })

  it('@projection', () => {
    expect(apply('projection', 'orthographic').space.projection).toBe('orthographic')
    refuse('projection', 'fisheye', /orthographic/)
  })

  it('@camera: any subset; elevation within ±89.5; zoom positive', () => {
    expect(apply('camera', 'elevation 10, zoom 2').space.camera).toEqual({ azimuth: 40, elevation: 10, zoom: 2 })
    expect(apply('camera', 'azimuth 135, elevation -89.5').space.camera).toEqual({ azimuth: 135, elevation: -89.5, zoom: 1 })
    refuse('camera', 'elevation 90', /89\.5/)
    refuse('camera', 'zoom 0', /zoom/)
    refuse('camera', 'roll 5', /azimuth, elevation or zoom/)
  })

  it('@frame', () => {
    expect(apply('frame', 'none').space.frame).toBe('none')
    refuse('frame', 'grid', /box, axes or none/)
  })

  it('@ticks3d: pi multiples by structure, in each written form', () => {
    const forms: [string, { num: number; den: number }, number][] = [
      ['pi', { num: 1, den: 1 }, Math.PI],
      ['2*pi', { num: 2, den: 1 }, 2 * Math.PI],
      ['2pi', { num: 2, den: 1 }, 2 * Math.PI],
      ['pi/6', { num: 1, den: 6 }, Math.PI / 6],
      ['3*pi/4', { num: 3, den: 4 }, (3 * Math.PI) / 4],
      ['(1/2)*pi', { num: 1, den: 2 }, Math.PI / 2],
      ['2*pi/4', { num: 1, den: 2 }, Math.PI / 2],
    ]
    for (const [text, pi, value] of forms) {
      const tick = apply('ticks3d', `y ${text}`).space.ticks.y!
      expect(tick.pi).toEqual(pi)
      expect(tick.value).toBeCloseTo(value, 15)
    }
    // not a rational multiple of pi, by structure
    expect(apply('ticks3d', 'x 0.5*pi').space.ticks.x!.pi).toBeNull()
    expect(apply('ticks3d', 'x pi^2').space.ticks.x!.pi).toBeNull()
    refuse('ticks3d', 'x -1', /positive/)
    refuse('ticks3d', 'x 0', /positive/)
  })

  it('@titles', () => {
    expect(apply('titles', 'y "x (m)"').space.titles).toEqual({ x: 'x', y: 'x (m)', z: 'z' })
    refuse('titles', 'x t', /quoted/)
  })

  it('@colormap', () => {
    expect(apply('colormap', 'balance').space.colormap).toBe('balance')
    refuse('colormap', 'jet', /jet/)
  })

  it('@resolution: an integer from 8 to 400', () => {
    expect(apply('resolution', '8').space.resolution).toBe(8)
    refuse('resolution', '401', /8 to 400/)
    refuse('resolution', '12.5', /8 to 400/)
  })

  it('@depthcue', () => {
    expect(apply('depthcue', 'on').space.depthcue).toBe(true)
    refuse('depthcue', 'maybe', /on.*off/)
  })

  it('a later line replaces the whole directive (last value wins)', () => {
    const t = target()
    parseSpaceDirective('camera', 'elevation 10', t)
    parseSpaceDirective('camera', 'azimuth 0', t)
    expect(t.space.camera).toEqual({ azimuth: 0, elevation: 25, zoom: 1 })
  })
})

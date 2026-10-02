import { describe, expect, it } from 'vitest'
import { arrowReadout, curveReadout, graphReadout, implicitReadout, parametricReadout, pointReadout, readoutTitle } from './readout'

describe('readout rows (E7), formatted by E8', () => {
  it('graph: x, y, z, then the partials', () => {
    expect(graphReadout([0.3, -0.7, -0.4], 0.6, 1.4)).toEqual([
      { label: 'x', value: '0.3' },
      { label: 'y', value: '−0.7' },
      { label: 'z', value: '−0.4' },
      { label: '∂f/∂x', value: '0.6' },
      { label: '∂f/∂y', value: '1.4' },
    ])
  })

  it('parametric: the point, then the parameters under their own names', () => {
    expect(parametricReadout([1, 0, 0], ['theta', 'phi'], Math.PI / 2, 0).slice(3)).toEqual([
      { label: 'theta', value: '1.571' },
      { label: 'phi', value: '0' },
    ])
  })

  it('implicit: the point, then |grad F| (|(3, 4, 0)| = 5)', () => {
    expect(implicitReadout([1, 2, 3], [3, 4, 0]).at(-1)).toEqual({ label: '|∇F|', value: '5' })
  })

  it("curve: the point, t under its own name, and the speed |r'(t)|", () => {
    expect(curveReadout([1, 0, 0.25], 's', 1 / 3, [0, 3, 4]).slice(3)).toEqual([
      { label: 's', value: '0.3333' },
      { label: '|r′|', value: '5' },
    ])
    // A polyline with no parameter: the point alone.
    expect(curveReadout([1, 2, 3], null, null, null)).toHaveLength(3)
  })

  it('point: its label, then its coordinates; big and tiny numbers go scientific', () => {
    expect(pointReadout([123456, 0.000123456, -3], 'A')).toEqual([
      { label: 'point', value: 'A' },
      { label: 'x', value: '1.235×10⁵' },
      { label: 'y', value: '1.235×10⁻⁴' },
      { label: 'z', value: '−3' },
    ])
    expect(pointReadout([0, 0, 0], null)[0].label).toBe('x')
  })

  it('arrow: tail, components and magnitude (|(1, 2, 2)| = 3)', () => {
    expect(arrowReadout([0, -1, 0.5], [1, 2, 2])).toEqual([
      { label: 'tail', value: '(0, −1, 0.5)' },
      { label: 'vector', value: '⟨1, 2, 2⟩' },
      { label: '|v|', value: '3' },
    ])
  })
})

describe('readoutTitle', () => {
  const source = (statement: string | null) => ({ line: 4, statement, object: 's4' })

  it("is the statement's name when it has one", () => {
    expect(readoutTitle(source('surface'), 'z = x^2 name: surface')).toBe('surface')
  })

  it('is the source line trimmed to 40 characters otherwise, else "line N"', () => {
    expect(readoutTitle(source(null), '  z = x^2 - y^2  ')).toBe('z = x^2 - y^2')
    const long = 'z = sin(x) cos(y) + x^2 y^2 - 3 x y + 1 for x in [-2, 2], y in [-2, 2]'
    const title = readoutTitle(source(null), long)
    expect(title).toHaveLength(40)
    expect(title).toBe(`${long.slice(0, 39)}…`)
    expect(readoutTitle(source(null), null)).toBe('line 4')
  })
})

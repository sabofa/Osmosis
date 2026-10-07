import { describe, expect, it } from 'vitest'
import { DEFAULT_PAINT_PARAMS } from '../../space/paint/params'
import { resolveSettings, toPaintParams, type SettingsLayer } from '../layers'

// toPaintParams lives here, under settings/, because it is the one thing in style/ that reads
// the painter's parameters (style/boundary.test.ts: only style/settings/** may import from
// space/, and only space/paint/params), and so are its tests. The stack's own tests are
// style/layers.test.ts.

const SOFT = 'paint.value.terminatorSoftness'
const only = (path: string, value: number): SettingsLayer => ({ set: { [path]: value } })

describe('toPaintParams', () => {
  it('is the painter’s defaults for an empty stack, and a fresh object', () => {
    const params = toPaintParams(resolveSettings({}, 'space'))
    expect(params).toEqual(DEFAULT_PAINT_PARAMS)
    expect(params).not.toBe(DEFAULT_PAINT_PARAMS)
    expect(params.curves.value).not.toBe(DEFAULT_PAINT_PARAMS.curves.value)
  })

  it('carries a paint setting the stack changed, a number, a choice and a curve alike', () => {
    const resolved = resolveSettings(
      {
        theme: { all: { set: { [SOFT]: 0.3, 'paint.canvas.weave': 'duck' } } },
        document: { set: { 'paint.curves.value': [[0, 0], [0.5, 0.7], [1, 1]] } },
      },
      'space'
    )
    const params = toPaintParams(resolved)
    expect(params.value.terminatorSoftness).toBe(0.3)
    expect(params.canvas.weave).toBe('duck')
    expect(params.curves.value).toEqual([[0, 0], [0.5, 0.7], [1, 1]])
    // And nothing else.
    expect({ ...params, value: DEFAULT_PAINT_PARAMS.value, canvas: DEFAULT_PAINT_PARAMS.canvas, curves: DEFAULT_PAINT_PARAMS.curves }).toEqual(DEFAULT_PAINT_PARAMS)
    expect({ ...params.value, terminatorSoftness: DEFAULT_PAINT_PARAMS.value.terminatorSoftness }).toEqual(DEFAULT_PAINT_PARAMS.value)
  })

  it('does not share what it hands out with the stack or the defaults', () => {
    const curve = [[0, 0], [0.5, 0.7], [1, 1]]
    const resolved = resolveSettings({ document: { set: { 'paint.curves.value': curve } } }, 'space')
    const params = toPaintParams(resolved)
    params.curves.value[1][1] = 0.1
    params.value.terminatorSoftness = 0.9
    expect(curve[1][1]).toBe(0.7)
    expect(toPaintParams(resolved).curves.value[1][1]).toBe(0.7)
    expect(DEFAULT_PAINT_PARAMS.value.terminatorSoftness).toBe(0.1)
  })

  it('is untouched by a figure preset', () => {
    const params = toPaintParams(resolveSettings({ theme: { all: only(SOFT, 0.3) }, figure: { preset: 'ink' } }, 'space'))
    expect(params.value.terminatorSoftness).toBe(0.3)
  })
})

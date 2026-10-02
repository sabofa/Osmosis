import { describe, expect, it } from 'vitest'
import { LIGHT_PALETTE } from '../../render/palette'
import { colormapTable, tableEntry } from '../colormaps'
import type { ColorScale } from '../scene/types'
import { FakeDocument } from '../testing/fakeDom'
import { meshMark, scene } from '../testing/marks'
import { cssRgb, spaceColors } from '../theme'
import { Colorbars } from './colorbar'
import { colorbarModel, colorbarScales, stopEntry } from './colorbarModel'

const LIGHT = spaceColors(LIGHT_PALETTE, 'light')

function scale(patch: Partial<ColorScale> = {}): ColorScale {
  return { id: 0, title: 'height', map: 'viridis', domain: { min: 0, max: 10 }, diverging: false, ...patch }
}

describe('colorbarModel', () => {
  it('samples 16 stops from the table: the first is entry 0 and the last entry 255', () => {
    const table = colormapTable('viridis', LIGHT)
    const model = colorbarModel(scale(), table)
    expect(model.stops).toHaveLength(16)
    expect(model.stops[0]).toBe(cssRgb(tableEntry(table, 0)))
    expect(model.stops[15]).toBe(cssRgb(tableEntry(table, 255)))
    // Stop k is entry round(255 k / 15) = 17 k.
    expect(stopEntry(1)).toBe(17)
    expect(model.stops[1]).toBe(cssRgb(tableEntry(table, 17)))
    expect(model.gradient.startsWith('linear-gradient(to top, ')).toBe(true)
    expect(model.gradient).toContain(`${model.stops[15]} 100.00%`)
  })

  it('ticks the domain on the 1-2-5 ladder aiming for 5 intervals, at their normalised positions', () => {
    const model = colorbarModel(scale({ title: 'x*y' }), colormapTable('viridis', LIGHT))
    expect(model.title).toBe('x*y')
    // span 10 / 5 = 2: 0, 2, 4, 6, 8, 10.
    expect(model.ticks.map((t) => [t.text, t.position])).toEqual([
      ['0', 0],
      ['2', 0.2],
      ['4', 0.4],
      ['6', 0.6],
      ['8', 0.8],
      ['10', 1],
    ])
  })

  it("marks a diverging scale's zero, and never a sequential scale's", () => {
    // [-3, 3], step niceStep(6, 5) = 1: zero is on the ladder and is marked.
    const on = colorbarModel(scale({ map: 'balance', domain: { min: -3, max: 3 }, diverging: true }), colormapTable('balance', LIGHT))
    expect(on.ticks.filter((t) => t.zero).map((t) => [t.text, t.position])).toEqual([['0', 0.5]])
    expect(on.ticks.find((t) => t.text === '−3')?.position).toBe(0)
    const seq = colorbarModel(scale({ domain: { min: -1, max: 1 } }), colormapTable('viridis', LIGHT))
    expect(seq.ticks.some((t) => t.zero)).toBe(false)
  })
})

describe('colorbarScales', () => {
  const mesh = (colorScale: number | null) => meshMark([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 0, 1, 0, 0, 1, 0, 0, 1], [0, 1, 2], { style: { colorScale } })
  const scales = [0, 1, 2, 3].map((id) => scale({ id, title: `s${id}` }))

  it('shows only referenced scales, in scene order, at most two, and counts the rest', () => {
    // Scale 1 is referenced by no mesh.
    const s = { ...scene([mesh(0), mesh(2), mesh(3), mesh(null)]), colorScales: scales }
    const { shown, hidden } = colorbarScales(s)
    expect(shown.map((x) => x.title)).toEqual(['s0', 's2'])
    expect(hidden).toBe(1)
  })

  it('shows nothing for a scene with no referenced scale', () => {
    expect(colorbarScales({ ...scene([mesh(null)]), colorScales: scales })).toEqual({ shown: [], hidden: 0 })
  })
})

describe('Colorbars (DOM)', () => {
  it('draws a block per model, title above a strip with its ticks, and replaces them on update', () => {
    const doc = new FakeDocument()
    const overlay = doc.createElement('div')
    const bars = new Colorbars(overlay as unknown as HTMLElement)
    const table = colormapTable('balance', LIGHT)
    const model = colorbarModel(scale({ title: 'x*y', map: 'balance', domain: { min: -3, max: 3 }, diverging: true }), table)
    bars.update([model, model])
    expect(bars.count).toBe(2)
    const root = overlay.children[0]
    expect(root.className).toBe('space-colorbars')
    const [title, body] = root.children[0].children
    expect(title.textContent).toBe('x*y')
    const [strip, ...ticks] = body.children
    expect(strip.style.background).toBe(model.gradient)
    expect(ticks.map((t) => [t.textContent, t.style.bottom, t.dataset.zero ?? null])).toContainEqual(['0', '50.00%', 'true'])
    bars.update([model])
    expect(root.children).toHaveLength(1)
    bars.dispose()
    expect(overlay.children).toHaveLength(0)
  })
})

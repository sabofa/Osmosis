import { describe, expect, it } from 'vitest'
import { DARK_PALETTE, LIGHT_PALETTE } from '../../../render/palette'
import { srgbToOklab } from '../../oklab'
import type { Mark, SpaceScene, SurfacePick } from '../../scene/types'
import { hexToRgb, SPACE_SERIES } from '../../theme'
import { DEFAULT_PAINT_PARAMS } from '../params'
import { makeSceneColours, paramsForSave, subjectColour, switchTheme, themeBaseTone } from '../../../../../review/src/paintLabColours'

const near = (a: readonly number[], b: readonly number[], digits = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits))

// A real surface has a pick; a construction plane (a tangent plane, a slice) has none.
const PICK: SurfacePick = { kind: 'graph', f: () => 0, fx: () => 0, fy: () => 0 }

describe('themeBaseTone', () => {
  it('is the palette background in OKLab', () => {
    near(themeBaseTone('light'), srgbToOklab(hexToRgb(LIGHT_PALETTE.background)))
    near(themeBaseTone('dark'), srgbToOklab(hexToRgb(DARK_PALETTE.background)))
    // The warm paper is bright and the dark theme is near-black (palette.ts: dark L ~ 0.23).
    expect(themeBaseTone('light')[0]).toBeGreaterThan(0.96)
    expect(themeBaseTone('dark')[0]).toBeGreaterThan(0.2)
    expect(themeBaseTone('dark')[0]).toBeLessThan(0.27)
  })
})

describe('switchTheme', () => {
  const none = { light: null, dark: null }

  it('moves the canvas tone to the new theme\'s base and remembers the one it left', () => {
    const toDark = switchTheme(DEFAULT_PAINT_PARAMS, none, 'light', 'dark')
    expect(toDark.params.canvas.tone).toEqual(themeBaseTone('dark'))
    expect(toDark.tones.light).toEqual([0.93, 0.004, 0.022])
  })

  it('round-trips the tuned light tone exactly, and changes nothing else', () => {
    const toDark = switchTheme(DEFAULT_PAINT_PARAMS, none, 'light', 'dark')
    const back = switchTheme(toDark.params, toDark.tones, 'dark', 'light')
    expect(back.params).toEqual(DEFAULT_PAINT_PARAMS)
  })

  it('remembers a dark tone that was adjusted by hand', () => {
    const toDark = switchTheme(DEFAULT_PAINT_PARAMS, none, 'light', 'dark')
    const edited = { ...toDark.params, canvas: { ...toDark.params.canvas, tone: [0.3, 0.01, 0.02] as [number, number, number] } }
    const light = switchTheme(edited, toDark.tones, 'dark', 'light')
    const dark = switchTheme(light.params, light.tones, 'light', 'dark')
    expect(dark.params.canvas.tone).toEqual([0.3, 0.01, 0.02])
  })

  it('is the identity when the theme does not change', () => {
    const same = switchTheme(DEFAULT_PAINT_PARAMS, none, 'light', 'light')
    expect(same.params).toBe(DEFAULT_PAINT_PARAMS)
  })
})

describe('paramsForSave', () => {
  it('saves the light paper tone whichever theme is showing, since the tuning holds one tone', () => {
    const toDark = switchTheme(DEFAULT_PAINT_PARAMS, { light: null, dark: null }, 'light', 'dark')
    const saved = paramsForSave(toDark.params, 'dark', toDark.tones)
    expect(saved.canvas.tone).toEqual([0.93, 0.004, 0.022])
    expect(saved.light).toEqual(toDark.params.light)
  })

  it('leaves the light theme\'s params as they are', () => {
    const tones = { light: null, dark: null }
    expect(paramsForSave(DEFAULT_PAINT_PARAMS, 'light', tones)).toBe(DEFAULT_PAINT_PARAMS)
  })
})

describe('makeSceneColours', () => {
  const source = { line: 1, statement: null, object: 's1' }
  const mesh = (author: string | null, slot: number, statement: string | null, colorScale: number | null, pick: SurfacePick | null = PICK): Mark => ({
    kind: 'mesh',
    source: { ...source, statement },
    positions: new Float64Array(9), normals: new Float64Array(9), indices: new Uint32Array([0, 1, 2]), scalars: null, uv: null,
    style: { color: { author, slot }, opacity: 1, colorScale, meshLines: null }, pick,
  })
  const scene: SpaceScene = {
    marks: [
      mesh('#ff0000', 0, 'ball', null),
      mesh(null, 1, null, null),
      mesh('#a39c88', 0, 'table', null),
      mesh(null, 0, 'surface', 0),
      mesh('#00aaff', 0, null, null, null), // a construction plane
      { kind: 'points', source, positions: new Float64Array(3), style: { color: { author: '#00ff00', slot: 0 }, size: 6, shape: 'dot' } },
    ],
    labels: [],
    colorScales: [{ id: 0, title: 'height', map: 'gray', domain: { min: 0, max: 1 }, diverging: false }],
    extent: null, boxSpanning: { x: false, y: false, z: false }, errors: [],
  }

  it('resolves a mark\'s own colour from the theme: an author colour wins, else its slot of the series', () => {
    const colours = makeSceneColours(scene, 'light', null)
    // sRGB red in OKLab (Ottosson): L 0.62796, a 0.22486, b 0.12585.
    near(colours.markColour(0), [0.62796, 0.22486, 0.12585], 4)
    near(colours.markColour(1), srgbToOklab(hexToRgb(SPACE_SERIES.light[0])))
    near(makeSceneColours(scene, 'dark', null).markColour(1), srgbToOklab(hexToRgb(SPACE_SERIES.dark[0])))
  })

  it('a local-colour override recolours real flat surfaces, but not the table, a colormapped surface, a construction plane or a data mark', () => {
    const local: [number, number, number] = [0.56, 0.1, 0.08]
    const colours = makeSceneColours(scene, 'light', local)
    expect(colours.markColour(0)).toEqual(local)
    expect(colours.markColour(1)).toEqual(local)
    near(colours.markColour(2), srgbToOklab(hexToRgb(0xa39c88)), 6) // table
    near(colours.markColour(3), makeSceneColours(scene, 'light', null).markColour(3), 9) // colormapped
    near(colours.markColour(4), srgbToOklab(hexToRgb(0x00aaff)), 6) // a construction plane has no pick
    near(colours.markColour(5), srgbToOklab([0, 1, 0]), 6) // a point is data
  })

  it('maps a scale value through the theme\'s colormap table, in OKLab', () => {
    const colours = makeSceneColours(scene, 'light', null)
    // The gray map runs #1a1a1a (26/255) to #f2f2f2 (242/255); a grey's OKLab L is the cube root of its linear value.
    const L = (byte: number) => Math.cbrt(((byte / 255 + 0.055) / 1.055) ** 2.4)
    const low = colours.scaleColour(0, 0)!
    const high = colours.scaleColour(0, 1)!
    expect(low[0]).toBeCloseTo(L(26), 5)
    expect(high[0]).toBeCloseTo(L(242), 5)
    expect(Math.abs(low[1]) + Math.abs(low[2])).toBeLessThan(1e-4)
  })

  it('has no colour for a scale that does not exist, and the grid colour for no data', () => {
    const colours = makeSceneColours(scene, 'light', null)
    expect(colours.scaleColour(7, 0.5)).toBeNull()
    near(colours.scaleColour(0, Number.NaN)!, srgbToOklab(hexToRgb(LIGHT_PALETTE.grid)), 6)
  })
})

describe('subjectColour', () => {
  it('is the first flat surface that is not the table, else the painter\'s terracotta', () => {
    const source = { line: 1, statement: null, object: 's1' }
    const flat = (author: string, statement: string | null): Mark => ({
      kind: 'mesh', source: { ...source, statement }, positions: new Float64Array(9), normals: new Float64Array(9),
      indices: new Uint32Array([0, 1, 2]), scalars: null, uv: null,
      style: { color: { author, slot: 0 }, opacity: 1, colorScale: null, meshLines: null }, pick: PICK,
    })
    const scene: SpaceScene = {
      marks: [flat('#a39c88', 'table'), flat('#b7603a', 'sphere')],
      labels: [], colorScales: [], extent: null, boxSpanning: { x: false, y: false, z: false }, errors: [],
    }
    near(subjectColour(scene, makeSceneColours(scene, 'light', null)), srgbToOklab(hexToRgb(0xb7603a)), 6)
    const empty = { ...scene, marks: [] }
    const [L, a, b] = subjectColour(empty, makeSceneColours(empty, 'light', null))
    // Terracotta: L 0.56, C 0.14, h 38 deg (the spec's reference colour).
    expect(L).toBeCloseTo(0.56, 9)
    expect(Math.hypot(a, b)).toBeCloseTo(0.14, 9)
    expect((Math.atan2(b, a) * 180) / Math.PI).toBeCloseTo(38, 9)
  })
})

// How the lab colours a scene for the painter, and how the canvas tone follows
// the theme. Pure, so the graph-engine suite can test it
// (graph-engine/src/space/paint/lab/colours.test.ts).
//
// A mark's local colour is what space would draw it in (an author colour, else
// its slot of the theme's series) as OKLab; a colormapped surface's is the
// colormap table at the scalar. The lab can also paint every real surface in
// one local colour, to see the lighting curve on any colour: a data mark
// (point, curve, arrow), a construction plane and a colormapped surface are
// never recoloured, and neither is a statement named `table`.

import { resolvePalette } from '../../graph-engine/src/render/palette'
import { colormapTable, colorOf } from '../../graph-engine/src/space/colormaps'
import { oklabToSrgb, srgbToOklab } from '../../graph-engine/src/space/oklab'
import type { PaintParams } from '../../graph-engine/src/space/paint/params'
import type { Oklab, SceneColours } from '../../graph-engine/src/space/paint/types'
import type { MeshMark, SpaceScene } from '../../graph-engine/src/space/scene/types'
import { hexToRgb, resolveSpaceColor, spaceColors } from '../../graph-engine/src/space/theme'

export type Theme = 'light' | 'dark'

const toOklab = (lab: readonly [number, number, number]): Oklab => [lab[0], lab[1], lab[2]]

// The painter's reference local colour (spec §3.4 tests): terracotta, L 0.56, C 0.14, h 38 deg.
const TERRACOTTA: Oklab = [0.56, 0.14 * Math.cos((38 * Math.PI) / 180), 0.14 * Math.sin((38 * Math.PI) / 180)]

// The canvas tone a theme starts from: its palette background, in OKLab.
export function themeBaseTone(theme: Theme): Oklab {
  return toOklab(srgbToOklab(hexToRgb(resolvePalette(theme).background)))
}

// The canvas tone each theme was last left at (null: never visited), so
// flipping the theme and flipping back changes nothing Ben tuned.
export interface Tones {
  light: Oklab | null
  dark: Oklab | null
}

// The params and tone memory after the theme changes: the tone of the theme
// being left is remembered, and the new theme's remembered tone (or its base)
// becomes the canvas tone. Nothing else changes.
export function switchTheme(params: PaintParams, tones: Tones, from: Theme, to: Theme): { params: PaintParams; tones: Tones } {
  if (from === to) return { params, tones }
  const remembered: Tones = { ...tones, [from]: params.canvas.tone }
  const tone = remembered[to] ?? themeBaseTone(to)
  return { params: { ...params, canvas: { ...params.canvas, tone: [tone[0], tone[1], tone[2]] } }, tones: remembered }
}

// What "Save as defaults" writes. tuning.json holds one canvas tone, and M2
// takes the tone from the theme, so it holds the light paper's: saving while
// the dark theme shows must not leave a near-black canvas as the shipping tone.
export function paramsForSave(params: PaintParams, theme: Theme, tones: Tones): PaintParams {
  if (theme === 'light') return params
  const tone = tones.light ?? params.canvas.tone
  return { ...params, canvas: { ...params.canvas, tone: [tone[0], tone[1], tone[2]] } }
}

// A real surface the local-colour override may recolour: a mesh with a pick
// (a z = f, parametric or implicit surface; construction planes have none),
// one flat colour, and not the table.
function isSubject(mark: SpaceScene['marks'][number]): mark is MeshMark {
  return mark.kind === 'mesh' && mark.pick !== null && mark.style.colorScale === null && mark.source.statement !== 'table'
}

export function makeSceneColours(scene: SpaceScene, theme: Theme, local: Oklab | null): SceneColours {
  const palette = resolvePalette(theme)
  const colours = spaceColors(palette, theme)
  return {
    markColour(markIndex) {
      const mark = scene.marks[markIndex]
      if (!mark) return TERRACOTTA
      if (local && isSubject(mark)) return toOklab(local)
      return toOklab(srgbToOklab(resolveSpaceColor(mark.style.color, palette, theme)))
    },
    scaleColour(scaleId, v) {
      const scale = scene.colorScales[scaleId]
      if (!scale) return null
      const table = colormapTable(scale.map, { theme, background: colours.background })
      return toOklab(srgbToOklab(colorOf(v, scale, table, colours.grid)))
    },
  }
}

// The colour the lighting-curve chart is drawn for: the first real surface's
// (the override, when it is on), else the reference terracotta.
export function subjectColour(scene: SpaceScene, colours: SceneColours): Oklab {
  const index = scene.marks.findIndex(isSubject)
  return index < 0 ? TERRACOTTA : colours.markColour(index)
}

// '#rrggbb' to OKLab, for the colour input. Null for anything else.
export function hexToOklab(hex: string): Oklab | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  return m ? toOklab(srgbToOklab(hexToRgb(Number.parseInt(m[1], 16)))) : null
}

// OKLab to '#rrggbb' (clamped to sRGB), for swatches.
export function oklabToHex(lab: readonly number[]): string {
  const [r, g, b] = oklabToSrgb([lab[0], lab[1], lab[2]])
  const h = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}


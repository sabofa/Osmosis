import { EXAMPLES } from '../examples'
import { parseSpec } from '../parser/parseSpec'
import { DARK_PALETTE, LIGHT_PALETTE } from '../render/palette'
import { renderFigure } from './render'

// What presetGolden.json pins: the looks the media changed (ink, pencil, marker), each on three
// figure examples in the two palettes. Shared by the test and by scripts/preset-golden.ts.

export const PRESET_GOLDEN_PRESETS = ['ink', 'pencil', 'marker'] as const
// A construction with a givens table, dashed lines and marks; a region with a hole, for the fills;
// and a solid with hidden edges and a section.
export const PRESET_GOLDEN_EXAMPLES = ['Givens table', 'Square minus its circle', 'Cube: the hexagonal section'] as const

export const presetGoldenKey = (preset: string, example: string, theme: 'light' | 'dark') => `${preset} | ${example} | ${theme}`

export function renderPresetGolden(preset: string, example: string, theme: 'light' | 'dark'): string {
  const found = EXAMPLES.find((e) => e.label === example)
  if (!found) throw new Error(`No example "${example}"`)
  const parsed = parseSpec(`@style: ${preset}\n${found.spec}`)
  return renderFigure(parsed.statements, parsed.config, theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE).svg
}

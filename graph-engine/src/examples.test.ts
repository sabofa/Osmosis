import { describe, expect, it } from 'vitest'
import { EXAMPLES } from './examples'
import { parseSpec } from './parser/parseSpec'
import { renderFigure } from './figure/render'
import { buildScene } from './scene/buildScene'
import { buildTable } from './scene/buildTable'
import { resolvePanels } from './scene/mode'
import { LIGHT_PALETTE } from './render/palette'

// Every example is a button in the review harness, and a button that does not
// work is a defect the user meets on their first click. Three phases of
// geometry shipped with no example exposing any of it, and the engine was
// reported as broken because the features could not be found — so this file
// exists to make a dead example button impossible to ship.

const BOUNDS = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }

describe('review harness examples', () => {
  it('has examples with unique labels', () => {
    const labels = EXAMPLES.map((e) => e.label)
    expect(labels.length).toBeGreaterThan(20)
    expect(new Set(labels).size).toBe(labels.length)
  })

  for (const example of EXAMPLES) {
    describe(example.label, () => {
      const parsed = parseSpec(example.spec)

      it('parses with no errors', () => {
        expect(parsed.errors.map((e) => `line ${e.line}: ${e.message}`)).toEqual([])
      })

      it('puts something on screen', () => {
        const panels = resolvePanels(parsed.statements, parsed.config)
        expect(panels.drawable !== null || panels.table).toBe(true)

        if (panels.table) {
          // A table panel with no rows would render an empty frame.
          const tables = buildTable(parsed.statements, parsed.config)
          expect(tables.length).toBeGreaterThan(0)
        }

        if (panels.drawable === 'figure') {
          const result = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
          expect(result.errors.map((e) => e.message)).toEqual([])
          // The paper rect is always emitted, so counting elements alone
          // would pass for an empty figure. Count only drawn content.
          const drawn = (result.svg.match(/<(circle|line|path|polyline|polygon|text)\b/g) ?? []).length
          expect(drawn).toBeGreaterThan(0)
        }

        if (panels.drawable === 'graph') {
          const scene = buildScene(parsed.statements, BOUNDS, parsed.config)
          expect(scene.errors.map((e) => e.message)).toEqual([])
          expect(scene.objects.length).toBeGreaterThan(0)
        }
      })
    })
  }
})

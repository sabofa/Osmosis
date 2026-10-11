import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../examples'
import { parseSpec } from '../parser/parseSpec'
import { DARK_PALETTE, LIGHT_PALETTE } from '../render/palette'
import GOLDEN from './cleanGolden.json'
import { renderFigure } from './render'

// The clean figure is today's output, byte for byte (figure styles, rule 1).
//
// cleanGolden.json holds the sha256 (first 20 hex digits) of every figure
// example's SVG — as written, and under the isometric and front views, in the
// light theme, and as written in the dark — computed by the code at 1951e6a,
// the commit before figure styles existed. A change to anything a clean
// figure draws turns this red; regenerate it only for a change to clean
// that is meant (and say so in the commit).
//
// The full before/after sweep (every spec string in the suite × every view,
// ~20k renders) stays a scratch harness; this is its committed guard.

const golden = GOLDEN as Record<string, string>

async function sha(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20)
}

describe('clean figures are byte-identical to before styles', () => {
  it('guards every figure example of the base commit', () => {
    expect(Object.keys(golden).length).toBe(288)
  })

  const byExample = new Map<string, string[]>()
  for (const key of Object.keys(golden)) {
    const label = key.split(' | ')[0]
    byExample.set(label, [...(byExample.get(label) ?? []), key])
  }

  for (const [label, keys] of byExample) {
    it(label, async () => {
      const example = EXAMPLES.find((e) => e.label === label)
      expect(example, `the example "${label}" still exists`).toBeDefined()
      const parsed = parseSpec(example!.spec)
      for (const key of keys) {
        const [, view, theme] = key.split(' | ')
        const config = { ...parsed.config, view: view === 'as written' ? parsed.config.view : (view as typeof parsed.config.view) }
        const svg = renderFigure(parsed.statements, config, theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE).svg
        expect(await sha(svg), key).toBe(golden[key])
      }
    })
  }
})

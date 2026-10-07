import { describe, expect, it } from 'vitest'
import GOLDEN from './presetGolden.json'
import { PRESET_GOLDEN_EXAMPLES, PRESET_GOLDEN_PRESETS, presetGoldenKey, renderPresetGolden } from './presetGolden.testkit'

// The ink, pencil and marker presets, pinned on three figure examples in the light and the dark
// palette: the sha256 (first 20 hex digits) of each SVG, so that any change to what those looks
// draw turns this red. Unlike cleanGolden.json this one MAY move, on purpose: when a look is
// meant to change, regenerate it (scripts/preset-golden.ts) in the same commit and say why.
//
// History: first pinned at ebd7fc3 (light and dark were byte-equal then: the paper decided the
// palette). Re-pinned on purpose when the presets took their colours from their medium, so they
// follow the theme: the colours move, and a dark theme is no longer the light figure. Re-pinned
// again, the pencil's and the marker's twelve, when a medium's opacity came to REPLACE the line
// type's own factor instead of multiplying it (their strokes are laid at the medium's strength),
// and the marker's lines became a near-black (and near-white in a dark theme), and a marker no longer
// multiplies its strokes over a dark page, where a light stroke would vanish. Re-pinned a third time (Task 5,
// fix round 1): a medium drops the figure's 0.6 fade on hidden and auxiliary lines (ink's givens table and cube
// section, which have dashed lines, and every pencil and marker one), and the pencil and the marker leave their
// line opacity at 1 (the medium carries their 0.85). Ink's square minus its circle has no auxiliary line and held.

const golden = GOLDEN as Record<string, string>

async function sha(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20)
}

describe('the ink, pencil and marker presets are pinned', () => {
  it('pins every preset on every example in both palettes', () => {
    expect(Object.keys(golden).length).toBe(PRESET_GOLDEN_PRESETS.length * PRESET_GOLDEN_EXAMPLES.length * 2)
  })

  for (const preset of PRESET_GOLDEN_PRESETS) {
    for (const example of PRESET_GOLDEN_EXAMPLES) {
      it(`${preset}: ${example}`, async () => {
        for (const theme of ['light', 'dark'] as const) {
          const key = presetGoldenKey(preset, example, theme)
          expect(await sha(renderPresetGolden(preset, example, theme)), key).toBe(golden[key])
        }
      })
    }
  }
})

import { describe, expect, it } from 'vitest'
import GOLDEN from './presetGolden.json'
import { PRESET_GOLDEN_EXAMPLES, PRESET_GOLDEN_PRESETS, presetGoldenKey, renderPresetGolden } from './presetGolden.testkit'

// The ink, pencil and marker presets, pinned on three figure examples in the light and the dark
// palette: the sha256 (first 20 hex digits) of each SVG, so that any change to what those looks
// draw turns this red. Unlike cleanGolden.json this one MAY move, on purpose: when a look is
// meant to change, regenerate it (scripts/preset-golden.ts) in the same commit and say why.
//
// History: first pinned at ebd7fc3, before the presets took their colours from their medium.

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

// Writes src/figure/presetGolden.json: the sha256 (first 20 hex digits) of the SVG of the ink,
// pencil and marker presets on three figure examples, in the light and in the dark palette.
//
//   npx vite-node graph-engine/scripts/preset-golden.ts
//
// Run it from the repository root, and only for a change to those looks that is meant (the
// commit says so). figure/presetGolden.test.ts holds the file against the renderer.
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { PRESET_GOLDEN_EXAMPLES, PRESET_GOLDEN_PRESETS, presetGoldenKey, renderPresetGolden } from '../src/figure/presetGolden.testkit'

const golden: Record<string, string> = {}
for (const preset of PRESET_GOLDEN_PRESETS) {
  for (const example of PRESET_GOLDEN_EXAMPLES) {
    for (const theme of ['light', 'dark'] as const) {
      golden[presetGoldenKey(preset, example, theme)] = createHash('sha256').update(renderPresetGolden(preset, example, theme)).digest('hex').slice(0, 20)
    }
  }
}
writeFileSync(new URL('../src/figure/presetGolden.json', import.meta.url), JSON.stringify(golden, null, 2) + '\n')
console.log(`wrote ${Object.keys(golden).length} entries`)

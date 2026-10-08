import { normalise, type ThemeManifest } from '../manifest.js'

export const wsClean: ThemeManifest = normalise({
  id: 'builtin:ws-clean',
  name: 'Clean',
  description: 'Osmosis Clean — the default shape, type, space and material language.',
  author: 'human',
  layer: 'workspace',
})

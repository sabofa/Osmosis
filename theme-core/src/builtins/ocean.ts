import { normalise, type ThemeManifest } from '../manifest.js'

export const ocean: ThemeManifest = normalise({
  id: 'builtin:ocean',
  name: 'Ocean',
  description: 'Cool teal and slate-blue, fully derived from its seeds.',
  author: 'human',
  seeds: {
    light: { canvas: '#e9f1f4', surface: '#fafdfe', ink: '#10202a', accent: '#1f7a8c', secondary: '#3a5a9b' },
    dark: { canvas: '#0a1419', surface: '#10202a', ink: '#e2eef2', accent: '#4fb3c8', secondary: '#7d9ad6' },
  },
  dials: { roundness: 0.6, elevation: 0.35 },
})

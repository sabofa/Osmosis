import { normalise, type ThemeManifest } from '../manifest.js'

const shared = {
  'color-heat-0': '#e6d9c8', 'color-heat-1': '#f0c29e', 'color-heat-2': '#eea16a',
  'color-heat-3': '#e0753a', 'color-heat-4': '#b3411f', 'color-good': '#6e7f3c', 'color-bad': '#b3411f',
}

export const ember: ThemeManifest = normalise({
  id: 'builtin:ember',
  name: 'Ember',
  description: 'Warm parchment by day, near-black coals by night, with a glow from the corner.',
  author: 'human',
  seeds: {
    light: { canvas: '#f2ebe0', surface: '#fffaf3', ink: '#1c1410', accent: '#b3411f' },
    dark: { canvas: '#0d0b09', surface: '#16110d', ink: '#f6ece0', accent: '#ff8a3d' },
  },
  overrides: {
    light: {
      'color-text-muted': '#75655a', 'color-border': '#e6d9c8', 'color-border-strong': '#cdb9a2',
      'color-accent-wash': '#f8e9df', ...shared,
    },
    dark: {
      'color-text-muted': '#a89583', 'color-border': '#2b2119', 'color-border-strong': '#443426',
      'color-accent-wash': '#2e1a0f', ...shared,
    },
  },
  css: 'body { background-image: radial-gradient(ellipse at top left, color-mix(in srgb, var(--accent) 10%, transparent), transparent 55%); }',
})

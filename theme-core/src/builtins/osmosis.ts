import { normalise, type ThemeManifest } from '../manifest.js'

export const osmosis: ThemeManifest = normalise({
  id: 'builtin:osmosis',
  name: 'Osmosis',
  description: 'The default Osmosis look: warm paper, moss ink, terracotta accent.',
  author: 'human',
  seeds: {
    light: { canvas: '#eef1e5', surface: '#ffffff', ink: '#17170f', accent: '#c65d22' },
    dark: { canvas: '#17160f', surface: '#201e15', ink: '#f2efe2', accent: '#e2803f' },
  },
  overrides: {
    light: {
      'color-text-muted': '#6b6b5f', 'color-border': '#e4e2d4', 'color-border-strong': '#c9c6b3',
      'color-accent-wash': '#faf1e9', 'color-good': '#4c7a4a', 'color-bad': '#a34b3f',
      'color-heat-0': '#e4e2d4', 'color-heat-1': '#e9c9a6', 'color-heat-2': '#e3a468',
      'color-heat-3': '#d97a35', 'color-heat-4': '#c65d22',
    },
    dark: {
      'color-text-muted': '#a19d8c', 'color-border': '#34311e', 'color-border-strong': '#4a4530',
      'color-accent-wash': '#2c2113', 'color-good': '#6fa06c', 'color-bad': '#c76a5c',
      'color-heat-0': '#2a2819', 'color-heat-1': '#4a3a20', 'color-heat-2': '#7a4e24',
      'color-heat-3': '#a85f2a', 'color-heat-4': '#e2803f',
    },
  },
})

import { normalise, type ThemeManifest } from '../manifest.js'

const shared = {
  'color-heat-0': '#d8e0d2', 'color-heat-1': '#b3d3b8', 'color-heat-2': '#86bc93',
  'color-heat-3': '#57a06d', 'color-heat-4': '#2f7a4f', 'color-good': '#2f7a4f', 'color-bad': '#a6553c',
}

export const forest: ThemeManifest = normalise({
  id: 'builtin:forest',
  name: 'Forest',
  description: 'Deep greens on pale sage, with a quiet green-tinted panel edge.',
  author: 'human',
  seeds: {
    light: { canvas: '#ecf0e6', surface: '#fbfcf8', ink: '#141a13', accent: '#2f7a4f' },
    dark: { canvas: '#0f1511', surface: '#161f18', ink: '#e6efe6', accent: '#6fbf8a' },
  },
  overrides: {
    light: {
      'color-text-muted': '#5d6b5c', 'color-border': '#d8e0d2', 'color-border-strong': '#b8c6b0',
      'color-accent-wash': '#e8f3ea', ...shared,
    },
    dark: {
      'color-text-muted': '#92a394', 'color-border': '#25332a', 'color-border-strong': '#36473c',
      'color-accent-wash': '#16261b', ...shared,
    },
  },
  css: '.panel { border-color: color-mix(in srgb, var(--accent) 18%, var(--line)); }',
})

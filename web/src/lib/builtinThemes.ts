import type { ThemePreset } from '../hooks/useThemePresets'

// Themes that ship with the app. They exist on every device without syncing,
// can't be edited or deleted (Duplicate makes an editable copy), and their
// ids start with "builtin:" so the server accepts them as the active theme
// without needing a row. Each covers the eight palette tokens for both modes
// and uses the custom-CSS slot for what tokens alone can't reach: the
// heatmap ramp, the good/bad colours, and a little surface texture.
export const BUILTIN_THEMES: ThemePreset[] = [
  {
    id: 'builtin:slate',
    name: 'Slate',
    builtin: true,
    tokens: {
      light: {
        '--accent': '#3b6ea8',
        '--accent-wash': '#eaf1f9',
        '--bg': '#eef0f3',
        '--surface': '#ffffff',
        '--ink': '#161a21',
        '--muted': '#5f6672',
        '--line': '#dfe3e9',
        '--line-strong': '#c3c9d3',
      },
      dark: {
        '--accent': '#7fa8dc',
        '--accent-wash': '#1a2433',
        '--bg': '#111418',
        '--surface': '#1a1e24',
        '--ink': '#e7ebf1',
        '--muted': '#98a1ad',
        '--line': '#2a3038',
        '--line-strong': '#3c444f',
      },
    },
    customCss: [
      ':root:not([data-theme="light"]), :root[data-theme="light"] { --heat-0: #dfe3e9; --heat-1: #b9cbe3; --heat-2: #8db0d6; --heat-3: #5f8fc4; --heat-4: #3b6ea8; --good: #3f7d5a; --bad: #b0473f; }',
      'body { background-image: linear-gradient(180deg, color-mix(in srgb, var(--accent) 6%, transparent), transparent 40%); }',
    ].join('\n'),
  },
  {
    id: 'builtin:forest',
    name: 'Forest',
    builtin: true,
    tokens: {
      light: {
        '--accent': '#2f7a4f',
        '--accent-wash': '#e8f3ea',
        '--bg': '#ecf0e6',
        '--surface': '#fbfcf8',
        '--ink': '#141a13',
        '--muted': '#5d6b5c',
        '--line': '#d8e0d2',
        '--line-strong': '#b8c6b0',
      },
      dark: {
        '--accent': '#6fbf8a',
        '--accent-wash': '#16261b',
        '--bg': '#0f1511',
        '--surface': '#161f18',
        '--ink': '#e6efe6',
        '--muted': '#92a394',
        '--line': '#25332a',
        '--line-strong': '#36473c',
      },
    },
    customCss: [
      ':root:not([data-theme="light"]), :root[data-theme="light"] { --heat-0: #d8e0d2; --heat-1: #b3d3b8; --heat-2: #86bc93; --heat-3: #57a06d; --heat-4: #2f7a4f; --good: #2f7a4f; --bad: #a6553c; }',
      '.panel { border-color: color-mix(in srgb, var(--accent) 18%, var(--line)); }',
    ].join('\n'),
  },
  {
    id: 'builtin:ember',
    name: 'Ember',
    builtin: true,
    tokens: {
      light: {
        '--accent': '#b3411f',
        '--accent-wash': '#f8e9df',
        '--bg': '#f2ebe0',
        '--surface': '#fffaf3',
        '--ink': '#1c1410',
        '--muted': '#75655a',
        '--line': '#e6d9c8',
        '--line-strong': '#cdb9a2',
      },
      dark: {
        '--accent': '#ff8a3d',
        '--accent-wash': '#2e1a0f',
        '--bg': '#0d0b09',
        '--surface': '#16110d',
        '--ink': '#f6ece0',
        '--muted': '#a89583',
        '--line': '#2b2119',
        '--line-strong': '#443426',
      },
    },
    customCss: [
      ':root:not([data-theme="light"]), :root[data-theme="light"] { --heat-0: #e6d9c8; --heat-1: #f0c29e; --heat-2: #eea16a; --heat-3: #e0753a; --heat-4: #b3411f; --good: #6e7f3c; --bad: #b3411f; }',
      'body { background-image: radial-gradient(ellipse at top left, color-mix(in srgb, var(--accent) 10%, transparent), transparent 55%); }',
    ].join('\n'),
  },
  {
    id: 'builtin:plum',
    name: 'Plum',
    builtin: true,
    tokens: {
      light: {
        '--accent': '#7a3e8f',
        '--accent-wash': '#f3eaf7',
        '--bg': '#f0edf3',
        '--surface': '#ffffff',
        '--ink': '#1a1420',
        '--muted': '#6a6072',
        '--line': '#e2dbe8',
        '--line-strong': '#c8bcd2',
      },
      dark: {
        '--accent': '#c48ad6',
        '--accent-wash': '#2a1c31',
        '--bg': '#120f16',
        '--surface': '#1b161f',
        '--ink': '#efe8f3',
        '--muted': '#a396ac',
        '--line': '#2e2535',
        '--line-strong': '#443749',
      },
    },
    customCss: [
      ':root:not([data-theme="light"]), :root[data-theme="light"] { --heat-0: #e2dbe8; --heat-1: #d5bfe0; --heat-2: #bf98d0; --heat-3: #a06bb6; --heat-4: #7a3e8f; --good: #4c7a6a; --bad: #a8404f; }',
      '.panel { box-shadow: 0 1px 0 color-mix(in srgb, var(--accent) 25%, transparent); }',
    ].join('\n'),
  },
]

export function isBuiltinThemeId(id: string | null): boolean {
  return id !== null && id.startsWith('builtin:')
}

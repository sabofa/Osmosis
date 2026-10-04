// The default Osmosis theme, as constants: the default tokens of the web app, and
// the good and bad of the built-in palettes of render/palette.ts. A theme that
// leaves a colour out gets it from here (adapter.ts: `defaultTheme`).
//
// DEFAULT_LIGHT_TOKENS and DEFAULT_DARK_TOKENS are copies of the ones in
// web/src/lib/themeTokens.ts (the base palettes of web/src/index.css), kept here
// because the graph engine never imports from web/. adapter.test.ts reads that
// file as text and checks these match, so the two cannot drift.
//
// These are only data. adapter.ts is what reads them.

export const DEFAULT_TOKEN_NAMES = ['--accent', '--accent-wash', '--bg', '--surface', '--ink', '--muted', '--line', '--line-strong'] as const
export type DefaultTokenName = (typeof DEFAULT_TOKEN_NAMES)[number]
export type DefaultTokens = Readonly<Record<DefaultTokenName, string>>

export const DEFAULT_LIGHT_TOKENS: DefaultTokens = {
  '--accent': '#c65d22',
  '--accent-wash': '#faf1e9',
  '--bg': '#eef1e5',
  '--surface': '#ffffff',
  '--ink': '#17170f',
  '--muted': '#6b6b5f',
  '--line': '#e4e2d4',
  '--line-strong': '#c9c6b3',
}

export const DEFAULT_DARK_TOKENS: DefaultTokens = {
  '--accent': '#e2803f',
  '--accent-wash': '#2c2113',
  '--bg': '#17160f',
  '--surface': '#201e15',
  '--ink': '#f2efe2',
  '--muted': '#a19d8c',
  '--line': '#34311e',
  '--line-strong': '#4a4530',
}

// Good and bad. The tokens above have neither, so they come from the built-in
// palettes of render/palette.ts (`LIGHT_PALETTE`/`DARK_PALETTE`: segment is good,
// point is bad). Copies, for the same reason as the tokens: style/ imports
// nothing from render/. adapter.test.ts checks them against the real palettes.
export const DEFAULT_LIGHT_GOOD_BAD: Readonly<{ good: string; bad: string }> = { good: '#4c7a4a', bad: '#a34b3f' }
export const DEFAULT_DARK_GOOD_BAD: Readonly<{ good: string; bad: string }> = { good: '#6fa06c', bad: '#c76a5c' }

// The light mode of the four built-in themes (web/src/lib/builtinThemes.ts), by preset id: the
// light tokens, and the --good and --bad their custom CSS sets (the same in both modes). A
// built-in theme in dark mode takes its board colours from these (adapter.ts: `fromOsmosisTheme`),
// so what is drawn on a board does not change with the mode. Copies, for the same reason as the
// tokens above; adapter.test.ts reads builtinThemes.ts as text and checks them.
export const BUILTIN_THEME_IDS = ['builtin:slate', 'builtin:forest', 'builtin:ember', 'builtin:plum'] as const
export type BuiltinThemeId = (typeof BUILTIN_THEME_IDS)[number]

export interface BuiltinLight {
  tokens: DefaultTokens
  good: string
  bad: string
}

export const BUILTIN_LIGHT: Readonly<Record<BuiltinThemeId, BuiltinLight>> = {
  'builtin:slate': {
    tokens: {
      '--accent': '#3b6ea8',
      '--accent-wash': '#eaf1f9',
      '--bg': '#eef0f3',
      '--surface': '#ffffff',
      '--ink': '#161a21',
      '--muted': '#5f6672',
      '--line': '#dfe3e9',
      '--line-strong': '#c3c9d3',
    },
    good: '#3f7d5a',
    bad: '#b0473f',
  },
  'builtin:forest': {
    tokens: {
      '--accent': '#2f7a4f',
      '--accent-wash': '#e8f3ea',
      '--bg': '#ecf0e6',
      '--surface': '#fbfcf8',
      '--ink': '#141a13',
      '--muted': '#5d6b5c',
      '--line': '#d8e0d2',
      '--line-strong': '#b8c6b0',
    },
    good: '#2f7a4f',
    bad: '#a6553c',
  },
  'builtin:ember': {
    tokens: {
      '--accent': '#b3411f',
      '--accent-wash': '#f8e9df',
      '--bg': '#f2ebe0',
      '--surface': '#fffaf3',
      '--ink': '#1c1410',
      '--muted': '#75655a',
      '--line': '#e6d9c8',
      '--line-strong': '#cdb9a2',
    },
    good: '#6e7f3c',
    bad: '#b3411f',
  },
  'builtin:plum': {
    tokens: {
      '--accent': '#7a3e8f',
      '--accent-wash': '#f3eaf7',
      '--bg': '#f0edf3',
      '--surface': '#ffffff',
      '--ink': '#1a1420',
      '--muted': '#6a6072',
      '--line': '#e2dbe8',
      '--line-strong': '#c8bcd2',
    },
    good: '#4c7a6a',
    bad: '#a8404f',
  },
}

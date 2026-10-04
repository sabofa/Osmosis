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

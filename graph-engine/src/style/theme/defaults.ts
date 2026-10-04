// The app's default theme, as constants: the default tokens of the web app and
// the built-in palettes of render/palette.ts.
//
// DEFAULT_LIGHT_TOKENS and DEFAULT_DARK_TOKENS are copies of the ones in
// web/src/lib/themeTokens.ts (the base palettes of web/src/index.css), kept here
// because the graph engine never imports from web/. adapter.test.ts reads that
// file as text and checks these match, so the two cannot drift.
//
// These are only data. adapter.ts is what reads them.

import type { PaletteLike } from './types'

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

// The built-in light and dark palettes of render/palette.ts (`LIGHT_PALETTE`,
// `DARK_PALETTE`), the eight slots the adapter reads. They are what a theme
// that leaves colours out falls back to, and where `defaultTheme` takes its good
// and bad (the tokens above have none). Copies, for the same reason as the
// tokens: style/ imports nothing from render/. adapter.test.ts checks them
// against the real palettes.
export const BUILTIN_LIGHT_PALETTE: PaletteLike = {
  background: 0xfdf6ea,
  curve: 0xc65d22,
  segment: 0x4c7a4a,
  point: 0xa34b3f,
  axis: 0x17170f,
  grid: 0xe4e2d4,
  gridStrong: 0xc9c6b3,
  muted: 0x6b6558,
}

export const BUILTIN_DARK_PALETTE: PaletteLike = {
  background: 0x201e15,
  curve: 0xe2803f,
  segment: 0x6fa06c,
  point: 0xc76a5c,
  axis: 0xf2efe2,
  grid: 0x34311e,
  gridStrong: 0x4a4530,
  muted: 0xa39d8c,
}

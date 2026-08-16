export interface TokenField {
  key: string
  label: string
  hint: string
}

// The subset of CSS custom properties a theme preset is allowed to control.
// Deliberately the palette tokens, not layout/spacing/fonts — enough to make
// a theme feel distinct without letting it break the app's structure.
export const TOKEN_FIELDS: TokenField[] = [
  { key: '--accent', label: 'Accent', hint: 'buttons, links, highlights' },
  { key: '--accent-wash', label: 'Accent wash', hint: 'soft tinted backgrounds' },
  { key: '--bg', label: 'Background', hint: 'page background' },
  { key: '--surface', label: 'Surface', hint: 'cards and panels' },
  { key: '--ink', label: 'Text', hint: 'primary text' },
  { key: '--muted', label: 'Muted text', hint: 'secondary text' },
  { key: '--line', label: 'Border (soft)', hint: '' },
  { key: '--line-strong', label: 'Border (strong)', hint: '' },
]

// Mirrors the base palettes in index.css. Used as the starting point a theme's
// light/dark token editor shows before the user overrides anything — read
// statically rather than from computed style, since computed style only
// reflects whichever mode happens to be live in the browser right now, not
// necessarily the mode tab being edited.
export const DEFAULT_LIGHT_TOKENS: Record<string, string> = {
  '--accent': '#c65d22',
  '--accent-wash': '#faf1e9',
  '--bg': '#eef1e5',
  '--surface': '#ffffff',
  '--ink': '#17170f',
  '--muted': '#6b6b5f',
  '--line': '#e4e2d4',
  '--line-strong': '#c9c6b3',
}

export const DEFAULT_DARK_TOKENS: Record<string, string> = {
  '--accent': '#e2803f',
  '--accent-wash': '#2c2113',
  '--bg': '#17160f',
  '--surface': '#201e15',
  '--ink': '#f2efe2',
  '--muted': '#a19d8c',
  '--line': '#34311e',
  '--line-strong': '#4a4530',
}

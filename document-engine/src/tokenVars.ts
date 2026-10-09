import type { DocumentTokens } from 'theme-core'
import { HIGHLIGHT_PALETTE } from './highlightPalette'

// Neutral fallback used when the host passes no `tokens`. Light, no brand.
export const DEFAULT_TOKENS: DocumentTokens = {
  mode: 'light',
  colors: {
    page: '#ffffff',
    text: '#1f1f1f',
    textMuted: '#5f5f5f',
    link: '#1a56c4',
    rule: '#c8c8c8',
    selection: '#b3d4fc',
    highlight: ['#f4d35e', '#a8d4a0', '#f0a8c0', '#9ec5e8'],
    codeBg: '#f0f0f0',
    codeText: '#1f1f1f',
    syntax: {
      keyword: '#a626a4', string: '#50a14f', number: '#986801', comment: '#8a8a8a',
      function: '#4078f2', type: '#c18401', operator: '#383a42', punctuation: '#5f5f5f',
    },
    tableHeader: '#e6e6e6',
    tableStripe: '#f6f6f6',
    accent: '#1a56c4',
  },
  fonts: {
    body: 'system-ui, sans-serif',
    display: 'system-ui, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    math: "'Latin Modern Math', 'STIX Two Math', serif",
    cjk: "'Noto Sans JP', system-ui, sans-serif",
  },
  scale: { base: '1rem', ratio: 1.25, leading: '1.6', measure: '70ch' },
  key: 'default',
}

// Body text: the theme's body face, then the math face (so stray math
// glyphs resolve), then CJK, then a generic serif.
export function fontStack(t: DocumentTokens): string {
  return [t.fonts.body, t.fonts.math, t.fonts.cjk, 'serif'].join(', ')
}

export function codeFontStack(t: DocumentTokens): string {
  return [t.fonts.mono, 'monospace'].join(', ')
}

// KaTeX wells: math face first.
export function mathFontStack(t: DocumentTokens): string {
  return [t.fonts.math, t.fonts.body, t.fonts.cjk, 'serif'].join(', ')
}

// Chrome fallbacks: used only when the host frame publishes no component
// tokens (--menu-bg, --button-radius, ...). Colours derive from the engine's
// own --de-* vars; radii are relative to the chrome's font size.
export const CHROME_FALLBACKS: Record<string, string> = {
  '--de-chrome-bg': 'color-mix(in srgb, var(--de-text) 85%, transparent)',
  '--de-chrome-text': 'var(--de-page)',
  '--de-chrome-hover': 'color-mix(in srgb, currentColor 16%, transparent)',
  '--de-chrome-control-bg': 'color-mix(in srgb, currentColor 10%, transparent)',
  '--de-chrome-border': 'transparent',
  '--de-chrome-shadow': '0 4px 14px color-mix(in srgb, var(--de-text) 30%, transparent)',
  '--de-chrome-radius': '0.6em',
  '--de-chrome-radius-pill': '99em',
  '--de-chrome-radius-round': '50%',
}

export function tokensToCssVars(t: DocumentTokens): Record<string, string> {
  const c = t.colors
  const v: Record<string, string> = {
    '--de-page': c.page,
    '--de-text': c.text,
    '--de-text-muted': c.textMuted,
    '--de-link': c.link,
    '--de-rule': c.rule,
    '--de-selection': c.selection,
  }
  c.highlight.forEach((h, i) => {
    v[`--de-highlight-${i + 1}`] = h
  })
  v['--de-code-bg'] = c.codeBg
  v['--de-code-text'] = c.codeText
  for (const k of ['keyword', 'string', 'number', 'comment', 'function', 'type', 'operator', 'punctuation'] as const) {
    v[`--de-syntax-${k}`] = c.syntax[k]
  }
  v['--de-table-header'] = c.tableHeader
  v['--de-table-stripe'] = c.tableStripe
  v['--de-accent'] = c.accent
  v['--de-font-body'] = t.fonts.body
  v['--de-font-display'] = t.fonts.display
  v['--de-font-mono'] = t.fonts.mono
  v['--de-font-math'] = t.fonts.math
  v['--de-font-cjk'] = t.fonts.cjk
  v['--de-font-stack-body'] = fontStack(t)
  v['--de-font-stack-code'] = codeFontStack(t)
  v['--de-font-stack-math'] = mathFontStack(t)
  v['--de-font-size'] = t.scale.base
  v['--de-leading'] = t.scale.leading
  v['--de-measure'] = t.scale.measure
  v['--de-scale-ratio'] = String(t.scale.ratio)
  return { ...v, ...CHROME_FALLBACKS }
}

// Must stay translucent: a PDF's text-layer spans render with
// color:transparent over a canvas, so an opaque highlight background would
// hide the glyphs underneath.
export const HIGHLIGHT_ALPHA = 0.55

// Palette ids map to tokens.colors.highlight by palette index
// (yellow=0, green=1, pink=2, blue=3); the anchor reuses highlight[0].
// Literal colour values rather than var(...): ::highlight() isn't guaranteed
// to resolve custom properties from the stylesheet cascade across browsers.
export function highlightCss(groupPrefix: string, t: DocumentTokens): string {
  const mix = (col: string) => `color-mix(in srgb, ${col} ${Math.round(HIGHLIGHT_ALPHA * 100)}%, transparent)`
  const rules = HIGHLIGHT_PALETTE.map(
    (c, i) => `::highlight(${groupPrefix}-${c.id}) { background-color: ${mix(t.colors.highlight[i % 4])}; }`
  )
  rules.push(`::highlight(${groupPrefix}-anchor) { background-color: ${mix(t.colors.highlight[0])}; }`)
  return rules.join('\n')
}

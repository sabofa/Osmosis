import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEFAULT_TOKENS, CHROME_FALLBACKS, tokensToCssVars, fontStack, codeFontStack, mathFontStack, highlightCss } from './tokenVars'
import { HIGHLIGHT_PALETTE } from './highlightPalette'
import type { DocumentTokens } from 'theme-core'

const T: DocumentTokens = {
  mode: 'dark',
  colors: {
    page: 'P', text: 'T', textMuted: 'TM', link: 'L', rule: 'R', selection: 'S',
    highlight: ['h1', 'h2', 'h3', 'h4'],
    codeBg: 'CB', codeText: 'CT',
    syntax: { keyword: 'k', string: 's', number: 'n', comment: 'c', function: 'f', type: 't', operator: 'o', punctuation: 'p' },
    tableHeader: 'TH', tableStripe: 'TS', accent: 'A',
  },
  fonts: { body: 'Body', display: 'Disp', mono: 'Mono', math: 'Math', cjk: 'Cjk' },
  scale: { base: '1rem', ratio: 1.25, leading: '1.6', measure: '70ch' },
  key: 'k',
}

describe('tokensToCssVars', () => {
  it('maps every token onto a scoped custom property', () => {
    expect(tokensToCssVars(T)).toEqual({
      '--de-page': 'P',
      '--de-text': 'T',
      '--de-text-muted': 'TM',
      '--de-link': 'L',
      '--de-rule': 'R',
      '--de-selection': 'S',
      '--de-highlight-1': 'h1',
      '--de-highlight-2': 'h2',
      '--de-highlight-3': 'h3',
      '--de-highlight-4': 'h4',
      '--de-code-bg': 'CB',
      '--de-code-text': 'CT',
      '--de-syntax-keyword': 'k',
      '--de-syntax-string': 's',
      '--de-syntax-number': 'n',
      '--de-syntax-comment': 'c',
      '--de-syntax-function': 'f',
      '--de-syntax-type': 't',
      '--de-syntax-operator': 'o',
      '--de-syntax-punctuation': 'p',
      '--de-table-header': 'TH',
      '--de-table-stripe': 'TS',
      '--de-accent': 'A',
      '--de-font-body': 'Body',
      '--de-font-display': 'Disp',
      '--de-font-mono': 'Mono',
      '--de-font-math': 'Math',
      '--de-font-cjk': 'Cjk',
      '--de-font-stack-body': 'Body, Math, Cjk, serif',
      '--de-font-stack-code': 'Mono, monospace',
      '--de-font-stack-math': 'Math, Body, Cjk, serif',
      '--de-font-size': '1rem',
      '--de-leading': '1.6',
      '--de-measure': '70ch',
      '--de-scale-ratio': '1.25',
      ...CHROME_FALLBACKS,
    })
  })
  it('default tokens produce the same key set', () => {
    expect(Object.keys(tokensToCssVars(DEFAULT_TOKENS)).sort()).toEqual(Object.keys(tokensToCssVars(T)).sort())
  })
})

describe('chrome fallbacks', () => {
  it('are derived from the engine tokens (colour-mix of --de-*), radii relative', () => {
    expect(CHROME_FALLBACKS['--de-chrome-bg']).toContain('var(--de-text)')
    expect(CHROME_FALLBACKS['--de-chrome-text']).toBe('var(--de-page)')
    expect(CHROME_FALLBACKS['--de-chrome-radius']).toMatch(/em$/)
    expect(CHROME_FALLBACKS['--de-chrome-radius-pill']).toMatch(/em$/)
  })
  it('contain no colour literals', () => {
    for (const v of Object.values(CHROME_FALLBACKS)) {
      expect(v).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(/)
    }
  })
})

describe('font stacks', () => {
  it('body: body, math, cjk, generic serif (exact order)', () => {
    expect(fontStack(T)).toBe('Body, Math, Cjk, serif')
  })
  it('code: mono then generic monospace', () => {
    expect(codeFontStack(T)).toBe('Mono, monospace')
  })
  it('math: math first, then body, cjk, serif', () => {
    expect(mathFontStack(T)).toBe('Math, Body, Cjk, serif')
  })
})

describe('highlightCss', () => {
  it('maps palette ids to highlight[0..3] and anchors to highlight[0]', () => {
    const css = highlightCss('de1', T)
    HIGHLIGHT_PALETTE.forEach((c, i) => {
      expect(css).toContain(`::highlight(de1-${c.id}) { background-color: color-mix(in srgb, h${i + 1} 55%, transparent); }`)
    })
    expect(css).toContain('::highlight(de1-anchor) { background-color: color-mix(in srgb, h1 55%, transparent); }')
  })
})

describe('highlightCss with a malformed tokens object', () => {
  it('never emits undefined when highlight colours are missing', () => {
    const bad = { ...T, colors: { ...T.colors, highlight: ['only'] } } as unknown as typeof T
    const css = highlightCss('de1', bad)
    expect(css).not.toContain('undefined')
    expect(css).toContain('color-mix(in srgb, only 55%')
    const none = { ...T, colors: { ...T.colors, highlight: [] } } as unknown as typeof T
    expect(highlightCss('de1', none)).not.toContain('undefined')
  })
})

describe('DocumentViewer.css guard', () => {
  const css = readFileSync(fileURLToPath(new URL('./DocumentViewer.css', import.meta.url)), 'utf8')
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  it('has no hard-coded colours', () => {
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(stripped).not.toMatch(/rgba?\(/)
    expect(stripped).not.toMatch(/hsla?\(/)
  })
  it('has no hard-coded font families or radii in px/%', () => {
    expect(stripped).not.toMatch(/font-family:[ \t]*(?![ \t]|var\(|inherit)/)
    expect(stripped).not.toMatch(/border-radius:\s*(?!var\(|0)[^;]*\d+(px|%)/)
  })
  it('has a transparent root', () => {
    const m = stripped.match(/\.document-viewer\s*\{[^}]*\}/)
    expect(m?.[0]).toMatch(/background:\s*transparent/)
  })
  it('has no light/dark classes', () => {
    expect(stripped).not.toMatch(/document-viewer-(light|dark)/)
  })
})

describe('chrome inline styles guard', () => {
  for (const f of ['./Toolbar.tsx', './DocumentViewer.tsx']) {
    it(`${f} has no colour literals in inline styles`, () => {
      const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')
      const styles = [...src.matchAll(/style=\{\{[^}]*\}\}/g)].map((m) => m[0]).join(' ')
      expect(styles).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(/)
      expect(src).not.toMatch(/['"`]#[0-9a-fA-F]{3,8}['"`]/)
    })
  }
})

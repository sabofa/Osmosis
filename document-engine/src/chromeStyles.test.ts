import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The engine-owned chrome (ribbon, quiet viewer controls) is token-only:
// colours come from var(--de-*), radii and fonts from variables, sizes in px/em.
// Literal percentages inside color-mix are allowed here (state tints are
// chrome, not document layers; DocumentViewer.css keeps its stricter guard).
const FILES = ['./ribbon/Ribbon.css', './ViewerControls.css']
const raw = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')
const css = (f: string) => raw(f).replace(/\/\*[\s\S]*?\*\//g, '')

describe.each(FILES)('%s', (f) => {
  const src = css(f)
  it('has no colour literals', () => {
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(src).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/)
    expect(src).not.toMatch(/:\s*(?:white|black|red|green|blue|gray|grey|orange|yellow|purple|silver|navy)\s*[;!]/)
  })
  it('has no font-family literal', () => {
    expect(src).not.toMatch(/font-family:[ \t]*(?![ \t]|var\(|inherit)/)
  })
  it('has no pixel or percent border radius', () => {
    expect(src).not.toMatch(/border-radius:\s*(?!var\(|calc\(var|0)[^;]*\b\d+(px|%)/)
  })
  it('carries no box-shadow other than none and the popover shadow', () => {
    const shadows = [...src.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1].trim())
    for (const s of shadows) {
      expect(s === 'none' || /^0 4px 12px color-mix\(in srgb, var\(--de-text\) \d+%, transparent\)$/.test(s), s).toBe(true)
    }
  })
})

describe('TSX sources', () => {
  for (const f of ['./ribbon/Ribbon.tsx', './Toolbar.tsx']) {
    it(`${f} has no colour literals`, () => {
      const src = raw(f)
      expect(src).not.toMatch(/['"`]#[0-9a-fA-F]{3,8}['"`]/)
      expect(src).not.toMatch(/\b(?:rgba?|hsla?)\(/)
    })
  }
})

describe('quiet viewer controls', () => {
  const src = css('./ViewerControls.css')
  it('are flat at rest: no shadow, transparent hairline', () => {
    const idle = src.match(/\.document-viewer-zoom-control,\s*\.document-viewer-settings > button \{[^}]*\}/)?.[0] ?? ''
    expect(idle).toMatch(/box-shadow:\s*none/)
    expect(idle).toMatch(/border:\s*1px solid transparent/)
  })
  it('rest at half opacity, full on hover, focus and open', () => {
    expect(src).toMatch(/opacity: var\(--viewer-control-idle-opacity, 0\.5\)/)
    expect(src).toMatch(/:focus-within/)
    expect(src).toMatch(/\[data-open\]/)
  })
  it('honour the host --viewer-control-* overrides', () => {
    for (const v of ['inset', 'bg', 'fg', 'border', 'idle-opacity']) expect(raw('./ViewerControls.css')).toContain(`--viewer-control-${v}`)
  })
})

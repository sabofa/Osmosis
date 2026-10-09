import { describe, it, expect } from 'vitest'
import { renderMath } from './mathRender'

describe('renderMath', () => {
  it('renders valid TeX with html and mathml', () => {
    const r = renderMath('x^2 + 1', false)
    expect('html' in r).toBe(true)
    if ('html' in r) {
      expect(r.html).toContain('class="katex"')
      expect(r.html).toContain('<math')
      expect(r.html).not.toContain('katex-display')
    }
  })

  it('does not throw on invalid TeX', () => {
    const r = renderMath(String.raw`\frac{`, false)
    expect('html' in r || 'error' in r).toBe(true)
    if ('html' in r) expect(r.html).toContain('katex-error')
  })

  it('uses display mode when asked', () => {
    const r = renderMath(String.raw`\int_0^1 x\,dx`, true)
    expect('html' in r && r.html.includes('katex-display')).toBe(true)
  })

  it('does not trust href', () => {
    const r = renderMath(String.raw`\href{javascript:alert(1)}{x}`, false)
    if ('html' in r) expect(r.html).not.toContain('href="javascript')
  })
})

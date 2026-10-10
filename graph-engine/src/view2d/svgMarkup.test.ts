import { describe, expect, it } from 'vitest'
import { svgWindow } from './svgMarkup'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" preserveAspectRatio="xMidYMid meet" data-style="chalk"><g data-layer="paper"/></svg>'

describe('svgWindow', () => {
  it('replaces the window, size and fitting, and keeps the other root attributes and the body', () => {
    const out = svgWindow(SVG, { x: -1.5, y: 2, width: 3, height: 4 }, 512, 256)!
    expect(out).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" data-style="chalk" width="512" height="256" viewBox="-1.5 2 3 4" preserveAspectRatio="none"><g data-layer="paper"/></svg>',
    )
  })
  it('puts a style block first, for an image the page CSS cannot reach', () => {
    const out = svgWindow(SVG, { x: 0, y: 0, width: 1, height: 1 }, 1, 1, 'a{b:c}')!
    expect(out).toContain('preserveAspectRatio="none"><style>a{b:c}</style><g data-layer="paper"/>')
  })
  it('null for markup without an svg root', () => {
    expect(svgWindow('<g/>', { x: 0, y: 0, width: 1, height: 1 }, 1, 1)).toBeNull()
  })
})

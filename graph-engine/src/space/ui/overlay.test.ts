import { describe, expect, it } from 'vitest'
import { LIGHT_PALETTE } from '../../render/palette'
import { spaceColors } from '../theme'
import { FakeDocument, type FakeElement } from '../testing/fakeDom'
import { Overlay } from './overlay'

function newOverlay() {
  const doc = new FakeDocument()
  const parent = doc.createElement('div')
  const canvas = doc.createElement('canvas')
  parent.appendChild(canvas)
  const overlay = new Overlay(canvas as unknown as HTMLCanvasElement)
  return { overlay, element: overlay.element as unknown as FakeElement }
}

describe('Overlay.setColors (S6 plan V10)', () => {
  it("sets --space-line from the palette's grid, not gridStrong (S6 fix round 1, M6)", () => {
    const { overlay, element } = newOverlay()
    const colors = spaceColors(LIGHT_PALETTE, 'light')
    overlay.setColors(colors)
    const line = element.style.getPropertyValue('--space-line')
    const grid = `rgb(${Math.round(colors.grid[0] * 255)}, ${Math.round(colors.grid[1] * 255)}, ${Math.round(colors.grid[2] * 255)})`
    const gridStrong = `rgb(${Math.round(colors.gridStrong[0] * 255)}, ${Math.round(colors.gridStrong[1] * 255)}, ${Math.round(colors.gridStrong[2] * 255)})`
    expect(grid).not.toBe(gridStrong) // the fixture is meaningless if these coincide
    expect(line).toBe(grid)
  })

  it('sets the other three chrome tokens from ink, background and muted', () => {
    const { overlay, element } = newOverlay()
    const colors = spaceColors(LIGHT_PALETTE, 'light')
    overlay.setColors(colors)
    const rgb = (c: readonly [number, number, number]) => `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`
    expect(element.style.getPropertyValue('--space-ink')).toBe(rgb(colors.axis))
    expect(element.style.getPropertyValue('--space-surface')).toBe(rgb(colors.background))
    expect(element.style.getPropertyValue('--space-muted')).toBe(rgb(colors.muted))
  })
})

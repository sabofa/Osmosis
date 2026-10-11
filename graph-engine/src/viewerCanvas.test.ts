import { describe, expect, it, vi } from 'vitest'
import { canvasKey, releaseRenderer } from './viewerCanvas'

describe("GraphViewer's canvas rule", () => {
  it('releasing a renderer disposes it once and reports that its canvas is spent', () => {
    const renderer = { dispose: vi.fn() }
    const holder: { current: typeof renderer | null } = { current: renderer }
    expect(releaseRenderer(holder)).toBe(true)
    expect(renderer.dispose).toHaveBeenCalledTimes(1)
    expect(holder.current).toBeNull()
    // Nothing held: nothing disposed, and the canvas is still fresh.
    expect(releaseRenderer(holder)).toBe(false)
    expect(renderer.dispose).toHaveBeenCalledTimes(1)
  })

  it('keys the canvas by the context type it serves and its generation', () => {
    expect(canvasKey('3d', 0)).not.toBe(canvasKey('2d', 0))
    expect(canvasKey('3d', 1)).not.toBe(canvasKey('3d', 0))
    expect(canvasKey('2d', 4)).toBe(canvasKey('2d', 4))
  })
})

import { describe, expect, it } from 'vitest'
import { contentToScreen, fittedCamera, panByScreen, pxPerUnit, screenToContent, visibleRect, zoomAbout } from './camera'

const frame = { x: -320, y: -240, width: 640, height: 480 }
const screen = { width: 800, height: 400 }

describe('the camera', () => {
  it('fits the frame like SVG "meet": the limiting axis fills the screen', () => {
    const cam = fittedCamera(frame)
    expect(cam).toEqual({ cx: 0, cy: 0, zoom: 1 })
    expect(pxPerUnit(frame, cam, screen)).toBeCloseTo(400 / 480, 12)
    const v = visibleRect(frame, cam, screen)
    expect(v.height).toBeCloseTo(480, 9)
    expect(v.width).toBeCloseTo(960, 9) // the screen's aspect, centred
    expect(v.x).toBeCloseTo(-480, 9)
  })

  it('round-trips content and screen at random cameras', () => {
    for (let i = 0; i < 50; i++) {
      const cam = { cx: Math.sin(i) * 300, cy: Math.cos(i) * 200, zoom: Math.exp(Math.sin(i * 1.7) * 3) }
      const p = { x: i * 7 - 100, y: 50 - i * 3 }
      const back = screenToContent(contentToScreen(p, frame, cam, screen), frame, cam, screen)
      expect(back.x).toBeCloseTo(p.x, 9)
      expect(back.y).toBeCloseTo(p.y, 9)
    }
  })

  it('zooms about a screen point, keeping the content under it fixed', () => {
    const cam = { cx: 40, cy: -10, zoom: 2 }
    const at = { x: 610, y: 95 }
    const before = screenToContent(at, frame, cam, screen)
    const after = screenToContent(at, frame, zoomAbout(cam, at, 3.7, frame, screen), screen)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('pans by screen pixels exactly: content follows the cursor', () => {
    const cam = { cx: 0, cy: 0, zoom: 3 }
    const p = { x: 12, y: -7 }
    const s0 = contentToScreen(p, frame, cam, screen)
    const s1 = contentToScreen(p, frame, panByScreen(cam, 25, -40, frame, screen), screen)
    expect(s1.x - s0.x).toBeCloseTo(25, 9)
    expect(s1.y - s0.y).toBeCloseTo(-40, 9)
  })
})

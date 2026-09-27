import { describe, expect, it, vi } from 'vitest'
import { DARK_PALETTE, LIGHT_PALETTE } from '../render/palette'
import { defaultSpaceConfig, type SpaceConfig } from './config'
import { createFakeGl, type FakeGl } from './gl/fakeGl'
import { SpaceRenderer, type SpaceRendererEnv } from './SpaceRenderer'
import { FakeDocument, type FakeElement } from './testing/fakeDom'
import { curveMark, label, scene } from './testing/marks'

// A canvas in a parent, both fake, handing out the recording fake GL.
function mount(fake: FakeGl | null = createFakeGl()) {
  const doc = new FakeDocument()
  const parent = doc.createElement('div')
  const canvas = doc.createElement('canvas') as FakeElement & Record<string, unknown>
  Object.assign(canvas, {
    width: 300,
    height: 150,
    clientWidth: 800,
    clientHeight: 600,
    getContext: (type: string) => (type === 'webgl2' && fake ? fake.gl : null),
  })
  parent.appendChild(canvas)
  return { doc, parent, canvas }
}

// requestAnimationFrame as a queue the test drains by hand, with a clock.
function fakeEnv(overrides: Partial<SpaceRendererEnv> = {}) {
  let time = 0
  let next = 1
  const queue = new Map<number, (t: number) => void>()
  const resize: (() => void)[] = []
  const env: SpaceRendererEnv = {
    requestFrame: vi.fn((cb: (t: number) => void) => {
      queue.set(next, cb)
      return next++
    }),
    cancelFrame: vi.fn((h: number) => {
      queue.delete(h)
    }),
    now: () => time,
    devicePixelRatio: () => 1.5,
    prefersReducedMotion: () => false,
    observeSize: (_el, cb) => {
      resize.push(cb)
      return () => resize.splice(resize.indexOf(cb), 1)
    },
    ...overrides,
  }
  return {
    env,
    requests: () => (env.requestFrame as ReturnType<typeof vi.fn>).mock.calls.length,
    pending: () => queue.size,
    // Run every queued frame once, 16 ms apart.
    flush() {
      const due = [...queue.entries()]
      queue.clear()
      for (const [, cb] of due) {
        time += 16
        cb(time)
      }
      return due.length
    },
    advance(ms: number) {
      time += ms
    },
    resize: () => resize.forEach((cb) => cb()),
  }
}

const CONFIG = { space: defaultSpaceConfig() }
const helix = curveMark((t) => [Math.cos(t), Math.sin(t), t / 10], 0, 12, 64)

describe('SpaceRenderer renders on demand', () => {
  it('requests a frame only after a change, and never loops on its own', () => {
    const fake = createFakeGl()
    const { canvas } = mount(fake)
    const clock = fakeEnv()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    expect(clock.requests()).toBe(0)

    r.setScene(scene([helix]), CONFIG)
    r.setView({ azimuth: 10, elevation: 20, zoom: 1, target: [0, 0, 0] })
    // Both changes collapse into one frame.
    expect(clock.requests()).toBe(1)
    expect(clock.flush()).toBe(1)
    expect(fake.draws.length).toBeGreaterThan(0)
    // Nothing changed since: nothing is queued.
    expect(clock.pending()).toBe(0)
    expect(clock.flush()).toBe(0)

    // The same view again is not a change.
    r.setView(r.getView())
    expect(clock.pending()).toBe(0)

    r.setView({ ...r.getView(), azimuth: 50 })
    expect(clock.pending()).toBe(1)
    clock.flush()
    r.setPalette(DARK_PALETTE, 'dark')
    expect(clock.pending()).toBe(1)
    clock.flush()
    expect(clock.pending()).toBe(0)
    r.dispose()
  })

  it('redraws at once when the canvas is resized, so a resized canvas never shows a stretched frame', () => {
    const fake = createFakeGl()
    const { canvas } = mount(fake)
    const clock = fakeEnv()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    r.setScene(scene([helix]), CONFIG)
    clock.flush()
    const draws = fake.draws.length
    canvas.clientHeight = 700
    clock.resize()
    // Drawn inside the resize callback (before the browser paints), not a frame later.
    expect(fake.draws.length).toBeGreaterThan(draws)
    expect(clock.pending()).toBe(0)
    expect(canvas.height).toBe(700 * 1.5)
    r.dispose()
  })

  it('runs inertia frames after a fast orbit drag, then stops by itself', () => {
    const { canvas } = mount()
    const clock = fakeEnv()
    const onViewChange = vi.fn()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light', onViewChange }, clock.env)
    r.setScene(scene([helix]), CONFIG)
    clock.flush()
    const pointer = (x: number) => ({ pointerId: 1, clientX: x, clientY: 100, button: 0, shiftKey: false })
    canvas.dispatch('pointerdown', pointer(100))
    clock.advance(16)
    canvas.dispatch('pointermove', pointer(130))
    clock.advance(16)
    canvas.dispatch('pointermove', pointer(160))
    expect(r.getView().azimuth).toBeCloseTo(40 - 0.4 * 60, 9)
    canvas.dispatch('pointerup', pointer(160))
    let frames = 0
    while (clock.pending() > 0 && frames < 500) frames += clock.flush()
    expect(frames).toBeGreaterThan(3)
    expect(frames).toBeLessThan(500)
    // It kept turning after release, the way the drag went.
    expect(r.getView().azimuth).toBeLessThan(40 - 24)
    expect(onViewChange).toHaveBeenCalled()
    r.dispose()
  })

  it('sizes the backing store to CSS size x min(devicePixelRatio, 2)', () => {
    const { canvas } = mount()
    const clock = fakeEnv({ devicePixelRatio: () => 3 })
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    r.setScene(scene([helix]), CONFIG)
    clock.flush()
    expect([canvas.width, canvas.height]).toEqual([1600, 1200])
    r.dispose()
  })
})

describe('SpaceRenderer and its host', () => {
  it('puts its overlay beside the canvas, fills it with labels, and removes it on dispose', () => {
    const fake = createFakeGl()
    const { canvas, parent } = mount(fake)
    const clock = fakeEnv()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    const overlay = parent.children.find((c) => c.className === 'space-overlay')!
    expect(overlay).toBeDefined()
    r.setScene(scene([helix], { labels: [label([0, 0, 0], 'P')] }), CONFIG)
    clock.flush()
    const texts = overlay.children.map((c) => c.textContent)
    expect(texts).toContain('P')
    expect(texts).toContain('x')
    expect(canvas.tabIndex).toBe(0)
    r.dispose()
    expect(parent.children.includes(overlay)).toBe(false)
    expect(canvas.listenerCount()).toBe(0)
    for (const kind of Object.keys(fake.created) as (keyof FakeGl['created'])[]) expect([kind, fake.created[kind] - fake.deleted[kind]]).toEqual([kind, 0])
  })

  it('shows a legible message, and does not throw, without WebGL2', () => {
    const { canvas, parent } = mount(null)
    const clock = fakeEnv()
    const onError = vi.fn()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light', onError }, clock.env)
    expect(() => {
      r.setScene(scene([helix]), CONFIG)
      clock.flush()
    }).not.toThrow()
    const overlay = parent.children.find((c) => c.className === 'space-overlay')!
    const message = overlay.children.find((c) => c.className === 'space-message')
    expect(message?.textContent).toMatch(/WebGL2/)
    r.dispose()
  })

  it('shows a shader failure in the view as well as through onError', () => {
    const { canvas, parent } = mount(createFakeGl({ failCompile: true }))
    const clock = fakeEnv()
    const onError = vi.fn()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light', onError }, clock.env)
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/shader failed to compile/))
    const overlay = parent.children.find((c) => c.className === 'space-overlay')!
    expect(overlay.children.find((c) => c.className === 'space-message')?.textContent).toMatch(/shader failed to compile/)
    r.dispose()
  })

  it('starts from the authored camera aimed at the box centre, and double-click returns there', () => {
    const { canvas } = mount()
    const clock = fakeEnv()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    const space: SpaceConfig = { ...defaultSpaceConfig(), camera: { azimuth: -30, elevation: 10, zoom: 2 }, bounds: { x: { min: 0, max: 4 }, y: { min: -1, max: 1 }, z: { min: 0, max: 2 } } }
    r.setScene(scene([helix]), { space })
    expect(r.getView()).toEqual({ azimuth: -30, elevation: 10, zoom: 2, target: [2, 0, 1] })
    r.setView({ azimuth: 100, elevation: 45, zoom: 0.5, target: [0, 0, 0] })
    canvas.dispatch('dblclick')
    expect(r.getView()).toEqual({ azimuth: -30, elevation: 10, zoom: 2, target: [2, 0, 1] })
    r.dispose()
  })
})

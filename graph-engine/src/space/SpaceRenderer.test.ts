import { describe, expect, it, vi } from 'vitest'
import { DARK_PALETTE, LIGHT_PALETTE } from '../render/palette'
import { defaultSpaceConfig, type SpaceConfig } from './config'
import { createFakeGl, type FakeGl } from './gl/fakeGl'
import { parseSpec } from '../parser/parseSpec'
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
  const pixelRatio: (() => void)[] = []
  let ratio = 1.5
  const env: SpaceRendererEnv = {
    requestFrame: vi.fn((cb: (t: number) => void) => {
      queue.set(next, cb)
      return next++
    }),
    cancelFrame: vi.fn((h: number) => {
      queue.delete(h)
    }),
    now: () => time,
    devicePixelRatio: () => ratio,
    prefersReducedMotion: () => false,
    observeSize: (_el, cb) => {
      resize.push(cb)
      return () => resize.splice(resize.indexOf(cb), 1)
    },
    observePixelRatio: (cb) => {
      pixelRatio.push(cb)
      return () => pixelRatio.splice(pixelRatio.indexOf(cb), 1)
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
    // The display's pixel ratio changes (a monitor move, browser zoom) with no CSS resize.
    setPixelRatio(next: number) {
      ratio = next
      pixelRatio.forEach((cb) => cb())
    },
    listeners: () => resize.length + pixelRatio.length,
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
    const pointer = (x: number) => ({ pointerId: 1, clientX: x, clientY: 100, button: 0, buttons: 1, shiftKey: false })
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

describe('SpaceRenderer.setSpec', () => {
  it('builds the kernel from a parsed spec, draws its scene, and returns no errors for a good spec', () => {
    const fake = createFakeGl()
    const { canvas } = mount(fake)
    const clock = fakeEnv()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    const parsed = parseSpec('@camera: azimuth -30, elevation 20\nz = x^2 - y^2 for x in [-1, 1], y in [-1, 1]')
    expect(parsed.errors).toEqual([])
    expect(r.setSpec(parsed.statements, parsed.config, parsed.statementLines)).toEqual([])
    clock.flush()
    expect(fake.draws.some((d) => fake.programSource(d.program).vertex.includes('space: mesh'))).toBe(true)
    // The authored camera, aimed at the box centre.
    expect([r.getView().azimuth, r.getView().elevation]).toEqual([-30, 20])
    r.dispose()
  })

  it("returns the kernel's errors with their 1-based lines, and still draws the rest", () => {
    const fake = createFakeGl()
    const { canvas } = mount(fake)
    const clock = fakeEnv()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    const parsed = parseSpec('z = x^2 + y^2 for x in [-1, 1], y in [-1, 1]\n\nz = nope(x) + y for x in [0, 1], y in [0, 1]')
    const errors = r.setSpec(parsed.statements, parsed.config, parsed.statementLines)
    expect(errors.map((e) => e.line)).toEqual([3])
    clock.flush()
    expect(fake.draws.some((d) => fake.programSource(d.program).vertex.includes('space: mesh'))).toBe(true)
    r.dispose()
  })
})

describe('SpaceRenderer and the display', () => {
  it('re-sizes the backing store and redraws when devicePixelRatio changes without a CSS resize', () => {
    const fake = createFakeGl()
    const { canvas } = mount(fake)
    const clock = fakeEnv()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    r.setScene(scene([helix]), CONFIG)
    clock.flush()
    expect(canvas.width).toBe(1200)
    const draws = fake.draws.length
    clock.setPixelRatio(2)
    expect(canvas.width).toBe(1600)
    expect(fake.draws.length).toBeGreaterThan(draws)
    r.dispose()
    expect(clock.listeners()).toBe(0)
  })

  it('reads no layout on hover, and at most the rect once per drag', () => {
    const { canvas } = mount()
    let reads = 0
    let rects = 0
    for (const prop of ['clientWidth', 'clientHeight'] as const) {
      const value = canvas[prop] as number
      Object.defineProperty(canvas, prop, {
        get: () => {
          reads++
          return value
        },
      })
    }
    canvas.getBoundingClientRect = () => {
      rects++
      return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }
    }
    const clock = fakeEnv()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    r.setScene(scene([helix]), CONFIG)
    clock.flush()
    reads = 0
    rects = 0
    const move = (x: number, buttons: number) => canvas.dispatch('pointermove', { pointerId: 1, clientX: x, clientY: 100, button: -1, buttons, shiftKey: false })
    for (let x = 0; x < 20; x++) move(x, 0)
    expect([reads, rects]).toEqual([0, 0])
    canvas.dispatch('pointerdown', { pointerId: 1, clientX: 20, clientY: 100, button: 0, buttons: 1, shiftKey: false })
    for (let x = 21; x < 40; x++) move(x, 1)
    expect(reads).toBe(0)
    expect(rects).toBeLessThanOrEqual(1)
    expect(r.getView().azimuth).not.toBe(40)
    r.dispose()
  })
})

describe('SpaceRenderer and context loss', () => {
  it('tells its host when the context is lost and when it is restored, and redraws on restore', () => {
    const fake = createFakeGl()
    const { canvas } = mount(fake)
    const clock = fakeEnv()
    const onContextLost = vi.fn()
    const onContextRestored = vi.fn()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light', onContextLost, onContextRestored }, clock.env)
    r.setScene(scene([helix]), CONFIG)
    clock.flush()
    fake.lose()
    canvas.dispatch('webglcontextlost')
    expect(onContextLost).toHaveBeenCalledTimes(1)
    expect(onContextRestored).not.toHaveBeenCalled()
    fake.restore()
    canvas.dispatch('webglcontextrestored')
    expect(onContextRestored).toHaveBeenCalledTimes(1)
    const draws = fake.draws.length
    clock.flush()
    expect(fake.draws.length).toBeGreaterThan(draws)
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

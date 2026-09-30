import { describe, expect, it, vi } from 'vitest'
import { DARK_PALETTE, LIGHT_PALETTE } from '../render/palette'
import { defaultSpaceConfig, type SpaceConfig } from './config'
import { createFakeGl, type FakeGl } from './gl/fakeGl'
import { parseSpec } from '../parser/parseSpec'
import { SpaceRenderer, type SpaceRendererEnv } from './SpaceRenderer'
import { FakeDocument, type FakeElement } from './testing/fakeDom'
import { project } from './camera/projection'
import type { SpaceEvent } from './events'
import type { SpaceKernel } from './kernel/api'
import { curveMark, graphMesh, label, meshMark, scene } from './testing/marks'
import type { SpaceScene } from './scene/types'

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

  it('reads no layout on hover beyond the cached rect, and at most the rect once per drag', () => {
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
    // The probe needs the cursor in canvas pixels: the rect is read once and
    // cached for every later move.
    for (let x = 0; x < 20; x++) move(x, 0)
    expect(reads).toBe(0)
    expect(rects).toBe(1)
    rects = 0
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

  it('shows "restoring…" while the context is lost, S6 plan V9, and clears it once restored', () => {
    const fake = createFakeGl()
    const { canvas, parent } = mount(fake)
    const clock = fakeEnv()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    r.setScene(scene([helix]), CONFIG)
    clock.flush()
    const overlay = parent.children.find((c) => c.className === 'space-overlay')!
    const message = () => overlay.children.find((c) => c.className === 'space-message')
    expect(message()).toBeUndefined()
    fake.lose()
    canvas.dispatch('webglcontextlost')
    expect(message()?.textContent).toBe('restoring…')
    fake.restore()
    canvas.dispatch('webglcontextrestored')
    expect(message()).toBeUndefined()
    r.dispose()
  })
})

describe('SpaceRenderer and the empty-scene state (S6 plan V9)', () => {
  it('shows "nothing to draw yet: add a statement" for a scene with no marks and no errors, and clears it once the scene has marks', () => {
    const fake = createFakeGl()
    const { canvas, parent } = mount(fake)
    const clock = fakeEnv()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    const overlay = parent.children.find((c) => c.className === 'space-overlay')!
    const message = () => overlay.children.find((c) => c.className === 'space-message')
    r.setScene(scene([]), CONFIG)
    clock.flush()
    expect(message()?.textContent).toBe('nothing to draw yet: add a statement')
    r.setScene(scene([helix]), CONFIG)
    clock.flush()
    expect(message()).toBeUndefined()
    r.dispose()
  })

  it('does not show the empty-scene message over a shader failure, and never without WebGL2', () => {
    const noGl = mount(null)
    const noGlR = new SpaceRenderer(noGl.canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, fakeEnv().env)
    noGlR.setScene(scene([]), CONFIG)
    const noGlOverlay = noGl.parent.children.find((c) => c.className === 'space-overlay')!
    expect(noGlOverlay.children.find((c) => c.className === 'space-message')?.textContent).toMatch(/WebGL2/)
    noGlR.dispose()

    const { canvas, parent } = mount(createFakeGl({ failCompile: true }))
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, fakeEnv().env)
    r.setScene(scene([]), CONFIG)
    const overlay = parent.children.find((c) => c.className === 'space-overlay')!
    expect(overlay.children.find((c) => c.className === 'space-message')?.textContent).toMatch(/shader failed to compile/)
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

  it('starts from the authored camera aimed at the box centre, and double-click eases back there over 280 ms (S6 plan V9)', () => {
    const { canvas } = mount()
    const clock = fakeEnv()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    const space: SpaceConfig = { ...defaultSpaceConfig(), camera: { azimuth: -30, elevation: 10, zoom: 2 }, bounds: { x: { min: 0, max: 4 }, y: { min: -1, max: 1 }, z: { min: 0, max: 2 } } }
    r.setScene(scene([helix]), { space })
    expect(r.getView()).toEqual({ azimuth: -30, elevation: 10, zoom: 2, target: [2, 0, 1] })
    r.setView({ azimuth: 100, elevation: 45, zoom: 0.5, target: [0, 0, 0] })
    canvas.dispatch('dblclick')
    // S6 fix round 1, M4: getView() reports where the ease is headed right
    // away, not the transient view a host would otherwise read a moment
    // before it changed again.
    expect(r.getView()).toEqual({ azimuth: -30, elevation: 10, zoom: 2, target: [2, 0, 1] })
    // It still eases, not snaps, internally: the drawn view has not jumped yet.
    expect(r['view']).toEqual({ azimuth: 100, elevation: 45, zoom: 0.5, target: [0, 0, 0] })
    let frames = 0
    while (clock.pending() > 0 && frames < 100) {
      clock.flush()
      frames++
    }
    // 280 ms at 16 ms a frame is about 17-18 frames.
    expect(frames).toBeGreaterThan(10)
    expect(frames).toBeLessThan(30)
    expect(r['view']).toEqual({ azimuth: -30, elevation: 10, zoom: 2, target: [2, 0, 1] })
    expect(r.getView()).toEqual({ azimuth: -30, elevation: 10, zoom: 2, target: [2, 0, 1] })
    r.dispose()
  })

  it('reduced motion snaps double-click back to the authored view instead of easing (S6 plan V9)', () => {
    const { canvas } = mount()
    const clock = fakeEnv({ prefersReducedMotion: () => true })
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    const space: SpaceConfig = { ...defaultSpaceConfig(), camera: { azimuth: -30, elevation: 10, zoom: 2 }, bounds: { x: { min: 0, max: 4 }, y: { min: -1, max: 1 }, z: { min: 0, max: 2 } } }
    r.setScene(scene([helix]), { space })
    r.setView({ azimuth: 100, elevation: 45, zoom: 0.5, target: [0, 0, 0] })
    canvas.dispatch('dblclick')
    expect(r.getView()).toEqual({ azimuth: -30, elevation: 10, zoom: 2, target: [2, 0, 1] })
    // A snap still schedules its one redraw, but no animation loop: flushing
    // it asks for no further frame.
    clock.flush()
    expect(clock.pending()).toBe(0)
    expect(r.getView()).toEqual({ azimuth: -30, elevation: 10, zoom: 2, target: [2, 0, 1] })
    r.dispose()
  })

  it('azimuth takes the shortest way round when easing (S6 plan V9): 170 -> -170 turns 20 degrees, not 340', () => {
    const { canvas } = mount()
    const clock = fakeEnv()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    const space: SpaceConfig = { ...defaultSpaceConfig(), camera: { azimuth: -170, elevation: 10, zoom: 1 }, bounds: { x: { min: 0, max: 4 }, y: { min: -1, max: 1 }, z: { min: 0, max: 2 } } }
    r.setScene(scene([helix]), { space })
    r.setView({ azimuth: 170, elevation: 10, zoom: 1, target: [2, 0, 1] })
    canvas.dispatch('dblclick')
    // M4: getView() already reports the target, not the transient view.
    expect(r.getView().azimuth).toBeCloseTo(-170, 6)
    clock.flush()
    // One 16 ms frame in: the drawn view's azimuth has moved a small step
    // past 170 toward 180/-180, not backward toward 0 (which the naive
    // -340-degree route would).
    expect(r['view'].azimuth).toBeGreaterThan(170)
    while (clock.pending() > 0) clock.flush()
    expect(r['view'].azimuth).toBeCloseTo(-170, 6)
    expect(r.getView().azimuth).toBeCloseTo(-170, 6)
    r.dispose()
  })

  it('re-targets a reset ease in progress when a value moves the box mid-flight (S6 fix round 1, M4)', () => {
    const fake = createFakeGl()
    const { canvas } = mount(fake)
    const clock = fakeEnv()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    const parsed = parseSpec('@param a = 1 range [0.5, 4]\nz = a*x^2 + y^2 for x in [-2, 2], y in [-2, 2]')
    r.setSpec(parsed.statements, parsed.config, parsed.statementLines)
    clock.flush()
    r.setView({ ...r.getView(), azimuth: r.getView().azimuth + 40 })
    canvas.dispatch('dblclick')
    const targetBefore = r.getView().target
    clock.flush() // one step into the ease
    // The camera itself is not authored to change, only the box's height —
    // a value change alone does not stop the ease (only stopInertia() does).
    r.setValue('a', 4)
    clock.flush()
    const targetAfter = r.getView().target
    // Re-targeted: getView() now points at the new box's centre, not the
    // one the ease was originally aimed at.
    expect(targetAfter).not.toEqual(targetBefore)
    while (clock.pending() > 0) clock.flush()
    // It still converges exactly on the final (re-targeted) authored view,
    // not stuck somewhere between the two.
    expect(r['view']).toEqual(r.getView())
    r.dispose()
  })

  it('shows a colorbar per referenced colour scale, at most two, with one console note per scene for the rest', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { canvas, parent } = mount()
    const clock = fakeEnv()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    const mesh = (colorScale: number) => meshMark([0, 0, 0, 1, 0, 0, 0, 1, 1], [0, 0, 1, 0, 0, 1, 0, 0, 1], [0, 1, 2], { style: { colorScale } })
    const scales = [0, 1, 2].map((id) => ({ id, title: `s${id}`, map: 'viridis' as const, domain: { min: 0, max: 1 }, diverging: false }))
    r.setScene({ ...scene([mesh(0), mesh(1), mesh(2)]), colorScales: scales }, CONFIG)
    const overlay = parent.children.find((c) => c.className === 'space-overlay')!
    const bars = overlay.children.find((c) => c.className === 'space-colorbars')!
    expect(bars.children.map((b) => b.children[0].textContent)).toEqual(['s0', 's1'])
    expect(info).toHaveBeenCalledTimes(1)
    expect(String(info.mock.calls[0][0])).toMatch(/1 more colour scale not shown/)
    // A theme change redraws the bars without a second note.
    r.setPalette(DARK_PALETTE, 'dark')
    expect(bars.children).toHaveLength(2)
    expect(info).toHaveBeenCalledTimes(1)
    r.setScene(scene([helix]), CONFIG)
    expect(bars.children).toHaveLength(0)
    r.dispose()
    info.mockRestore()
  })

  it("draws with the spec's @depthcue: off (the cue uniform is 0 for every mark)", () => {
    const fake = createFakeGl()
    const { canvas } = mount(fake)
    const clock = fakeEnv()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    const parsed = parseSpec('@depthcue: off\n(cos(t), sin(t), t/10) for t in [0, 12]')
    r.setSpec(parsed.statements, parsed.config, parsed.statementLines)
    clock.flush()
    const cues = fake.calls.filter((c) => c.fn === 'uniform1f' && (c.args[0] as { uniform?: string }).uniform === 'u_cue').map((c) => c.args[1])
    expect(cues.length).toBeGreaterThan(0)
    expect(new Set(cues)).toEqual(new Set([0]))
    r.dispose()
  })
})

describe('SpaceRenderer: the probe and pins', () => {
  // A saddle through the box centre: the ray through the middle of the view
  // meets it at the origin.
  // Every evaluation of f is counted: only the probe's pick evaluates it.
  let evaluations = 0
  const saddle = graphMesh(
    (x, y) => {
      evaluations++
      return x * x - y * y
    },
    (x) => 2 * x,
    (_x, y) => -2 * y,
    -2,
    2,
    -2,
    2,
    32,
    { line: 3 },
  )

  function live(config: Parameters<SpaceRenderer['setScene']>[1] = CONFIG) {
    const fake = createFakeGl()
    const { canvas, parent } = mount(fake)
    const clock = fakeEnv()
    const events: SpaceEvent[] = []
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light', onEvent: (e) => events.push(e) }, clock.env)
    r.setScene(scene([saddle]), config)
    clock.flush()
    const overlay = parent.children.find((c) => c.className === 'space-overlay')!
    const readouts = () => overlay.children.filter((c) => c.className === 'space-readout')
    const pointer = (type: string, x: number, y: number, buttons: number) =>
      canvas.dispatch(type, { pointerId: 1, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons, shiftKey: false })
    return { fake, canvas, clock, events, r, readouts, pointer }
  }

  it('picks once per frame on hover, shows a readout with the partials, and reports the mark once', () => {
    const { clock, events, r, readouts, pointer } = live()
    evaluations = 0
    for (let dx = 0; dx < 5; dx++) pointer('pointermove', 400 + dx * 0.01, 300, 0)
    // Five moves, no pick yet: it waits for the frame.
    expect(evaluations).toBe(0)
    expect(readouts()).toHaveLength(0)
    clock.flush()
    const once = evaluations
    expect(once).toBeGreaterThan(0)
    const [box] = readouts()
    expect(box).toBeDefined()
    const [title, rows] = box.children
    expect(title.textContent).toBe('line 3')
    const labels = rows.children.map((c) => c.textContent)
    expect(labels).toContain('∂f/∂x')
    expect(labels).toContain('∂f/∂y')
    expect(events.filter((e) => e.type === 'hover')).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'hover', hit: { kind: 'graph', source: { object: 's3' } } })
    // Moving over the same mark reports nothing new; leaving reports null.
    pointer('pointermove', 402, 301, 0)
    clock.flush()
    expect(events).toHaveLength(1)
    r['hoverAt'](null, null)
    expect(events.at(-1)).toEqual({ type: 'hover', hit: null })
    clock.flush()
    expect(readouts()).toHaveLength(0)
    r.dispose()
  })

  it('pins on a click, unpins on a click at the marker, and clears on Esc, reporting each', () => {
    const { clock, canvas, events, r, readouts, pointer } = live()
    pointer('pointerdown', 400, 300, 1)
    pointer('pointerup', 400, 300, 0)
    clock.flush()
    expect(events.filter((e) => e.type === 'pin')).toMatchObject([{ action: 'add', hit: { kind: 'graph' } }])
    expect(readouts().filter((b) => b.dataset.pinned === 'true')).toHaveLength(1)
    // A 5 px drag is not a click.
    pointer('pointerdown', 300, 300, 1)
    pointer('pointermove', 305, 300, 1)
    pointer('pointerup', 305, 300, 0)
    expect(events.filter((e) => e.type === 'pin')).toHaveLength(1)
    canvas.dispatch('keydown', { key: 'Escape' })
    expect(events.filter((e) => e.type === 'pin').at(-1)).toEqual({ type: 'pin', action: 'clear', hit: null })
    clock.flush()
    expect(readouts()).toHaveLength(0)
    r.dispose()
  })

  it('does neither under @hover: none', () => {
    const { clock, events, r, readouts, pointer } = live({ ...CONFIG, hover: 'none' })
    pointer('pointermove', 400, 300, 0)
    clock.flush()
    pointer('pointerdown', 400, 300, 1)
    pointer('pointerup', 400, 300, 0)
    clock.flush()
    expect(readouts()).toHaveLength(0)
    expect(events).toEqual([])
    r.dispose()
  })

  it('draws the probe marker and drop lines last, into the canvas, over everything', () => {
    const { fake, clock, r, pointer } = live()
    pointer('pointermove', 400, 300, 0)
    clock.flush()
    const last = fake.draws.slice(-6)
    expect(last.every((d) => d.framebuffer === null && !d.depthTest)).toBe(true)
    // Two AA passes of drop lines, feet and the ring.
    const programs = last.map((d) => /space: (\w+)/.exec(fake.programSource(d.program).vertex)?.[1])
    expect(programs).toEqual(['line', 'point', 'point', 'line', 'point', 'point'])
    r.dispose()
  })
})

describe('SpaceRenderer: parameters, play and drag', () => {
  const SPEC = `@param a = 0.5 range [-2, 2]
@param b = 1 range [-2, 2]
@param n = 3 range [1, 30] integer
z = x^2 + y^2 for x in [-2, 2], y in [-2, 2]
P = (a, b, a^2 + b^2)`

  function live() {
    const fake = createFakeGl()
    const { canvas, parent } = mount(fake)
    const clock = fakeEnv()
    const events: SpaceEvent[] = []
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light', onEvent: (e) => events.push(e) }, clock.env)
    const parsed = parseSpec(SPEC)
    r.setSpec(parsed.statements, parsed.config, parsed.statementLines, SPEC)
    clock.flush()
    const overlay = parent.children.find((c) => c.className === 'space-overlay')!
    const panel = overlay.children.find((c) => c.className === 'space-params')!
    const row = (i: number) => {
      const [name, slider, number, play, loop] = panel.children[i].children
      return { name, slider: slider as FakeElement & { value: string }, number: number as FakeElement & { value: string }, play, loop }
    }
    const kernel = () => r['kernel'] as SpaceKernel
    return { fake, canvas, clock, events, r, panel, row, kernel }
  }

  it('shows a row per binding, with its live value', () => {
    const { panel, row, r } = live()
    expect(panel.style.display).toBe('')
    expect(panel.children.map((c) => c.children[0].textContent)).toEqual(['a', 'b', 'n'])
    expect(row(0).slider.value).toBe('0.5')
    expect(row(2).number.value).toBe('3')
    // A hand-built scene has no parameters: the panel hides.
    r.setScene(scene([helix]), CONFIG)
    expect(panel.style.display).toBe('none')
    r.dispose()
  })

  it('coalesces 10 slider inputs in one frame into one setValue, held while still scrubbing (S6 fix round 1, I7)', () => {
    const { clock, events, row, kernel, r } = live()
    const setValues = vi.spyOn(kernel(), 'setValues')
    const { slider } = row(0)
    for (let i = 1; i <= 10; i++) {
      slider.value = String(i / 10)
      slider.dispatch('input')
    }
    expect(setValues).not.toHaveBeenCalled()
    clock.flush()
    // I7: every `input` before the matching `change` is still scrubbing —
    // held the same way a play or a point-drag is, so a box-dependent
    // statement (an implicit surface, a 3-variable contour:) meshes coarser
    // while the reader is still moving the slider.
    expect(setValues.mock.calls).toHaveLength(1)
    const [values, options] = setValues.mock.calls[0]
    expect(values).toEqual(new Map([['a', 1]]))
    expect(options?.holdBox).toBeDefined()
    expect(events.filter((e) => e.type === 'param')).toEqual([{ type: 'param', name: 'a', value: 1, source: 'slider' }])
    // The native `change` (release) rebuilds once more, this time not held
    // — the slider path's equivalent of a drag's one solve at release.
    slider.dispatch('change')
    clock.flush()
    expect(setValues.mock.calls).toHaveLength(2)
    expect(setValues.mock.calls[1]).toEqual([new Map([['a', 1]]), undefined])
    r.dispose()
  })

  it('commits the number box on Enter, and reports nothing for a host setValue', () => {
    const { clock, events, row, kernel, r } = live()
    const { number } = row(1)
    number.value = '-1.25'
    number.dispatch('keydown', { key: 'Enter' })
    clock.flush()
    expect(kernel().values().get('b')).toBe(-1.25)
    r.setValue('b', 0.75)
    clock.flush()
    expect(kernel().values().get('b')).toBe(0.75)
    expect(events.filter((e) => e.type === 'param').map((e) => e.type === 'param' && e.source)).toEqual(['slider'])
    r.dispose()
  })

  it('plays a binding min -> max over 6 s, stepping an integer one, then stops asking for frames', () => {
    const { clock, events, row, kernel, r } = live()
    row(2).play.dispatch('click')
    expect(row(2).play.textContent).toBe('❚❚')
    // Frames every 16 ms; after about 3.2 s the integer n is near round(1 + 29 * 3.2 / 6) = 16.
    let frames = 0
    while (clock.pending() > 0 && frames < 1000) {
      clock.flush()
      frames++
    }
    // 6 s at 16 ms a frame, and not a standing loop after it.
    expect(frames).toBeGreaterThan(300)
    expect(frames).toBeLessThan(400)
    expect(kernel().values().get('n')).toBe(30)
    expect(row(2).play.textContent).toBe('▶')
    const played = events.filter((e) => e.type === 'param' && e.name === 'n')
    expect(played.every((e) => e.type === 'param' && e.source === 'play' && Number.isInteger(e.value))).toBe(true)
    expect(played.at(-1)).toMatchObject({ value: 30 })
    r.dispose()
  })

  it('drags P = (a, b, a^2 + b^2) under the cursor instead of orbiting, writing a and b', () => {
    const { clock, canvas, events, kernel, r } = live()
    const camera = r['camera']()!
    const world = r['world']!
    const at = (p: readonly [number, number, number]) => project(camera, world.toWorld(p))
    const start = at([0.5, 1, 1.25])
    const view = r.getView()
    const pointer = (type: string, x: number, y: number, buttons: number) =>
      canvas.dispatch(type, { pointerId: 1, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons, shiftKey: false })
    pointer('pointerdown', start.x, start.y, 1)
    // S6 plan V5: grabbing a draggable point sets the cursor.
    expect(canvas.style.cursor).toBe('grabbing')
    const target = at([0.8, 1.2, 0.8 ** 2 + 1.2 ** 2])
    pointer('pointermove', target.x, target.y, 1)
    clock.flush()
    pointer('pointerup', target.x, target.y, 0)
    expect(canvas.style.cursor).toBe('')
    expect(r.getView()).toEqual(view)
    expect(kernel().values().get('a')).toBeCloseTo(0.8, 6)
    expect(kernel().values().get('b')).toBeCloseTo(1.2, 6)
    expect(new Set(events.filter((e) => e.type === 'param').map((e) => e.type === 'param' && e.source))).toEqual(new Set(['drag']))
    r.dispose()
  })
})

describe('SpaceRenderer: a point on its own curve', () => {
  it('hovers and grabs P = (a, a^2, 0) on (t, t^2, 0): the point, not the curve', () => {
    const SPEC = `@param a = 0.5 range [-2, 2]
(t, t^2, 0) for t in [-2, 2]
P = (a, a^2, 0)`
    const fake = createFakeGl()
    const { canvas } = mount(fake)
    const clock = fakeEnv()
    const events: SpaceEvent[] = []
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light', onEvent: (e) => events.push(e) }, clock.env)
    const parsed = parseSpec(SPEC)
    r.setSpec(parsed.statements, parsed.config, parsed.statementLines, SPEC)
    clock.flush()
    const camera = r['camera']()!
    const world = r['world']!
    const at = project(camera, world.toWorld([0.5, 0.25, 0]))
    const pointer = (type: string, x: number, y: number, buttons: number) =>
      canvas.dispatch(type, { pointerId: 1, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons, shiftKey: false })
    pointer('pointermove', at.x, at.y, 0)
    clock.flush()
    expect(events.at(-1)).toMatchObject({ type: 'hover', hit: { kind: 'point' } })
    // S6 plan V5: hovering a draggable point shows the grab cursor.
    expect(canvas.style.cursor).toBe('grab')
    const view = r.getView()
    const target = project(camera, world.toWorld([1, 1, 0]))
    pointer('pointerdown', at.x, at.y, 1)
    expect(canvas.style.cursor).toBe('grabbing')
    pointer('pointermove', target.x, target.y, 1)
    clock.flush()
    pointer('pointerup', target.x, target.y, 0)
    expect(canvas.style.cursor).toBe('')
    expect(r.getView()).toEqual(view)
    expect((r['kernel'] as SpaceKernel).values().get('a')).toBeCloseTo(1, 6)
    r.dispose()
  })
})

describe('SpaceRenderer: value changes, the probe, pins and the box', () => {
  const SPEC = `@param a = 1 range [0.5, 2]
z = a*x^2 + y^2 for x in [-2, 2], y in [-2, 2]
P = (a, 0, 0)`

  function live(spec = SPEC) {
    const fake = createFakeGl()
    const { canvas, parent, doc } = mount(fake)
    const clock = fakeEnv()
    const events: SpaceEvent[] = []
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light', onEvent: (e) => events.push(e) }, clock.env)
    const load = (text: string, withSource = true) => {
      const parsed = parseSpec(text)
      r.setSpec(parsed.statements, parsed.config, parsed.statementLines, withSource ? text : undefined)
      clock.flush()
    }
    load(spec)
    const overlay = parent.children.find((c) => c.className === 'space-overlay')!
    const readouts = () => overlay.children.filter((c) => c.className === 'space-readout')
    const value = (box: FakeElement, label: string) => {
      const rows = box.children[1].children
      const i = rows.findIndex((c) => c.textContent === label)
      return i >= 0 ? rows[i + 1].textContent : undefined
    }
    const pointer = (type: string, x: number, y: number, buttons: number) =>
      canvas.dispatch(type, { pointerId: 1, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons, shiftKey: false })
    const panel = overlay.children.find((c) => c.className === 'space-params')!
    const play = () => panel.children[0].children[3].dispatch('click')
    return { fake, canvas, doc, clock, events, r, load, overlay, readouts, value, pointer, play }
  }

  it('re-reads the probe through each new scene during play: one hover event, no re-pick', () => {
    const { clock, events, r, readouts, value, pointer, play } = live()
    pointer('pointermove', 400, 300, 0)
    clock.flush()
    const first = value(readouts()[0], 'z')
    play()
    for (let i = 0; i < 10; i++) clock.flush()
    expect(events.filter((e) => e.type === 'hover')).toHaveLength(1)
    // The same (x, y) on the surface, the new z.
    expect(value(readouts()[0], 'z')).not.toBe(first)
    expect(r['pendingHover']).toBeNull()
    r.dispose()
  })

  it('holds the box and the camera target still while playing, and resolves them once when play stops', () => {
    const { clock, r, play } = live()
    const before = r['world']
    const target = r.getView().target
    play()
    for (let i = 0; i < 10; i++) {
      clock.flush()
      expect(r['world']).toBe(before)
      expect(r.getView().target).toEqual(target)
    }
    // Stopped by hand, with no value change in that frame: resolved once.
    // (a started over at 0.5 and has barely moved: z tops out near 6, not 8.)
    play()
    clock.flush()
    expect(r['world']).not.toBe(before)
    expect(r['world']!.box.z.max).toBeLessThan(before!.box.z.max)
    // a runs 0.5 -> 2 over 6 s: played to the end in 1.5 s jumps of the fake
    // clock (frames at +1.516, +3.032, +4.548 and +6.064 s), the box is held
    // on every frame of the play and resolved exactly once, on the last, to
    // follow a = 2; then no frame is asked for.
    play()
    const held = r['world']
    const worlds: unknown[] = []
    for (let i = 0; i < 6 && clock.pending() > 0; i++) {
      clock.advance(1500)
      clock.flush()
      worlds.push(r['world'])
    }
    expect(worlds).toHaveLength(4)
    expect(worlds.slice(0, -1).every((w) => w === held)).toBe(true)
    expect(worlds.at(-1)).not.toBe(held)
    expect(clock.pending()).toBe(0)
    // z reaches 2 * 4 + 4 = 12, past the first box's top.
    expect(r['world']!.box.z.max).toBeGreaterThanOrEqual(12)
    expect(before!.box.z.max).toBeLessThan(12)
    r.dispose()
  })

  it('builds box-dependent statements in the held box during play, and in the resolved box once it stops (J1)', () => {
    // plane: x = 1 spans the box's z: [0, 8] at a = 1 (4 + 4), and it grows
    // with a once play stops, never while the frame holds still.
    const { clock, r, play } = live(`${SPEC}
plane: x = 1`)
    const planeZ = () => {
      const plane = (r['scene'] as SpaceScene).marks.find((m) => m.source.object === 's4')!
      if (plane.kind !== 'mesh') throw new Error('not a mesh')
      let max = -Infinity
      for (let i = 2; i < plane.positions.length; i += 3) max = Math.max(max, plane.positions[i])
      return max
    }
    const held = r['world']!.box.z.max
    expect(planeZ()).toBe(held)
    play()
    for (let i = 0; i < 6 && clock.pending() > 0; i++) {
      clock.advance(1500)
      clock.flush()
      // every frame, the plane reaches exactly the top of the box drawn
      expect(planeZ()).toBe(r['world']!.box.z.max)
    }
    // a = 2 at the end: z reaches 2 * 4 + 4 = 12, and so does the plane.
    expect(r['world']!.box.z.max).toBeGreaterThanOrEqual(12)
    expect(planeZ()).toBe(r['world']!.box.z.max)
    r.dispose()
  })

  it('rebuilds box-dependent statements in the resolved box when a drag ends with no last move (a cancelled pointer)', () => {
    // Dragging P = (a, 0, 0) from x = 1 to 1.6 raises a*x^2 + y^2's top from
    // 8 to 10.4. While dragging, the box holds and plane: x = 1 stays in it;
    // a pointercancel ends the drag with no position, so no value changes on
    // the last frame: the held box resolves then, and the plane follows it.
    const { clock, r, pointer } = live(`${SPEC}
plane: x = 1`)
    const planeZ = () => {
      const plane = (r['scene'] as SpaceScene).marks.find((m) => m.source.object === 's4')!
      if (plane.kind !== 'mesh') throw new Error('not a mesh')
      let max = -Infinity
      for (let i = 2; i < plane.positions.length; i += 3) max = Math.max(max, plane.positions[i])
      return max
    }
    const camera = r['camera']()!
    const world = r['world']!
    const at = (p: readonly [number, number, number]) => project(camera, world.toWorld(p))
    const start = at([1, 0, 0])
    const end = at([1.6, 0, 0])
    pointer('pointerdown', start.x, start.y, 1)
    pointer('pointermove', end.x, end.y, 1)
    clock.flush()
    const held = r['world']!.box.z.max
    expect(held).toBe(world.box.z.max)
    expect((r['kernel'] as SpaceKernel).values().get('a')).toBeCloseTo(1.6, 6)
    expect(planeZ()).toBe(held)
    pointer('pointercancel', end.x, end.y, 0)
    clock.flush()
    expect(r['dragging']).toBeNull()
    expect(r['world']!.box.z.max).toBeGreaterThan(held)
    expect(planeZ()).toBe(r['world']!.box.z.max)
    r.dispose()
  })

  it('moves a pin with a value change (the pin on the surface reads the new z)', () => {
    const { clock, r, readouts, value, pointer } = live()
    pointer('pointerdown', 400, 300, 1)
    pointer('pointerup', 400, 300, 0)
    clock.flush()
    const pinned = () => readouts().find((b) => b.dataset.pinned === 'true')!
    const x = Number(value(pinned(), 'x')!.replace('−', '-'))
    const y = Number(value(pinned(), 'y')!.replace('−', '-'))
    r.setValue('a', 2)
    clock.flush()
    const z = Number(value(pinned(), 'z')!.replace('−', '-'))
    // z = 2 x^2 + y^2 at the pinned (x, y), to the readout's 4 digits.
    expect(z).toBeCloseTo(2 * x * x + y * y, 2)
    r.dispose()
  })

  it('solves a drag once more at its release, so a last move with no frame after it is not lost', () => {
    const { clock, r, pointer } = live()
    const camera = r['camera']()!
    const world = r['world']!
    const at = (p: readonly [number, number, number]) => project(camera, world.toWorld(p))
    const start = at([1, 0, 0])
    const end = at([1.6, 0, 0])
    pointer('pointerdown', start.x, start.y, 1)
    pointer('pointermove', (start.x + end.x) / 2, (start.y + end.y) / 2, 1)
    pointer('pointerup', end.x, end.y, 0)
    clock.flush()
    expect((r['kernel'] as SpaceKernel).values().get('a')).toBeCloseTo(1.6, 6)
    expect(r['dragging']).toBeNull()
    r.dispose()
  })

  it('notes extra colour scales once per spec, not per value change, and keeps an unchanged colorbar', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const spec = `@param a = 1 range [0.5, 2]
z = x^2 for x in [-2, 2], y in [-2, 2]
z = y^2 for x in [-2, 2], y in [-2, 2]
z = x y for x in [-2, 2], y in [-2, 2]
P = (a, 0, 0)`
    const { clock, r, overlay } = live(spec)
    expect(info).toHaveBeenCalledTimes(1)
    const bars = overlay.children.find((c) => c.className === 'space-colorbars')!
    const block = bars.children[0]
    for (const v of [1.2, 1.4, 1.6]) {
      r.setValue('a', v)
      clock.flush()
    }
    expect(info).toHaveBeenCalledTimes(1)
    // P moved; the surfaces and their colorbars did not: the same DOM.
    expect(bars.children[0]).toBe(block)
    info.mockRestore()
    r.dispose()
  })

  it('keeps a pin across a spec edit only while its statement line reads the same', () => {
    const { clock, r, load, readouts, pointer } = live()
    const pinned = () => readouts().filter((b) => b.dataset.pinned === 'true')
    pointer('pointerdown', 400, 300, 1)
    pointer('pointerup', 400, 300, 0)
    clock.flush()
    expect(pinned()).toHaveLength(1)
    // A line appended: the surface is still line 2 with the same text.
    load(`${SPEC}\nQ = (0, 0, 1)`)
    expect(pinned()).toHaveLength(1)
    // A surface inserted above: line 2 (object s2, which the pin was on) is
    // now ANOTHER graph surface, which re-evaluation alone would reattach the
    // pin to. The pin is dropped instead.
    const lines = SPEC.split('\n')
    load([lines[0], 'z = x^2 - y^2 for x in [-2, 2], y in [-2, 2]', ...lines.slice(1)].join('\n'))
    expect(pinned()).toHaveLength(0)
    r.dispose()
  })

  it('drops pins across a spec set with no source text (their lines cannot be checked)', () => {
    const { clock, load, readouts, pointer, r } = live()
    const pinned = () => readouts().filter((b) => b.dataset.pinned === 'true')
    const pin = () => {
      pointer('pointerdown', 400, 300, 1)
      pointer('pointerup', 400, 300, 0)
      clock.flush()
    }
    pin()
    load(SPEC, false)
    expect(pinned()).toHaveLength(0)
    // Pinned with no source text, then the same spec with it: still dropped.
    pin()
    expect(pinned()).toHaveLength(1)
    load(SPEC)
    expect(pinned()).toHaveLength(0)
    r.dispose()
  })

  it('rebuilds a two-parameter dragged point once per frame', async () => {
    const { registerBuilder } = await import('./kernel/registry')
    const { POINT } = await import('./kernel/primitives')
    let builds = 0
    registerBuilder('point', {
      ...POINT,
      prepare: (statement, context) => {
        const prepared = POINT.prepare(statement, context)
        return {
          reads: prepared.reads,
          build: () => {
            builds++
            return prepared.build()
          },
        }
      },
    })
    try {
      const spec = `@param a = 0.8 range [-2, 2]
@param b = 0.6 range [-2, 2]
P = (a, b, a^2 + b^2)`
      const { clock, r, pointer } = live(spec)
      const camera = r['camera']()!
      const world = r['world']!
      const at = (p: readonly [number, number, number]) => project(camera, world.toWorld(p))
      const start = at([0.8, 0.6, 1])
      const end = at([0.9, 0.7, 1.3])
      pointer('pointerdown', start.x, start.y, 1)
      builds = 0
      pointer('pointermove', end.x, end.y, 1)
      clock.flush()
      // a and b both changed; P was built once.
      expect((r['kernel'] as SpaceKernel).values().get('b')).toBeCloseTo(0.7, 6)
      expect(builds).toBe(1)
      r.dispose()
    } finally {
      registerBuilder('point', POINT)
    }
  })
})

// S6 carried item (b): chromeRects() used to call getBoundingClientRect()
// on the panel, the colorbars and every readout box on every draw. The
// panel and the colorbars only move on a resize, the panel's own
// collapse/expand, or a row/colorbar count change, so their rectangles are
// now cached against a signature of exactly those; the readout boxes are
// excluded from that cache because they are repositioned on nearly every
// draw (the camera, a play, a drag, or a plain hover), with no change in
// how many there are, so a count-only cache would serve a stale rectangle
// for a box that has visibly moved.
describe('SpaceRenderer: chromeRects caches the panel and colorbars, never the readouts', () => {
  const TWO_PARAMS = `@param a = 1 range [0.5, 2]
@param b = 1 range [0.5, 2]
z = a*x^2 + y^2 for x in [-2, 2], y in [-2, 2]
P = (a, 0, 0)`

  function live(spec = TWO_PARAMS) {
    const fake = createFakeGl()
    const { canvas, parent } = mount(fake)
    const clock = fakeEnv()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    const overlay = parent.children.find((c) => c.className === 'space-overlay')!
    const panel = overlay.children.find((c) => c.className === 'space-params')!
    const bars = overlay.children.find((c) => c.className === 'space-colorbars')!
    // A fixed non-zero rect, so rectOf() keeps it (a zero-sized one drops
    // out on its own and would hide a caching bug behind that early exit).
    // Spied before the first load, so the initial computation is counted too.
    const spyRect = (el: FakeElement, width: number, height: number) => {
      const spy = vi.fn(() => ({ left: 10, top: 10, width, height, right: 10 + width, bottom: 10 + height }))
      el.getBoundingClientRect = spy
      return spy
    }
    const panelSpy = spyRect(panel, 200, 40)
    const barsSpy = spyRect(bars, 12, 160)
    const load = (text: string) => {
      const parsed = parseSpec(text)
      r.setSpec(parsed.statements, parsed.config, parsed.statementLines, text)
      clock.flush()
    }
    load(spec)
    const readouts = () => overlay.children.filter((c) => c.className === 'space-readout')
    const pointer = (type: string, x: number, y: number, buttons: number) =>
      canvas.dispatch(type, { pointerId: 1, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons, shiftKey: false })
    return { fake, canvas, clock, r, overlay, panel, bars, readouts, panelSpy, barsSpy, pointer, load }
  }

  it('reuses the panel and colorbar rectangles across frames where only the camera or a readout changes', () => {
    const { clock, r, panelSpy, barsSpy, pointer } = live()
    // The initial draw (inside load()) computed both once.
    expect(panelSpy).toHaveBeenCalledTimes(1)
    expect(barsSpy).toHaveBeenCalledTimes(1)

    // A hover brings up a readout and moves it across two frames; a camera
    // change follows. None of that touches the panel or the colorbars.
    pointer('pointermove', 400, 300, 0)
    clock.flush()
    pointer('pointermove', 420, 310, 0)
    clock.flush()
    r.setView({ ...r.getView(), azimuth: r.getView().azimuth + 5 })
    clock.flush()

    expect(panelSpy).toHaveBeenCalledTimes(1)
    expect(barsSpy).toHaveBeenCalledTimes(1)
    r.dispose()
  })

  it('never caches a readout box: its rectangle is measured fresh on every draw that shows it', () => {
    // A pinned box (I6: only a pinned readout is a chrome obstacle at all —
    // the hover probe's own box is deliberately excluded, see below), moved
    // by the camera rather than the pointer across the two later frames.
    const { clock, r, readouts, pointer } = live()
    pointer('pointerdown', 400, 300, 1)
    pointer('pointerup', 400, 300, 0)
    clock.flush()
    const [box] = readouts()
    expect(box).toBeDefined()
    expect(box.dataset.pinned).toBe('true')
    const boxSpy = vi.fn(() => ({ left: 0, top: 0, width: 80, height: 24, right: 80, bottom: 24 }))
    box.getBoundingClientRect = boxSpy
    r.setView({ ...r.getView(), azimuth: r.getView().azimuth + 5 })
    clock.flush()
    r.setView({ ...r.getView(), azimuth: r.getView().azimuth + 5 })
    clock.flush()
    expect(boxSpy.mock.calls.length).toBe(2)
    r.dispose()
  })

  it('I6: the hover probe box is never a chrome obstacle, pinned or not — only pinned readouts are', () => {
    const { clock, r, readouts, pointer } = live()
    pointer('pointermove', 400, 300, 0)
    clock.flush()
    const [box] = readouts()
    expect(box).toBeDefined()
    expect(box.dataset.pinned).toBeUndefined()
    const boxSpy = vi.fn(() => ({ left: 0, top: 0, width: 80, height: 24, right: 80, bottom: 24 }))
    box.getBoundingClientRect = boxSpy
    pointer('pointermove', 420, 310, 0)
    clock.flush()
    // A tick label may sit right under the cursor without ever contesting
    // it: the probe's own box is not measured for chromeRects() at all.
    expect(boxSpy).not.toHaveBeenCalled()
    r.dispose()
  })

  it('recomputes on a resize', () => {
    const { canvas, clock, r, panelSpy, barsSpy } = live()
    const before = panelSpy.mock.calls.length
    canvas.clientHeight = 700
    clock.resize()
    expect(panelSpy.mock.calls.length).toBeGreaterThan(before)
    expect(barsSpy.mock.calls.length).toBeGreaterThan(before)
    r.dispose()
  })

  it('recomputes when the panel expands or collapses', () => {
    const { r, panel, panelSpy } = live()
    // Two rows and no interaction yet: the panel starts collapsed to a chip.
    expect(panel.dataset.collapsed).toBe('true')
    const before = panelSpy.mock.calls.length
    panel.dispatch('mouseenter')
    expect(panel.dataset.collapsed).toBeUndefined()
    r['draw']()
    expect(panelSpy.mock.calls.length).toBeGreaterThan(before)
    const afterExpand = panelSpy.mock.calls.length
    panel.dispatch('mouseleave')
    expect(panel.dataset.collapsed).toBe('true')
    r['draw']()
    expect(panelSpy.mock.calls.length).toBeGreaterThan(afterExpand)
    r.dispose()
  })

  it('I6: the collapse or expand path requests a frame on its own — no manual draw() needed', () => {
    const { clock, r, panel, panelSpy } = live()
    expect(panel.dataset.collapsed).toBe('true')
    expect(clock.pending()).toBe(0)
    const before = panelSpy.mock.calls.length
    // A plain DOM event, nothing else: no pointer or camera activity that
    // would otherwise have scheduled a frame of its own.
    panel.dispatch('mouseenter')
    expect(clock.pending()).toBe(1)
    clock.flush()
    expect(panelSpy.mock.calls.length).toBeGreaterThan(before)
    r.dispose()
  })

  it('recomputes when the bindings change the row count', () => {
    const { r, panelSpy, load } = live()
    const before = panelSpy.mock.calls.length
    load('@param a = 1 range [0.5, 2]\nz = a*x^2 + y^2 for x in [-2, 2], y in [-2, 2]')
    expect(panelSpy.mock.calls.length).toBeGreaterThan(before)
    r.dispose()
  })

  it("I6: the colorbar obstacle is the union of its own box and its tick labels' — a tick sits outside the body's own box (SpaceView.css's `right: 18px`)", () => {
    const fake = createFakeGl()
    const { canvas, parent } = mount(fake)
    const clock = fakeEnv()
    const r = new SpaceRenderer(canvas as unknown as HTMLCanvasElement, { palette: LIGHT_PALETTE, theme: 'light' }, clock.env)
    const mesh = meshMark([0, 0, 0, 1, 0, 0, 0, 1, 1], [0, 0, 1, 0, 0, 1, 0, 0, 1], [0, 1, 2], { style: { colorScale: 0 } })
    const scales = [{ id: 0, title: 's0', map: 'viridis' as const, domain: { min: 0, max: 1 }, diverging: false }]
    r.setScene({ ...scene([mesh]), colorScales: scales }, CONFIG)
    const overlay = parent.children.find((c) => c.className === 'space-overlay')!
    const bars = overlay.children.find((c) => c.className === 'space-colorbars')!
    const body = bars.children[0].children[1]
    const tick = body.children.find((c) => c.className === 'space-colorbar-tick')!
    // The container sits well inset from the overlay's left edge; a tick
    // label's `right: 18px` (SpaceView.css) places it 18 px+ further left
    // of .space-colorbar-body's own 12 px-wide box — outside the
    // container's own measured rect, since an absolutely positioned child
    // never grows its parent's box.
    bars.getBoundingClientRect = () => ({ left: 700, top: 100, width: 40, height: 180, right: 740, bottom: 280 })
    tick.getBoundingClientRect = () => ({ left: 650, top: 150, width: 30, height: 14, right: 680, bottom: 164 })
    const rects = r['chromeRects']() as { x: number; y: number; width: number; height: number }[]
    // The colorbar obstacle (not the panel, which is empty/hidden here — no
    // @param) reaches left to the tick, not just the container.
    const left = (rect: { x: number; width: number }) => rect.x - rect.width / 2
    expect(rects.some((rect) => left(rect) <= 650)).toBe(true)
    r.dispose()
  })
})


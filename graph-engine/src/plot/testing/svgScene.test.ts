import { describe, expect, it } from 'vitest'
import { parseSpec } from '../../parser/parseSpec'
import { buildScene } from '../../scene/buildScene'
import { chainOf } from '../../scene/chains'
import type { Chain, Scene } from '../../scene/types'
import { type CorpusView, view } from './corpus'
import { sceneToSvg, svgFrame } from './svgScene'

const STD: CorpusView = view(-10, 10, -10, 10)

function sceneOf(spec: string, v: CorpusView = STD): Scene {
  const parsed = parseSpec(spec)
  return buildScene(parsed.statements, v.bounds, parsed.config, undefined, parsed.statementLines, { widthPx: v.widthPx, heightPx: v.heightPx })
}

const count = (svg: string, pattern: RegExp) => (svg.match(pattern) ?? []).length

describe('sceneToSvg', () => {
  // poles, a hole, a jump with open and filled ends, and a band: one of everything the sampler makes
  const scene = sceneOf('y = tan(x)\ny = (x^2 - 1)/(x - 1)\ny = {x <= 0: x^2, x + 1}\ny = sin(500x)')
  const svg = sceneToSvg(scene, STD)
  const chains = scene.objects.flatMap((o) => (o.kind === 'curve' ? o.chains : []))
  const marks = scene.objects.flatMap((o) => (o.kind === 'mark' ? [o] : []))

  it('holds no NaN and no Infinity, and the view as its box', () => {
    expect(scene.errors).toEqual([])
    expect(svg).not.toMatch(/NaN|Infinity/)
    expect(svg).toMatch(/viewBox="0 0 800 800"/)
  })

  it('draws one polyline per chain', () => {
    expect(chains.length).toBeGreaterThan(10)
    expect(count(svg, /<polyline /g)).toBe(chains.length)
  })

  it('draws one circle per mark: a ring (fill none) for an open one, a dot for a filled one', () => {
    // the hole of (x^2 - 1)/(x - 1), and the two ends at the seam of the piecewise: two open, one filled
    expect(marks.map((m) => m.fill).sort()).toEqual(['filled', 'open', 'open'])
    expect(count(svg, /<circle [^>]*data-mark=/g)).toBe(marks.length)
    expect(count(svg, /<circle [^>]*data-mark="[a-z]+" fill="none"/g)).toBe(marks.filter((m) => m.fill === 'open').length)
    expect(count(svg, /<circle [^>]*data-mark="[a-z]+" fill="#[0-9a-f]{6}"/g)).toBe(marks.filter((m) => m.fill === 'filled').length)
  })

  it('draws a band as a filled path', () => {
    const bands = scene.objects.filter((o) => o.kind === 'band')
    expect(bands.length).toBeGreaterThan(0)
    expect(count(svg, /<path class="band" [^>]*fill="#[0-9a-f]{6}"/g)).toBe(bands.reduce((s, b) => s + (b.kind === 'band' ? b.outline.length : 0), 0))
  })

  it('draws each asymptote guide dashed, clipped to the view', () => {
    const guides = scene.objects.filter((o) => o.kind === 'line' && o.role === 'asymptote' && Math.abs(o.through.x) <= 10)
    expect(guides.length).toBeGreaterThanOrEqual(6)
    const dashed = svg.match(/<line [^>]*stroke-dasharray="[^"]+" data-role="asymptote"\/>/g) ?? []
    expect(dashed).toHaveLength(guides.length)
    // the guide at pi/2: the view's whole height, at the x pi/2 is at
    const at = ((Math.PI / 2 + 10) * 800) / 20
    const guide = dashed.find((d) => Math.abs(Number(/x1="([^"]+)"/.exec(d)![1]) - at) < 0.01)!
    expect(guide).toBeDefined()
    const ys = [Number(/y1="([^"]+)"/.exec(guide)![1]), Number(/y2="([^"]+)"/.exec(guide)![1])].sort((a, b) => a - b)
    expect(ys).toEqual([0, 800])
  })

  it('leaves out a guide that is not in the view', () => {
    const away: Scene = { objects: [{ kind: 'line', through: { x: 50, y: 0 }, direction: { x: 0, y: 1 }, extent: 'infinite', role: 'asymptote' }], errors: [], regression: null }
    expect(sceneToSvg(away, STD)).not.toMatch(/data-role="asymptote"/)
  })

  it('closes a closed chain, and puts a flipped y axis under the view', () => {
    const triangle: Scene = { objects: [{ kind: 'curve', id: { statement: 0, object: 'curve' }, chains: [chainOf([{ x: -10, y: 10 }, { x: 10, y: 10 }, { x: 0, y: -10 }], [0, 1, 2], true)], breaks: [] }], errors: [], regression: null }
    const out = sceneToSvg(triangle, STD)
    // y up in the world is down the page: (-10, 10) is the top left corner
    expect(out).toMatch(/<polyline points="0\.00,0\.00 800\.00,0\.00 400\.00,800\.00 0\.00,0\.00"/)
  })

  it('draws points and segments as their plain shapes', () => {
    const plain: Scene = {
      objects: [
        { kind: 'point', label: null, position: { x: 1, y: 1 } },
        { kind: 'segment', from: { x: 0, y: 0 }, to: { x: 3, y: 4 }, dashed: true },
      ],
      errors: [],
      regression: null,
    }
    const out = sceneToSvg(plain, STD)
    expect(count(out, /<circle [^>]*data-kind="point"/g)).toBe(1)
    expect(out).toMatch(/<line [^>]*stroke-dasharray="6 5"\/>/)
  })

  describe('regions and dashed curves', () => {
    const ring = (r: number): Chain => chainOf(Array.from({ length: 16 }, (_, i) => ({ x: r * Math.cos((i * Math.PI) / 8), y: r * Math.sin((i * Math.PI) / 8) })), Array.from({ length: 16 }, (_, i) => i), true)
    const id = { statement: 0, object: 'region' }
    const annulus: Scene = { objects: [{ kind: 'region', id, outline: [ring(4), ring(8)], boundary: [] }], errors: [], regression: null }
    const out = sceneToSvg(annulus, STD)

    it('draws an annulus as one even-odd path with a subpath per ring, translucent, with no stroke', () => {
      const paths = out.match(/<path [^>]*fill-rule="evenodd"[^>]*>/g) ?? []
      expect(paths).toHaveLength(1)
      const path = paths[0]!
      expect(count(path, /M/g)).toBe(2)
      expect(path).toMatch(/fill-opacity="0\.18"/)
      expect(path).toMatch(/stroke="none"/)
      expect(out).not.toMatch(/NaN|Infinity/)
    })

    it('draws a region beneath the curves', () => {
      const both: Scene = { objects: [{ kind: 'curve', id: { statement: 0, object: 'curve' }, chains: [ring(6)], breaks: [] }, annulus.objects[0]], errors: [], regression: null }
      const o = sceneToSvg(both, STD)
      expect(o.indexOf('fill-rule="evenodd"')).toBeLessThan(o.indexOf('<polyline'))
    })

    it('draws a dashed curve with stroke-dasharray and a solid one without', () => {
      const curve = (dashed: boolean): Scene => ({ objects: [{ kind: 'curve', id: { statement: 0, object: 'curve' }, chains: [ring(6)], breaks: [], dashed }], errors: [], regression: null })
      expect(sceneToSvg(curve(true), STD)).toMatch(/<polyline [^>]*stroke-dasharray="7 5"/)
      expect(sceneToSvg(curve(false), STD)).not.toMatch(/stroke-dasharray/)
    })
  })

  it('takes a dark theme', () => {
    expect(sceneToSvg(scene, STD, { theme: 'dark' })).toContain('fill="#201e15"')
    expect(svg).toContain('fill="#fdf6ea"')
  })

  it('is byte-identical to the unframed drawer without a frame', () => {
    const fnv = (s: string) => {
      let h = 0x811c9dc5
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
      return h.toString(16)
    }
    const small = sceneOf('y = x^2')
    const wide = view(0, 6.28, -1.2, 1.2)
    expect([fnv(sceneToSvg(scene, STD)), fnv(sceneToSvg(small, STD)), fnv(sceneToSvg(sceneOf('y = sin(x)', wide), wide, { theme: 'dark' }))]).toEqual(['59efa1d5', '4b48d86e', '1b6ff8e5'])
  })

  describe('with a frame', () => {
    const framed = (spec: string, v: CorpusView, theme?: 'light' | 'dark') => {
      const parsed = parseSpec(spec)
      const sc = buildScene(parsed.statements, v.bounds, parsed.config, undefined, parsed.statementLines, { widthPx: v.widthPx, heightPx: v.heightPx })
      return sceneToSvg(sc, v, { theme, frame: svgFrame(v, parsed.config) })
    }
    const texts = (svg: string) => [...svg.matchAll(/<text [^>]*x="([^"]+)" y="([^"]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), s: m[3] }))
    const PI_VIEW = view(0, 2 * Math.PI, -1.2, 1.2)

    it('puts pi labels at the pixel x of their values', () => {
      const out = framed('y = sin(x)\n@xstep: pi/2', PI_VIEW)
      const ts = texts(out)
      for (const [s, k] of [['π/2', 1], ['π', 2], ['3π/2', 3], ['2π', 4]] as const) {
        const t = ts.find((q) => q.s === s)
        expect(t, s).toBeDefined()
        expect(Math.abs(t!.x - ((k * Math.PI) / 2) * (800 / (2 * Math.PI)))).toBeLessThan(0.5)
      }
    })

    it('labels log decades and draws faint minor lines', () => {
      const v = view(0, 4, 0, 4, 800, 800)
      const out = framed('y = x\n@yscale: log\n@bounds: 0,4,1,10000', v)
      const ts = texts(out).map((q) => q.s)
      for (const s of ['1', '10', '10²', '10³', '10⁴']) expect(ts).toContain(s)
      expect(count(out, /<line [^>]*data-grid="faint" data-axis="y"/g)).toBe(8 * 4)
    })

    it('pins y labels to the left edge when the y axis is off screen', () => {
      const out = framed('y = x', view(20, 30, -5, 5))
      const ys = texts(out).filter((q) => /^[−-]?[0-4]$/.test(q.s))
      expect(ys.length).toBeGreaterThan(3)
      for (const q of ys) expect(q.x).toBeLessThan(60)
    })

    it('renders an authored title as text, escaped', () => {
      const out = framed('y = x\n@titles: x "t (s) & <u>"', STD)
      expect(out).toContain('>t (s) &amp; &lt;u&gt;</text>')
    })

    it('holds no NaN and no Infinity, and is deterministic', () => {
      const spec = 'y = sin(x)\n@xstep: pi/2\n@titles: x "t (s)"'
      const a = framed(spec, PI_VIEW, 'dark')
      expect(a).not.toMatch(/NaN|Infinity/)
      expect(a).toContain('>t (s)</text>')
      expect(framed(spec, PI_VIEW, 'dark')).toBe(a)
    })

    it('draws the frame under the scene', () => {
      const out = framed('y = x', STD)
      expect(out.indexOf('<text')).toBeLessThan(out.indexOf('<polyline'))
    })
  })

  it('does not hide a number that is not finite: it is written, for the contact sheet to find', () => {
    const bad: Scene = { objects: [{ kind: 'curve', id: { statement: 0, object: 'curve' }, chains: [chainOf([{ x: 0, y: 0 }, { x: 1, y: Number.NaN }], [0, 1])], breaks: [] }], errors: [], regression: null }
    expect(sceneToSvg(bad, STD)).toMatch(/NaN/)
  })
})

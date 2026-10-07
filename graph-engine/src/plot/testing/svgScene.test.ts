import { describe, expect, it } from 'vitest'
import { parseSpec } from '../../parser/parseSpec'
import { buildScene } from '../../scene/buildScene'
import { chainOf } from '../../scene/chains'
import type { Scene } from '../../scene/types'
import { type CorpusView, view } from './corpus'
import { sceneToSvg } from './svgScene'

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

  it('draws points, segments and regions as their plain shapes', () => {
    const plain: Scene = {
      objects: [
        { kind: 'point', label: null, position: { x: 1, y: 1 } },
        { kind: 'segment', from: { x: 0, y: 0 }, to: { x: 3, y: 4 }, dashed: true },
        { kind: 'triangles', triangles: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      ],
      errors: [],
      regression: null,
    }
    const out = sceneToSvg(plain, STD)
    expect(count(out, /<circle [^>]*data-kind="point"/g)).toBe(1)
    expect(out).toMatch(/<line [^>]*stroke-dasharray="6 5"\/>/)
    // 40 px to a unit: (0, 0), (1, 0) and (0, 1) are the centre, 40 right of it and 40 above it
    expect(out).toMatch(/<path d="M400\.00,400\.00L440\.00,400\.00L400\.00,360\.00Z" fill="#[0-9a-f]{6}" fill-opacity="0\.18"/)
  })

  it('takes a dark theme', () => {
    expect(sceneToSvg(scene, STD, { theme: 'dark' })).toContain('fill="#201e15"')
    expect(svg).toContain('fill="#fdf6ea"')
  })

  it('does not hide a number that is not finite: it is written, for the contact sheet to find', () => {
    const bad: Scene = { objects: [{ kind: 'curve', id: { statement: 0, object: 'curve' }, chains: [chainOf([{ x: 0, y: 0 }, { x: 1, y: Number.NaN }], [0, 1])], breaks: [] }], errors: [], regression: null }
    expect(sceneToSvg(bad, STD)).toMatch(/NaN/)
  })
})

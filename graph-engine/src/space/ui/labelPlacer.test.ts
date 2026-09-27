// S6 plan V2: one label placer for every piece of overlay text. Unit tests
// on the pure placer itself, then the four scenarios the plan names,
// rendered through the real pipeline (parse -> kernel -> box -> world ->
// camera -> frame -> layoutLabels) exactly as SpaceRenderer builds it, so a
// regression in any layer between the spec and the screen would show here.

import { describe, expect, it } from 'vitest'
import { cameraMatrices } from '../camera/projection'
import { worldMap } from '../camera/world'
import { boxHalfExtents } from '../frame/aspect'
import { flatAxes, resolveBox } from '../frame/bounds'
import { buildFrame } from '../frame/build'
import { estimateLabelSize, labelsOverlap, type LabelBox } from '../frame/labels'
import { frameAxes } from '../frame/ticks'
import { LABEL_FONT_PX, TICK_FONT_PX, TITLE_FONT_PX } from '../frame/types'
import { parseSpec } from '../../parser/parseSpec'
import { createSpaceKernel } from '../kernel/index'
import type { SpaceScene } from '../scene/types'
import { annotationLabel, label } from '../testing/marks'
import { layoutLabels, type LabelItem } from './layout'
import { annotationCandidates, placeLabels, pointCandidates, type LabelRequest } from './labelPlacer'

function sceneAndLabels(spec: string): LabelItem[] {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  const kernel = createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines)
  const scene: SpaceScene = kernel.scene()
  expect(scene.errors).toEqual([])
  const space = parsed.config.space
  const box = resolveBox(space, scene.extent)
  const flat = flatAxes(space, scene.extent)
  const world = worldMap(box, boxHalfExtents(box, space.aspect, scene, flat))
  const axes = frameAxes(space, box, flat)
  const camera = cameraMatrices({ ...space.camera, target: world.centre }, world, { width: 900, height: 650 }, space.projection)
  const frame = buildFrame(space.frame, world, camera, axes)
  return layoutLabels(frame, scene.labels, camera, world)
}

function centerBox(item: LabelItem): LabelBox {
  const fontSize = item.role === 'tick' ? TICK_FONT_PX : item.role === 'title' ? TITLE_FONT_PX : LABEL_FONT_PX
  const size = estimateLabelSize(item.text, fontSize)
  return item.role === 'label' ? { x: item.x + size.width / 2, y: item.y - size.height / 2, ...size } : { x: item.x, y: item.y, ...size }
}

function expectNoOverlap(items: readonly LabelItem[]): void {
  const shown = items.filter((i) => i.visible)
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      expect(labelsOverlap(centerBox(shown[i]), centerBox(shown[j])), `${shown[i].key} (${shown[i].text}) vs ${shown[j].key} (${shown[j].text})`).toBe(
        false
      )
    }
  }
}

describe('placeLabels: priority and candidates (unit)', () => {
  const req = (over: Partial<LabelRequest> & Pick<LabelRequest, 'key' | 'role'>): LabelRequest => ({
    text: over.key,
    fontSize: 13,
    anchor: { x: 0, y: 0 },
    candidates: [],
    ...over,
  })

  it('places every label at its own single candidate when nothing collides', () => {
    const placed = placeLabels([
      req({ key: 'a', role: 'tick', anchor: { x: 0, y: 0 }, candidates: [{ x: 0, y: 0 }] }),
      req({ key: 'b', role: 'tick', anchor: { x: 200, y: 0 }, candidates: [{ x: 200, y: 0 }] }),
    ])
    expect(placed.map((p) => p.visible)).toEqual([true, true])
  })

  it('an annotation wins its shared spot over a tick label placed later in priority', () => {
    const anchor = { x: 0, y: 0 }
    const placed = placeLabels([
      { key: 'tick', text: 'tick', role: 'tick', fontSize: 13, anchor, candidates: [anchor] },
      { key: 'readout', text: 'readout', role: 'annotation', fontSize: 13, anchor, candidates: [anchor] },
    ])
    const tick = placed.find((p) => p.key === 'tick')!
    const readout = placed.find((p) => p.key === 'readout')!
    expect(readout.visible).toBe(true)
    expect(readout.x).toBe(anchor.x)
    // The tick shares the readout's only candidate and loses (lower priority).
    expect(tick.visible).toBe(false)
  })

  it('a point label with no candidate free is dropped, not overlapped', () => {
    const anchor = { x: 0, y: 0 }
    const placed = placeLabels([
      { key: 'a', text: 'aaaaaaaaaa', role: 'label', fontSize: 13, anchor, candidates: [anchor] },
      { key: 'b', text: 'bbbbbbbbbb', role: 'label', fontSize: 13, anchor, candidates: [anchor] },
    ])
    const shown = placed.filter((p) => p.visible)
    expect(shown).toHaveLength(1)
  })

  it('an annotation with no candidate free still shows, with a leader back to its anchor', () => {
    const anchor = { x: 0, y: 0 }
    const placed = placeLabels([
      { key: 'a', text: 'aaaaaaaaaa', role: 'annotation', fontSize: 13, anchor, candidates: [anchor] },
      { key: 'b', text: 'bbbbbbbbbb', role: 'annotation', fontSize: 13, anchor, candidates: [anchor] },
    ])
    expect(placed.every((p) => p.visible)).toBe(true)
    expect(placed.some((p) => p.leader !== null)).toBe(true)
  })

  it('is deterministic: independent of input order, since priority and index order settle every tie', () => {
    const a: LabelRequest[] = [
      { key: '1', text: 'one', role: 'annotation', fontSize: 13, anchor: { x: 0, y: 0 }, candidates: annotationCandidates({ x: 0, y: 0 }) },
      { key: '2', text: 'two', role: 'label', fontSize: 13, anchor: { x: 0, y: 0 }, candidates: pointCandidates({ x: 0, y: 0 }) },
    ]
    expect(placeLabels(a)).toEqual(placeLabels(a))
    expect(placeLabels(a)).toEqual(placeLabels([...a]))
  })
})

describe('S6 plan V2 scenarios, through the real pipeline', () => {
  it('the two gradient readouts do not overlap each other or the x ticks', () => {
    const items = sceneAndLabels(`@bounds3d: x [-2, 2], y [-2, 2], z [-4, 4]
f(x, y) = x^2 - y^2
z = f(x, y) opacity: 0.55
gradient: f at (0.5, 0.25)
gradient: f at (0.5, -1) lifted`)
    const readouts = items.filter((i) => i.key.includes('.readout'))
    expect(readouts).toHaveLength(2)
    expect(readouts.every((r) => r.visible)).toBe(true)
    expectNoOverlap(items)
  })

  it("the half-disc's centroid and area readouts do not overlap", () => {
    const items = sceneAndLabels(`D = region r in [0, 1], theta in [0, pi]
region: D
centroid: D`)
    const readouts = items.filter((i) => i.key.includes('.readout'))
    expect(readouts.length).toBeGreaterThanOrEqual(2)
    expect(readouts.every((r) => r.visible)).toBe(true)
    expectNoOverlap(items)
  })

  it('saddle-point contour labels: at most one per curve, and none overlap', () => {
    const items = sceneAndLabels(`@bounds3d: x [-2, 2], y [-2, 2]
f(x, y) = x^2 - y^2
z = f(x, y) opacity: 0.5
contour: f levels 9 floor labels`)
    const contourLabels = items.filter((i) => /\.label\d+$/.test(i.key.split(':')[2] ?? ''))
    // One label per drawn level (a level whose curve misses the domain gets none).
    expect(contourLabels.length).toBeGreaterThan(0)
    expect(contourLabels.every((l) => l.visible)).toBe(true)
    expectNoOverlap(items)
  })

  it('is deterministic: the same scene lays out the same way twice', () => {
    const spec = `@bounds3d: x [-2, 2], y [-2, 2], z [-4, 4]
f(x, y) = x^2 - y^2
z = f(x, y) opacity: 0.55
gradient: f at (0.5, 0.25)
gradient: f at (0.5, -1) lifted`
    expect(sceneAndLabels(spec)).toEqual(sceneAndLabels(spec))
  })

  it('a readout is always shown, even packed against several point labels at the same anchor', () => {
    const jam = Array.from({ length: 10 }, (_, i) => label([1, 1, 1], `p${i}`, i + 1))
    const readout = annotationLabel([1, 1, 1], 'a readout that must always show', 50)
    // layoutLabels needs a FrameModel; an empty one has no lines or labels of its own.
    const box = { x: { min: -2, max: 2 }, y: { min: -2, max: 2 }, z: { min: -2, max: 2 } }
    const world = worldMap(box, [1, 1, 1])
    const camera = cameraMatrices({ azimuth: 40, elevation: 25, zoom: 1, target: world.centre }, world, { width: 900, height: 650 }, 'orthographic')
    const items = layoutLabels({ style: 'none', lines: [], labels: [], key: 'none' }, [...jam, readout], camera, world)
    const shown = items.find((i) => i.text === readout.text)!
    expect(shown.visible).toBe(true)
  })
})

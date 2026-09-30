// S6 plan V2: one label placer for every piece of overlay text. Unit tests
// on the pure placer itself, then the four scenarios the plan names,
// rendered through the real pipeline (parse -> kernel -> box -> world ->
// camera -> frame -> layoutLabels) exactly as SpaceRenderer builds it, so a
// regression in any layer between the spec and the screen would show here.

import { describe, expect, it } from 'vitest'
import { cameraMatrices, project } from '../camera/projection'
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
  const box = resolveBox(space, scene.extent, scene.boxSpanning)
  const flat = flatAxes(space, scene.extent, scene.boxSpanning)
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

  it('I3: a contour value label loses to a point label at the same spot, and is dropped, not force-shown', () => {
    const anchor = { x: 0, y: 0 }
    const placed = placeLabels([
      { key: 'contour', text: 'contour value', role: 'contour', fontSize: 13, anchor, candidates: [anchor] },
      { key: 'point', text: 'point label', role: 'label', fontSize: 13, anchor, candidates: [anchor] },
    ])
    const point = placed.find((p) => p.key === 'point')!
    const contour = placed.find((p) => p.key === 'contour')!
    // A point label now outranks a contour value (the old bug: contour
    // shared 'annotation''s top priority and would have won here instead).
    expect(point.visible).toBe(true)
    expect(contour.visible).toBe(false)
    expect(contour.leader).toBeNull()
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

  it('is deterministic under a permuted input: priority and index order settle every tie regardless of array order', () => {
    const a: LabelRequest[] = [
      { key: '1', text: 'one', role: 'annotation', fontSize: 13, anchor: { x: 0, y: 0 }, candidates: annotationCandidates({ x: 0, y: 0 }) },
      { key: '2', text: 'two', role: 'label', fontSize: 13, anchor: { x: 0, y: 0 }, candidates: pointCandidates({ x: 0, y: 0 }) },
      { key: '3', text: 'three', role: 'contour', fontSize: 13, anchor: { x: 0, y: 0 }, candidates: annotationCandidates({ x: 0, y: 0 }) },
      { key: '4', text: 'four', role: 'tick', fontSize: 13, anchor: { x: 0, y: 0 }, candidates: [{ x: 0, y: 0 }] },
    ]
    // A genuine permutation (reversed), not a same-order copy: the result,
    // keyed and sorted back for comparison, must be the byte-same regardless
    // of the order placeLabels was handed the requests in.
    const byKey = (result: ReturnType<typeof placeLabels>) => new Map(result.map((p) => [p.key, p]))
    const forward = byKey(placeLabels(a))
    const reversed = byKey(placeLabels([...a].reverse()))
    const shuffled = byKey(placeLabels([a[2], a[0], a[3], a[1]]))
    for (const key of ['1', '2', '3', '4']) {
      expect(reversed.get(key)).toEqual(forward.get(key))
      expect(shuffled.get(key)).toEqual(forward.get(key))
    }
  })

  it('a placement more than 14 px from its anchor gets a leader, even when nothing blocked the closer candidates (I3)', () => {
    const anchor = { x: 0, y: 0 }
    // A single candidate at 30 px: nothing to collide with, so this is a
    // normal first-try fit, not the total-failure fallback — the leader
    // comes from distance alone.
    const placed = placeLabels([{ key: 'a', text: 'a', role: 'annotation', fontSize: 13, anchor, candidates: [{ x: 30, y: 0 }] }])
    expect(placed[0].visible).toBe(true)
    expect(placed[0].x).toBe(30)
    expect(placed[0].leader).toEqual(anchor)
  })

  it('a readout that fits nowhere within 60 px searches out to 120 px and lands clear of the blocker (I3)', () => {
    const anchor = { x: 0, y: 0 }
    // Covers every one of annotationCandidates' rings (14-60 px) but stops
    // short of 70: the normal search is exhausted, forcing the fallback.
    const obstacle: LabelBox = { x: 0, y: 0, width: 140, height: 140 }
    const placed = placeLabels(
      [{ key: 'a', text: 'a', role: 'annotation', fontSize: 13, anchor, candidates: annotationCandidates(anchor) }],
      [obstacle]
    )
    expect(placed[0].visible).toBe(true)
    const size = { width: 0.6 * 13, height: 13 }
    expect(labelsOverlap({ x: placed[0].x, y: placed[0].y, ...size }, obstacle)).toBe(false)
    // 70 px or more out: well past the 14 px leader threshold.
    expect(Math.hypot(placed[0].x - anchor.x, placed[0].y - anchor.y)).toBeGreaterThanOrEqual(70)
    expect(placed[0].leader).toEqual(anchor)
  })

  it("M2: a request's sizeText, not its text, is what the placer reserves room for", () => {
    const anchor = { x: 0, y: 0 }
    // 'v' alone (1 char) reaches nowhere near the point label; the much
    // longer full text a click-expanded readout would show reaches every
    // one of its candidates.
    const pointAnchor = { x: 60, y: -10 }
    const requests = (sizeText?: string): LabelRequest[] => [
      { key: 'readout', text: 'v', role: 'annotation', fontSize: 13, anchor, candidates: annotationCandidates(anchor), sizeText },
      { key: 'point', text: 'Q', role: 'label', fontSize: 13, anchor: pointAnchor, candidates: pointCandidates(pointAnchor) },
    ]
    const capped = placeLabels(requests())
    const expanded = placeLabels(requests('v = 1.234567890123456789'))
    const at = (placed: ReturnType<typeof placeLabels>) => placed.find((p) => p.key === 'point')!
    const cappedPoint = at(capped)
    const expandedPoint = at(expanded)
    // The short capped text reaches none of the point label's candidates:
    // it shows normally.
    expect(cappedPoint.visible).toBe(true)
    // The much wider box sizeText reserves reaches every one of them
    // instead (a point label has no leader-line fallback, unlike a
    // readout): it is dropped once the readout is "expanded", proving the
    // placer sized its reserved room from sizeText, not text.
    expect(expandedPoint.visible).toBe(false)
  })

  // S6 plan V10: "nothing overlaps the frame's tick labels: V2's placer
  // knows the chrome's rectangles."
  describe('obstacles (S6 plan V10: the chrome`s rectangles)', () => {
    it('a tick label dropped over an obstacle is hidden, not overlapped', () => {
      const anchor = { x: 0, y: 0 }
      const obstacle: LabelBox = { x: 0, y: 0, width: 40, height: 20 }
      const placed = placeLabels([{ key: 'tick', text: '0', role: 'tick', fontSize: 13, anchor, candidates: [anchor] }], [obstacle])
      expect(placed[0].visible).toBe(false)
    })

    it('a point label steps past an obstacle on its first candidate to its next one', () => {
      const anchor = { x: 0, y: 0 }
      const candidates = [{ x: 0, y: 0 }, { x: 100, y: 0 }]
      const obstacle: LabelBox = { x: 0, y: 0, width: 20, height: 20 }
      const placed = placeLabels([{ key: 'p', text: 'P', role: 'label', fontSize: 13, anchor, candidates }], [obstacle])
      expect(placed[0].visible).toBe(true)
      expect(placed[0].x).toBe(100)
      expect(placed[0].y).toBe(0)
    })

    it('an annotation steps past an obstacle to a nearby candidate with no leader (I3: within 14 px)', () => {
      const anchor = { x: 0, y: 0 }
      const candidates = [{ x: 0, y: 0 }, { x: 10, y: 0 }]
      // Small, so the second candidate (10 px away) genuinely clears it —
      // the point of this test is a short step, not a forced fallback.
      const obstacle: LabelBox = { x: 0, y: 0, width: 6, height: 6 }
      const placed = placeLabels([{ key: 'a', text: 'a', role: 'annotation', fontSize: 13, anchor, candidates }], [obstacle])
      expect(placed[0].visible).toBe(true)
      expect(placed[0].x).toBe(10)
      expect(placed[0].y).toBe(0)
      expect(placed[0].leader).toBeNull()
    })

    it('an annotation steps past an obstacle to a farther candidate, gaining a leader (I3: over 14 px from its anchor)', () => {
      const anchor = { x: 0, y: 0 }
      const candidates = [{ x: 0, y: 0 }, { x: 100, y: 0 }]
      const obstacle: LabelBox = { x: 0, y: 0, width: 20, height: 20 }
      const placed = placeLabels([{ key: 'a', text: 'readout', role: 'annotation', fontSize: 13, anchor, candidates }], [obstacle])
      expect(placed[0].visible).toBe(true)
      expect(placed[0].x).toBe(100)
      expect(placed[0].y).toBe(0)
      // Not the total-failure fallback (both candidates were tried in order
      // and the second one simply fit) — the leader comes from distance
      // alone, whichever way the label got there.
      expect(placed[0].leader).toEqual(anchor)
    })

    it('an obstacle never appears in the output: it is not one of the requests', () => {
      const anchor = { x: 0, y: 0 }
      const placed = placeLabels([{ key: 'tick', text: '0', role: 'tick', fontSize: 13, anchor, candidates: [anchor] }], [
        { x: 500, y: 500, width: 40, height: 20 },
      ])
      expect(placed).toHaveLength(1)
      expect(placed[0].key).toBe('tick')
    })
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
    // I3: explicitly at most one VISIBLE label per curve (level) — grouped
    // by the level index contours.ts encodes in the key (label0, label1,
    // ...), never more than one showing for the same curve.
    const perLevel = new Map<string, number>()
    for (const l of contourLabels.filter((c) => c.visible)) {
      const level = (l.key.split(':')[2] ?? '').match(/\.label(\d+)$/)![1]
      perLevel.set(level, (perLevel.get(level) ?? 0) + 1)
    }
    for (const count of perLevel.values()) expect(count).toBe(1)
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

  it('a readout is always shown, even packed against several point labels at the same anchor, and reaches the fallback (I3)', () => {
    const jam = Array.from({ length: 10 }, (_, i) => label([1, 1, 1], `p${i}`, i + 1))
    const readout = annotationLabel([1, 1, 1], 'a readout that must always show', 50)
    // layoutLabels needs a FrameModel; an empty one has no lines or labels of its own.
    const box = { x: { min: -2, max: 2 }, y: { min: -2, max: 2 }, z: { min: -2, max: 2 } }
    const world = worldMap(box, [1, 1, 1])
    const camera = cameraMatrices({ azimuth: 40, elevation: 25, zoom: 1, target: world.centre }, world, { width: 900, height: 650 }, 'orthographic')
    // M5: this used to place cleanly at its first candidate (14 px out) —
    // the point labels' own 10 px ring never actually reached it, so the
    // fallback this test's title claims to prove was never exercised. A
    // chrome obstacle spanning the whole 60 px search radius forces it.
    const s = project(camera, world.toWorld([1, 1, 1]))
    const obstacle: LabelBox = { x: s.x, y: s.y, width: 140, height: 140 }
    const items = layoutLabels({ style: 'none', lines: [], labels: [], key: 'none' }, [...jam, readout], camera, world, [obstacle])
    const shown = items.find((i) => i.text === readout.text)!
    expect(shown.visible).toBe(true)
    expect(shown.leader).not.toBeNull()
  })
})

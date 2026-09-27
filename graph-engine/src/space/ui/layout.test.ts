import { describe, expect, it } from 'vitest'
import { cameraMatrices, project } from '../camera/projection'
import { worldMap } from '../camera/world'
import { defaultSpaceConfig } from '../config'
import { boxFrame } from '../frame/box'
import { frameAxes } from '../frame/ticks'
import type { FrameModel } from '../frame/types'
import type { Box3 } from '../scene/types'
import { annotationLabel, label } from '../testing/marks'
import { estimateLabelSize, labelsOverlap } from '../frame/labels'
import { LABEL_FONT_PX } from '../frame/types'
import { pointCandidates } from './labelPlacer'
import { layoutLabels } from './layout'

const CUBE: Box3 = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }
const WORLD = worldMap(CUBE, [1, 1, 1])
const AXES = frameAxes(defaultSpaceConfig(), CUBE)
const cam = (azimuth: number, zoom = 1) =>
  cameraMatrices({ azimuth, elevation: 25, zoom, target: [0, 0, 0] }, WORLD, { width: 800, height: 600 }, 'orthographic')

const EMPTY: FrameModel = { style: 'none', lines: [], labels: [], key: 'none' }

describe('layoutLabels', () => {
  it('places a frame label at its projection plus its screen offset', () => {
    const frame: FrameModel = { ...EMPTY, labels: [{ key: 'tick:x:0', position: [0, 0, 0], screenOffset: [12, -3], text: '0', role: 'tick' }] }
    const [item] = layoutLabels(frame, [], cam(40), WORLD)
    const o = project(cam(40), [0, 0, 0])
    expect(item).toMatchObject({ key: 'tick:x:0', text: '0', role: 'tick', visible: true })
    expect(item.x).toBeCloseTo(o.x + 12, 9)
    expect(item.y).toBeCloseTo(o.y - 3, 9)
  })

  it('hides a label whose anchor projects outside the viewport', () => {
    // Zoomed 20x about the centre, the corner (1, 1, 1) is far off screen.
    const labels = [label([1, 1, 1], 'far'), label([0, 0, 0], 'near')]
    const items = layoutLabels(EMPTY, labels, cam(40, 20), WORLD)
    expect(items.find((i) => i.text === 'far')!.visible).toBe(false)
    expect(items.find((i) => i.text === 'near')!.visible).toBe(true)
  })

  it('places an uncontested point label at its first (up-right) candidate (S6 plan V2)', () => {
    const [item] = layoutLabels(EMPTY, [label([0.2, 0.1, 0.3], 'P')], cam(40), WORLD)
    const p = project(cam(40), [0.2, 0.1, 0.3])
    const [first] = pointCandidates({ x: p.x, y: p.y })
    const size = estimateLabelSize('P', LABEL_FONT_PX)
    expect(item.role).toBe('label')
    expect(item.x).toBeCloseTo(first.x - size.width / 2, 9)
    expect(item.y).toBeCloseTo(first.y + size.height / 2, 9)
  })

  it('moves a point label off its first candidate, clear of a higher-priority annotation at the same anchor', () => {
    // An annotation and a point label share an anchor: the annotation places
    // first (priority) and claims the up-right candidate both would prefer;
    // the point label must land somewhere that does not overlap it.
    const items = layoutLabels(EMPTY, [annotationLabel([0, 0, 0], 'blocker', 9), label([0, 0, 0], 'P')], cam(40), WORLD)
    const blocker = items.find((i) => i.text === 'blocker')!
    const point = items.find((i) => i.text === 'P')!
    expect(blocker.visible).toBe(true)
    expect(point.visible).toBe(true)
    const box = (i: typeof blocker) => {
      const size = estimateLabelSize(i.text, LABEL_FONT_PX)
      return { x: i.x + size.width / 2, y: i.y - size.height / 2, ...size }
    }
    expect(labelsOverlap(box(blocker), box(point))).toBe(false)
  })

  it('a crowded annotation still shows, with a leader line back to its anchor, never dropped', () => {
    // Eight annotations at the same point exhaust every ring position at
    // every radius long before the ninth; it must still show.
    const jam = Array.from({ length: 40 }, (_, i) => annotationLabel([0, 0, 0], `r${i}`, i + 1))
    const target = annotationLabel([0, 0, 0], 'last', 100)
    const items = layoutLabels(EMPTY, [...jam, target], cam(40), WORLD)
    const last = items.find((i) => i.text === 'last')!
    expect(last.visible).toBe(true)
    expect(last.leader).not.toBeNull()
  })

  it('a crowded point label (no leader) is dropped rather than overlapping', () => {
    const jam = Array.from({ length: 12 }, (_, i) => label([0, 0, 0], `p${i}`, i + 1))
    const items = layoutLabels(EMPTY, jam, cam(40), WORLD)
    expect(items.some((i) => !i.visible)).toBe(true)
    // No two labels that ARE shown overlap.
    const shown = items.filter((i) => i.visible)
    const box = (i: (typeof shown)[number]) => {
      const size = estimateLabelSize(i.text, LABEL_FONT_PX)
      return { x: i.x + size.width / 2, y: i.y - size.height / 2, ...size }
    }
    for (let i = 0; i < shown.length; i++) {
      for (let j = i + 1; j < shown.length; j++) expect(labelsOverlap(box(shown[i]), box(shown[j]))).toBe(false)
    }
  })

  it('is deterministic: the same input places the same way every time', () => {
    const labels = [annotationLabel([0, 0, 0], 'A', 1), annotationLabel([0.01, 0, 0], 'B', 2), label([0, 0.01, 0], 'C', 3)]
    const a = layoutLabels(EMPTY, labels, cam(40), WORLD)
    const b = layoutLabels(EMPTY, labels, cam(40), WORLD)
    expect(a).toEqual(b)
  })

  it('keeps keys stable across camera positions, so the pool reuses spans', () => {
    const labels = [label([0.2, 0.1, 0.3], 'P', 3), label([0.5, 0.5, 0.5], 'Q', 4)]
    const a = layoutLabels(boxFrame(WORLD, cam(40), AXES), labels, cam(40), WORLD)
    const b = layoutLabels(boxFrame(WORLD, cam(-60), AXES), labels, cam(-60), WORLD)
    const keys = (items: typeof a) => new Set(items.map((i) => i.key))
    expect(new Set(a.map((i) => i.key)).size).toBe(a.length)
    for (const key of ['title:x', 'title:y', 'title:z', 'tick:x:5', 'label:0:s3.label', 'label:1:s4.label']) {
      expect(keys(a).has(key)).toBe(true)
      expect(keys(b).has(key)).toBe(true)
    }
  })
})

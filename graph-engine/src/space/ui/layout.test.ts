import { describe, expect, it } from 'vitest'
import { cameraMatrices, project } from '../camera/projection'
import { worldMap } from '../camera/world'
import { defaultSpaceConfig } from '../config'
import { boxFrame } from '../frame/box'
import { frameAxes } from '../frame/ticks'
import type { FrameModel } from '../frame/types'
import type { Box3 } from '../scene/types'
import { label } from '../testing/marks'
import { layoutLabels, POINT_LABEL_OFFSET } from './layout'

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

  it('offsets point labels up-right by (6, -6) px', () => {
    expect(POINT_LABEL_OFFSET).toEqual([6, -6])
    const [item] = layoutLabels(EMPTY, [label([0.2, 0.1, 0.3], 'P')], cam(40), WORLD)
    const p = project(cam(40), [0.2, 0.1, 0.3])
    expect(item.role).toBe('label')
    expect(item.x).toBeCloseTo(p.x + 6, 9)
    expect(item.y).toBeCloseTo(p.y - 6, 9)
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

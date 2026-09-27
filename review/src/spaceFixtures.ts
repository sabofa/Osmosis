// Hand-built SpaceScenes for the space review page, until the kernel (S1)
// builds scenes from specs (S2 Task 7 replaces this list with SPACE_EXAMPLES
// plus the old 3D example). Each one says what a correct render looks like,
// so a reviewer with only a screenshot can tell right from wrong.

import { defaultSpaceConfig, type SpaceConfig } from '../../graph-engine/src/space/config'
import type { SpaceScene, Vec3 } from '../../graph-engine/src/space/scene/types'
import {
  arrowMark,
  curveMark,
  graphMesh,
  label,
  lineMark,
  parametricMesh,
  pointMark,
  scene,
} from '../../graph-engine/src/space/testing/marks'

export interface SpaceFixture {
  id: string
  title: string
  // What a correct render shows.
  look: string
  scene: SpaceScene
  space: SpaceConfig
}

function config(patch: Partial<SpaceConfig> = {}): SpaceConfig {
  return { ...defaultSpaceConfig(), ...patch }
}

const DEG = Math.PI / 180
// The default camera's eye direction (azimuth 40, elevation 25): an arrow
// along it, in an equal-aspect box, points straight at the viewer.
const TOWARD_CAMERA: Vec3 = [Math.cos(25 * DEG) * Math.cos(40 * DEG), Math.cos(25 * DEG) * Math.sin(40 * DEG), Math.sin(25 * DEG)]

const sphereAt = (r: number, c: Vec3 = [0, 0, 0]) =>
  parametricMesh(
    (u, v) => [c[0] + r * Math.sin(v) * Math.cos(u), c[1] + r * Math.sin(v) * Math.sin(u), c[2] + r * Math.cos(v)],
    (u, v) => [Math.sin(v) * Math.cos(u), Math.sin(v) * Math.sin(u), Math.cos(v)],
    0,
    2 * Math.PI,
    0,
    Math.PI,
    64,
    32,
    { line: 2, style: { opacity: 0.6, color: { author: null, slot: 1 } } },
  )

const saddle = () =>
  graphMesh(
    (x, y) => x * x - y * y,
    (x) => 2 * x,
    (_x, y) => -2 * y,
    -2,
    2,
    -2,
    2,
    64,
    { line: 1 },
  )

const helix = (line = 1) => curveMark((t) => [Math.cos(t), Math.sin(t), t / (2 * Math.PI)], 0, 4 * Math.PI, 512, { line, style: { width: 2.5 } })

const SHAPES = ['dot', 'ring', 'cross', 'diamond', 'square'] as const

function shapesRow(z: number, line: number) {
  return SHAPES.map((shape, i) =>
    pointMark([[-1.6 + i * 0.8, -1.6, z]], { line: line + i, style: { shape, size: 12, color: { author: null, slot: i + 1 } } }),
  )
}

export const SPACE_FIXTURES: SpaceFixture[] = [
  {
    id: 'saddle',
    title: 'Saddle z = x² − y²',
    look:
      'An orange saddle over [−2, 2]², lit from the upper left: rising toward ±x, falling toward ±y. The box is auto aspect (a graph surface), z runs −4..4. Back walls x = −2, y = −2 and the floor carry gridlines; tick labels on the two front-bottom edges and the left vertical edge, none overlapping.',
    scene: scene([saddle()]),
    space: config(),
  },
  {
    id: 'sphere',
    title: 'Unit sphere, translucent 0.6',
    look:
      'A round (equal aspect) blue sphere at 60% opacity, lit from the upper left with a soft highlight there and darker toward the lower right. The back walls, their outlines and gridlines show through it. Only its nearest layer is drawn (the sorted fallback; S3’s order-independent transparency adds the far side). It stays round as you orbit.',
    scene: scene([sphereAt(1)]),
    space: config(),
  },
  {
    id: 'helix',
    title: 'Helix',
    look:
      'Two turns of an orange helix of radius 1 rising 0..2 in z, drawn 2.5 px wide at every zoom, with round joins (no gaps or spikes at the 512 segment joints).',
    scene: scene([helix()]),
    space: config(),
  },
  {
    id: 'points',
    title: 'Points of every shape',
    look:
      'Two rows of five markers, 12 px, along x (which runs toward the front-left at the default camera), from the back-right: dot, ring, cross (+), diamond, square, each in its own series colour; the same pixel size at every zoom, antialiased edges. The two dots are labelled P and Q, up and to the right of the marker.',
    scene: scene([...shapesRow(0, 1), ...shapesRow(1.2, 6)], {
      labels: [label([-1.6, -1.6, 0], 'P', 1), label([-1.6, -1.6, 1.2], 'Q', 6)],
    }),
    space: config({ bounds: { x: { min: -2, max: 2 }, y: { min: -2, max: 2 }, z: { min: -1, max: 2 } } }),
  },
  {
    id: 'arrows',
    title: 'Arrows along the axes, one at the camera',
    look:
      'Three arrows from the origin along +x (left-front), +y (right) and +z (up), each with a triangular head. A fourth, from (0, 0, 0) toward the viewer, shows as a ring with a dot at its centre (⊙) at the default camera; orbit and it becomes a normal arrow.',
    scene: scene([
      arrowMark(
        [
          { tail: [0, 0, 0], vector: [1.5, 0, 0] },
          { tail: [0, 0, 0], vector: [0, 1.5, 0] },
          { tail: [0, 0, 0], vector: [0, 0, 1.5] },
        ],
        { line: 1, style: { color: { author: null, slot: 1 } } },
      ),
      arrowMark([{ tail: [0, 0, 0], vector: [TOWARD_CAMERA[0] * 1.2, TOWARD_CAMERA[1] * 1.2, TOWARD_CAMERA[2] * 1.2] }], {
        line: 2,
        style: { color: { author: null, slot: 0 }, headSize: 14 },
      }),
    ]),
    space: config({ bounds: { x: { min: -2, max: 2 }, y: { min: -2, max: 2 }, z: { min: -2, max: 2 } } }),
  },
  {
    id: 'dashed',
    title: 'Dashed segment and polyline',
    look:
      'A long orange dashed segment from (−1.5, 1.5, −1) to (1.5, −1.5, 1), across the view, with 8 px dashes and 5 px gaps that stay 8/5 px at every zoom; and a purple zig-zag in the plane z = 0 dashed 3/3 px, whose pattern runs on continuously around its corners rather than restarting at each.',
    scene: scene([
      lineMark(
        [
          [
            [-1.5, 1.5, -1],
            [1.5, -1.5, 1],
          ],
        ],
        { line: 1, style: { dash: [8, 5], width: 2 } },
      ),
      lineMark(
        [
          [
            [-1.5, 1.5, 0],
            [-0.5, 0.5, 0],
            [0.5, 1.5, 0],
            [1.5, 0.5, 0],
          ],
        ],
        { line: 2, style: { dash: [3, 3], width: 1.5, color: { author: 'purple', slot: 2 } } },
      ),
    ]),
    space: config({ bounds: { x: { min: -2, max: 2 }, y: { min: -2, max: 2 }, z: { min: -2, max: 2 } } }),
  },
  {
    id: 'lines-points-arrows',
    title: 'Helix, shapes, arrows and a dash together',
    look:
      'The S2 Task 4 check: a helix, one marker of each shape, three axis arrows plus one ring (⊙) pointing at the viewer, and a dashed diagonal — lines drawn over nothing, each at its own pixel width.',
    scene: scene([
      helix(1),
      ...shapesRow(-1, 2),
      arrowMark(
        [
          { tail: [0, 0, 0], vector: [1.5, 0, 0] },
          { tail: [0, 0, 0], vector: [0, 1.5, 0] },
          { tail: [0, 0, 0], vector: [0, 0, 1.5] },
          { tail: [0, 0, 0], vector: [TOWARD_CAMERA[0], TOWARD_CAMERA[1], TOWARD_CAMERA[2]] },
        ],
        { line: 7, style: { color: { author: null, slot: 3 } } },
      ),
      lineMark(
        [
          [
            [-2, 2, -2],
            [2, -2, 2],
          ],
        ],
        { line: 8, style: { dash: [8, 5] } },
      ),
    ]),
    space: config({ bounds: { x: { min: -2, max: 2 }, y: { min: -2, max: 2 }, z: { min: -2, max: 2 } } }),
  },
  {
    id: 'precision',
    title: 'A surface at x ≈ 4500 (precision)',
    look:
      'A smooth ripple z = sin(3(x − 4500)) cos(3y) over x in [4499, 4501]: the x ticks read 4499.0 .. 4501.0, and the surface is smooth, not stair-stepped or jittering as you orbit (positions go to the GPU relative to the box centre).',
    scene: scene([
      graphMesh(
        (x, y) => 0.4 * Math.sin(3 * (x - 4500)) * Math.cos(3 * y),
        (x, y) => 1.2 * Math.cos(3 * (x - 4500)) * Math.cos(3 * y),
        (x, y) => -1.2 * Math.sin(3 * (x - 4500)) * Math.sin(3 * y),
        4499,
        4501,
        -1,
        1,
        96,
        { line: 1, style: { color: { author: null, slot: 5 } } },
      ),
    ]),
    space: config(),
  },
  {
    id: 'axes-frame',
    title: '@frame: axes — surface and small arrows',
    look:
      'The textbook look: no walls; three axes through the origin with arrowheads and the letters x, y, z beyond their tips; small tick marks and labels (none at the origin). A translucent paraboloid z = (x² + y²)/4 and three short arrows at (1, 1, 0.5).',
    scene: scene([
      graphMesh(
        (x, y) => (x * x + y * y) / 4,
        (x) => x / 2,
        (_x, y) => y / 2,
        -2,
        2,
        -2,
        2,
        48,
        { line: 1, style: { opacity: 0.7 } },
      ),
      arrowMark(
        [
          { tail: [1, 1, 0.5], vector: [0.5, 0, 0] },
          { tail: [1, 1, 0.5], vector: [0, 0.5, 0] },
          { tail: [1, 1, 0.5], vector: [0, 0, 0.5] },
        ],
        { line: 2, style: { color: { author: null, slot: 1 }, headSize: 8 } },
      ),
    ]),
    space: config({ frame: 'axes', bounds: { x: { min: -2, max: 2 }, y: { min: -2, max: 2 }, z: { min: 0, max: 2 } } }),
  },
]

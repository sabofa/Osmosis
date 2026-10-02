// The lab's camera and scene plumbing, pure so the graph-engine suite can test
// it (graph-engine/src/space/paint/lab/camera.test.ts).
//
// One decision here is the engine's contract with the lab. The paint model and
// renderer work in WORLD space, the box-normalised space SpaceRenderer draws in
// (every axis within +-1, max half-extent 1), not in author coordinates:
// densities are per world unit², brush loads key to world cells, and an author
// box at x ~ 4500 would not survive Float32. So the lab hands the engine a
// scene already mapped to world (toWorldScene), a PaintView whose matrices are
// over world coordinates (cameraMatrices takes a WorldMap), and a light
// direction in world space. The pick and drag closures a scene carries still
// read author coordinates and are meaningless on the world copy; the painter
// does not pick.

import { parseSpec } from '../../graph-engine/src/parser/parseSpec'
import { sanitizeView } from '../../graph-engine/src/space/camera/controls'
import type { CameraMatrices } from '../../graph-engine/src/space/camera/projection'
import { DEG, type ScreenBasis } from '../../graph-engine/src/space/camera/turntable'
import { worldMap, worldNormal, type WorldMap } from '../../graph-engine/src/space/camera/world'
import type { Projection, SpaceView } from '../../graph-engine/src/space/config'
import { boxHalfExtents } from '../../graph-engine/src/space/frame/aspect'
import { flatAxes, resolveBox } from '../../graph-engine/src/space/frame/bounds'
import type { CreateSpaceKernel } from '../../graph-engine/src/space/kernel/api'
import { createSpaceKernel } from '../../graph-engine/src/space/kernel/index'
import type { PaintView } from '../../graph-engine/src/space/paint/types'
import type { Box3, Mark, SpaceScene, Vec3 } from '../../graph-engine/src/space/scene/types'
import type { PaintFigure } from './paintLabFigures'

// The unit direction TOWARD the key light, in world space, from the light's
// azimuth (degrees, + = toward the viewer's left) and elevation (+ = above),
// both measured against the view. 0, 0 is a light at the eye; so the light
// turns with the camera, as it does for a painter who moves around the model
// and keeps the lamp where it was.
export function lightDirection(basis: ScreenBasis, azimuth: number, elevation: number): Vec3 {
  const ca = Math.cos(azimuth * DEG)
  const sa = Math.sin(azimuth * DEG)
  const ce = Math.cos(elevation * DEG)
  const se = Math.sin(elevation * DEG)
  // toward the eye B = -forward, screen right R, screen up U.
  const { forward: f, right: r, up: u } = basis
  return [
    ce * (ca * -f[0] - sa * r[0]) + se * u[0],
    ce * (ca * -f[1] - sa * r[1]) + se * u[1],
    ce * (ca * -f[2] - sa * r[2]) + se * u[2],
  ]
}

// One frame's view for the engine from the space camera's matrices. `zoom` is how far in the camera is
// against the figure's authored framing (the camera's zoom over the authored zoom: 1 at the authored view,
// 3 for a 3x close-up); the painter makes its brush follow it (PaintView.zoom). Left out it means 1.
export function buildPaintView(
  camera: CameraMatrices,
  light: { azimuth: number; elevation: number },
  pixelRatio: number,
  dragging: boolean,
  zoom?: number,
): PaintView {
  const { forward } = camera.basis
  return {
    viewProj: Float32Array.from(camera.viewProj),
    view: Float32Array.from(camera.view),
    eye: [camera.eye[0], camera.eye[1], camera.eye[2]],
    viewDir: [forward[0], forward[1], forward[2]],
    lightDir: [...lightDirection(camera.basis, light.azimuth, light.elevation)],
    width: camera.viewport.width,
    height: camera.viewport.height,
    pixelRatio,
    dragging,
    ...(zoom !== undefined && Number.isFinite(zoom) ? { zoom } : {}),
  }
}

function mapPoints(src: Float64Array, world: WorldMap): Float64Array {
  const out = new Float64Array(src.length)
  for (let i = 0; i + 2 < src.length; i += 3) {
    const w = world.toWorld([src[i], src[i + 1], src[i + 2]])
    out[i] = w[0]
    out[i + 1] = w[1]
    out[i + 2] = w[2]
  }
  return out
}

// A direction (an arrow's vector) scales by k but is not shifted by the centre.
function mapDirections(src: Float64Array, world: WorldMap): Float64Array {
  const out = new Float64Array(src.length)
  for (let i = 0; i + 2 < src.length; i += 3) {
    out[i] = src[i] * world.scale[0]
    out[i + 1] = src[i + 1] * world.scale[1]
    out[i + 2] = src[i + 2] * world.scale[2]
  }
  return out
}

function mapNormals(src: Float64Array, world: WorldMap): Float64Array {
  const out = new Float64Array(src.length)
  for (let i = 0; i + 2 < src.length; i += 3) {
    const n = worldNormal([src[i], src[i + 1], src[i + 2]], world.scale)
    out[i] = n[0]
    out[i + 1] = n[1]
    out[i + 2] = n[2]
  }
  return out
}

function mapMark(mark: Mark, world: WorldMap): Mark {
  switch (mark.kind) {
    case 'mesh':
      return { ...mark, positions: mapPoints(mark.positions, world), normals: mapNormals(mark.normals, world) }
    case 'lines':
    case 'points':
      return { ...mark, positions: mapPoints(mark.positions, world) }
    case 'arrows':
      return { ...mark, tails: mapPoints(mark.tails, world), vectors: mapDirections(mark.vectors, world) }
    case 'boxes':
      return { ...mark, mins: mapPoints(mark.mins, world), maxs: mapPoints(mark.maxs, world) }
  }
}

// The scene in world coordinates: positions (a - centre) * k, normals n / k
// renormalised (a normal is not a direction between points), arrow vectors
// scaled by k. Indices, uv, scalars and styles are the same objects; the scene
// it was given is not changed.
export function toWorldScene(scene: SpaceScene, world: WorldMap): SpaceScene {
  const box = (b: Box3 | null): Box3 | null => {
    if (!b) return null
    const lo = world.toWorld([b.x.min, b.y.min, b.z.min])
    const hi = world.toWorld([b.x.max, b.y.max, b.z.max])
    return { x: { min: lo[0], max: hi[0] }, y: { min: lo[1], max: hi[1] }, z: { min: lo[2], max: hi[2] } }
  }
  return {
    ...scene,
    marks: scene.marks.map((m) => mapMark(m, world)),
    labels: scene.labels.map((l) => ({ ...l, position: world.toWorld(l.position) })),
    extent: box(scene.extent),
  }
}

export interface BuiltFigure {
  // The kernel's scene, in author coordinates.
  scene: SpaceScene
  world: WorldMap
  box: Box3
  // The figure's own camera: what double-click returns to.
  authored: SpaceView
  projection: Projection
  // "line 3: ..." for every parse and build error; empty when the figure is sound.
  errors: string[]
}

const EMPTY_SCENE: SpaceScene = {
  marks: [], labels: [], colorScales: [], extent: null, boxSpanning: { x: false, y: false, z: false }, errors: [],
}

const describe = (e: { line: number; message: string }) => (e.line > 0 ? `line ${e.line}: ${e.message}` : e.message)

// A spec through the same path SpaceRenderer.setSpec takes (parseSpec, the
// kernel, then the box, the aspect and the world map). Never throws: errors
// come back as text, and whatever did build is still drawn. (`createKernel` is
// the real kernel; a test passes one that throws.)
export function buildFigure(spec: string, createKernel: CreateSpaceKernel = createSpaceKernel): BuiltFigure {
  const parsed = parseSpec(spec)
  const errors = parsed.errors.map(describe)
  let scene = EMPTY_SCENE
  try {
    scene = createKernel(parsed.statements, parsed.config, parsed.statementLines).scene()
    errors.push(...scene.errors.map(describe))
  } catch (error) {
    errors.push(`space could not build this spec: ${error instanceof Error ? error.message : String(error)}`)
  }
  const space = parsed.config.space
  const box = resolveBox(space, scene.extent, scene.boxSpanning)
  const flat = flatAxes(space, scene.extent, scene.boxSpanning)
  const world = worldMap(box, boxHalfExtents(box, space.aspect, scene, flat))
  const authored: SpaceView = { ...space.camera, target: world.centre }
  return { scene, world, box, authored: sanitizeView(authored, authored), projection: space.projection, errors }
}


export interface PreparedFigure {
  built: BuiltFigure
  // The scene in world coordinates, as the engine takes it.
  worldScene: SpaceScene
}

const PREPARED = new Map<string, PreparedFigure>()

// A figure built once for the life of the page, so the Tune view and the
// Showcase share one build (a surface at res 120 is not free to rebuild).
export function prepareFigure(figure: PaintFigure): PreparedFigure {
  let prepared = PREPARED.get(figure.id)
  if (!prepared) {
    const built = buildFigure(figure.spec)
    prepared = { built, worldScene: toWorldScene(built.scene, built.world) }
    PREPARED.set(figure.id, prepared)
  }
  return prepared
}

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
import { cameraMatrices, type CameraMatrices, type Viewport } from '../../graph-engine/src/space/camera/projection'
import { DEG, type ScreenBasis } from '../../graph-engine/src/space/camera/turntable'
import { worldMap, worldNormal, type WorldMap } from '../../graph-engine/src/space/camera/world'
import type { Projection, SpaceView } from '../../graph-engine/src/space/config'
import { boxHalfExtents } from '../../graph-engine/src/space/frame/aspect'
import { flatAxes, resolveBox } from '../../graph-engine/src/space/frame/bounds'
import type { CreateSpaceKernel } from '../../graph-engine/src/space/kernel/api'
import { createSpaceKernel } from '../../graph-engine/src/space/kernel/index'
import type { AuthoredFraming } from '../../graph-engine/src/space/paint/bake/types'
import type { PaintView } from '../../graph-engine/src/space/paint/types'
import type { Box3, Mark, SpaceScene, Vec3 } from '../../graph-engine/src/space/scene/types'
import type { PaintFigure } from './paintLabFigures'

// The unit direction TOWARD the key light, in world space, from the light's
// azimuth (degrees, + = toward the viewer's left) and elevation (+ = above),
// both measured against the view. 0, 0 is a light at the eye; so the light
// turns with the camera (light.worldFixed 0).
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

// The unit direction TOWARD the key light, in world space, for a light fixed in the world (light.worldFixed 1): the
// studio setup, a lamp that stays on the motif while the painter walks around it. z is up; the azimuth (degrees) is
// about the z axis from +x toward +y, and the elevation is above the xy-plane, the turntable's own angles
// (camera/turntable.ts eyeDirection): (0, 0) is +x, (90, 0) is +y and (0, 90) is (0, 0, 1), straight down on the figure.
export function worldLightDirection(azimuth: number, elevation: number): Vec3 {
  const ce = Math.cos(elevation * DEG)
  return [ce * Math.cos(azimuth * DEG), ce * Math.sin(azimuth * DEG), Math.sin(elevation * DEG)]
}

// The key light's direction for the lab's light parameters: fixed in the world when `worldFixed` is on (1, half or
// more), else relative to the view. `worldFixed` left out means relative.
export function keyLightDirection(basis: ScreenBasis, light: { azimuth: number; elevation: number; worldFixed?: number }): Vec3 {
  return (light.worldFixed ?? 0) >= 0.5 ? worldLightDirection(light.azimuth, light.elevation) : lightDirection(basis, light.azimuth, light.elevation)
}

// One frame's view for the engine from the space camera's matrices. `zoom` is how far in the camera is
// against the figure's authored framing (the camera's zoom over the authored zoom: 1 at the authored view,
// 3 for a 3x close-up); the painter makes its brush follow it (PaintView.zoom). Left out it means 1.
export function buildPaintView(
  camera: CameraMatrices,
  light: { azimuth: number; elevation: number; worldFixed?: number },
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
    lightDir: [...keyLightDirection(camera.basis, light)],
    width: camera.viewport.width,
    height: camera.viewport.height,
    pixelRatio,
    dragging,
    ...(zoom !== undefined && Number.isFinite(zoom) ? { zoom } : {}),
  }
}

// The framing the baked painting is composed for (graph-engine/src/space/paint/bake/types.ts): the figure's authored camera at zoom 1 in a
// viewport of this size, as the Tune view builds it. `worldPerPx` is the world size of a CSS px at the figure's centre (the camera's
// worldPerPixel: the plane through the target, facing the camera), the eye and view direction are the authored camera's, and an orthographic
// figure says so. It does not depend on where the camera is NOW: orbiting the figure does not change it, a new figure or another size of
// the stage does.
export function authoredFraming(built: Pick<BuiltFigure, 'authored' | 'world' | 'projection'>, viewport: Viewport): AuthoredFraming {
  const camera = cameraMatrices(built.authored, built.world, viewport, built.projection)
  const f = camera.basis.forward
  return { eye: [camera.eye[0], camera.eye[1], camera.eye[2]], viewDir: [f[0], f[1], f[2]], ortho: built.projection === 'orthographic', worldPerPx: camera.worldPerPixel }
}

// The stage may be resized without the figure's bake being made again: the baked paths are long enough for the frame to take a sub-arc of them, so a
// stage that makes the figure up to twice as large in px (or half as large) is absorbed like a zoom by the frame (frameFromBake sizes strokes in
// CSS px and takes the arc they need). Past that band the framing is made again, and the bake with it.
export const FRAMING_BAND = { min: 0.5, max: 2 } as const

// The framing the lab holds for a figure: made at the first size of the stage, and kept (the same object) while the stage leaves the figure's size in
// px within FRAMING_BAND of what it was made for (the ratio of the world size of a px: the stage's height, for a landscape stage). Another figure, or a
// size past the band, makes a new one.
export interface HeldFraming {
  built: Pick<BuiltFigure, 'authored' | 'world' | 'projection'>
  framing: AuthoredFraming
}

export function heldFraming(held: HeldFraming | null, built: HeldFraming['built'], viewport: Viewport): HeldFraming {
  const fresh = authoredFraming(built, viewport)
  if (held && held.built === built) {
    const ratio = held.framing.worldPerPx / fresh.worldPerPx
    // (a ratio of exactly 2 or 1/2 is in the band, whatever the last bit of the division says)
    if (ratio >= FRAMING_BAND.min - 1e-9 && ratio <= FRAMING_BAND.max + 1e-9) return held
  }
  return { built, framing: fresh }
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

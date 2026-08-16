import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { GraphConfig } from '../parser/config'
import { clearAndDispose } from './disposeObject3D'
import { makeLabelSprite, POINT_COLOR } from './labelSprite'
import type { Scene3D, SceneObject3D } from '../scene/types3d'
import type { Vec3 } from '../scene/types3d'

const AXIS_LENGTH = 6
const GRID_SIZE = 10
const HOVER_MAX_SCREEN_DIST = 70

// Colors pulled from Osmosis's own design language (see web/src/index.css) —
// same mapping as the 2D renderer (curve/surface use --accent, segment/ray
// use --good, hover uses --accent, axis uses --ink), so the two views read
// as one consistent system rather than each inventing its own palette. Grid
// uses --line/--line-strong; background matches GraphViewer.css's --gv-bg.
const LIGHT_BACKGROUND = 0xfdf6ea
const LIGHT_GRID = [0xc9c6b3, 0xe4e2d4] as const
const LIGHT_AXIS = 0x17170f
const LIGHT_HOVER = 0xc65d22
const LIGHT_CURVE = 0xc65d22
const LIGHT_SEGMENT = 0x4c7a4a
// Same flat 2D accent as LIGHT_CURVE — the earlier "dark and unappealing"
// read wasn't the color itself, it was too little contrast between lit and
// shadowed facets (see the lighting setup below); recoloring the surface
// only made it look washed out instead of actually fixing that.
const LIGHT_SURFACE = 0xc65d22

const DARK_BACKGROUND = 0x201e15
const DARK_GRID = [0x4a4530, 0x34311e] as const
const DARK_AXIS = 0xf2efe2
const DARK_HOVER = 0xe2803f
const DARK_CURVE = 0xe2803f
const DARK_SEGMENT = 0x6fa06c
const DARK_SURFACE = 0xe2803f

// A warm near-white instead of pure white, so lit surfaces pick up the same
// warm-paper cast as the rest of the scene instead of a cold studio light.
const LIGHT_COLOR = 0xfff4e6

// Nearest point on a 2D segment to p, as a 0..1 fraction along a->b — used to
// find where along a 3D segment/curve sub-segment the cursor is nearest,
// working entirely in *projected screen space* (see handleHoverMove) since
// that's the only space where "nearest to the cursor" means what it looks like.
function nearestParamOnSegment2D(a: { x: number; y: number }, b: { x: number; y: number }, p: { x: number; y: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return 0
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  return Math.min(Math.max(t, 0), 1)
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
}

export interface HoverInfo3D {
  worldX: number
  worldY: number
  worldZ: number
  screenX: number
  screenY: number
  label?: string
}

export interface SceneRenderer3DOptions {
  onHover?: (info: HoverInfo3D | null) => void
  onContextLost?: () => void
}

// Owns the three.js scene/camera/renderer for the 3D view: a perspective
// camera with mouse-orbit controls (drag to rotate, wheel to dolly, right-drag
// to pan), plus lighting so surfaces read as solid. Unlike the 2D renderer,
// orbiting the camera never changes what should be sampled, so there's no
// view-change callback here — geometry only rebuilds when the spec changes.
//
// Our data uses x,y as the "ground" plane and z as height, matching the 2D
// view's axes. three.js defaults to Y-up, so the camera's up vector is set to
// +Z and the ground grid is rotated into the XY plane, letting every object
// builder below use {x,y,z} directly with no axis remapping.
export class SceneRenderer3D {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private objectGroup = new THREE.Group()
  private hoverGroup = new THREE.Group()
  private grid: THREE.GridHelper
  private axisLines: THREE.LineSegments
  private canvas: HTMLCanvasElement
  private resizeObserver: ResizeObserver
  private rafId = 0
  private hoverColor: number
  private curveColor: number
  private segmentColor: number
  private surfaceColor: number
  private config: GraphConfig
  private options: SceneRenderer3DOptions
  private lastScene: Scene3D | null = null
  private dragging = false
  private needsRender = true
  private hoverScheduled = false
  private pendingHoverEvent: PointerEvent | null = null

  constructor(canvas: HTMLCanvasElement, config: GraphConfig, options: SceneRenderer3DOptions = {}) {
    this.canvas = canvas
    this.config = config
    this.options = options
    const dark = config.theme === 'dark'
    this.hoverColor = dark ? DARK_HOVER : LIGHT_HOVER
    this.curveColor = dark ? DARK_CURVE : LIGHT_CURVE
    this.segmentColor = dark ? DARK_SEGMENT : LIGHT_SEGMENT
    this.surfaceColor = dark ? DARK_SURFACE : LIGHT_SURFACE
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setClearColor(dark ? DARK_BACKGROUND : LIGHT_BACKGROUND, 1)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    const rect = canvas.getBoundingClientRect()
    const width = Math.max(rect.width, 1)
    const height = Math.max(rect.height, 1)
    this.renderer.setSize(width, height, false)

    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000)
    this.camera.up.set(0, 0, 1)
    this.camera.position.set(8, -8, 6)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.target.set(0, 0, 0)
    this.controls.update()
    // Render-on-demand: OrbitControls fires 'change' continuously while
    // orbiting/dollying/panning or damping to a stop, and stops firing once
    // settled — the standard three.js pattern for not rendering a static
    // scene forever at 60fps for no reason.
    this.controls.addEventListener('change', () => {
      this.needsRender = true
    })

    // Low ambient + a strong key light is what actually gives a Lambert-shaded
    // surface contrast — ambient lights every facet equally regardless of
    // orientation, so turning *that* up (an earlier attempt at this) just
    // washes the whole surface toward one flat brightness instead of fixing
    // anything; raising the key light's own intensity while keeping ambient
    // low is what makes facing-the-light facets read as genuinely brighter
    // than facets angled away. The fill light stays deliberately dim — just
    // enough that the shadow side keeps some detail instead of crushing to a
    // single flat dark tone, not enough to compete with the key light.
    this.scene.add(new THREE.AmbientLight(LIGHT_COLOR, 0.35))
    const directional = new THREE.DirectionalLight(LIGHT_COLOR, 1.1)
    directional.position.set(6, -8, 10)
    this.scene.add(directional)
    const fill = new THREE.DirectionalLight(LIGHT_COLOR, 0.2)
    fill.position.set(-8, 6, 4)
    this.scene.add(fill)

    this.grid = this.buildGrid(dark)
    this.scene.add(this.grid)
    // A single ink-colored axis instead of AxesHelper's default red/green/
    // blue — the default reads as generic 3D-engine chrome and clashes with
    // the rest of the (now unified, warm) palette.
    this.axisLines = this.buildAxisLines(dark ? DARK_AXIS : LIGHT_AXIS)
    this.scene.add(this.axisLines)

    this.scene.add(this.objectGroup)
    this.scene.add(this.hoverGroup)

    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(canvas)

    canvas.addEventListener('pointerdown', this.handlePointerDown)
    window.addEventListener('pointerup', this.handlePointerUp)
    canvas.addEventListener('pointermove', this.handleHoverMove)
    canvas.addEventListener('pointerleave', this.handlePointerLeave)
    canvas.addEventListener('webglcontextlost', this.handleContextLost)

    this.loop()
  }

  private handleContextLost = (e: Event) => {
    e.preventDefault()
    cancelAnimationFrame(this.rafId)
    this.options.onContextLost?.()
  }

  setConfig(config: GraphConfig) {
    this.config = config
    const dark = config.theme === 'dark'
    this.renderer.setClearColor(dark ? DARK_BACKGROUND : LIGHT_BACKGROUND, 1)
    this.hoverColor = dark ? DARK_HOVER : LIGHT_HOVER
    this.curveColor = dark ? DARK_CURVE : LIGHT_CURVE
    this.segmentColor = dark ? DARK_SEGMENT : LIGHT_SEGMENT
    this.surfaceColor = dark ? DARK_SURFACE : LIGHT_SURFACE

    // GridHelper bakes its two colors into a vertex-color attribute at
    // construction time rather than a material uniform, so retinting it
    // means rebuilding it — cheap, and only happens on a theme change, not
    // per frame.
    this.scene.remove(this.grid)
    this.grid.geometry.dispose()
    ;(this.grid.material as THREE.Material).dispose()
    this.grid = this.buildGrid(dark)
    this.scene.add(this.grid)

    ;(this.axisLines.material as THREE.LineBasicMaterial).color.setHex(dark ? DARK_AXIS : LIGHT_AXIS)
    this.needsRender = true
  }

  private buildGrid(dark: boolean): THREE.GridHelper {
    const [gridA, gridB] = dark ? DARK_GRID : LIGHT_GRID
    const grid = new THREE.GridHelper(GRID_SIZE, GRID_SIZE, gridA, gridB)
    grid.rotation.x = Math.PI / 2
    return grid
  }

  private buildAxisLines(color: number): THREE.LineSegments {
    const positions = new Float32Array([0, 0, 0, AXIS_LENGTH, 0, 0, 0, 0, 0, 0, AXIS_LENGTH, 0, 0, 0, 0, 0, 0, AXIS_LENGTH])
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }))
  }

  private handleResize() {
    const rect = this.canvas.getBoundingClientRect()
    const width = Math.max(rect.width, 1)
    const height = Math.max(rect.height, 1)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.needsRender = true
  }

  private handlePointerDown = () => {
    this.dragging = true
  }

  private handlePointerUp = () => {
    this.dragging = false
  }

  private handlePointerLeave = () => {
    clearAndDispose(this.hoverGroup)
    this.needsRender = true
    this.options.onHover?.(null)
  }

  private projectToScreen(p: Vec3, widthPx: number, heightPx: number): { x: number; y: number } {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(this.camera)
    return { x: ((v.x + 1) / 2) * widthPx, y: ((1 - v.y) / 2) * heightPx }
  }

  // Raw pointermove events can fire above the display refresh rate; the
  // actual hit-test is coalesced to at most once per animation frame, same
  // as the 2D renderer.
  private handleHoverMove = (e: PointerEvent) => {
    this.pendingHoverEvent = e
    if (this.hoverScheduled) return
    this.hoverScheduled = true
    requestAnimationFrame(() => {
      this.hoverScheduled = false
      const event = this.pendingHoverEvent
      if (event) this.resolveHover(event)
    })
  }

  // Same one-resolver-for-every-@hover-mode approach as the 2D renderer (see
  // render/SceneRenderer.ts): one flat candidate list, whichever is nearest
  // the cursor *on screen* wins. In 3D, "nearest on screen" is found by
  // projecting candidates through the camera rather than comparing world
  // coordinates directly, since perspective means screen distance isn't a
  // fixed multiple of world distance the way it is in the 2D orthographic view.
  private resolveHover(e: PointerEvent) {
    if (this.dragging) return
    const mode = this.config.hover
    if (mode === 'none' || !this.lastScene) {
      clearAndDispose(this.hoverGroup)
      this.needsRender = true
      this.options.onHover?.(null)
      return
    }

    const rect = this.canvas.getBoundingClientRect()
    const cursorScreen = { x: e.clientX - rect.left, y: e.clientY - rect.top }

    let best: { point: Vec3; label?: string; dist: number } | null = null
    const consider = (point: Vec3, label?: string) => {
      const screen = this.projectToScreen(point, rect.width, rect.height)
      const dist = Math.hypot(screen.x - cursorScreen.x, screen.y - cursorScreen.y)
      if (dist <= HOVER_MAX_SCREEN_DIST && (!best || dist < best.dist)) {
        best = { point, label, dist }
      }
    }
    // Nearest point on a 3D segment [a,b] to the cursor, resolved by nearest
    // point in *projected screen space* — correct even when perspective
    // foreshortens the segment.
    const considerSegment = (a: Vec3, b: Vec3) => {
      const screenA = this.projectToScreen(a, rect.width, rect.height)
      const screenB = this.projectToScreen(b, rect.width, rect.height)
      const t = nearestParamOnSegment2D(screenA, screenB, cursorScreen)
      consider(lerp3(a, b, t))
    }

    for (const obj of this.lastScene.objects) {
      if (obj.kind === 'point3d') {
        consider(obj.position, obj.label ?? undefined)
      } else if (mode === 'all' && obj.kind === 'curve3d') {
        for (let i = 0; i < obj.points.length - 1; i++) considerSegment(obj.points[i], obj.points[i + 1])
      } else if (mode === 'all' && (obj.kind === 'segment3d' || obj.kind === 'ray3d')) {
        considerSegment(obj.from, obj.to)
      }
    }

    clearAndDispose(this.hoverGroup)
    this.needsRender = true
    if (!best) {
      this.options.onHover?.(null)
      return
    }
    const target = best as { point: Vec3; label?: string; dist: number }

    // Drop line to the ground plane (z=0), matching the 2D view's vertical
    // guide down to the axis.
    const dropGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(target.point.x, target.point.y, 0),
      new THREE.Vector3(target.point.x, target.point.y, target.point.z),
    ])
    this.hoverGroup.add(new THREE.Line(dropGeometry, new THREE.LineBasicMaterial({ color: this.hoverColor })))
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), new THREE.MeshBasicMaterial({ color: this.hoverColor }))
    dot.position.set(target.point.x, target.point.y, target.point.z)
    this.hoverGroup.add(dot)

    const screen = this.projectToScreen(target.point, rect.width, rect.height)
    this.options.onHover?.({
      worldX: target.point.x,
      worldY: target.point.y,
      worldZ: target.point.z,
      screenX: screen.x,
      screenY: screen.y,
      label: target.label,
    })
  }

  setGraphScene(scene: Scene3D) {
    this.lastScene = scene
    clearAndDispose(this.objectGroup)
    for (const obj of scene.objects) {
      const mesh = this.buildObject(obj)
      if (mesh) this.objectGroup.add(mesh)
    }
    this.needsRender = true
  }

  private buildObject(obj: SceneObject3D): THREE.Object3D | null {
    if (obj.kind === 'curve3d') {
      if (obj.points.length < 2) return null
      const positions = new Float32Array(obj.points.length * 3)
      obj.points.forEach((p, i) => {
        positions[i * 3] = p.x
        positions[i * 3 + 1] = p.y
        positions[i * 3 + 2] = p.z
      })
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: this.curveColor }))
    }

    if (obj.kind === 'segment3d') {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(obj.from.x, obj.from.y, obj.from.z),
        new THREE.Vector3(obj.to.x, obj.to.y, obj.to.z),
      ])
      return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: this.segmentColor }))
    }

    if (obj.kind === 'ray3d') {
      const origin = new THREE.Vector3(obj.from.x, obj.from.y, obj.from.z)
      const target = new THREE.Vector3(obj.to.x, obj.to.y, obj.to.z)
      const dir = target.clone().sub(origin)
      const length = dir.length() || 1
      dir.normalize()
      // ArrowHelper's own "length" is the full origin-to-tip distance (head
      // included), so the tip lands exactly at `origin + dir * length` — the
      // spec's actual "-> (x2, y2, z2)" endpoint. Same overshoot bug as the
      // 2D ray's buildArrow (see SceneRenderer.ts) used to have when the
      // total was scaled up by an extra 1.4x on top of that.
      return new THREE.ArrowHelper(dir, origin, length, this.segmentColor, length * 0.15, length * 0.08)
    }

    if (obj.kind === 'point3d') {
      const group = new THREE.Group()
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), new THREE.MeshBasicMaterial({ color: POINT_COLOR }))
      sphere.position.set(obj.position.x, obj.position.y, obj.position.z)
      group.add(sphere)
      if (obj.label) {
        const sprite = makeLabelSprite(obj.label)
        sprite.position.set(obj.position.x + 0.2, obj.position.y + 0.2, obj.position.z + 0.2)
        group.add(sprite)
      }
      return group
    }

    if (obj.kind === 'surface3d') {
      return this.buildSurface(obj)
    }

    return null
  }

  private buildSurface(obj: SceneObject3D & { kind: 'surface3d' }): THREE.Object3D {
    const { rows, cols, positions } = obj
    const vertexCount = rows * cols
    const positionArray = new Float32Array(vertexCount * 3)
    for (let i = 0; i < vertexCount; i++) {
      const p = positions[i]
      positionArray[i * 3] = p.x
      positionArray[i * 3 + 1] = p.y
      positionArray[i * 3 + 2] = Number.isFinite(p.z) ? p.z : 0
    }

    const indices: number[] = []
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = j * cols + i
        const b = a + 1
        const c = a + cols
        const d = c + 1
        // Skip quads touching an undefined (NaN) sample so gaps stay open
        // rather than stretching a triangle across a discontinuity.
        if (![a, b, c, d].every((idx) => Number.isFinite(positions[idx].z))) continue
        indices.push(a, c, b, b, c, d)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()

    // Opaque flat-matte material, no wireframe overlay — a plain lit surface
    // reads cleaner and less "CAD tool" than a semi-transparent surface with
    // a wireframe cage on top, and lets the surface's own shading (plus the
    // ground grid/axis beneath it) carry the sense of depth instead.
    const material = new THREE.MeshLambertMaterial({
      color: this.surfaceColor,
      side: THREE.DoubleSide,
    })
    return new THREE.Mesh(geometry, material)
  }

  private loop = () => {
    this.controls.update()
    if (this.needsRender) {
      this.renderer.render(this.scene, this.camera)
      this.needsRender = false
    }
    this.rafId = requestAnimationFrame(this.loop)
  }

  dispose() {
    cancelAnimationFrame(this.rafId)
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown)
    window.removeEventListener('pointerup', this.handlePointerUp)
    this.canvas.removeEventListener('pointermove', this.handleHoverMove)
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave)
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost)
    clearAndDispose(this.objectGroup)
    clearAndDispose(this.hoverGroup)
    this.grid.geometry.dispose()
    ;(this.grid.material as THREE.Material).dispose()
    this.axisLines.geometry.dispose()
    ;(this.axisLines.material as THREE.Material).dispose()
    this.controls.dispose()
    this.renderer.dispose()
    // See SceneRenderer.dispose()'s comment — dispose() alone doesn't release
    // the WebGL context itself, which leaks across repeated question mounts.
    this.renderer.forceContextLoss()
  }
}

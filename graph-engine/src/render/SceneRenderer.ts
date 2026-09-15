import * as THREE from 'three'
import type { GraphConfig } from '../parser/config'
import { resolveColor } from '../parser/colors'
import { evalExpr, type FunctionTable } from '../parser/evalExpr'
import { Camera2D } from './camera2d'
import { clearAndDispose, disposeObject3D } from './disposeObject3D'
import { GeometryGroupManager, isGeometryKind, type GeometryKind } from './geometryGroup'
import { angleArcPoints, angleBisectorPoint, rightAngleSquarePoints, tickMarkSegments } from './geometryMarks'
import { GridRenderer } from './grid'
import { HoverResolver, type HoverInfo } from './hover'
import { clampedLabelPlacement } from './labelLayout'
import { makeLabelSprite } from './labelSprite'
import type { Bounds } from './marchingSquares'
import type { Scene as GraphScene, SceneObject, Vec2 } from '../scene/types'
import type { Expr } from '../parser/types'

export type { HoverInfo } from './hover'

import { LIGHT_PALETTE, DARK_PALETTE, type Palette } from './palette'
export type { Palette } from './palette'

const ANIMATE_DURATION_MS = 4000
// pixelToWorld's "fixed on-screen size" markers/line-weights are specified
// as an absolute pixel count, which is only "fixed" relative to a canvas of
// a given size — the same 7px dot that reads as a small accent on an
// 800px-wide desktop canvas covers a much bigger fraction of a 220px-wide
// embedded question widget, since it sits next to fewer, physically smaller
// grid cells. Scaling the target down (never up) for canvases smaller than
// this reference keeps markers/line-weight looking proportionate to the
// grid across embed sizes instead of a constant that only looks right at
// one specific size. Floored rather than let it shrink to nothing on a
// tiny embed.
const SIZE_REFERENCE_PX = 500
const MIN_SIZE_SCALE = 0.5
// Constant visual weight for a ray/vector's shaft — same rationale as
// geometryGroup.ts's LINE_WIDTH_PX (THREE.Line's linewidth isn't honored by
// most browsers, so a plain Line shaft would read as a near-invisible
// hairline next to the weighted curve/segment ribbons).
const RAY_WIDTH_PX = 3
// Geometry-annotation mark sizing — all fixed on-screen pixel targets (same
// pixelToWorld convention as everything else here), tuned to read clearly
// next to a polygon's own LINE_WIDTH_PX edges without overwhelming a small
// figure.
const ANGLE_ARC_RADIUS_PX = 22
const ANGLE_LABEL_DISTANCE_PX = 34
const RIGHT_ANGLE_SIZE_PX = 13
const TICK_LENGTH_PX = 5
const TICK_GAP_PX = 5
// A mark's fixed-pixel target only makes sense while it's small relative to
// the geometry it's attached to — at a zoomed-out-enough view, that same
// pixel target maps to a world size bigger than the vertex's own adjacent
// sides (an arc/right-angle-square wider than the triangle it's marking, a
// tick longer than the segment it's on). Clamping to a fraction of the
// relevant side length(s) means the mark shrinks along with its own
// geometry past that point instead of visually swallowing it, while still
// behaving as pure fixed-pixel-size at any zoom level where that clamp
// doesn't bind.
const ANGLE_ARC_MAX_FRACTION = 0.35
const ANGLE_LABEL_MAX_FRACTION = 0.5
const RIGHT_ANGLE_MAX_FRACTION = 0.3
const TICK_MAX_FRACTION = 0.2

const POINT_OUTLINE_INNER_PX = 4
const POINT_OUTLINE_OUTER_PX = 6
const POINT_HALO_PX = 7
const POINT_FILL_PX = 5.5

// How far a label sits from the point/vertex it belongs to, at any zoom —
// this is the actual reported bug, not just an extreme-zoom edge case: the
// original (pixelToWorld(14), pixelToWorld(14)) offset (~19.8px magnitude)
// reads as visibly detached from its anchor even at a perfectly normal,
// well-framed zoom level, since makeLabelSprite draws its text starting
// almost at the sprite's own left edge (x=4 of a 128px-wide canvas) rather
// than centered — so the *visible glyph*, not just the sprite's invisible
// bounding box, was sitting a nearly-20px gap away from the point. Cut
// down to a distance that reads as "just outside the point marker" instead.
const LABEL_OFFSET_PX = 10
const DEFAULT_LABEL_DIRECTION: Vec2 = { x: Math.SQRT1_2, y: Math.SQRT1_2 }

export interface SceneRendererOptions {
  // Colours to use instead of the theme's built-in palette (see palette.ts).
  palette?: Palette
  config: GraphConfig
  onViewChange?: () => void
  onHover?: (info: HoverInfo | null) => void
  // Fires when the browser force-evicts this canvas's WebGL context — e.g.
  // the page (or another tab sharing the same GPU process) has too many
  // live contexts open at once. Lets the host show a real message instead
  // of a silently blank canvas.
  onContextLost?: () => void
}

interface AnimatedEntry {
  mesh: THREE.Object3D
  fx: Expr
  fy: Expr
  param: string
  from: number
  to: number
  functions: FunctionTable
}

interface MiscEntry {
  kind: SceneObject['kind']
  outline: boolean
  hasLabel: boolean
  object3d: THREE.Object3D
  // Only set for kinds contentKey knows how to key (ray + the geometry-
  // annotation marks) — see contentKey below.
  cacheKey?: string
}

// Owns the three.js scene/camera/renderer plus pan/zoom pointer handling.
// Axis/grid drawing (grid.ts), hover hit-testing (hover.ts), and the
// curve/segment/segments/region update-in-place path (geometryGroup.ts) are
// each split into their own module — this class wires them together and owns
// everything that's genuinely renderer-lifecycle-level: the WebGL
// renderer/camera, pointer/wheel handling, the misc (point/ray/animatedPoint)
// group, and the render loop. `setGraphScene` replaces the plotted objects;
// the renderer keeps running its own render loop independently of that, but
// only issues an actual draw call when something changed (see `needsRender`)
// or a point is being animated.
//
// 'point' entries are index-matched and updated in place (reposition/
// recolor an existing Group) rather than disposed and rebuilt every time —
// measured cost: disposing+recreating even a single point's WebGL buffers
// added ~10ms to the next render call in this environment, entirely from
// GPU-side buffer/program churn, not JS-side construction (which is
// sub-millisecond). That's the same "fixed per-buffer cost, not a math
// cost" bottleneck documented on growAttribute in geometryGroup.ts, just
// showing up here instead — a spec with several points (a scatter plot,
// auto-detected vertices) was blowing the frame budget on every drag frame.
// animatedPoint stays on the simpler dispose-and-rebuild path — its position
// is expected to change every single frame (that's what "animated" means
// here), so there's no stale build to reuse in the first place. 'ray' used
// to be lumped in with it under the same "rebuild every time" policy, but a
// ray's own world-space geometry (shaft ribbon + cone head) doesn't actually
// depend on the camera's pan offset at all — only on its own spec endpoints
// and the current zoom (via RAY_WIDTH_PX's pixelToWorld conversion) — so a
// pure pan was disposing and reallocating GPU buffers for every vector/ray
// on every single drag frame for literally no change in what should end up
// on screen. That's exactly the per-frame GPU churn 'point' was already
// fixed for below; see rayKey.

export class SceneRenderer {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera2d: Camera2D
  private gridRenderer: GridRenderer
  // curve/segment/segments/region: updated in place rather than disposed and
  // rebuilt every rebuild, since those are the objects with real vertex
  // counts and rebuild every frame during a drag — see geometryGroup.ts.
  private geometryGroupManager: GeometryGroupManager
  // point/ray/animatedPoint — see the class comment above for the update
  // strategy (points reused in place, ray/animatedPoint rebuilt).
  private miscGroup = new THREE.Group()
  private miscEntries: MiscEntry[] = []
  private hoverResolver: HoverResolver
  private canvas: HTMLCanvasElement
  private resizeObserver: ResizeObserver
  private rafId = 0
  private dragging = false
  private lastPointer = { x: 0, y: 0 }
  private options: SceneRendererOptions
  private palette: Palette
  private lastScene: GraphScene | null = null
  private viewChangeScheduled = false
  private animated: AnimatedEntry[] = []
  private startTime = performance.now()
  private needsRender = true
  private hoverScheduled = false
  private pendingHoverEvent: PointerEvent | null = null

  constructor(canvas: HTMLCanvasElement, options: SceneRendererOptions) {
    this.canvas = canvas
    this.options = options
    this.palette = options.palette ?? (options.config.theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setClearColor(this.palette.background, 1)

    this.gridRenderer = new GridRenderer(this.palette)
    this.geometryGroupManager = new GeometryGroupManager()
    this.hoverResolver = new HoverResolver()

    this.scene.add(this.gridRenderer.group)
    this.scene.add(this.geometryGroupManager.group)
    this.scene.add(this.miscGroup)
    this.scene.add(this.hoverResolver.group)

    const rect = canvas.getBoundingClientRect()
    const width = Math.max(rect.width, 1)
    const height = Math.max(rect.height, 1)
    this.camera2d = new Camera2D(width, height, options.config.bounds ?? undefined)
    this.renderer.setSize(width, height, false)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(canvas)

    canvas.addEventListener('pointerdown', this.handlePointerDown)
    window.addEventListener('pointermove', this.handlePointerMove)
    window.addEventListener('pointerup', this.handlePointerUp)
    canvas.addEventListener('wheel', this.handleWheel, { passive: false })
    canvas.addEventListener('pointermove', this.handleHoverMove)
    canvas.addEventListener('pointerleave', this.handlePointerLeave)
    // preventDefault here is what allows 'webglcontextrestored' to ever
    // fire at all — without it the browser treats the loss as permanent.
    canvas.addEventListener('webglcontextlost', this.handleContextLost)

    this.drawGrid()
    this.loop()
  }

  getBounds(): Bounds {
    return this.camera2d.getBounds()
  }

  // Exposed so GraphViewer.tsx can pass a reduced marching-squares
  // resolution to buildScene while the user is actively panning.
  isDragging(): boolean {
    return this.dragging
  }

  // Converts a target on-screen pixel size into the current world-unit size
  // that renders as that many pixels — used for anything that's meant to be
  // a fixed-size UI marker (a point dot, the hover dot) rather than actual
  // plotted geometry. Without this, a CircleGeometry built with a fixed
  // world-unit radius visibly grows as you zoom in, since it's geometry like
  // everything else on the graph instead of a UI overlay.
  //
  // Clamped like the constructor/handleResize's own rect reads: a scene
  // rebuild can run synchronously while the canvas is still "display: none"
  // (e.g. GraphViewer swapping out of table mode — the state update that
  // un-hides the canvas hasn't committed to the DOM yet), which reports a
  // 0-height rect. Dividing by that produced Infinity/NaN ribbon vertices
  // for every curve/segment built during that window.
  private pixelToWorld(px: number): number {
    const rect = this.canvas.getBoundingClientRect()
    const height = Math.max(rect.height, 1)
    const sizeScale = Math.min(1, Math.max(MIN_SIZE_SCALE, Math.min(rect.width, rect.height) / SIZE_REFERENCE_PX))
    return px * sizeScale * this.camera2d.worldPerPixel(height)
  }

  setConfig(config: GraphConfig, palette?: Palette) {
    this.options.config = config
    this.palette = palette ?? (config.theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE)
    this.renderer.setClearColor(this.palette.background, 1)
    this.gridRenderer.setPalette(this.palette)
    this.drawGrid()
  }

  private handleResize() {
    const rect = this.canvas.getBoundingClientRect()
    const width = Math.max(rect.width, 1)
    const height = Math.max(rect.height, 1)
    this.renderer.setSize(width, height, false)
    this.camera2d.resize(width, height)
    this.drawGrid()
  }

  private handlePointerDown = (e: PointerEvent) => {
    this.dragging = true
    this.lastPointer = { x: e.clientX, y: e.clientY }
    try {
      this.canvas.setPointerCapture(e.pointerId)
    } catch {
      // ignore — pointer capture is a nicety (keeps dragging past the canvas edge), not required for panning to work
    }
  }

  // Rebuilding the scene (re-sampling every function/region/etc. over the new
  // bounds) is real work — expensive enough that firing it synchronously on
  // every single pointermove during a drag can fall behind the event rate and
  // read as "the line isn't rendering while I drag". Coalescing to at most
  // once per animation frame keeps the pan itself always smooth while the
  // heavier rebuild never queues up faster than the screen can show it.
  //
  // drawGrid() is coalesced here too, not called synchronously from
  // handleWheel/handlePointerMove — it stopped being free once axis tick
  // labels were added (each one is a canvas-2D redraw + a GPU texture
  // upload). A trackpad commonly fires many wheel sub-events per animation
  // frame during a continuous zoom; without this, every one of those was
  // redoing that work, which is what made zooming (especially a sustained
  // zoom-out, which crosses more "nice step" boundaries and therefore
  // changes more labels' text) noticeably heavier than a single pan/zoom
  // step should be. The camera itself still moves every frame — only the
  // grid/label *geometry* catches up on the next frame, same as the curve
  // rebuild already did.
  private scheduleViewChange() {
    if (this.viewChangeScheduled) return
    this.viewChangeScheduled = true
    requestAnimationFrame(() => {
      this.viewChangeScheduled = false
      this.drawGrid()
      this.options.onViewChange?.()
      // The hover guide line's own length is drawn out to the *current*
      // camera bounds (see hover.ts's resolve) — but resolveHover only
      // otherwise runs from a pointermove handler, and a wheel zoom (the
      // common "cursor stays put, scroll to zoom" gesture) changes those
      // bounds without firing one. Left alone, the line stayed sized for
      // whatever bounds were current the last time the mouse actually
      // moved, so it visibly stopped short of the newly-visible grid after
      // zooming out. Re-resolving against the last known cursor position
      // here keeps it in sync with every view change, not just the ones
      // that happen to come with a fresh mousemove.
      if (this.pendingHoverEvent) this.resolveHover(this.pendingHoverEvent)
    })
  }

  private handlePointerMove = (e: PointerEvent) => {
    if (!this.dragging) return
    const dx = e.clientX - this.lastPointer.x
    const dy = e.clientY - this.lastPointer.y
    this.lastPointer = { x: e.clientX, y: e.clientY }
    const rect = this.canvas.getBoundingClientRect()
    this.camera2d.panByPixels(dx, dy, rect.height)
    // Cheap, every frame — keeps the guide line's far end reaching the true
    // bottom of the view throughout the drag instead of freezing at
    // whatever bounds were current when hover was last fully resolved (see
    // refreshGuideLine's own comment). The full re-hit-test in resolveHover
    // stays skipped for the whole drag (see its `dragging` guard) — this
    // only touches the line's two vertices, not a scan of every candidate.
    this.hoverResolver.refreshGuideLine(this.camera2d)
    this.needsRender = true
    this.scheduleViewChange()
  }

  private handlePointerUp = () => {
    this.dragging = false
    // Belt-and-suspenders alongside scheduleViewChange's own re-resolve: that
    // one only fires once its queued rAF callback runs, which could in
    // principle land before or after this synchronous pointerup depending on
    // frame timing. Resolving right here means the hover marker reappears at
    // its correct, settled-view position the instant the drag actually ends,
    // regardless of that race.
    if (this.pendingHoverEvent) this.resolveHover(this.pendingHoverEvent)
  }

  private handleWheel = (e: WheelEvent) => {
    e.preventDefault()
    const rect = this.canvas.getBoundingClientRect()
    const factor = Math.exp(e.deltaY * 0.001)
    this.camera2d.zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height)
    this.hoverResolver.refreshGuideLine(this.camera2d)
    this.needsRender = true
    this.scheduleViewChange()
  }

  private handleContextLost = (e: Event) => {
    e.preventDefault()
    cancelAnimationFrame(this.rafId)
    this.options.onContextLost?.()
  }

  private handlePointerLeave = () => {
    this.hoverResolver.clear()
    this.needsRender = true
    this.options.onHover?.(null)
  }

  // Raw pointermove events can fire well above the display refresh rate on
  // some input devices; the actual hit-test (a full scan of every scene
  // object, and in "all" mode every sample point on every curve) is real
  // work, so it's coalesced to at most once per animation frame the same way
  // scheduleViewChange throttles pan/zoom rebuilds above.
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

  private resolveHover(e: PointerEvent) {
    if (this.dragging) return
    const mode = this.options.config.hover
    if (mode === 'none' || !this.lastScene) {
      this.hoverResolver.clear()
      this.needsRender = true
      this.options.onHover?.(null)
      return
    }

    const rect = this.canvas.getBoundingClientRect()
    const cursorScreen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    const cursorWorld = this.camera2d.screenToWorld(cursorScreen.x, cursorScreen.y, rect.width, rect.height)

    const info = this.hoverResolver.resolve(
      this.lastScene,
      mode,
      cursorScreen,
      cursorWorld,
      this.camera2d,
      rect.width,
      rect.height,
      this.palette.hover,
      this.palette.background,
      (px) => this.pixelToWorld(px)
    )
    this.needsRender = true
    this.options.onHover?.(info)
  }

  private drawGrid() {
    this.gridRenderer.draw(this.camera2d.getBounds(), this.options.config, (px) => this.pixelToWorld(px))
    this.needsRender = true
  }

  setGraphScene(scene: GraphScene) {
    this.lastScene = scene
    this.geometryGroupManager.update(
      scene.objects.filter((o): o is Extract<SceneObject, { kind: GeometryKind }> => isGeometryKind(o.kind)),
      this.palette,
      (px) => this.pixelToWorld(px)
    )
    this.updateMiscGroup(scene.objects.filter((o) => !isGeometryKind(o.kind)))
    this.needsRender = true
  }

  // See the class comment for the reuse policy per kind: 'point' updates its
  // existing Group in place, everything contentKey knows how to key (ray,
  // and the geometry-annotation marks below) skips rebuilding entirely when
  // that key says nothing that matters changed, and 'animatedPoint' always
  // rebuilds. Same index-match-by-position idea as geometryGroupManager
  // .update, just over whole objects instead of vertex buffers.
  private updateMiscGroup(objects: SceneObject[]) {
    const next: MiscEntry[] = []
    this.animated = []
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i]
      const outline = obj.kind === 'point' && obj.style === 'outline'
      const hasLabel = obj.kind === 'point' && !!obj.label
      const prev = this.miscEntries[i]
      if (obj.kind === 'point' && prev && prev.kind === 'point' && prev.outline === outline && prev.hasLabel === hasLabel) {
        this.updatePointObject(prev.object3d as THREE.Group, obj)
        next.push(prev)
        continue
      }
      const cacheKey = this.contentKey(obj)
      if (cacheKey !== null) {
        if (prev && prev.kind === obj.kind && prev.cacheKey === cacheKey) {
          next.push(prev)
          continue
        }
        if (prev) {
          this.miscGroup.remove(prev.object3d)
          disposeObject3D(prev.object3d)
        }
        const built = this.buildObject(obj)
        if (built) {
          this.miscGroup.add(built)
          next.push({ kind: obj.kind, outline, hasLabel, object3d: built, cacheKey })
        }
        continue
      }
      if (prev) {
        this.miscGroup.remove(prev.object3d)
        disposeObject3D(prev.object3d)
      }
      const built = this.buildObject(obj)
      if (built) {
        this.miscGroup.add(built)
        next.push({ kind: obj.kind, outline, hasLabel, object3d: built })
      }
    }
    for (let i = objects.length; i < this.miscEntries.length; i++) {
      this.miscGroup.remove(this.miscEntries[i].object3d)
      disposeObject3D(this.miscEntries[i].object3d)
    }
    this.miscEntries = next
  }

  // Everything these kinds' built geometry actually depends on: their own
  // spec inputs (endpoints/color/label/etc.) plus the current zoom (any
  // pixelToWorld-derived size — a ray's shaft width, an angle arc's radius —
  // changes with zoom even though the underlying world coordinates don't) —
  // deliberately *not* including anything about the camera's pan offset,
  // since panning alone never changes what any of these should look like.
  // `this.pixelToWorld(1)` stands in for "the current zoom" as a single
  // number: pixelToWorld is linear in its input, so any two pixelToWorld(N)
  // calls agree exactly whenever this one does. Two calls that produce the
  // same key would build byte-for-byte the same geometry, so it's safe to
  // skip rebuilding and just keep the previous object3d. Returns null for
  // any kind not listed here (point/animatedPoint), which just means "this
  // kind doesn't use the cache-key path" — see updateMiscGroup.
  private contentKey(obj: SceneObject): string | null {
    const zoom = this.pixelToWorld(1)
    if (obj.kind === 'ray') {
      return ['ray', obj.from.x, obj.from.y, obj.to.x, obj.to.y, obj.color ?? '', obj.label ?? '', zoom].join('|')
    }
    if (obj.kind === 'angleMark') {
      return ['angleMark', obj.vertex.x, obj.vertex.y, obj.from.x, obj.from.y, obj.to.x, obj.to.y, obj.label ?? '', obj.color ?? '', zoom].join('|')
    }
    if (obj.kind === 'tickMark') {
      return ['tickMark', obj.from.x, obj.from.y, obj.to.x, obj.to.y, obj.count, obj.color ?? '', zoom].join('|')
    }
    if (obj.kind === 'rightAngleMark') {
      return ['rightAngleMark', obj.vertex.x, obj.vertex.y, obj.from.x, obj.from.y, obj.to.x, obj.to.y, obj.color ?? '', zoom].join('|')
    }
    return null
  }

  // Repositions/recolors an existing point Group in place. Relies on
  // buildObject's 'point' case always producing children in the same
  // [ring-or-halo, circle, label?] order at the group's local origin (see
  // buildObject below), with the group itself carrying the world position —
  // that's what makes "just move the group" a correct, complete update.
  private updatePointObject(group: THREE.Group, obj: Extract<SceneObject, { kind: 'point' }>) {
    group.position.set(obj.position.x, obj.position.y, 0)
    const outline = obj.style === 'outline'
    const pointColor = this.colorOr(obj.color, this.palette.point)
    const ringOrHalo = group.children[0] as THREE.Mesh
    const circle = group.children[1] as THREE.Mesh
    ;(ringOrHalo.material as THREE.MeshBasicMaterial).color.setHex(outline ? pointColor : this.palette.background)
    ;(circle.material as THREE.MeshBasicMaterial).color.setHex(outline ? this.palette.background : pointColor)
    // Re-applied on every reuse, not just at first build — this used to be
    // build-time only, so a point's on-screen size stayed frozen at
    // whatever pixelToWorld returned the moment it was first built, and
    // reusing the same Group in place (rather than rebuilding — see the
    // class comment on why points get this treatment) never touched it
    // again. The *position* update above already ran every reuse; the size
    // just wasn't wired up the same way, so a point visibly grew as you
    // zoomed in instead of holding its apparent size like every other
    // pixelToWorld-driven marker does.
    this.applyPointSizes(group, outline)
    if (obj.label) {
      const label = group.children[2] as THREE.Sprite | undefined
      if (label && label.userData.labelText !== obj.label) {
        group.remove(label)
        disposeObject3D(label)
        const newLabel = this.buildLabel(obj.label, { x: 0, y: 0 }, obj.labelDirection ?? undefined, obj.maxLabelOffset)
        newLabel.userData.labelText = obj.label
        group.add(newLabel)
      } else if (label) {
        this.updateLabelSprite(label, { x: 0, y: 0 }, obj.labelDirection ?? undefined, obj.maxLabelOffset)
      }
    }
  }

  // Sizes an already-built point Group's ring-or-halo + circle meshes via
  // scale rather than geometry — both are built at unit radius (see
  // buildObject's 'point' case) specifically so resizing them, whether at
  // first build or on every later reuse, is a cheap transform update
  // instead of a GPU buffer rebuild.
  private applyPointSizes(group: THREE.Group, outline: boolean) {
    const ringOrHalo = group.children[0] as THREE.Mesh
    const circle = group.children[1] as THREE.Mesh
    if (outline) {
      const outer = this.pixelToWorld(POINT_OUTLINE_OUTER_PX)
      ringOrHalo.scale.setScalar(outer)
      circle.scale.setScalar(outer)
    } else {
      ringOrHalo.scale.setScalar(this.pixelToWorld(POINT_HALO_PX))
      circle.scale.setScalar(this.pixelToWorld(POINT_FILL_PX))
    }
  }

  private colorOr(color: string | null | undefined, fallback: number): number {
    return color ? resolveColor(color) : fallback
  }

  // A label sprite sized/offset in screen pixels rather than world units —
  // same fix as pixelToWorld above, applied to point/vector labels so they
  // don't visually balloon as you zoom in either. `direction` (default: up
  // and to the right, matching the original fixed offset) is which way the
  // label sits from `worldPos` — a polygon vertex passes one pointing away
  // from its own shape (see buildScene.ts's buildPolygon) so the label
  // doesn't land on top of an angle:/right-angle: mark, which always sits
  // *inside* the shape at that same vertex. `maxOffset` (world units) caps
  // how far out the fixed-pixel offset is allowed to push the label — see
  // maxLabelOffset's own comment in scene/types.ts for why.
  private buildLabel(text: string, worldPos: Vec2, direction?: Vec2, maxOffset?: number | null): THREE.Sprite {
    const sprite = makeLabelSprite(text)
    this.updateLabelSprite(sprite, worldPos, direction, maxOffset)
    return sprite
  }

  // The scale/position math buildLabel applies at construction, factored
  // out so a reused sprite (see updatePointObject) can get it re-applied on
  // every reuse too — same "target pixel size means the correct *world*
  // scale changes with zoom" reasoning as applyPointSizes above, just for a
  // Sprite's scale instead of a Mesh's. The actual clamp math lives in
  // labelLayout.ts (unit-tested there) rather than inline here, same
  // "keep it out of anything that needs a canvas to construct" reasoning as
  // geometryMarks.ts/hover.ts.
  private updateLabelSprite(sprite: THREE.Sprite, worldPos: Vec2, direction: Vec2 = DEFAULT_LABEL_DIRECTION, maxOffset?: number | null) {
    const placement = clampedLabelPlacement(worldPos, direction, this.pixelToWorld(LABEL_OFFSET_PX), this.pixelToWorld(60), this.pixelToWorld(30), maxOffset)
    sprite.scale.set(placement.width, placement.height, 1)
    sprite.position.set(placement.position.x, placement.position.y, 0)
  }

  // A weighted ribbon shaft + cone head, replacing THREE.ArrowHelper (whose
  // shaft is a plain THREE.Line — same "renders as a 1px hairline on most
  // platforms" problem as everything else in geometryGroup.ts). Proportions
  // (head length/radius as a fraction of the total) match ArrowHelper's own
  // defaults so existing vector/ray specs look the same shape, just with
  // real weight — the tip lands exactly at `origin + dir * length` (i.e. at
  // the spec's own "-> (x2, y2)" endpoint), same as ArrowHelper.
  private buildArrow(origin: THREE.Vector3, dir: THREE.Vector3, length: number, color: number): THREE.Group {
    const headLength = length * 0.15
    const headRadius = length * 0.08
    const shaftEnd = origin.clone().addScaledVector(dir, length - headLength)

    const group = new THREE.Group()

    const halfWidth = this.pixelToWorld(RAY_WIDTH_PX) / 2
    const nx = -dir.y * halfWidth
    const ny = dir.x * halfWidth
    const shaftPositions = new Float32Array([
      origin.x + nx, origin.y + ny, 0,
      origin.x - nx, origin.y - ny, 0,
      shaftEnd.x + nx, shaftEnd.y + ny, 0,
      shaftEnd.x - nx, shaftEnd.y - ny, 0,
    ])
    const shaftGeometry = new THREE.BufferGeometry()
    shaftGeometry.setAttribute('position', new THREE.BufferAttribute(shaftPositions, 3))
    shaftGeometry.setIndex([0, 1, 2, 1, 3, 2])
    group.add(new THREE.Mesh(shaftGeometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })))

    // ConeGeometry's local +Y is its apex; rotate that onto `dir` and center
    // it so the base sits at shaftEnd and the apex reaches the full length.
    const head = new THREE.Mesh(new THREE.ConeGeometry(headRadius, headLength, 12), new THREE.MeshBasicMaterial({ color }))
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
    head.position.copy(shaftEnd).addScaledVector(dir, headLength / 2)
    group.add(head)

    return group
  }

  // Only the point/ray/animatedPoint kinds — curve/segment/segments/region
  // are built and updated by geometryGroupManager instead (see setGraphScene).
  private buildObject(obj: SceneObject): THREE.Object3D | null {
    if (obj.kind === 'ray') {
      const origin = new THREE.Vector3(obj.from.x, obj.from.y, 0)
      const target = new THREE.Vector3(obj.to.x, obj.to.y, 0)
      const dir = target.clone().sub(origin)
      const length = dir.length() || 1
      dir.normalize()
      const color = this.colorOr(obj.color, this.palette.segment)
      const arrow = this.buildArrow(origin, dir, length, color)
      if (obj.label) {
        const mid = origin.clone().add(target).multiplyScalar(0.5)
        arrow.add(this.buildLabel(obj.label, { x: mid.x, y: mid.y }))
      }
      return arrow
    }

    if (obj.kind === 'point') {
      // Group-relative: every child sits at the group's local origin, and
      // the group itself carries the world position — required so
      // updatePointObject's in-place reuse can move the whole point with a
      // single group.position.set(...) instead of touching each child.
      const group = new THREE.Group()
      group.position.set(obj.position.x, obj.position.y, 0)
      const outline = obj.style === 'outline'
      const pointColor = this.colorOr(obj.color, this.palette.point)
      if (outline) {
        // Unit radius (1) — applyPointSizes below scales this via a
        // transform, not by rebuilding the geometry, so the same mesh works
        // at any zoom level (see applyPointSizes/updatePointObject).
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(POINT_OUTLINE_INNER_PX / POINT_OUTLINE_OUTER_PX, 1, 24),
          new THREE.MeshBasicMaterial({ color: pointColor })
        )
        group.add(ring)
        const circle = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: this.palette.background }))
        circle.position.set(0, 0, 0.01)
        group.add(circle)
      } else {
        // A background-colored halo behind the fill reads as a stroke/ring
        // cut into the paper — matching the reference's solid dot with a
        // 2px white stroke — and, using the canvas's own background rather
        // than a hardcoded white, stays correct in dark theme too (same
        // technique the outline style above already uses for its own ring).
        const halo = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: this.palette.background }))
        group.add(halo)
        const circle = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: pointColor }))
        circle.position.set(0, 0, 0.01)
        group.add(circle)
      }
      this.applyPointSizes(group, outline)
      if (obj.label) {
        const label = this.buildLabel(obj.label, { x: 0, y: 0 }, obj.labelDirection ?? undefined, obj.maxLabelOffset)
        label.userData.labelText = obj.label
        group.add(label)
      }
      return group
    }

    if (obj.kind === 'animatedPoint') {
      const color = this.colorOr(obj.color, this.palette.point)
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(this.pixelToWorld(7), 24), new THREE.MeshBasicMaterial({ color }))
      this.animated.push({ mesh, fx: obj.fx, fy: obj.fy, param: obj.param, from: obj.from, to: obj.to, functions: obj.functions })
      return mesh
    }

    // The three geometry-annotation marks (angle arc, right-angle square,
    // congruence ticks) — all thin plain THREE.Line strokes rather than the
    // weighted ribbons curves/segments get, matching how these read in an
    // actual textbook diagram: small, ink-thin decorations on top of the
    // real geometry, not part of it. Math lives in geometryMarks.ts so it's
    // unit-testable without a canvas.
    if (obj.kind === 'angleMark') {
      const color = this.colorOr(obj.color, this.palette.axis)
      const legLength = Math.min(Math.hypot(obj.from.x - obj.vertex.x, obj.from.y - obj.vertex.y), Math.hypot(obj.to.x - obj.vertex.x, obj.to.y - obj.vertex.y))
      const radius = Math.min(this.pixelToWorld(ANGLE_ARC_RADIUS_PX), legLength * ANGLE_ARC_MAX_FRACTION)
      const points = angleArcPoints(obj.vertex, obj.from, obj.to, radius)
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p.x, p.y, 0)))
      const group = new THREE.Group()
      group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color })))
      if (obj.label) {
        const labelDistance = Math.min(this.pixelToWorld(ANGLE_LABEL_DISTANCE_PX), legLength * ANGLE_LABEL_MAX_FRACTION)
        const labelPos = angleBisectorPoint(obj.vertex, obj.from, obj.to, labelDistance)
        // labelDistance above only clamps *where* the label sits (along the
        // bisector) — without also capping its own text size the same way
        // maxLabelOffset does for a polygon vertex, a small triangle's angle
        // label would keep rendering at full fixed pixel size regardless,
        // the same "closer to the vertex but still oversized" gap as before.
        group.add(this.buildLabel(obj.label, labelPos, undefined, legLength * ANGLE_LABEL_MAX_FRACTION))
      }
      return group
    }

    if (obj.kind === 'rightAngleMark') {
      const color = this.colorOr(obj.color, this.palette.axis)
      const legLength = Math.min(Math.hypot(obj.from.x - obj.vertex.x, obj.from.y - obj.vertex.y), Math.hypot(obj.to.x - obj.vertex.x, obj.to.y - obj.vertex.y))
      const size = Math.min(this.pixelToWorld(RIGHT_ANGLE_SIZE_PX), legLength * RIGHT_ANGLE_MAX_FRACTION)
      const points = rightAngleSquarePoints(obj.vertex, obj.from, obj.to, size)
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p.x, p.y, 0)))
      return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }))
    }

    if (obj.kind === 'tickMark') {
      const color = this.colorOr(obj.color, this.palette.axis)
      const segLength = Math.hypot(obj.to.x - obj.from.x, obj.to.y - obj.from.y)
      const tickLength = Math.min(this.pixelToWorld(TICK_LENGTH_PX), segLength * TICK_MAX_FRACTION)
      const gap = Math.min(this.pixelToWorld(TICK_GAP_PX), segLength * TICK_MAX_FRACTION)
      const segments = tickMarkSegments(obj.from, obj.to, obj.count, tickLength, gap)
      const group = new THREE.Group()
      for (const [a, b] of segments) {
        const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x, a.y, 0), new THREE.Vector3(b.x, b.y, 0)])
        group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color })))
      }
      return group
    }

    return null
  }

  private updateAnimated() {
    if (this.animated.length === 0) return
    const elapsed = performance.now() - this.startTime
    const angleMode = this.options.config.angle
    for (const entry of this.animated) {
      const cycle = (elapsed % ANIMATE_DURATION_MS) / ANIMATE_DURATION_MS
      const t = entry.from + (entry.to - entry.from) * cycle
      try {
        const bindings = { [entry.param]: t }
        const x = evalExpr(entry.fx, bindings, angleMode, entry.functions)
        const y = evalExpr(entry.fy, bindings, angleMode, entry.functions)
        entry.mesh.position.set(x, y, 0.02)
      } catch {
        // leave the point at its last valid position
      }
    }
  }

  private loop = () => {
    this.updateAnimated()
    // Render on demand: skip the actual draw call on frames where nothing
    // changed (no pan/zoom/hover/scene update in flight), unless a point is
    // being animated and therefore needs to keep moving every frame. Keeps
    // an idle, static graph from burning GPU/CPU forever just sitting there.
    if (this.needsRender || this.animated.length > 0) {
      this.renderer.render(this.scene, this.camera2d.camera)
      this.needsRender = false
    }
    this.rafId = requestAnimationFrame(this.loop)
  }

  dispose() {
    cancelAnimationFrame(this.rafId)
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown)
    window.removeEventListener('pointermove', this.handlePointerMove)
    window.removeEventListener('pointerup', this.handlePointerUp)
    this.canvas.removeEventListener('wheel', this.handleWheel)
    this.canvas.removeEventListener('pointermove', this.handleHoverMove)
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave)
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost)
    this.geometryGroupManager.dispose()
    clearAndDispose(this.miscGroup)
    this.hoverResolver.dispose()
    this.gridRenderer.dispose()
    this.renderer.dispose()
    // dispose() alone frees GPU buffers/programs but doesn't release the
    // underlying WebGL context itself — that only happens on GC, which is
    // non-deterministic. Every question with a graph mounts a fresh canvas
    // (a fresh context), and Chrome hard-caps live WebGL contexts at ~16 per
    // page — without an explicit force-loss here, browsing through several
    // graph questions leaks contexts until new ones fail to render and the
    // whole browser (not just the tab) gets sluggish from GPU pressure.
    this.renderer.forceContextLoss()
  }
}

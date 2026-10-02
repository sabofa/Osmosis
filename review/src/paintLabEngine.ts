// The Paint Lab's engine adapter. The lab talks to the painter only through
// this interface, so the model (space/paint/model), the renderer
// (space/paint/gl) and the paper (style/papers/generate) can land behind it
// without the lab changing.
//
// THIS FILE IS A STUB (Task 5). It clears the canvas to the canvas tone and
// draws the scene's meshes as flat-shaded triangles with Canvas 2D, lit by the
// key light (through the light-response and value curves, so the curve editors
// show an effect), plus its lines, points and arrows, and says so on the canvas. It
// exists so the lab runs, and can be judged, on its own. Task 6 replaces this
// file with the real thing: for each frame, renderer.renderGBuffer, then
// paintFrame (rebuilding particles only when the scene, seed or particle
// parameters change), then renderer.paint; and the paper, generated once per
// weave, texture and seed.
//
// The contract the lab keeps (and Task 6 may rely on):
//  - setScene receives the scene in WORLD coordinates (see paintLabCamera.ts):
//    box-normalised, the same space as the PaintView's matrices and lightDir.
//  - render receives the PaintView for this frame at the canvas's CSS size and
//    pixelRatio, the live params, and the debug mode; it returns the stroke
//    count and its own time. The lab sizes the canvas (CSS size x pixelRatio).
//  - createPaintEngine throws, with a message fit to show, when it cannot run
//    (no WebGL2); render may throw too. The lab catches both and shows them in
//    the view; the controls keep working.
//  - renderTo is render-then-copy, for the Showcase's grid of tiles: it paints
//    one view at view.width x view.height CSS px (x view.pixelRatio) and, in
//    the same task, copies the result into the 2D context `target` (drawImage,
//    scaled to the target canvas's own pixel size). The same task is what lets a
//    WebGL canvas be copied without preserveDrawingBuffer. The engine sizes its
//    own canvas for it; it must not depend on that canvas's client size. The
//    Showcase has ONE engine and canvas for all its tiles, calling setScene for
//    each figure in turn, so setScene should be cheap to alternate: cache
//    per-scene work (particles) on the scene object and the particle params,
//    not on the last call.
//  - dispose frees everything the engine made.
// Like the real engine will, the stub needs WebGL2, so the lab's no-WebGL2
// state is real today and not a promise.

import { oklabToSrgb } from '../../graph-engine/src/space/oklab'
import { evalCurve } from '../../graph-engine/src/space/paint/curves'
import type { PaintParams } from '../../graph-engine/src/space/paint/params'
import type { PaintDebugMode, PaintView, SceneColours } from '../../graph-engine/src/space/paint/types'
import type { SpaceScene } from '../../graph-engine/src/space/scene/types'

export interface PaintEngine {
  setScene(scene: SpaceScene, colours: SceneColours): void
  render(view: PaintView, params: PaintParams, debug: PaintDebugMode): { strokes: number; ms: number }
  renderTo(target: CanvasRenderingContext2D, view: PaintView, params: PaintParams, debug: PaintDebugMode): { strokes: number; ms: number }
  dispose(): void
}

type Rgb = readonly [number, number, number]

interface FlatMesh { kind: 'mesh'; positions: Float64Array; normals: Float64Array; indices: Uint32Array; rgb: Rgb; alpha: number; vertexRgb: Float32Array | null }
interface FlatLines { kind: 'lines'; positions: Float64Array; starts: Uint32Array; rgb: Rgb; width: number; dash: readonly number[] | null }
interface FlatPoints { kind: 'points'; positions: Float64Array; rgb: Rgb; size: number }
interface FlatArrows { kind: 'arrows'; tails: Float64Array; vectors: Float64Array; rgb: Rgb; width: number; head: number }
type Flat = FlatMesh | FlatLines | FlatPoints | FlatArrows

const css = (c: Rgb, a = 1) => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`

// The probe leaves no context behind: it is released at once.
function requireWebGL2(): void {
  const gl = document.createElement('canvas').getContext('webgl2')
  if (!gl) throw new Error('WebGL2 is not available in this browser, so the painter cannot draw. The controls still work; open the lab in a browser with WebGL2.')
  gl.getExtension('WEBGL_lose_context')?.loseContext()
}

export function createPaintEngine(canvas: HTMLCanvasElement): PaintEngine {
  requireWebGL2()
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The canvas would not give a 2D context.')
  const ctx: CanvasRenderingContext2D = context
  let flat: Flat[] = []

  const engine: PaintEngine = {
    setScene(scene, colours) {
      flat = scene.marks.flatMap((mark, i): Flat[] => {
        const lab = colours.markColour(i)
        const rgb = oklabToSrgb(lab)
        switch (mark.kind) {
          case 'mesh': {
            // A colormapped surface takes each vertex's colour from the colormap at its scalar.
            const scale = mark.style.colorScale
            let vertexRgb: Float32Array | null = null
            if (scale !== null && mark.scalars) {
              vertexRgb = new Float32Array(mark.scalars.length * 3)
              mark.scalars.forEach((value, v) => {
                const mapped = colours.scaleColour(scale, value)
                vertexRgb!.set(mapped ? oklabToSrgb(mapped) : rgb, 3 * v)
              })
            }
            return [{ kind: 'mesh', positions: mark.positions, normals: mark.normals, indices: mark.indices, rgb, alpha: mark.style.opacity, vertexRgb }]
          }
          case 'lines':
            return [{ kind: 'lines', positions: mark.positions, starts: mark.starts, rgb, width: mark.style.width, dash: mark.style.dash }]
          case 'points':
            return [{ kind: 'points', positions: mark.positions, rgb, size: mark.style.size }]
          case 'arrows':
            return [{ kind: 'arrows', tails: mark.tails, vectors: mark.vectors, rgb, width: mark.style.shaftWidth, head: mark.style.headSize }]
          default:
            return []
        }
      })
    },

    render(view, params, debug) {
      return draw(view, params, debug, true)
    },

    renderTo(target, view, params, debug) {
      // The engine's canvas takes the view's size, then the picture is copied
      // out before the task ends (a tile has its own caption, so no stub label).
      const w = Math.max(1, Math.round(view.width * view.pixelRatio))
      const h = Math.max(1, Math.round(view.height * view.pixelRatio))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const result = draw(view, params, debug, false)
      target.drawImage(canvas, 0, 0, target.canvas.width, target.canvas.height)
      return result
    },

    dispose() {
      flat = []
    },
  }
  return engine

  function draw(view: PaintView, params: PaintParams, debug: PaintDebugMode, label: boolean): { strokes: number; ms: number } {
    const t0 = performance.now()
    const { width, height, pixelRatio } = view
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    ctx.globalAlpha = 1
    ctx.setLineDash([])
    const tone = oklabToSrgb(params.canvas.tone)
    ctx.fillStyle = css(tone)
    ctx.fillRect(0, 0, width, height)

    const m = view.viewProj
    // World -> CSS px (x, y) and NDC depth (z: larger is farther).
    const screen = (p: Float64Array, i: number): [number, number, number] => {
      const x = p[i], y = p[i + 1], z = p[i + 2]
      const w = m[3] * x + m[7] * y + m[11] * z + m[15]
      return [
        ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * 0.5 * width,
        (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * 0.5 * height,
        (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
      ]
    }

    // Every triangle of every mesh, far to near.
    const tris: { depth: number; mesh: FlatMesh; a: number; b: number; c: number }[] = []
    const projected = new Map<FlatMesh, Float32Array>()
    for (const f of flat) {
      if (f.kind !== 'mesh') continue
      const n = f.positions.length / 3
      const pts = new Float32Array(n * 3)
      for (let v = 0; v < n; v++) pts.set(screen(f.positions, 3 * v), 3 * v)
      projected.set(f, pts)
      for (let t = 0; t + 2 < f.indices.length; t += 3) {
        const a = f.indices[t], b = f.indices[t + 1], c = f.indices[t + 2]
        tris.push({ depth: (pts[3 * a + 2] + pts[3 * b + 2] + pts[3 * c + 2]) / 3, mesh: f, a, b, c })
      }
    }
    tris.sort((p, q) => q.depth - p.depth)

    const { light } = params
    const [lx, ly, lz] = view.lightDir
    const [vx, vy, vz] = view.viewDir
    const grey = debug === 'value' || debug === 'grey'
    const dragging = view.dragging
    for (const { mesh, a, b, c } of tris) {
      const pts = projected.get(mesh)!
      const nm = mesh.normals
      let nx = nm[3 * a] + nm[3 * b] + nm[3 * c]
      let ny = nm[3 * a + 1] + nm[3 * b + 1] + nm[3 * c + 1]
      let nz = nm[3 * a + 2] + nm[3 * b + 2] + nm[3 * c + 2]
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len; ny /= len; nz /= len
      // Both sides are lit: a normal facing away from the eye turns round.
      if (nx * vx + ny * vy + nz * vz > 0) { nx = -nx; ny = -ny; nz = -nz }
      // The light response curve shapes N·L, and the value curve shapes the value that results (§11).
      const lambert = evalCurve(params.curves.lightResponse, Math.max(0, nx * lx + ny * ly + nz * lz))
      const raw = Math.min(1, light.ambient + (1 - light.ambient) * light.intensity * lambert + light.sky * Math.max(nz, 0) + light.bounce * Math.max(-nz, 0))
      const v = Math.min(1, Math.max(0, evalCurve(params.curves.value, raw)))
      const k = 0.22 + 0.95 * v
      const vc = mesh.vertexRgb
      const base: Rgb = vc
        ? [(vc[3 * a] + vc[3 * b] + vc[3 * c]) / 3, (vc[3 * a + 1] + vc[3 * b + 1] + vc[3 * c + 1]) / 3, (vc[3 * a + 2] + vc[3 * b + 2] + vc[3 * c + 2]) / 3]
        : mesh.rgb
      const rgb: Rgb = grey ? [v, v, v] : [Math.min(1, base[0] * k), Math.min(1, base[1] * k), Math.min(1, base[2] * k)]
      const fill = css(rgb, mesh.alpha)
      ctx.beginPath()
      ctx.moveTo(pts[3 * a], pts[3 * a + 1])
      ctx.lineTo(pts[3 * b], pts[3 * b + 1])
      ctx.lineTo(pts[3 * c], pts[3 * c + 1])
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
      if (!dragging && mesh.alpha === 1) {
        // A hairline of the same colour closes the antialiasing seams between triangles.
        ctx.strokeStyle = fill
        ctx.lineWidth = 0.6
        ctx.stroke()
      }
    }

    for (const f of flat) {
      if (f.kind === 'lines') {
        ctx.strokeStyle = css(f.rgb)
        ctx.lineWidth = f.width
        ctx.lineJoin = 'round'
        ctx.setLineDash(f.dash ? [...f.dash] : [])
        const n = f.positions.length / 3
        for (let s = 0; s < f.starts.length; s++) {
          const end = s + 1 < f.starts.length ? f.starts[s + 1] : n
          ctx.beginPath()
          for (let v = f.starts[s]; v < end; v++) {
            const [x, y] = screen(f.positions, 3 * v)
            if (v === f.starts[s]) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.stroke()
        }
        ctx.setLineDash([])
      } else if (f.kind === 'points') {
        for (let v = 0; v + 2 < f.positions.length; v += 3) {
          const [x, y] = screen(f.positions, v)
          ctx.beginPath()
          ctx.arc(x, y, f.size / 2, 0, Math.PI * 2)
          ctx.fillStyle = css(f.rgb)
          ctx.fill()
          ctx.strokeStyle = css(tone)
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
      } else if (f.kind === 'arrows') {
        for (let v = 0; v + 2 < f.tails.length; v += 3) {
          const tip = new Float64Array([f.tails[v] + f.vectors[v], f.tails[v + 1] + f.vectors[v + 1], f.tails[v + 2] + f.vectors[v + 2]])
          const [x0, y0] = screen(f.tails, v)
          const [x1, y1] = screen(tip, 0)
          const angle = Math.atan2(y1 - y0, x1 - x0)
          ctx.strokeStyle = css(f.rgb)
          ctx.fillStyle = css(f.rgb)
          ctx.lineWidth = f.width
          ctx.beginPath()
          ctx.moveTo(x0, y0)
          ctx.lineTo(x1, y1)
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x1 - f.head * Math.cos(angle - 0.4), y1 - f.head * Math.sin(angle - 0.4))
          ctx.lineTo(x1 - f.head * Math.cos(angle + 0.4), y1 - f.head * Math.sin(angle + 0.4))
          ctx.closePath()
          ctx.fill()
        }
      }
    }

    if (label) {
      ctx.font = '12px ui-monospace, "Cascadia Code", Menlo, monospace'
      ctx.fillStyle = tone[0] * 0.3 + tone[1] * 0.59 + tone[2] * 0.11 > 0.5 ? 'rgba(23, 23, 15, 0.62)' : 'rgba(242, 239, 226, 0.7)'
      ctx.fillText('stub engine: Canvas 2D flat shading, not the painter. The engine arrives in Task 6.', 14, height - 14)
    }
    return { strokes: 0, ms: performance.now() - t0 }
  }
}

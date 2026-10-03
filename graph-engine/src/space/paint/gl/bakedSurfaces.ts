// The baked surfaces on the GPU (the baked painting, Task 5): each refined surface of the bake (bake/types.ts BakedSurface) is
// uploaded once, when a bake arrives, as vertex buffers and an index buffer, and drawn every frame into the underpainting
// image (shaders/bakedUnderpaint.ts). A recolour (colour-only parameter changes) replaces only the colour buffer.
//
// Per vertex, four buffers:
//   positions  3 floats, relative to an origin at the middle of the baked surfaces (computed in 64 bits, as
//              meshes.ts does for the scene), so a figure far from zero keeps its precision;
//   normals    3 floats, the surface's own (side +1);
//   colours    8 floats: the underpainting of side +1 (3), of side -1 (3) and the coverage of each (2), linear-light sRGB,
//              the one buffer a recolour rewrites (bufferSubData);
//   indices    the triangles, 32 bit.
// A closed surface has no back: its back colours repeat the front's, and it is drawn with u_closed (side +1 only).
//
// A surface with no coverage anywhere (a veil, bare lit table: alpha 0 on every vertex of both sides) is not uploaded at all.
// Only gl/ touches WebGL; the choices a fragment makes are plain arithmetic here as well, and tested without a GPU.

import type { ProgramInfo } from '../../gl/program'
import type { BakedSurface } from '../bake/types'
import { complete, type Gl, type Resources } from './resources'

// --- plain numbers ------------------------------------------------------------

// Floats per vertex in the colour buffer: underFront (3), underBack (3), alphaFront and alphaBack (1 each).
export const COLOUR_STRIDE = 8

// Which side of a surface the viewer sees: the back (side -1) when the surface is open and its normal points away from the eye,
// the front otherwise (a normal square to the view counts as the front). `toEye` is the unit vector from the surface point to
// the eye (for an orthographic view, the reverse of the view direction). shaders/bakedUnderpaint.ts facesBack is this.
export function facesBack(normal: ArrayLike<number>, toEye: ArrayLike<number>, closed: boolean): boolean {
  return !closed && normal[0] * toEye[0] + normal[1] * toEye[1] + normal[2] * toEye[2] < 0
}

// The underpainting a fragment of `surface` at vertex `v` shows to an eye: the colour and coverage of the side it sees.
export function sideColour(surface: BakedSurface, v: number, back: boolean): { colour: [number, number, number]; alpha: number } {
  const under = back && surface.underBack ? surface.underBack : surface.underFront
  const alpha = back && surface.alphaBack ? surface.alphaBack : surface.alphaFront
  return { colour: [under[3 * v], under[3 * v + 1], under[3 * v + 2]], alpha: alpha[v] }
}

// Whether any vertex of the surface has coverage on either side: a surface with none draws nothing, whatever the view.
export function hasCoverage(surface: BakedSurface): boolean {
  const front = surface.alphaFront
  for (let v = 0; v < front.length; v++) if (front[v] > 0 && sideFinite(surface.underFront, front, v)) return true
  const back = surface.alphaBack
  const under = surface.underBack ?? surface.underFront
  if (back && !surface.closed) for (let v = 0; v < back.length; v++) if (back[v] > 0 && sideFinite(under, back, v)) return true
  return false
}

// Whether one side of vertex v has a finite colour and alpha. A side that has not is no underpainting there (coverage 0),
// as a NaN pixel of the model's image is (gl/underpaint.ts underpaintTexels).
export function sideFinite(under: ArrayLike<number>, alpha: ArrayLike<number>, v: number): boolean {
  return Number.isFinite(alpha[v]) && Number.isFinite(under[3 * v]) && Number.isFinite(under[3 * v + 1]) && Number.isFinite(under[3 * v + 2])
}

// Why a surface cannot be drawn, or null: its arrays must agree on the vertex count, and its triangles must point at vertices.
export function surfaceProblem(surface: BakedSurface): string | null {
  const n = surface.positions.length / 3
  if (!Number.isInteger(n) || n < 3) return 'it has fewer than three vertices'
  if (surface.normals.length !== 3 * n) return 'its normals are not one per vertex'
  if (surface.underFront.length !== 3 * n || surface.alphaFront.length !== n) return 'its front colours are not one per vertex'
  if (surface.underBack && surface.underBack.length !== 3 * n) return 'its back colours are not one per vertex'
  if (surface.alphaBack && surface.alphaBack.length !== n) return 'its back coverage is not one per vertex'
  if (surface.indices.length < 3) return 'it has no triangle'
  const used = surface.indices.length - (surface.indices.length % 3)
  for (let i = 0; i < used; i++) if (surface.indices[i] >= n) return 'a triangle points past its last vertex'
  return null
}

// The colour buffer's contents: per vertex underFront, underBack, alphaFront, alphaBack (COLOUR_STRIDE floats). A surface with
// no back (closed, or given none) repeats the front. `into`, when it is long enough, is filled instead of a new array.
export function colourData(surface: BakedSurface, into?: Float32Array): Float32Array {
  const n = surface.alphaFront.length
  const out = into && into.length >= n * COLOUR_STRIDE ? into : new Float32Array(n * COLOUR_STRIDE)
  const backUnder = surface.underBack ?? surface.underFront
  const backAlpha = surface.alphaBack ?? surface.alphaFront
  for (let v = 0; v < n; v++) {
    const o = v * COLOUR_STRIDE
    // a side whose colour or alpha is not finite (NaN) is no underpainting there: colour 0, coverage 0
    const front = sideFinite(surface.underFront, surface.alphaFront, v)
    const back = sideFinite(backUnder, backAlpha, v)
    out[o] = front ? surface.underFront[3 * v] : 0
    out[o + 1] = front ? surface.underFront[3 * v + 1] : 0
    out[o + 2] = front ? surface.underFront[3 * v + 2] : 0
    out[o + 3] = back ? backUnder[3 * v] : 0
    out[o + 4] = back ? backUnder[3 * v + 1] : 0
    out[o + 5] = back ? backUnder[3 * v + 2] : 0
    out[o + 6] = front ? surface.alphaFront[v] : 0
    out[o + 7] = back ? backAlpha[v] : 0
  }
  return out
}

// The middle of the bounding box of the surfaces' positions, in 64 bits ([0, 0, 0] with none).
export function bakedOrigin(surfaces: readonly BakedSurface[]): [number, number, number] {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const s of surfaces) {
    const p = s.positions
    for (let i = 0; i + 2 < p.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        const x = p[i + c]
        if (!Number.isFinite(x)) continue
        if (x < lo[c]) lo[c] = x
        if (x > hi[c]) hi[c] = x
      }
    }
  }
  if (!Number.isFinite(lo[0])) return [0, 0, 0]
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
}

function relativeTo(positions: Float32Array, origin: readonly [number, number, number]): Float32Array {
  const out = new Float32Array(positions.length)
  for (let i = 0; i + 2 < positions.length; i += 3) {
    out[i] = positions[i] - origin[0]
    out[i + 1] = positions[i + 1] - origin[1]
    out[i + 2] = positions[i + 2] - origin[2]
  }
  return out
}

// --- the GPU side -------------------------------------------------------------

export interface BakedSurfaceGpu {
  // Index into the array the surfaces were given in, and the surface's mark.
  index: number
  mark: number
  vao: WebGLVertexArrayObject
  colours: WebGLBuffer
  // Indices to draw, and vertices (a recolour must be of the same count).
  count: number
  vertices: number
  closed: boolean
  // Whether the surface has coverage now (a recolour can take it away).
  covered: boolean
}

export interface BakedGpu {
  surfaces: BakedSurfaceGpu[]
  // The origin the positions are relative to.
  origin: [number, number, number]
}

export interface BakedUpload {
  gpu: BakedGpu
  // One line for each surface that was left out because it could not be drawn (surfaceProblem).
  skipped: string[]
}

// Uploads the surfaces that have coverage. Every buffer is made through `res`, so freeing `res` frees them.
export function uploadBaked(gl: Gl, res: Resources, surfaces: readonly (BakedSurface | null)[]): BakedUpload {
  const usable: { index: number; surface: BakedSurface }[] = []
  const skipped: string[] = []
  surfaces.forEach((surface, index) => {
    if (!surface) return
    const problem = surfaceProblem(surface)
    if (problem) skipped.push(`paint: the baked surface of mark ${surface.mark} cannot be drawn: ${problem}`)
    else if (hasCoverage(surface)) usable.push({ index, surface })
  })
  const origin = bakedOrigin(usable.map((u) => u.surface))
  const made: BakedSurfaceGpu[] = []
  for (const { index, surface } of usable) {
    const vao = res.vertexArray()
    if (!vao) continue
    gl.bindVertexArray(vao)
    const attribute = (location: number, data: Float32Array, size: number, usage: number): WebGLBuffer | null => {
      const buffer = res.buffer()
      if (!buffer) return null
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, data, usage)
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
      return buffer
    }
    attribute(0, relativeTo(surface.positions, origin), 3, gl.STATIC_DRAW)
    attribute(1, surface.normals, 3, gl.STATIC_DRAW)
    // the colour buffer is interleaved: three attributes read it
    const colours = res.buffer()
    if (colours) {
      gl.bindBuffer(gl.ARRAY_BUFFER, colours)
      gl.bufferData(gl.ARRAY_BUFFER, colourData(surface), gl.DYNAMIC_DRAW)
      const stride = COLOUR_STRIDE * 4
      gl.enableVertexAttribArray(2)
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 0)
      gl.enableVertexAttribArray(3)
      gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 12)
      gl.enableVertexAttribArray(4)
      gl.vertexAttribPointer(4, 2, gl.FLOAT, false, stride, 24)
    }
    // the element buffer binding is VAO state: bind it while the VAO is bound
    const indices = res.buffer()
    if (indices) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, surface.indices, gl.STATIC_DRAW)
    }
    gl.bindVertexArray(null)
    if (!colours || !indices) continue
    made.push({
      index,
      mark: surface.mark,
      vao,
      colours,
      count: surface.indices.length - (surface.indices.length % 3),
      vertices: surface.alphaFront.length,
      closed: surface.closed,
      covered: true,
    })
  }
  return { gpu: { surfaces: made, origin }, skipped }
}

// Replaces the colours of an upload with those of `surfaces` (the same surfaces, recoloured): only the colour buffers are
// written. False, and nothing written, when they are not the same surfaces (a different vertex count, or a surface that has
// coverage now that was left out): the caller uploads them again.
export function recolourBaked(gl: Gl, gpu: BakedGpu, surfaces: readonly (BakedSurface | null)[]): boolean {
  const have = new Map(gpu.surfaces.map((s) => [s.index, s]))
  const next: { target: BakedSurfaceGpu; surface: BakedSurface }[] = []
  for (let index = 0; index < surfaces.length; index++) {
    const surface = surfaces[index]
    if (!surface || surfaceProblem(surface) !== null) continue
    const target = have.get(index)
    if (!target) {
      // a surface that was left out for having no coverage must still have none
      if (hasCoverage(surface)) return false
      continue
    }
    if (surface.alphaFront.length !== target.vertices || surface.closed !== target.closed) return false
    next.push({ target, surface })
  }
  // every uploaded surface must be there to be recoloured
  if (next.length !== gpu.surfaces.length) return false
  gl.bindVertexArray(null)
  for (const { target, surface } of next) {
    gl.bindBuffer(gl.ARRAY_BUFFER, target.colours)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, colourData(surface))
    target.covered = hasCoverage(surface)
  }
  return true
}

// --- the target and the pass --------------------------------------------------

// The image the surfaces are drawn into before the rim is dilated into the underpainting texture: RGBA8, with a depth buffer of
// its own for the surfaces among themselves.
export interface BakedTarget {
  width: number
  height: number
  fbo: WebGLFramebuffer
  texture: WebGLTexture
  depth: WebGLRenderbuffer
  destroy(): void
}

export function createBakedTarget(gl: Gl, res: Resources, width: number, height: number): BakedTarget | null {
  const fbo = res.framebuffer()
  const texture = res.texture(gl.RGBA8, width, height)
  const depth = res.renderbuffer(gl.DEPTH_COMPONENT24, width, height)
  const destroy = () => {
    res.deleteFramebuffer(fbo)
    res.deleteTexture(texture)
    res.deleteRenderbuffer(depth)
  }
  if (!fbo || !texture || !depth) {
    destroy()
    return null
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth)
  gl.drawBuffers([gl.COLOR_ATTACHMENT0])
  const good = complete(gl)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  if (!good) {
    destroy()
    return null
  }
  return { width, height, fbo, texture, depth, destroy }
}

export interface BakedPassInput {
  program: ProgramInfo
  gpu: BakedGpu
  target: BakedTarget
  // clip = matrix * (position - origin): the view's matrix with the origin folded in and scaled to the G-buffer grid
  // (gbufferMatrix), so the image is in the G-buffer's orientation, row 0 the top.
  matrix: Float32Array
  // The view: the eye relative to the origin, the direction, and whether it is a perspective one.
  relEye: readonly [number, number, number]
  viewDir: readonly [number, number, number]
  perspective: boolean
  // dot(origin - eye, viewDir): the view depth of the origin.
  depthBase: number
  // The opaque meshes' view depth for this view at the target's size (shaders/depth.ts), and the bias; null: no test.
  sceneDepth: WebGLTexture | null
  bias: number
  // A texture for the depth sampler to hold when there is no scene depth (any 2D texture other than the target's own).
  standIn: WebGLTexture | null
}

// Clears the target and draws every surface with coverage into it. Returns the number of surfaces drawn.
export function drawBakedSurfaces(gl: Gl, input: BakedPassInput): number {
  const { program, gpu, target } = input
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
  gl.viewport(0, 0, target.width, target.height)
  gl.disable(gl.BLEND)
  gl.disable(gl.CULL_FACE)
  gl.enable(gl.DEPTH_TEST)
  gl.depthFunc(gl.LESS)
  gl.depthMask(true)
  gl.clearBufferfv(gl.COLOR, 0, new Float32Array(4))
  gl.clearDepth(1)
  gl.clear(gl.DEPTH_BUFFER_BIT)
  gl.useProgram(program.program)
  gl.uniformMatrix4fv(program.uniform('u_viewProj'), false, input.matrix)
  gl.uniform3f(program.uniform('u_viewDir'), input.viewDir[0], input.viewDir[1], input.viewDir[2])
  gl.uniform1f(program.uniform('u_depthBase'), input.depthBase)
  gl.uniform3f(program.uniform('u_relEye'), input.relEye[0], input.relEye[1], input.relEye[2])
  gl.uniform1i(program.uniform('u_perspective'), input.perspective ? 1 : 0)
  gl.uniform1i(program.uniform('u_sceneTest'), input.sceneDepth ? 1 : 0)
  gl.uniform1f(program.uniform('u_depthBias'), input.bias)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, input.sceneDepth ?? input.standIn)
  gl.uniform1i(program.uniform('u_sceneDepth'), 0)
  let drawn = 0
  for (const surface of gpu.surfaces) {
    if (!surface.covered) continue
    gl.uniform1i(program.uniform('u_closed'), surface.closed ? 1 : 0)
    gl.bindVertexArray(surface.vao)
    gl.drawElements(gl.TRIANGLES, surface.count, gl.UNSIGNED_INT, 0)
    drawn++
  }
  gl.bindVertexArray(null)
  gl.disable(gl.DEPTH_TEST)
  return drawn
}

// The rim pass: the target's image into the framebuffer bound for drawing (the underpainting texture's), every texel written.
export function drawBakedDilate(gl: Gl, program: ProgramInfo, raw: BakedTarget, into: WebGLFramebuffer): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, into)
  gl.viewport(0, 0, raw.width, raw.height)
  gl.disable(gl.BLEND)
  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.CULL_FACE)
  gl.useProgram(program.program)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, raw.texture)
  gl.uniform1i(program.uniform('u_raw'), 0)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
}

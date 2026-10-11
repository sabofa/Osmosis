// The frame loop (plan E4; spec SP4 "Frame loop"). One frame, in order:
//
// 1. Into the multisampled target (targets.ts), cleared to the background.
// 2. Opaque meshes, pushed back by polygon offset, so a curve or point
//    lying on a surface wins the depth test with no bias of its own. (A
//    fixed NDC bias on lines, S2's, is below what a depth buffer resolves
//    once the view is face-on.)
// 3. The hidden-part pass: lines and arrows marked hidden: 'dashed', drawn
//    only where they are behind something (depthFunc GREATER), without
//    writing depth, faint and dashed. It runs before the frame or any mark
//    has written depth, so it tests against the opaque surfaces only, and
//    against the same polygon offset: a curve on a surface is not hidden by
//    it, and a curve behind an axis of the axes frame gets no dashed stub.
// 4. The frame.
// 5. Lines, points and arrows.
// 6. Translucent meshes:
//    - with EXT_color_buffer_float, by weighted blended OIT: the MSAA colour
//      and depth are resolved by blitFramebuffer, the meshes accumulate into
//      the OIT target (depth-tested against the resolved depth, never
//      writing it), and one full-screen draw composites them over the
//      resolved colour into the canvas;
//    - without it, S2's sorted per-mark blending into the MSAA target.
//    Either way the multisampled buffer is resolved into the RGBA8 resolve
//    texture first: a multisample resolve must blit between identical
//    formats, and the canvas (alpha: false) is RGB8. Without OIT the resolved
//    colour is then blitted, single-sampled, to the canvas.
//
// 7. The overlay (the interaction layer: probe and pin markers, drop
//    lines), last, into the canvas, over everything: no depth test, never
//    clipped, never in the hidden pass.
//
// When the targets cannot be made (an incomplete framebuffer), the same
// passes draw straight into the canvas.

import type { Rgb } from '../theme'
import type { ProgramInfo } from './program'
import { COMPOSITE_FRAGMENT, COMPOSITE_VERTEX } from './shaders/oit'
import type { Targets } from './targets'

export const COMPOSITE_PROGRAM = { name: 'composite', vertex: COMPOSITE_VERTEX, fragment: COMPOSITE_FRAGMENT }

// glPolygonOffset for opaque meshes: slope-scaled, plus a constant in depth
// units large enough to cover a default-resolution surface's chord error seen
// face-on (the flat triangles bulge off the true surface a curve lies on).
export const MESH_POLYGON_OFFSET = { factor: 1, units: 256 } as const

export interface FramePasses {
  frame(): void
  opaque(): void
  hidden(): void
  marks(): void
  // Translucent meshes: accumulating for OIT (`oit`), or sorted and blended.
  translucent(oit: boolean): void
  hasTranslucent: boolean
  overlay(): void
}

export interface FrameLoopInput {
  targets: Targets | null
  composite: ProgramInfo | null
  background: Rgb
  // Backing-store pixels.
  width: number
  height: number
}

// One full-screen triangle through the composite program.
function composite(gl: WebGL2RenderingContext, program: ProgramInfo, targets: Targets, oit: NonNullable<Targets['oit']>): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, targets.width, targets.height)
  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.BLEND)
  gl.useProgram(program.program)
  const textures: [string, WebGLTexture][] = [
    ['u_opaque', targets.resolve.color],
    ['u_accum', oit.accum],
    ['u_weight', oit.weight],
  ]
  textures.forEach(([name, texture], unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(program.uniform(name), unit)
  })
  gl.bindVertexArray(null)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  for (let unit = textures.length - 1; unit >= 0; unit--) {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }
  gl.enable(gl.DEPTH_TEST)
}

// Colour (and depth, when asked) from one framebuffer to another (null: the canvas).
function blit(gl: WebGL2RenderingContext, targets: Targets, from: WebGLFramebuffer, into: WebGLFramebuffer | null, depth: boolean): void {
  const { width, height } = targets
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from)
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, into)
  gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT | (depth ? gl.DEPTH_BUFFER_BIT : 0), gl.NEAREST)
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
}

export function runFrameLoop(gl: WebGL2RenderingContext, input: FrameLoopInput, passes: FramePasses): void {
  const { targets, background } = input
  gl.bindFramebuffer(gl.FRAMEBUFFER, targets ? targets.msaa.fbo : null)
  gl.viewport(0, 0, input.width, input.height)
  gl.clearColor(background[0], background[1], background[2], 1)
  gl.clearDepth(1)
  gl.depthMask(true)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
  gl.enable(gl.DEPTH_TEST)
  gl.depthFunc(gl.LEQUAL)
  gl.disable(gl.CULL_FACE)
  gl.disable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  gl.enable(gl.POLYGON_OFFSET_FILL)
  gl.polygonOffset(MESH_POLYGON_OFFSET.factor, MESH_POLYGON_OFFSET.units)
  passes.opaque()
  gl.disable(gl.POLYGON_OFFSET_FILL)

  gl.depthFunc(gl.GREATER)
  gl.depthMask(false)
  gl.enable(gl.BLEND)
  passes.hidden()
  gl.disable(gl.BLEND)
  gl.depthMask(true)
  gl.depthFunc(gl.LEQUAL)

  passes.frame()
  passes.marks()

  const oit = targets?.oit ?? null
  if (passes.hasTranslucent && targets && oit && input.composite) {
    blit(gl, targets, targets.msaa.fbo, targets.resolve.fbo, true)
    gl.bindFramebuffer(gl.FRAMEBUFFER, oit.fbo)
    gl.viewport(0, 0, targets.width, targets.height)
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 1])
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0])
    gl.depthMask(false)
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA)
    passes.translucent(true)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.disable(gl.BLEND)
    gl.depthMask(true)
    composite(gl, input.composite, targets, oit)
  } else {
    if (passes.hasTranslucent) passes.translucent(false)
    if (targets) {
      blit(gl, targets, targets.msaa.fbo, targets.resolve.fbo, false)
      blit(gl, targets, targets.resolve.fbo, null, false)
    }
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, input.width, input.height)
  gl.disable(gl.DEPTH_TEST)
  passes.overlay()
  gl.enable(gl.DEPTH_TEST)
}

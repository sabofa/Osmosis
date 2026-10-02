// The frame loop's render targets (plan E4), sized to the canvas's backing
// store:
// - msaa: a multisampled framebuffer (4 samples, or MAX_SAMPLES if lower)
//   with RGBA8 colour and DEPTH24 depth renderbuffers. Everything opaque
//   draws here.
// - resolve: single-sample RGBA8 colour and DEPTH24 depth textures, which
//   the MSAA buffer is blitted into before order-independent transparency
//   (so the OIT pass can depth-test against it and the composite read it).
// - oit (only with EXT_color_buffer_float, and only once a translucent mesh
//   needs it: attachOit): an RGBA16F accumulation texture and an R16F weight
//   texture in one framebuffer, whose depth attachment is the resolved depth
//   texture. If it cannot be made, only its own resources are deleted: the
//   MSAA and resolve targets stay, and translucent meshes draw sorted.
//
// WebGL2 has one blend state for every draw buffer (per-buffer blending
// needs OES_draw_buffers_indexed), so the accumulation uses the
// single-state layout of weighted blended OIT: accum.rgb sums
// premultiplied colour times weight (blend ONE, ONE), accum.a multiplies
// down the revealage (blend ZERO, ONE_MINUS_SRC_ALPHA, cleared to 1), and
// the R16F target sums alpha times weight (ONE, ONE).
//
// Every resource is recreated on resize and after a context restore, and
// deleted by destroy().

export const MSAA_SAMPLES = 4

export interface OitTarget {
  fbo: WebGLFramebuffer
  accum: WebGLTexture
  weight: WebGLTexture
}

export interface Targets {
  width: number
  height: number
  samples: number
  msaa: { fbo: WebGLFramebuffer; color: WebGLRenderbuffer; depth: WebGLRenderbuffer }
  resolve: { fbo: WebGLFramebuffer; color: WebGLTexture; depth: WebGLTexture }
  oit: OitTarget | null
  // Deletes every target, the OIT one included.
  destroy(gl: WebGL2RenderingContext): void
}

export function msaaSamples(gl: WebGL2RenderingContext): number {
  const max = Number(gl.getParameter(gl.MAX_SAMPLES))
  return Number.isFinite(max) && max >= 1 ? Math.min(MSAA_SAMPLES, max) : MSAA_SAMPLES
}

// The resources one group of targets makes, deleted together.
class Owned {
  framebuffers: WebGLFramebuffer[] = []
  renderbuffers: WebGLRenderbuffer[] = []
  textures: WebGLTexture[] = []

  destroy(gl: WebGL2RenderingContext): void {
    for (const f of this.framebuffers) gl.deleteFramebuffer(f)
    for (const r of this.renderbuffers) gl.deleteRenderbuffer(r)
    for (const t of this.textures) gl.deleteTexture(t)
    this.framebuffers = []
    this.renderbuffers = []
    this.textures = []
  }

  framebuffer(gl: WebGL2RenderingContext): WebGLFramebuffer | null {
    const f = gl.createFramebuffer()
    if (f) this.framebuffers.push(f)
    return f
  }

  renderbuffer(gl: WebGL2RenderingContext, samples: number, format: number, width: number, height: number): WebGLRenderbuffer | null {
    const r = gl.createRenderbuffer()
    if (!r) return null
    this.renderbuffers.push(r)
    gl.bindRenderbuffer(gl.RENDERBUFFER, r)
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, format, width, height)
    return r
  }

  texture(gl: WebGL2RenderingContext, format: number, width: number, height: number): WebGLTexture | null {
    const t = gl.createTexture()
    if (!t) return null
    this.textures.push(t)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }
}

function unbind(gl: WebGL2RenderingContext): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.bindRenderbuffer(gl.RENDERBUFFER, null)
  gl.bindTexture(gl.TEXTURE_2D, null)
}

function complete(gl: WebGL2RenderingContext): boolean {
  return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
}

// The MSAA and resolve targets, or null (with everything it made deleted)
// when a framebuffer is incomplete; the frame loop then draws straight to
// the canvas, as S2 did. No OIT target yet: attachOit adds it on demand.
export function createTargets(gl: WebGL2RenderingContext, width: number, height: number): Targets | null {
  const owned = new Owned()
  const fail = () => {
    unbind(gl)
    owned.destroy(gl)
    return null
  }
  const samples = msaaSamples(gl)

  const msaaFbo = owned.framebuffer(gl)
  const msaaColor = owned.renderbuffer(gl, samples, gl.RGBA8, width, height)
  const msaaDepth = owned.renderbuffer(gl, samples, gl.DEPTH_COMPONENT24, width, height)
  if (!msaaFbo || !msaaColor || !msaaDepth) return fail()
  gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFbo)
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msaaColor)
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msaaDepth)
  if (!complete(gl)) return fail()

  const resolveFbo = owned.framebuffer(gl)
  const resolveColor = owned.texture(gl, gl.RGBA8, width, height)
  const resolveDepth = owned.texture(gl, gl.DEPTH_COMPONENT24, width, height)
  if (!resolveFbo || !resolveColor || !resolveDepth) return fail()
  gl.bindFramebuffer(gl.FRAMEBUFFER, resolveFbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resolveColor, 0)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, resolveDepth, 0)
  if (!complete(gl)) return fail()
  unbind(gl)

  const targets: Targets = {
    width,
    height,
    samples,
    msaa: { fbo: msaaFbo, color: msaaColor, depth: msaaDepth },
    resolve: { fbo: resolveFbo, color: resolveColor, depth: resolveDepth },
    oit: null,
    destroy(g) {
      const oit = targets.oit
      if (oit) {
        g.deleteFramebuffer(oit.fbo)
        g.deleteTexture(oit.accum)
        g.deleteTexture(oit.weight)
        targets.oit = null
      }
      owned.destroy(g)
    },
  }
  return targets
}

// Adds the OIT target (EXT_color_buffer_float must be enabled on this
// context). Returns false, leaving `targets.oit` null and deleting only what
// it made, when the framebuffer is incomplete.
export function attachOit(gl: WebGL2RenderingContext, targets: Targets): boolean {
  if (targets.oit) return true
  const owned = new Owned()
  const { width, height } = targets
  const fbo = owned.framebuffer(gl)
  const accum = owned.texture(gl, gl.RGBA16F, width, height)
  const weight = owned.texture(gl, gl.R16F, width, height)
  let ok = fbo !== null && accum !== null && weight !== null
  if (ok) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accum, 0)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, weight, 0)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, targets.resolve.depth, 0)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
    ok = complete(gl)
  }
  unbind(gl)
  if (!ok) {
    owned.destroy(gl)
    return false
  }
  // From here targets.destroy() owns them.
  targets.oit = { fbo: fbo!, accum: accum!, weight: weight! }
  return true
}

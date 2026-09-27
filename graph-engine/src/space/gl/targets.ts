// The frame loop's render targets (plan E4), sized to the canvas's backing
// store:
// - msaa: a multisampled framebuffer (4 samples, or MAX_SAMPLES if lower)
//   with RGBA8 colour and DEPTH24 depth renderbuffers. Everything opaque
//   draws here.
// - resolve: single-sample RGBA8 colour and DEPTH24 depth textures, which
//   the MSAA buffer is blitted into before order-independent transparency
//   (so the OIT pass can depth-test against it and the composite read it).
// - oit (only with EXT_color_buffer_float): an RGBA16F accumulation texture
//   and an R16F weight texture in one framebuffer, whose depth attachment is
//   the resolved depth texture.
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

export interface Targets {
  width: number
  height: number
  samples: number
  msaa: { fbo: WebGLFramebuffer; color: WebGLRenderbuffer; depth: WebGLRenderbuffer }
  resolve: { fbo: WebGLFramebuffer; color: WebGLTexture; depth: WebGLTexture }
  oit: { fbo: WebGLFramebuffer; accum: WebGLTexture; weight: WebGLTexture } | null
  destroy(gl: WebGL2RenderingContext): void
}

export function msaaSamples(gl: WebGL2RenderingContext): number {
  const max = Number(gl.getParameter(gl.MAX_SAMPLES))
  return Number.isFinite(max) && max >= 1 ? Math.min(MSAA_SAMPLES, max) : MSAA_SAMPLES
}

// Allocates every target, or returns null (with everything it made deleted)
// when a framebuffer is incomplete; the frame loop then draws straight to the
// canvas, as S2 did.
export function createTargets(gl: WebGL2RenderingContext, width: number, height: number, float: boolean): Targets | null {
  const framebuffers: WebGLFramebuffer[] = []
  const renderbuffers: WebGLRenderbuffer[] = []
  const textures: WebGLTexture[] = []
  const destroy = (g: WebGL2RenderingContext) => {
    for (const f of framebuffers) g.deleteFramebuffer(f)
    for (const r of renderbuffers) g.deleteRenderbuffer(r)
    for (const t of textures) g.deleteTexture(t)
    framebuffers.length = 0
    renderbuffers.length = 0
    textures.length = 0
  }
  const framebuffer = () => {
    const f = gl.createFramebuffer()
    if (f) framebuffers.push(f)
    return f
  }
  const renderbuffer = (samples: number, format: number) => {
    const r = gl.createRenderbuffer()
    if (!r) return null
    renderbuffers.push(r)
    gl.bindRenderbuffer(gl.RENDERBUFFER, r)
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, format, width, height)
    return r
  }
  const texture = (format: number) => {
    const t = gl.createTexture()
    if (!t) return null
    textures.push(t)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }
  const complete = () => gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE

  const samples = msaaSamples(gl)
  const fail = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindRenderbuffer(gl.RENDERBUFFER, null)
    gl.bindTexture(gl.TEXTURE_2D, null)
    destroy(gl)
    return null
  }

  // The multisampled target.
  const msaaFbo = framebuffer()
  const msaaColor = renderbuffer(samples, gl.RGBA8)
  const msaaDepth = renderbuffer(samples, gl.DEPTH_COMPONENT24)
  if (!msaaFbo || !msaaColor || !msaaDepth) return fail()
  gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFbo)
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msaaColor)
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msaaDepth)
  if (!complete()) return fail()

  // The resolve target.
  const resolveFbo = framebuffer()
  const resolveColor = texture(gl.RGBA8)
  const resolveDepth = texture(gl.DEPTH_COMPONENT24)
  if (!resolveFbo || !resolveColor || !resolveDepth) return fail()
  gl.bindFramebuffer(gl.FRAMEBUFFER, resolveFbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resolveColor, 0)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, resolveDepth, 0)
  if (!complete()) return fail()

  // The OIT target, when float colour buffers can be rendered to.
  let oit: Targets['oit'] = null
  if (float) {
    const fbo = framebuffer()
    const accum = texture(gl.RGBA16F)
    const weight = texture(gl.R16F)
    if (!fbo || !accum || !weight) return fail()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accum, 0)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, weight, 0)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, resolveDepth, 0)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
    if (!complete()) return fail()
    oit = { fbo, accum, weight }
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.bindRenderbuffer(gl.RENDERBUFFER, null)
  gl.bindTexture(gl.TEXTURE_2D, null)
  return {
    width,
    height,
    samples,
    msaa: { fbo: msaaFbo, color: msaaColor, depth: msaaDepth },
    resolve: { fbo: resolveFbo, color: resolveColor, depth: resolveDepth },
    oit,
    destroy,
  }
}

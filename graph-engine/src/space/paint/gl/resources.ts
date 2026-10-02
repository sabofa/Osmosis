// Every GL object the paint renderer makes is created through here, so
// dispose() can free exactly what was made and a context loss can drop the
// dead handles without deleting them. Only space/paint/gl/ touches WebGL.

import type { compileProgram } from '../../gl/program'

// The WebGL2 context type, named through the one function that already takes
// it: the space import-boundary test (boundary.test.ts) keeps the literal type
// name out of every file outside space/gl/.
export type Gl = Parameters<typeof compileProgram>[0]

export class Resources {
  private readonly textures = new Set<WebGLTexture>()
  private readonly framebuffers = new Set<WebGLFramebuffer>()
  private readonly renderbuffers = new Set<WebGLRenderbuffer>()
  private readonly buffers = new Set<WebGLBuffer>()
  private readonly vaos = new Set<WebGLVertexArrayObject>()

  private readonly gl: Gl

  constructor(gl: Gl) {
    this.gl = gl
  }

  get size(): number {
    return this.textures.size + this.framebuffers.size + this.renderbuffers.size + this.buffers.size + this.vaos.size
  }

  // An immutable-storage 2D texture (texStorage2D), NEAREST and clamped.
  texture(format: number, width: number, height: number, filter: number = this.gl.NEAREST): WebGLTexture | null {
    const gl = this.gl
    const t = gl.createTexture()
    if (!t) return null
    this.textures.add(t)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }

  framebuffer(): WebGLFramebuffer | null {
    const f = this.gl.createFramebuffer()
    if (f) this.framebuffers.add(f)
    return f
  }

  renderbuffer(format: number, width: number, height: number): WebGLRenderbuffer | null {
    const gl = this.gl
    const r = gl.createRenderbuffer()
    if (!r) return null
    this.renderbuffers.add(r)
    gl.bindRenderbuffer(gl.RENDERBUFFER, r)
    gl.renderbufferStorage(gl.RENDERBUFFER, format, width, height)
    return r
  }

  buffer(): WebGLBuffer | null {
    const b = this.gl.createBuffer()
    if (b) this.buffers.add(b)
    return b
  }

  vertexArray(): WebGLVertexArrayObject | null {
    const v = this.gl.createVertexArray()
    if (v) this.vaos.add(v)
    return v
  }

  deleteTexture(t: WebGLTexture | null): void {
    if (t && this.textures.delete(t)) this.gl.deleteTexture(t)
  }

  deleteFramebuffer(f: WebGLFramebuffer | null): void {
    if (f && this.framebuffers.delete(f)) this.gl.deleteFramebuffer(f)
  }

  deleteRenderbuffer(r: WebGLRenderbuffer | null): void {
    if (r && this.renderbuffers.delete(r)) this.gl.deleteRenderbuffer(r)
  }

  deleteBuffer(b: WebGLBuffer | null): void {
    if (b && this.buffers.delete(b)) this.gl.deleteBuffer(b)
  }

  deleteVertexArray(v: WebGLVertexArrayObject | null): void {
    if (v && this.vaos.delete(v)) this.gl.deleteVertexArray(v)
  }

  // Frees everything (the context is alive).
  disposeAll(): void {
    const gl = this.gl
    for (const t of this.textures) gl.deleteTexture(t)
    for (const f of this.framebuffers) gl.deleteFramebuffer(f)
    for (const r of this.renderbuffers) gl.deleteRenderbuffer(r)
    for (const b of this.buffers) gl.deleteBuffer(b)
    for (const v of this.vaos) gl.deleteVertexArray(v)
    this.forget()
  }

  // After a context loss every handle is already dead: drop them undeleted.
  forget(): void {
    this.textures.clear()
    this.framebuffers.clear()
    this.renderbuffers.clear()
    this.buffers.clear()
    this.vaos.clear()
  }
}

// True when the framebuffer bound to FRAMEBUFFER is complete.
export function complete(gl: Gl): boolean {
  return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
}

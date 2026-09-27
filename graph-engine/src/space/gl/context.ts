// The WebGL2 context (plan G9, spec SP4). Only space/gl/ touches a context.

export const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  antialias: true,
  alpha: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
}

export const NO_WEBGL2_MESSAGE = 'Space needs WebGL2, which this browser or device does not provide, so this view cannot be drawn.'

export interface GlCapabilities {
  // Queried now and recorded for S3's order-independent transparency; S2
  // draws translucent meshes with the sorted fallback either way.
  colorBufferFloat: boolean
}

export type ContextResult = { gl: WebGL2RenderingContext; capabilities: GlCapabilities } | { error: string }

export function createContext(canvas: HTMLCanvasElement): ContextResult {
  let gl: WebGL2RenderingContext | null = null
  try {
    gl = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES) as WebGL2RenderingContext | null
  } catch {
    gl = null
  }
  if (!gl) return { error: NO_WEBGL2_MESSAGE }
  return { gl, capabilities: queryCapabilities(gl) }
}

export function queryCapabilities(gl: WebGL2RenderingContext): GlCapabilities {
  return { colorBufferFloat: gl.getExtension('EXT_color_buffer_float') !== null }
}

// Loss and restoration. `webglcontextlost` must be default-prevented, or the
// browser never restores the context. Returns the unsubscribe.
export function watchContext(canvas: HTMLCanvasElement, onLost: () => void, onRestored: () => void): () => void {
  const lost = (event: Event) => {
    event.preventDefault()
    onLost()
  }
  const restored = () => onRestored()
  canvas.addEventListener('webglcontextlost', lost)
  canvas.addEventListener('webglcontextrestored', restored)
  return () => {
    canvas.removeEventListener('webglcontextlost', lost)
    canvas.removeEventListener('webglcontextrestored', restored)
  }
}

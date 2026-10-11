// The WebGL2 context (plan G9, spec SP4). Only space/gl/ touches a context.

// The canvas itself is not multisampled: the frame loop draws into its own
// MSAA target and blits (frameLoop.ts), and only falls back to drawing on
// the canvas directly when that target cannot be made.
export const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  antialias: false,
  alpha: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
}

// The plain-text reason: the GlBackendOptions.onError / report() pathway
// (a host callback and console.error both take a string, never a
// structured message) and NO_WEBGL2_STATE below share this one wording.
export const NO_WEBGL2_MESSAGE = 'Space needs WebGL2, which this browser or device does not provide, so this view cannot be drawn.'

// S6 plan V9: a state message is a one-line reason and, where useful, a
// next step, as its own, quieter line (ui/overlay.ts StateMessage; a plain
// string there is the reason alone). No WebGL2 and a lost context are
// drawing states the view itself can name (SpaceRenderer.ts shows these
// through Overlay.showMessage; a shader compile failure's own message comes
// from the GL driver, and an empty scene's from SpaceRenderer.ts).
export const NO_WEBGL2_STATE = { reason: NO_WEBGL2_MESSAGE, next: 'Try a different browser, or turn on hardware acceleration.' }

// A context loss is always temporary (the browser drops and later restores
// it); the message clears itself when handleRestored fires, so it needs no
// next step of its own.
export const CONTEXT_LOST_MESSAGE = 'restoring…'

export interface GlCapabilities {
  // Float colour targets: order-independent transparency (frameLoop.ts);
  // without it, translucent meshes draw sorted.
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

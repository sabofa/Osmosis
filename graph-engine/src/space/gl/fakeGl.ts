// A recording fake WebGL2RenderingContext, for testing the GL layer's
// lifecycle and state without a GPU (spec SP4, SP10). It is a test helper:
// nothing outside tests imports it.
//
// - Handles are plain objects { kind, id }.
// - create*/delete* are counted per kind, and the live set is tracked, so a
//   test can assert created - deleted = 0 after dispose().
// - bufferData keeps a copy of what was uploaded, and vertexAttribPointer
//   records which buffer feeds which attribute location of the bound VAO.
// - useProgram and every draw call are logged in order, with the program in
//   use, so a test can assert draw order.
// - lose()/restore() simulate context loss: while lost every call is recorded
//   as an error, create* return null, and nothing draws. A loss frees every
//   live resource, as a real loss does.
//
// Any member not implemented here is recorded generically and returns
// undefined; the backend's calls are type-checked against the real
// interface, so the fake cannot hide a misspelt method.

export type FakeKind = 'buffer' | 'vertexArray' | 'program' | 'shader' | 'texture' | 'framebuffer' | 'renderbuffer'
const KINDS: readonly FakeKind[] = ['buffer', 'vertexArray', 'program', 'shader', 'texture', 'framebuffer', 'renderbuffer']

export interface FakeHandle {
  kind: FakeKind
  id: number
}

export interface FakeDraw {
  fn: string
  program: FakeHandle | null
  vao: FakeHandle | null
  mode: number
  count: number
  instances: number
}

export interface FakeUpload {
  buffer: FakeHandle | null
  target: number
  data: Float32Array | Uint32Array | Uint16Array | null
}

// The real WebGL values for every constant the GL layer reads.
export const GL_CONSTANTS = {
  DEPTH_BUFFER_BIT: 0x0100,
  COLOR_BUFFER_BIT: 0x4000,
  POINTS: 0x0000,
  LINES: 0x0001,
  TRIANGLES: 0x0004,
  TRIANGLE_STRIP: 0x0005,
  ZERO: 0,
  ONE: 1,
  SRC_ALPHA: 0x0302,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  LESS: 0x0201,
  LEQUAL: 0x0203,
  CULL_FACE: 0x0b44,
  DEPTH_TEST: 0x0b71,
  BLEND: 0x0be2,
  UNSIGNED_SHORT: 0x1403,
  UNSIGNED_INT: 0x1405,
  FLOAT: 0x1406,
  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  STATIC_DRAW: 0x88e4,
  DYNAMIC_DRAW: 0x88e8,
  FRAGMENT_SHADER: 0x8b30,
  VERTEX_SHADER: 0x8b31,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
} as const

export interface FakeGlOptions {
  // Make every shader compile fail (or only those whose source matches).
  failCompile?: boolean | ((source: string) => boolean)
  colorBufferFloat?: boolean
}

export interface FakeGl {
  gl: WebGL2RenderingContext
  calls: { fn: string; args: unknown[] }[]
  draws: FakeDraw[]
  uploads: FakeUpload[]
  // Calls made while the context was lost.
  errors: string[]
  extensionsQueried: string[]
  created: Record<FakeKind, number>
  deleted: Record<FakeKind, number>
  live: Record<FakeKind, Set<number>>
  readonly lost: boolean
  // The vertex and fragment source of a program handle.
  programSource(program: FakeHandle | null): { vertex: string; fragment: string }
  // The last data uploaded into a buffer handle.
  bufferContents(buffer: FakeHandle | null | undefined): FakeUpload['data'] | undefined
  // Which buffer feeds `location` in a VAO.
  attribBuffer(vao: FakeHandle | null, location: number): FakeHandle | undefined
  lose(): void
  restore(): void
}

const COMPILE_LOG = "ERROR: 0:7: 'lighting' : undeclared identifier (fake)"

export function createFakeGl(options: FakeGlOptions = {}): FakeGl {
  let nextId = 1
  let lost = false
  const calls: FakeGl['calls'] = []
  const draws: FakeDraw[] = []
  const uploads: FakeUpload[] = []
  const errors: string[] = []
  const extensionsQueried: string[] = []
  const created = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<FakeKind, number>
  const deleted = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<FakeKind, number>
  const live = Object.fromEntries(KINDS.map((k) => [k, new Set<number>()])) as Record<FakeKind, Set<number>>
  const sources = new Map<number, { type: number; source: string }>()
  const attached = new Map<number, number[]>()
  const contents = new Map<number, FakeUpload['data']>()
  const attribs = new Map<number, Map<number, FakeHandle>>()
  let program: FakeHandle | null = null
  let vao: FakeHandle | null = null
  let arrayBuffer: FakeHandle | null = null
  // Element buffers bind to the VAO; tracked for completeness of uploads.
  let elementBuffer: FakeHandle | null = null

  const make = (kind: FakeKind): FakeHandle | null => {
    if (lost) return null
    const handle = { kind, id: nextId++ }
    created[kind]++
    live[kind].add(handle.id)
    return handle
  }
  const drop = (kind: FakeKind, handle: unknown) => {
    if (!handle || lost) return
    const h = handle as FakeHandle
    if (!live[kind].has(h.id)) return
    live[kind].delete(h.id)
    deleted[kind]++
  }
  const fails = (source: string) =>
    typeof options.failCompile === 'function' ? options.failCompile(source) : options.failCompile === true

  const impl: Record<string, (...args: never[]) => unknown> = {
    isContextLost: () => lost,
    getExtension: (name: string) => {
      extensionsQueried.push(name)
      if (name === 'EXT_color_buffer_float') return options.colorBufferFloat === false ? null : {}
      return null
    },
    createBuffer: () => make('buffer'),
    createVertexArray: () => make('vertexArray'),
    createProgram: () => make('program'),
    createShader: (type: number) => {
      const h = make('shader')
      if (h) sources.set(h.id, { type, source: '' })
      return h
    },
    createTexture: () => make('texture'),
    createFramebuffer: () => make('framebuffer'),
    createRenderbuffer: () => make('renderbuffer'),
    deleteBuffer: (h: FakeHandle) => drop('buffer', h),
    deleteVertexArray: (h: FakeHandle) => drop('vertexArray', h),
    deleteProgram: (h: FakeHandle) => drop('program', h),
    deleteShader: (h: FakeHandle) => drop('shader', h),
    deleteTexture: (h: FakeHandle) => drop('texture', h),
    deleteFramebuffer: (h: FakeHandle) => drop('framebuffer', h),
    deleteRenderbuffer: (h: FakeHandle) => drop('renderbuffer', h),
    shaderSource: (h: FakeHandle, source: string) => {
      const s = sources.get(h.id)
      if (s) s.source = source
    },
    getShaderParameter: (h: FakeHandle) => !fails(sources.get(h.id)?.source ?? ''),
    getShaderInfoLog: (h: FakeHandle) => (fails(sources.get(h.id)?.source ?? '') ? COMPILE_LOG : ''),
    attachShader: (p: FakeHandle, s: FakeHandle) => {
      const list = attached.get(p.id) ?? []
      list.push(s.id)
      attached.set(p.id, list)
    },
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    getUniformLocation: (_p: FakeHandle, name: string) => ({ uniform: name }),
    useProgram: (p: FakeHandle | null) => {
      program = p
    },
    bindVertexArray: (v: FakeHandle | null) => {
      vao = v
    },
    bindBuffer: (target: number, b: FakeHandle | null) => {
      if (target === GL_CONSTANTS.ARRAY_BUFFER) arrayBuffer = b
      else elementBuffer = b
    },
    bufferData: (target: number, data: unknown) => {
      const buffer = target === GL_CONSTANTS.ARRAY_BUFFER ? arrayBuffer : elementBuffer
      const copy =
        data instanceof Float32Array
          ? new Float32Array(data)
          : data instanceof Uint32Array
            ? new Uint32Array(data)
            : data instanceof Uint16Array
              ? new Uint16Array(data)
              : null
      uploads.push({ buffer, target, data: copy })
      if (buffer) contents.set(buffer.id, copy)
    },
    vertexAttribPointer: (location: number) => {
      if (!vao || !arrayBuffer) return
      const map = attribs.get(vao.id) ?? new Map<number, FakeHandle>()
      map.set(location, arrayBuffer)
      attribs.set(vao.id, map)
    },
    drawArrays: (mode: number, _first: number, count: number) => {
      draws.push({ fn: 'drawArrays', program, vao, mode, count, instances: 1 })
    },
    drawElements: (mode: number, count: number) => {
      draws.push({ fn: 'drawElements', program, vao, mode, count, instances: 1 })
    },
    drawArraysInstanced: (mode: number, _first: number, count: number, instances: number) => {
      draws.push({ fn: 'drawArraysInstanced', program, vao, mode, count, instances })
    },
    drawElementsInstanced: (mode: number, count: number, _type: number, _offset: number, instances: number) => {
      draws.push({ fn: 'drawElementsInstanced', program, vao, mode, count, instances })
    },
  }

  const target = {} as Record<string, unknown>
  const gl = new Proxy(target, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop in GL_CONSTANTS) return GL_CONSTANTS[prop as keyof typeof GL_CONSTANTS]
      if (/^[A-Z][A-Z0-9_]*$/.test(prop)) throw new Error(`fake GL: missing constant ${prop}`)
      if (prop === 'canvas') return undefined
      return (...args: unknown[]) => {
        calls.push({ fn: prop, args })
        if (lost && prop !== 'isContextLost') {
          errors.push(prop)
          return prop.startsWith('create') || prop === 'getExtension' ? null : undefined
        }
        const f = impl[prop]
        return f ? (f as (...a: unknown[]) => unknown)(...args) : undefined
      }
    },
  }) as unknown as WebGL2RenderingContext

  return {
    gl,
    calls,
    draws,
    uploads,
    errors,
    extensionsQueried,
    created,
    deleted,
    live,
    get lost() {
      return lost
    },
    programSource(p) {
      const shaders = p ? (attached.get(p.id) ?? []) : []
      let vertex = ''
      let fragment = ''
      for (const id of shaders) {
        const s = sources.get(id)
        if (!s) continue
        if (s.type === GL_CONSTANTS.VERTEX_SHADER) vertex = s.source
        else fragment = s.source
      }
      return { vertex, fragment }
    },
    bufferContents(buffer) {
      return buffer ? contents.get(buffer.id) : undefined
    },
    attribBuffer(v, location) {
      return v ? attribs.get(v.id)?.get(location) : undefined
    },
    lose() {
      lost = true
      for (const k of KINDS) live[k].clear()
      program = null
      vao = null
      arrayBuffer = null
      elementBuffer = null
    },
    restore() {
      lost = false
    },
  }
}

// A canvas that hands out the fake context and can fire the context events.
export interface FakeCanvas {
  canvas: HTMLCanvasElement
  // Simulate a loss (the fake loses its resources, then the event fires).
  lose(): { defaultPrevented: boolean }
  restore(): void
  listenerCount(type: string): number
}

export function fakeCanvas(fake: FakeGl | null, size = { width: 800, height: 600 }): FakeCanvas {
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  const canvas = {
    width: size.width,
    height: size.height,
    clientWidth: size.width,
    clientHeight: size.height,
    getContext: (type: string) => (type === 'webgl2' && fake ? fake.gl : null),
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      const set = listeners.get(type) ?? new Set()
      set.add(fn)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners.get(type)?.delete(fn)
    },
  }
  const fire = (type: string, event: unknown) => {
    for (const fn of [...(listeners.get(type) ?? [])]) fn(event)
  }
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    lose() {
      fake?.lose()
      const event = {
        defaultPrevented: false,
        preventDefault() {
          event.defaultPrevented = true
        },
      }
      fire('webglcontextlost', event)
      return event
    },
    restore() {
      fake?.restore()
      fire('webglcontextrestored', {})
    },
    listenerCount: (type) => listeners.get(type)?.size ?? 0,
  }
}

// Shader programs (plan G9): compile, link, cache per pipeline. A failure
// throws ShaderError carrying the GL info log; the backend catches it at its
// boundary and reports it, so nothing is thrown into React.

export class ShaderError extends Error {
  readonly log: string
  constructor(message: string, log: string) {
    super(`${message}: ${log.trim() || '(no info log)'}`)
    this.name = 'ShaderError'
    this.log = log
  }
}

export interface ProgramInfo {
  name: string
  program: WebGLProgram
  uniform(name: string): WebGLUniformLocation | null
}

function compile(gl: WebGL2RenderingContext, type: number, source: string, label: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new ShaderError(`space: could not create the ${label} shader`, '')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? ''
    gl.deleteShader(shader)
    throw new ShaderError(`space: the ${label} shader failed to compile`, log)
  }
  return shader
}

export function compileProgram(gl: WebGL2RenderingContext, name: string, vertex: string, fragment: string): ProgramInfo {
  const vs = compile(gl, gl.VERTEX_SHADER, vertex, `${name} vertex`)
  let fs: WebGLShader
  try {
    fs = compile(gl, gl.FRAGMENT_SHADER, fragment, `${name} fragment`)
  } catch (error) {
    gl.deleteShader(vs)
    throw error
  }
  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    throw new ShaderError(`space: could not create the ${name} program`, '')
  }
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  // The shaders are owned by the program once linked; flag them for deletion now.
  gl.detachShader(program, vs)
  gl.detachShader(program, fs)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? ''
    gl.deleteProgram(program)
    throw new ShaderError(`space: the ${name} program failed to link`, log)
  }
  const locations = new Map<string, WebGLUniformLocation | null>()
  return {
    name,
    program,
    uniform(uniform: string) {
      if (!locations.has(uniform)) locations.set(uniform, gl.getUniformLocation(program, uniform))
      return locations.get(uniform) ?? null
    },
  }
}

// One program per pipeline, compiled on first use.
export class ProgramCache {
  private readonly programs = new Map<string, ProgramInfo>()

  get(gl: WebGL2RenderingContext, name: string, vertex: string, fragment: string): ProgramInfo {
    const cached = this.programs.get(name)
    if (cached) return cached
    const info = compileProgram(gl, name, vertex, fragment)
    this.programs.set(name, info)
    return info
  }

  deleteAll(gl: WebGL2RenderingContext): void {
    for (const info of this.programs.values()) gl.deleteProgram(info.program)
    this.programs.clear()
  }

  // After a context loss every handle is already dead: drop them undeleted.
  forget(): void {
    this.programs.clear()
  }
}

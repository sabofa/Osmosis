// A test helper: space/gl/fakeGl.ts's recording fake, widened for the paint
// renderer. It adds the few constants the paint code reads that the base fake
// does not know (RGBA32F, R32F, RG32F, R8, REPEAT, MAX_TEXTURE_SIZE), answers
// getParameter(MAX_TEXTURE_SIZE), and records readPixels, filling the
// destination from a provider so a test can hand the renderer a known
// G-buffer. Nothing outside tests imports it.

import type { Gl } from './resources'
import { createFakeGl, fakeCanvas, type FakeCanvas, type FakeGl, type FakeGlOptions } from '../../gl/fakeGl'

export const PAINT_CONSTANTS = {
  RGBA32F: 0x8814,
  R32F: 0x822e,
  RG32F: 0x8230,
  R8: 0x8229,
  REPEAT: 0x2901,
  MAX_TEXTURE_SIZE: 0x0d33,
} as const

export interface ReadRecord {
  attachment: number
  width: number
  height: number
  type: number
}

// Fills `dst` for the n-th attachment (0-based) of a readPixels.
export type ReadProvider = (attachment: number, width: number, height: number, dst: ArrayBufferView) => void

export interface PaintFakeGl {
  // The widened fake: its calls, draws, created/deleted counts and so on.
  fake: FakeGl
  canvas: FakeCanvas
  reads: ReadRecord[]
  setReadback(provider: ReadProvider | null): void
}

// What the fake reports as its device limits (the real ones vary: a phone's MAX_TEXTURE_SIZE can be 4096, 2048 or less).
export interface PaintFakeLimits {
  // MAX_TEXTURE_SIZE (default 4096).
  maxTextureSize?: number
}

export function createPaintFakeGl(options: FakeGlOptions = {}, size = { width: 800, height: 600 }, limits: PaintFakeLimits = {}): PaintFakeGl {
  const base = createFakeGl(options)
  const reads: ReadRecord[] = []
  let provider: ReadProvider | null = null
  let readBuffer = 0x8ce0
  const wrapped = new Proxy(base.gl as unknown as Record<string, unknown>, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') {
        if (prop in PAINT_CONSTANTS) return PAINT_CONSTANTS[prop as keyof typeof PAINT_CONSTANTS]
        if (prop === 'getParameter') {
          return (name: number) => (name === PAINT_CONSTANTS.MAX_TEXTURE_SIZE ? (limits.maxTextureSize ?? 4096) : (target.getParameter as (n: number) => unknown)(name))
        }
        if (prop === 'readBuffer') {
          return (attachment: number) => {
            readBuffer = attachment
            ;(target.readBuffer as (a: number) => void)(attachment)
          }
        }
        if (prop === 'readPixels') {
          return (x: number, y: number, width: number, height: number, format: number, type: number, dst: ArrayBufferView) => {
            base.calls.push({ fn: 'readPixels', args: [x, y, width, height, format, type, dst] })
            const attachment = readBuffer - 0x8ce0
            reads.push({ attachment, width, height, type })
            provider?.(attachment, width, height, dst)
          }
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as unknown as Gl
  // The canvas hands out the widened context; every other member is the base's.
  const shim = Object.create(base, { gl: { value: wrapped } }) as FakeGl
  return {
    fake: base,
    canvas: fakeCanvas(shim, size),
    reads,
    setReadback(p) {
      provider = p
    },
  }
}

// The kinds of draw the paint renderer makes, told apart by the shader's own
// header comment.
export type PaintPass = 'shadow' | 'gbuffer' | 'depth' | 'underpaint' | 'stroke' | 'copy' | 'composite' | 'image' | 'edges' | 'other'

export function passOf(fake: FakeGl, draw: FakeGl['draws'][number]): PaintPass {
  const { vertex, fragment } = fake.programSource(draw.program)
  const text = `${vertex}\n${fragment}`
  const needles: [PaintPass, string][] = [
    ['shadow', '// paint: shadow'],
    ['gbuffer', '// paint: gbuffer'],
    ['depth', '// paint: depth'],
    ['underpaint', '// paint: underpaint'],
    ['stroke', '// paint: stroke'],
    ['copy', '// paint: copy'],
    ['composite', '// paint: composite'],
    ['image', '// paint: image'],
    ['edges', '// paint: edge segments'],
  ]
  for (const [pass, needle] of needles) if (text.includes(needle)) return pass
  return 'other'
}

const DRAW_FNS = new Set(['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'])

export interface PaintEvent {
  kind: PaintPass | 'readPixels'
  draw?: FakeGl['draws'][number]
  // The latest value(s) set for each uniform, by name, when the draw happened
  // (for example u_base is [3]).
  uniforms: Record<string, unknown[]>
}

// The draws and readbacks in the order they happened.
export function timeline(paint: PaintFakeGl): PaintEvent[] {
  const { fake } = paint
  const events: PaintEvent[] = []
  const uniforms: Record<string, unknown[]> = {}
  let draw = 0
  for (const call of fake.calls) {
    if (call.fn.startsWith('uniform')) {
      const loc = call.args[0] as { uniform?: string } | null
      if (loc?.uniform) uniforms[loc.uniform] = call.args.slice(1)
    }
    if (call.fn === 'readPixels') events.push({ kind: 'readPixels', uniforms: { ...uniforms } })
    if (!DRAW_FNS.has(call.fn)) continue
    const d = fake.draws[draw++]
    events.push({ kind: passOf(fake, d), draw: d, uniforms: { ...uniforms } })
  }
  return events
}

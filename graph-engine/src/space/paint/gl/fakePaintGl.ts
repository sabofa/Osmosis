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
  PIXEL_PACK_BUFFER: 0x88eb,
  STREAM_READ: 0x88e1,
  SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
  ALREADY_SIGNALED: 0x911a,
  TIMEOUT_EXPIRED: 0x911b,
  CONDITION_SATISFIED: 0x911c,
  WAIT_FAILED: 0x911d,
} as const

export interface ReadRecord {
  attachment: number
  width: number
  height: number
  type: number
  // Into a pack buffer (readPixels given an offset), not an array.
  pack?: boolean
}

// Fills `dst` for the n-th attachment (0-based) of a readPixels.
export type ReadProvider = (attachment: number, width: number, height: number, dst: ArrayBufferView) => void

// What the fake's fences and pack buffer saw (asyncReadback).
export interface FenceRecord {
  created: number
  deleted: number
  // clientWaitSync calls, and how many of them were not yet signalled
  polls: number
  pending: number
  // getBufferSubData calls on the pack buffer
  subDataReads: number
}

export interface PaintFakeGl {
  // The widened fake: its calls, draws, created/deleted counts and so on.
  fake: FakeGl
  canvas: FakeCanvas
  reads: ReadRecord[]
  fences: FenceRecord
  setReadback(provider: ReadProvider | null): void
}

// What the fake reports as its device limits (the real ones vary: a phone's MAX_TEXTURE_SIZE can be 4096, 2048 or less).
export interface PaintFakeLimits {
  // The fake hands out fences and a pack buffer, as a WebGL2 context does (fenceSync, clientWaitSync, deleteSync,
  // PIXEL_PACK_BUFFER, getBufferSubData), so the renderer reads a G-buffer back without waiting. Left off, fenceSync answers
  // nothing, as the base fake does, and the renderer reads it the plain way.
  asyncReadback?: boolean
  // With asyncReadback: how many times clientWaitSync says the fence has not passed yet, before it says it has (default 0).
  fenceDelayPolls?: number
  // With asyncReadback: clientWaitSync answers WAIT_FAILED (a fence that broke).
  failFence?: boolean
  // With asyncReadback: called at every clientWaitSync, before it answers (a test that has the context go while a read polls).
  onPoll?: () => void
  // MAX_TEXTURE_SIZE (default 4096).
  maxTextureSize?: number
}

export function createPaintFakeGl(options: FakeGlOptions = {}, size = { width: 800, height: 600 }, limits: PaintFakeLimits = {}): PaintFakeGl {
  const base = createFakeGl(options)
  const reads: ReadRecord[] = []
  const fences: FenceRecord = { created: 0, deleted: 0, polls: 0, pending: 0, subDataReads: 0 }
  let provider: ReadProvider | null = null
  let readBuffer = 0x8ce0
  // the pack buffer: bound or not, its size, and what the last read into it holds
  let packBound = false
  let packed: Float32Array | null = null
  const asyncReadback = limits.asyncReadback === true
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
          return (x: number, y: number, width: number, height: number, format: number, type: number, dst: ArrayBufferView | number) => {
            base.calls.push({ fn: 'readPixels', args: [x, y, width, height, format, type, dst] })
            const attachment = readBuffer - 0x8ce0
            if (typeof dst === 'number') {
              // into the bound pack buffer: the GPU copies it there, the bytes are taken from it later
              reads.push({ attachment, width, height, type, pack: true })
              packed = new Float32Array(width * height * 4)
              provider?.(attachment, width, height, packed)
              return
            }
            reads.push({ attachment, width, height, type })
            provider?.(attachment, width, height, dst)
          }
        }
        if (asyncReadback) {
          if (prop === 'bindBuffer') {
            return (bufferTarget: number, buffer: unknown) => {
              if (bufferTarget === PAINT_CONSTANTS.PIXEL_PACK_BUFFER) {
                packBound = buffer !== null
                base.calls.push({ fn: 'bindBuffer', args: [bufferTarget, buffer] })
              } else (target.bindBuffer as (t: number, b: unknown) => void)(bufferTarget, buffer)
            }
          }
          if (prop === 'bufferData') {
            return (bufferTarget: number, ...rest: unknown[]) => {
              if (bufferTarget !== PAINT_CONSTANTS.PIXEL_PACK_BUFFER) (target.bufferData as (t: number, ...r: unknown[]) => void)(bufferTarget, ...rest)
            }
          }
          if (prop === 'fenceSync') {
            return () => {
              fences.created++
              base.calls.push({ fn: 'fenceSync', args: [] })
              return { fence: true, polls: 0 }
            }
          }
          if (prop === 'clientWaitSync') {
            return (sync: { polls: number }) => {
              base.calls.push({ fn: 'clientWaitSync', args: [] })
              fences.polls++
              sync.polls++
              limits.onPoll?.()
              if (limits.failFence) return PAINT_CONSTANTS.WAIT_FAILED
              if (sync.polls > (limits.fenceDelayPolls ?? 0)) return PAINT_CONSTANTS.ALREADY_SIGNALED
              fences.pending++
              return PAINT_CONSTANTS.TIMEOUT_EXPIRED
            }
          }
          if (prop === 'deleteSync') {
            return () => {
              fences.deleted++
              base.calls.push({ fn: 'deleteSync', args: [] })
            }
          }
          if (prop === 'getBufferSubData') {
            return (bufferTarget: number, offset: number, dst: Float32Array) => {
              if (bufferTarget !== PAINT_CONSTANTS.PIXEL_PACK_BUFFER || !packBound || !packed) throw new Error('fake gl: getBufferSubData with no pack buffer filled')
              fences.subDataReads++
              base.calls.push({ fn: 'getBufferSubData', args: [bufferTarget, offset] })
              dst.set(packed.subarray(offset / 4, offset / 4 + dst.length))
            }
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
    fences,
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

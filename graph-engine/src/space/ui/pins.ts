// Pins (plan E10, spec SP6 "Pins"): a pure reducer. A pin keeps a hit's
// marker, drop lines and readout on screen; the renderer draws them (the
// interaction layer and the readout boxes in probe.ts).
//
// - A click (pointer up within 4 px of pointer down, and under 400 ms) on a
//   hit pins it.
// - A click within 8 px of a pin's marker removes that pin instead.
// - Esc clears every pin.
// - After the scene changes, every pin is re-evaluated through the new
//   scene's picks (pick/reevaluate.ts); a pin whose mark is gone is dropped.
// - A pin remembers the source line of the statement it is on; after a spec
//   edit it survives only if that line's text is unchanged ('respec'), so an
//   edit that renumbers statements drops it rather than reattaching it to
//   whatever now sits at its line.
// - Pins are view state, not source: they are reported as events.

import { reevaluate } from '../pick/reevaluate'
import type { Hit } from '../pick/types'
import type { SpaceScene } from '../scene/types'

export const CLICK_MAX_MOVE_PX = 4
export const CLICK_MAX_MS = 400
export const PIN_REMOVE_PX = 8

export interface PointerMark {
  x: number
  y: number
  // ms, any monotonic clock.
  time: number
}

// Whether a press and its release make a click rather than a drag.
export function isClick(down: PointerMark, up: PointerMark): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_MAX_MOVE_PX && up.time - down.time < CLICK_MAX_MS
}

export interface Pin {
  id: number
  hit: Hit
  // The text of its statement's source line when pinned, or null when not known.
  text: string | null
}

export interface PinsState {
  pins: readonly Pin[]
  nextId: number
}

export const NO_PINS: PinsState = { pins: [], nextId: 1 }

export interface PinEvent {
  type: 'pin'
  action: 'add' | 'remove' | 'clear'
  hit: Hit | null
}

export type PinAction =
  // `markers`: where each pin's marker is on screen now, CSS px.
  // `text`: the hit statement's source line, when known.
  | { type: 'click'; x: number; y: number; hit: Hit | null; markers: readonly { id: number; x: number; y: number }[]; text?: string | null }
  | { type: 'clear' }
  | { type: 'reevaluate'; scene: SpaceScene }
  // The spec changed: `text(line)` is the new text of a source line.
  | { type: 'respec'; text: (line: number) => string | null }

export function reducePins(state: PinsState, action: PinAction): { state: PinsState; events: PinEvent[] } {
  switch (action.type) {
    case 'click': {
      let nearest: { id: number; d: number } | null = null
      for (const m of action.markers) {
        const d = Math.hypot(m.x - action.x, m.y - action.y)
        if (d <= PIN_REMOVE_PX && (!nearest || d < nearest.d)) nearest = { id: m.id, d }
      }
      const target = nearest?.id
      const removed = target === undefined ? undefined : state.pins.find((p) => p.id === target)
      if (removed) {
        return { state: { ...state, pins: state.pins.filter((p) => p !== removed) }, events: [{ type: 'pin', action: 'remove', hit: removed.hit }] }
      }
      if (!action.hit) return { state, events: [] }
      const pin: Pin = { id: state.nextId, hit: action.hit, text: action.text ?? null }
      return { state: { pins: [...state.pins, pin], nextId: state.nextId + 1 }, events: [{ type: 'pin', action: 'add', hit: action.hit }] }
    }
    case 'clear':
      if (state.pins.length === 0) return { state, events: [] }
      return { state: { ...state, pins: [] }, events: [{ type: 'pin', action: 'clear', hit: null }] }
    case 'reevaluate': {
      if (state.pins.length === 0) return { state, events: [] }
      const pins: Pin[] = []
      for (const p of state.pins) {
        const hit = reevaluate(p.hit, action.scene)
        if (hit) pins.push({ ...p, hit })
      }
      return { state: { ...state, pins }, events: [] }
    }
    case 'respec': {
      if (state.pins.length === 0) return { state, events: [] }
      const pins = state.pins.filter((p) => p.text !== null && p.text === action.text(p.hit.source.line))
      return pins.length === state.pins.length ? { state, events: [] } : { state: { ...state, pins }, events: [] }
    }
  }
}

// Input: raw pointer, wheel and key samples in, view intents out.
//
// Browsers speak in pointer events; a view speaks in "drag this much", "zoom
// there", "reset". This file is the translation, and it is a state machine over
// samples only: no DOM, no React, and no clock (every sample carries its own
// `t`, and so does every intent). The browser layer feeds it and ViewMotion
// consumes what it emits.
//
// What it recognises:
//   - click or drag: a press released within CLICK_SLOP of where it began is a
//     click; the first move past the slop starts a drag, and that first `drag`
//     carries the whole displacement since the press, so nothing is lost;
//   - double-click: two clicks close in time and place also emit `reset`
//     (shift + clicks, which edit the selection, never count);
//   - pinch: two touches give `pinch` (exact, not smoothed) and never a click;
//     when one lifts, the other carries on as a fresh drag with no jump;
//   - wheel: an exponential zoom at the pointer, steeper for a trackpad pinch
//     (ctrl + wheel);
//   - hover: mouse and pen only, and only with nothing pressed;
//   - keys: zoom, pan, reset, clear the selection, toggle the coordinates.
// Only the primary mouse button acts; touch and pen always do.

import {
  CLICK_SLOP,
  DOUBLE_CLICK_MS,
  DOUBLE_CLICK_SLOP,
  KEY_PAN_FRACTION,
  KEY_ZOOM_STEP,
  PINCH_WHEEL_SENSITIVITY,
  WHEEL_LINE_PX,
  WHEEL_PAGE_PX,
  WHEEL_SENSITIVITY,
} from './feel'
import type { Vec } from './types'

export type PointerKind = 'mouse' | 'pen' | 'touch'

// x, y are relative to the view, in px.
export interface PointerSample {
  id: number
  x: number
  y: number
  t: number
  kind: PointerKind
  button: number
  // Shift was held (at the release, for a click: shift + click adds to the
  // selection). Absent counts as not held.
  shiftKey?: boolean
}

export interface WheelSample {
  x: number
  y: number
  deltaY: number
  deltaMode: 0 | 1 | 2
  ctrlKey: boolean
  t: number
}

export interface KeySample {
  key: string
  t: number
}

export type Intent =
  | { kind: 'dragStart'; t: number }
  | { kind: 'drag'; dx: number; dy: number; t: number }
  | { kind: 'dragEnd'; t: number }
  | { kind: 'zoom'; at: Vec; factor: number; t: number } // smoothed (wheel, keys)
  | { kind: 'pinch'; at: Vec; factor: number; dx: number; dy: number; t: number } // exact (two fingers)
  | { kind: 'pan'; dx: number; dy: number; t: number } // smoothed (keys)
  // `additive`: shift was held at the release, so the click adds to (or takes
  // from) the selection instead of replacing it.
  | { kind: 'click'; at: Vec; pointer: PointerKind; additive: boolean; t: number }
  | { kind: 'hover'; at: Vec | null; pointer: PointerKind } // null: the pointer left
  | { kind: 'reset'; t: number }
  | { kind: 'clearSelection' }
  | { kind: 'toggleCoordinates' }

interface Down {
  x: number
  y: number
  kind: PointerKind
}

// The single pointer being tracked as a click-or-drag.
interface Press {
  id: number
  x0: number
  y0: number
  lastX: number
  lastY: number
  dragging: boolean
  // True when this press continues a pinch: any movement drags (no slop), and
  // lifting it is never a click.
  afterPinch: boolean
}

export class GestureRecognizer {
  private readonly screen: (() => { width: number; height: number }) | undefined
  private readonly down = new Map<number, Down>() // the tracked pointers, at most two
  private readonly ignored = new Set<number>() // pressed, but not ours (secondary button, third finger)
  private press: Press | null = null
  private pinch: { dist: number; mid: Vec } | null = null
  private lastClick: { x: number; y: number; t: number } | null = null

  // `screen` is read on each key press, so a resize is honoured. Without it
  // there is nothing for the zoom and pan keys to act on, and they do nothing.
  constructor(options?: { screen?: () => { width: number; height: number } }) {
    this.screen = options?.screen
  }

  pointerDown(s: PointerSample): Intent[] {
    const out: Intent[] = []
    // A new press for an id ends whatever that id was doing. Its release may
    // never have arrived (a context menu can swallow the mouseup), whether it
    // was a tracked press or an ignored one (a secondary button).
    this.ignored.delete(s.id)
    if (this.down.has(s.id)) out.push(...this.pointerCancel(s))
    if (s.kind === 'mouse' && s.button !== 0) {
      this.ignored.add(s.id)
      return out
    }
    if (this.down.size >= 2) {
      this.ignored.add(s.id)
      return out
    }
    this.down.set(s.id, { x: s.x, y: s.y, kind: s.kind })
    if (this.down.size === 1) {
      this.press = {
        id: s.id,
        x0: s.x,
        y0: s.y,
        lastX: s.x,
        lastY: s.y,
        dragging: false,
        afterPinch: false,
      }
      return out
    }
    // The second finger: the single-pointer gesture ends, the pinch begins.
    if (this.press?.dragging) out.push({ kind: 'dragEnd', t: s.t })
    this.press = null
    this.lastClick = null
    this.pinch = this.measure()
    return out
  }

  pointerMove(s: PointerSample): Intent[] {
    const d = this.down.get(s.id)
    if (!d) {
      if (s.kind === 'touch' || this.down.size > 0 || this.ignored.size > 0) return []
      return [{ kind: 'hover', at: { x: s.x, y: s.y }, pointer: s.kind }]
    }
    d.x = s.x
    d.y = s.y
    if (this.down.size === 2) return this.movePinch(s.t)
    const p = this.press
    if (!p || p.id !== s.id) return []
    if (!p.dragging) {
      const ox = s.x - p.x0
      const oy = s.y - p.y0
      if (p.afterPinch ? ox === 0 && oy === 0 : Math.hypot(ox, oy) < CLICK_SLOP) return []
      p.dragging = true
      p.lastX = s.x
      p.lastY = s.y
      this.lastClick = null
      return [
        { kind: 'dragStart', t: s.t },
        { kind: 'drag', dx: ox, dy: oy, t: s.t },
      ]
    }
    const dx = s.x - p.lastX
    const dy = s.y - p.lastY
    p.lastX = s.x
    p.lastY = s.y
    if (dx === 0 && dy === 0) return []
    return [{ kind: 'drag', dx, dy, t: s.t }]
  }

  pointerUp(s: PointerSample): Intent[] {
    return this.release(s, true)
  }

  pointerCancel(s: PointerSample): Intent[] {
    return this.release(s, false)
  }

  // The pointer left the view: nothing is under it any more.
  pointerLeave(kind: PointerKind): Intent[] {
    return [{ kind: 'hover', at: null, pointer: kind }]
  }

  wheel(s: WheelSample): Intent[] {
    if (s.deltaY === 0) return []
    const px = s.deltaY * (s.deltaMode === 1 ? WHEEL_LINE_PX : s.deltaMode === 2 ? WHEEL_PAGE_PX : 1)
    const sensitivity = s.ctrlKey ? PINCH_WHEEL_SENSITIVITY : WHEEL_SENSITIVITY
    return [{ kind: 'zoom', at: { x: s.x, y: s.y }, factor: Math.exp(-px * sensitivity), t: s.t }]
  }

  key(s: KeySample): Intent[] {
    switch (s.key) {
      case '+':
      case '=':
        return this.keyZoom(KEY_ZOOM_STEP, s.t)
      case '-':
      case '_':
        return this.keyZoom(1 / KEY_ZOOM_STEP, s.t)
      // An arrow moves the view toward it, which moves the content the other way.
      case 'ArrowLeft':
        return this.keyPan(1, 0, s.t)
      case 'ArrowRight':
        return this.keyPan(-1, 0, s.t)
      case 'ArrowUp':
        return this.keyPan(0, 1, s.t)
      case 'ArrowDown':
        return this.keyPan(0, -1, s.t)
      case '0':
        return [{ kind: 'reset', t: s.t }]
      case 'Escape':
        return [{ kind: 'clearSelection' }]
      case 'c':
      case 'C':
        return [{ kind: 'toggleCoordinates' }]
      default:
        return []
    }
  }

  private keyZoom(factor: number, t: number): Intent[] {
    const size = this.screen?.()
    if (!size) return []
    return [{ kind: 'zoom', at: { x: size.width / 2, y: size.height / 2 }, factor, t }]
  }

  // `sx, sy` are the direction the content moves, as -1, 0 or 1.
  private keyPan(sx: number, sy: number, t: number): Intent[] {
    const size = this.screen?.()
    if (!size) return []
    return [
      {
        kind: 'pan',
        dx: sx === 0 ? 0 : sx * KEY_PAN_FRACTION * size.width,
        dy: sy === 0 ? 0 : sy * KEY_PAN_FRACTION * size.height,
        t,
      },
    ]
  }

  // The distance between the two tracked pointers and the point between them.
  private measure(): { dist: number; mid: Vec } {
    const [a, b] = [...this.down.values()]
    return { dist: Math.hypot(b.x - a.x, b.y - a.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
  }

  private movePinch(t: number): Intent[] {
    const prev = this.pinch
    const now = this.measure()
    this.pinch = now
    if (!prev || prev.dist <= 0 || now.dist <= 0) return []
    const factor = now.dist / prev.dist
    const dx = now.mid.x - prev.mid.x
    const dy = now.mid.y - prev.mid.y
    if (factor === 1 && dx === 0 && dy === 0) return []
    return [{ kind: 'pinch', at: now.mid, factor, dx, dy, t }]
  }

  private release(s: PointerSample, mayClick: boolean): Intent[] {
    if (this.ignored.delete(s.id)) return []
    if (!this.down.has(s.id)) return []
    const wasPinch = this.down.size === 2
    this.down.delete(s.id)
    this.pinch = null

    if (wasPinch) {
      // The finger left behind carries on as a fresh drag from where it is.
      const [id, rest] = [...this.down.entries()][0]
      this.press = { id, x0: rest.x, y0: rest.y, lastX: rest.x, lastY: rest.y, dragging: false, afterPinch: true }
      return []
    }

    const p = this.press
    this.press = null
    if (!p || p.id !== s.id) return []
    if (p.dragging) return [{ kind: 'dragEnd', t: s.t }]
    if (p.afterPinch || !mayClick) return []

    const additive = s.shiftKey === true
    const out: Intent[] = [{ kind: 'click', at: { x: s.x, y: s.y }, pointer: s.kind, additive, t: s.t }]
    // Shift + click picks things to add and take away, quick ones in a row
    // included; it is never half of a double-click, which resets the view.
    if (additive) {
      this.lastClick = null
      return out
    }
    const prev = this.lastClick
    if (prev && s.t - prev.t <= DOUBLE_CLICK_MS && Math.hypot(s.x - prev.x, s.y - prev.y) <= DOUBLE_CLICK_SLOP) {
      out.push({ kind: 'reset', t: s.t })
      this.lastClick = null // a third click starts a new pair
    } else {
      this.lastClick = { x: s.x, y: s.y, t: s.t }
    }
    return out
  }
}

// Word-style caret for the CodeMirror editor: it glides between positions and
// its blink is a soft fade (solid while you type, fading ~half a second after
// you stop) instead of a hard on/off step.
//
// How: drawSelection() already keeps ONE DOM node per cursor and updates its
// inline left/top/height in place (RectangleMarker.update), so a plain CSS
// transition on the primary cursor animates the glide with no overlay of our
// own. Chrome pixel-snaps the painted box of a left/top-positioned element, so
// the bar stays crisp at any zoom or devicePixelRatio (a transform would
// resample it). What CSS cannot do is skip the glide for a long jump, so a
// MutationObserver on the cursor layer compares each primary cursor's new
// inline position with its last one and suspends the transition for that
// jump. The blink lives on the whole cursor layer; CodeMirror restarts its own
// animation by flipping the inline animation-name, which we override with
// !important and restart ourselves by flipping a data attribute (a steady caret,
// blinkMs 0, has no animation rules at all: drawSelection's blink rate is 0).
// A jump snaps when it is long, or lands on another line (see caretMotion).
import { Compartment, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, drawSelection, type ViewUpdate } from '@codemirror/view'

export interface SmoothCaretOptions {
  /** Glide duration in ms (default 90). 0 turns the glide off. */
  glideMs?: number
  /** Length of one blink cycle in ms (default 1060, like Word). 0 keeps the caret steady. */
  blinkMs?: number
  /** Jumps longer than this many px snap instead of gliding (default 400). */
  snapPx?: number
  /** False installs nothing: CodeMirror's own caret. */
  enabled?: boolean
}

export const DEFAULT_GLIDE_MS = 90
export const DEFAULT_BLINK_MS = 1060
export const DEFAULT_SNAP_PX = 400

/** True when moving from a to b is too far to glide (a streak would be worse than a snap). */
export function isLongJump(ax: number, ay: number, bx: number, by: number, snapPx: number): boolean {
  return Math.hypot(bx - ax, by - ay) > snapPx
}

export type CaretMotion = 'glide' | 'snap'

/**
 * How the caret should travel from `prev` to `next` (inline left/top in px).
 * Like Word: it glides along a line (typing, End / Home, arrows left and right),
 * but snaps when it lands on a different line (typing past the wrap point, a
 * click, PageDown) - except for an ArrowUp / ArrowDown of one line, which glides.
 * Any jump longer than `snapPx` snaps.
 */
export function caretMotion(
  prev: { x: number; y: number }, next: { x: number; y: number },
  o: { snapPx: number; lineHeight: number; verticalArrow: boolean },
): CaretMotion {
  if (isLongJump(prev.x, prev.y, next.x, next.y, o.snapPx)) return 'snap'
  const dy = Math.abs(next.y - prev.y)
  if (dy <= o.lineHeight / 2) return 'glide'
  if (o.verticalArrow && dy <= o.lineHeight * 1.5) return 'glide'
  return 'snap'
}

/** True for a style-attribute change that only touched `transition` (our own snap bookkeeping). */
export function transitionOnlyChange(oldStyle: string | null, newStyle: string | null): boolean {
  const strip = (v: string | null) => (v ?? '').replace(/(?:^|;)\s*transition[^;]*;?/gi, ';').replace(/\s+/g, '').replace(/^;+|;+$/g, '')
  return strip(oldStyle) === strip(newStyle)
}

const ARROW_WINDOW_MS = 400

type Pos = { x: number; y: number }

class SmoothCaretPlugin {
  private layer: HTMLElement | null = null
  private mo: MutationObserver | null = null
  private last = new WeakMap<Element, Pos>()
  private phase = false
  private gone = false
  private arrowAt = -Infinity
  private readonly view: EditorView
  private readonly snapPx: number
  constructor(view: EditorView, snapPx: number) {
    this.view = view
    this.snapPx = snapPx
    this.attach()
  }

  noteKey(e: KeyboardEvent): void {
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.ctrlKey && !e.metaKey) this.arrowAt = performance.now()
  }

  private attach(): void {
    // drawSelection can be reconfigured (the layer is rebuilt): drop a detached layer and look again.
    if (this.layer && !this.layer.isConnected) {
      this.mo?.disconnect()
      this.mo = null
      this.layer = null
    }
    if (this.layer || typeof MutationObserver === 'undefined') return
    const layer = this.view.scrollDOM.querySelector<HTMLElement>(':scope > .cm-cursorLayer')
    if (!layer) return
    this.layer = layer
    this.mo = new MutationObserver((records) => {
      // Our own transition on/off writes are not caret moves.
      if (records.every((r) => r.type === 'attributes' && transitionOnlyChange(r.oldValue, (r.target as HTMLElement).getAttribute('style')))) return
      this.onMutate()
    })
    this.mo.observe(layer, { subtree: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true, childList: true })
    this.onMutate()
  }

  private onMutate(): void {
    const layer = this.layer
    if (!layer) return
    const cursors = Array.from(layer.querySelectorAll<HTMLElement>('.cm-cursor-primary'))
    for (const el of cursors) {
      const x = parseFloat(el.style.left)
      const y = parseFloat(el.style.top)
      if (Number.isNaN(x) || Number.isNaN(y)) continue
      const prev = this.last.get(el)
      this.last.set(el, { x, y })
      if (!prev || (prev.x === x && prev.y === y)) continue
      const lineHeight = Math.max(parseFloat(el.style.height) || 0, this.view.defaultLineHeight)
      const verticalArrow = performance.now() - this.arrowAt < ARROW_WINDOW_MS
      if (caretMotion(prev, { x, y }, { snapPx: this.snapPx, lineHeight, verticalArrow }) === 'glide') continue
      // Suspend the glide until two frames after this write have styled.
      el.style.transition = 'none'
      requestAnimationFrame(() => requestAnimationFrame(() => { if (!this.gone) el.style.removeProperty('transition') }))
    }
  }

  update(u: ViewUpdate): void {
    this.attach()
    // Every keystroke / selection move / focus change restarts the fade at full opacity.
    if (this.layer && (u.docChanged || u.selectionSet || u.focusChanged)) {
      this.phase = !this.phase
      this.layer.dataset.deCaret = this.phase ? 'b' : 'a'
    }
  }

  destroy(): void {
    this.gone = true
    this.mo?.disconnect()
  }
}

const fade = {
  '0%': { opacity: '1' },
  '50%': { opacity: '1', animationTimingFunction: 'ease-in-out' },
  '75%': { opacity: '0.15', animationTimingFunction: 'ease-in-out' },
  '100%': { opacity: '1' },
}

function caretTheme(glideMs: number, blinkMs: number): Extension {
  const blinks = blinkMs > 0
  const layerFocused = '&.cm-focused > .cm-scroller > .cm-cursorLayer'
  const ease = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
  return EditorView.theme({
    '&': {
      '--de-caret-glide': `${glideMs}ms`,
      '--de-caret-blink': `${blinkMs}ms`,
      '--de-caret-width': '2px',
      '--de-caret-anim-a': 'de-caret-a',
      '--de-caret-anim-b': 'de-caret-b',
    },
    '.cm-cursor': {
      borderLeft: 'none',
      backgroundColor: 'var(--de-text)',
      width: 'var(--de-caret-width)',
      marginLeft: 'calc(var(--de-caret-width) / -2)',
      borderRadius: '0.12em',
    },
    '.cm-cursor-primary': {
      transition: `left var(--de-caret-glide) ${ease}, top var(--de-caret-glide) ${ease}, height var(--de-caret-glide) ${ease}`,
    },
    ...(blinks
      ? {
          [layerFocused]: {
            animationName: 'var(--de-caret-anim-a) !important',
            animationDuration: 'var(--de-caret-blink) !important',
            animationIterationCount: 'infinite !important',
          },
          [`${layerFocused}[data-de-caret=b]`]: { animationName: 'var(--de-caret-anim-b) !important' },
          '@keyframes de-caret-a': fade,
          '@keyframes de-caret-b': fade,
        }
      : {}),
    '&:not(.cm-focused) > .cm-scroller > .cm-selectionLayer': { opacity: '0.55' },
    '@media (prefers-reduced-motion: reduce)': {
      '.cm-cursor-primary': { transition: 'none' },
      // custom properties set on the layer itself beat the root's, whatever the specificity
      ...(blinks ? { '.cm-cursorLayer': { '--de-caret-anim-a': 'none', '--de-caret-anim-b': 'none' } } : {}),
    },
  })
}

// Steady caret: drawSelection's own blink rate, combined with the host's by min(), set to 0.
const steady = drawSelection({ cursorBlinkRate: 0 })

/** The Word-style caret: glide + soft fade. `enabled: false` leaves CodeMirror's own caret. */
export function smoothCaret(opts: SmoothCaretOptions = {}): Extension {
  if (opts.enabled === false) return []
  const glide = opts.glideMs ?? DEFAULT_GLIDE_MS
  const blink = opts.blinkMs ?? DEFAULT_BLINK_MS
  const snap = opts.snapPx ?? DEFAULT_SNAP_PX
  return [
    caretTheme(glide, blink),
    blink > 0 ? [] : steady,
    ViewPlugin.define((view) => new SmoothCaretPlugin(view, snap), {
      eventHandlers: { keydown(this: SmoothCaretPlugin, e: KeyboardEvent) { this.noteKey(e) } },
    }),
  ]
}

export const smoothCaretCompartment = new Compartment()

/** Switch the smooth caret on or off (or retune it) for a mounted view; off = CodeMirror's own caret. */
export function setSmoothCaret(view: EditorView, on: boolean | SmoothCaretOptions): void {
  const o: SmoothCaretOptions = typeof on === 'boolean' ? { enabled: on } : on
  view.dispatch({ effects: smoothCaretCompartment.reconfigure(smoothCaret(o)) })
}

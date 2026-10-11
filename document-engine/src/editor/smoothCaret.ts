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
// !important and restart ourselves by flipping a data attribute.
import { Compartment, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

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

type Pos = { x: number; y: number }

class SmoothCaretPlugin {
  private layer: HTMLElement | null = null
  private mo: MutationObserver | null = null
  private last = new WeakMap<Element, Pos>()
  private phase = false
  private gone = false
  private readonly view: EditorView
  private readonly snapPx: number
  constructor(view: EditorView, snapPx: number) {
    this.view = view
    this.snapPx = snapPx
    this.attach()
  }

  private attach(): void {
    if (this.layer || typeof MutationObserver === 'undefined') return
    const layer = this.view.scrollDOM.querySelector<HTMLElement>(':scope > .cm-cursorLayer')
    if (!layer) return
    this.layer = layer
    this.mo = new MutationObserver(() => this.onMutate())
    this.mo.observe(layer, { subtree: true, attributes: true, attributeFilter: ['style'], childList: true })
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
      if (!isLongJump(prev.x, prev.y, x, y, this.snapPx)) continue
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
    [layerFocused]: {
      animationName: 'var(--de-caret-anim-a) !important',
      animationDuration: 'var(--de-caret-blink) !important',
      animationIterationCount: 'infinite !important',
    },
    [`${layerFocused}[data-de-caret=b]`]: { animationName: 'var(--de-caret-anim-b) !important' },
    '&:not(.cm-focused) > .cm-scroller > .cm-selectionLayer': { opacity: '0.55' },
    '@keyframes de-caret-a': fade,
    '@keyframes de-caret-b': fade,
    '@media (prefers-reduced-motion: reduce)': {
      '.cm-cursor-primary': { transition: 'none' },
      // custom properties set on the layer itself beat the root's, whatever the specificity
      '.cm-cursorLayer': { '--de-caret-anim-a': 'none', '--de-caret-anim-b': 'none' },
    },
  })
}

const steady = EditorView.theme({ '&.cm-focused > .cm-scroller > .cm-cursorLayer': { animationName: 'none !important' } })

/** The Word-style caret: glide + soft fade. `enabled: false` leaves CodeMirror's own caret. */
export function smoothCaret(opts: SmoothCaretOptions = {}): Extension {
  if (opts.enabled === false) return []
  const glide = opts.glideMs ?? DEFAULT_GLIDE_MS
  const blink = opts.blinkMs ?? DEFAULT_BLINK_MS
  const snap = opts.snapPx ?? DEFAULT_SNAP_PX
  return [
    caretTheme(glide, blink > 0 ? blink : DEFAULT_BLINK_MS),
    blink > 0 ? [] : steady,
    ViewPlugin.define((view) => new SmoothCaretPlugin(view, snap)),
  ]
}

export const smoothCaretCompartment = new Compartment()

/** Switch the smooth caret on or off (or retune it) for a mounted view; off = CodeMirror's own caret. */
export function setSmoothCaret(view: EditorView, on: boolean | SmoothCaretOptions): void {
  const o: SmoothCaretOptions = typeof on === 'boolean' ? { enabled: on } : on
  view.dispatch({ effects: smoothCaretCompartment.reconfigure(smoothCaret(o)) })
}

// The parameter panel (plan E11, spec SP6 "Parameters"): a compact panel at
// the top left of the view, one row per @param binding — its name, a range
// slider, a number box that commits on Enter or blur, a play button and a
// loop toggle. DOM, with pointer events on (the rest of the overlay has them
// off). It only reports what the reader did; the renderer owns the values,
// coalesces changes to one kernel rebuild per frame, and runs play.

import type { Binding } from '../config'
import { cssRgb, type SpaceColors } from '../theme'

export interface ParamsHandlers {
  // S6 fix round 1, I7: `scrubbing` is true for every slider `input` event
  // (still moving) and false for its number-box commit or its final,
  // native `change` (released) — the renderer holds the box the same way
  // it does for a play or a point-drag while any binding's is true.
  change(name: string, value: number, scrubbing: boolean): void
  togglePlay(name: string): void
  toggleLoop(name: string): void
  // S6 fix round 1, I6: the panel collapses or expands on a plain hover or
  // focus change (setExpanded below) — a DOM event this class handles
  // entirely on its own, invisible to SpaceRenderer unless it says so. That
  // changes the panel's own rectangle, so the label placer's chrome
  // obstacle is stale until the next draw() — but nothing before this asked
  // for one. This is the request, and the renderer's own chance to drop its
  // cached chrome rectangle (SpaceRenderer.ts's chromeRects()) too.
  chromeChanged(): void
}

export interface ParamRowState {
  value: number
  playing: boolean
  loop: boolean
}

interface Row {
  binding: Binding
  slider: HTMLInputElement
  number: HTMLInputElement
  play: HTMLButtonElement
  loop: HTMLButtonElement
  editing: boolean
}

// A continuous binding with no step slides in 1000ths of its range.
export function sliderStep(binding: Binding): number {
  if (binding.integer) return 1
  if (binding.step !== null && binding.step > 0) return binding.step
  return (binding.max - binding.min) / 1000
}

// How many decimals a step is written with: 0.25 -> 2, 0.1 -> 1, 5 -> 0.
export function stepDecimals(step: number): number {
  for (let d = 0; d <= 10; d++) {
    const scaled = step * 10 ** d
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, scaled)) return d
  }
  return 10
}

// What the number box shows: an integer binding as an integer, a stepped one
// to its step's decimals, a continuous one to 4 significant digits. Plain
// ASCII (no U+2212 minus), so the number input accepts it.
export function displayValue(binding: Binding, value: number): string {
  if (binding.integer) return String(Math.round(value))
  if (binding.step !== null && binding.step > 0) return value.toFixed(stepDecimals(binding.step))
  return String(Number(value.toPrecision(4)))
}

export class ParamsPanel {
  readonly element: HTMLDivElement
  private readonly handlers: ParamsHandlers
  private rows: Row[] = []
  // S6 plan V10: collapsed to a chip unless hovered, focused, or a
  // parameter is playing.
  private hovered = false
  private focused = false
  private anyPlaying = false

  constructor(overlay: HTMLElement, handlers: ParamsHandlers) {
    this.handlers = handlers
    this.element = overlay.ownerDocument.createElement('div')
    this.element.className = 'space-params'
    this.element.style.display = 'none'
    this.element.addEventListener('mouseenter', () => this.setExpanded('hovered', true))
    this.element.addEventListener('mouseleave', () => this.setExpanded('hovered', false))
    // A hidden collapsed row cannot hold focus, so this only ever fires
    // from the one row the chip already shows — but it also has to clear
    // when focus leaves the panel for anywhere else on the page.
    this.element.addEventListener('focusin', () => this.setExpanded('focused', true))
    this.element.addEventListener('focusout', () => this.setExpanded('focused', false))
    overlay.appendChild(this.element)
  }

  private setExpanded(which: 'hovered' | 'focused', value: boolean): void {
    this[which] = value
    this.updateCollapsed()
  }

  private updateCollapsed(): void {
    const collapsed = this.rows.length > 1 && !this.hovered && !this.focused && !this.anyPlaying
    const was = this.element.dataset.collapsed === 'true'
    if (collapsed === was) return
    if (collapsed) this.element.dataset.collapsed = 'true'
    else delete this.element.dataset.collapsed
    this.handlers.chromeChanged()
  }

  get size(): number {
    return this.rows.length
  }

  setColors(colors: SpaceColors): void {
    this.element.style.background = cssRgb(colors.background)
    this.element.style.borderColor = cssRgb(colors.gridStrong)
    this.element.style.color = cssRgb(colors.axis)
  }

  // One row per binding, in source order; none hides the panel.
  setBindings(bindings: readonly Binding[]): void {
    for (const row of this.rows) (row.slider.parentElement as HTMLElement | null)?.remove()
    this.rows = []
    const doc = this.element.ownerDocument
    for (const binding of bindings) {
      const line = doc.createElement('div')
      line.className = 'space-param'
      const name = doc.createElement('span')
      name.className = 'space-param-name'
      name.textContent = binding.name
      const slider = doc.createElement('input')
      slider.type = 'range'
      slider.className = 'space-param-slider'
      slider.min = String(binding.min)
      slider.max = String(binding.max)
      slider.step = String(sliderStep(binding))
      slider.setAttribute('aria-label', binding.name)
      const number = doc.createElement('input')
      number.type = 'number'
      number.className = 'space-param-number'
      number.min = String(binding.min)
      number.max = String(binding.max)
      number.step = String(sliderStep(binding))
      number.setAttribute('aria-label', `${binding.name} value`)
      const play = doc.createElement('button')
      play.type = 'button'
      play.className = 'space-param-play'
      play.setAttribute('aria-label', `Play ${binding.name}`)
      const loop = doc.createElement('button')
      loop.type = 'button'
      loop.className = 'space-param-loop'
      loop.textContent = '⟲'
      loop.setAttribute('aria-label', `Loop ${binding.name}`)
      line.append(name, slider, number, play, loop)
      this.element.appendChild(line)
      const row: Row = { binding, slider, number, play, loop, editing: false }
      this.rows.push(row)

      slider.addEventListener('input', () => this.handlers.change(binding.name, Number(slider.value), true))
      // S6 fix round 1, I7: the native `change` fires once, on release
      // (mouseup or keyup) — the scrub's end, so the last value goes
      // through again, this time not scrubbing, for the one full-
      // resolution rebuild a play or a drag's release also gets.
      slider.addEventListener('change', () => this.handlers.change(binding.name, Number(slider.value), false))
      const commit = () => {
        const value = Number(number.value)
        if (number.value.trim() !== '' && Number.isFinite(value)) this.handlers.change(binding.name, value, false)
      }
      number.addEventListener('focus', () => (row.editing = true))
      number.addEventListener('blur', () => {
        row.editing = false
        commit()
      })
      number.addEventListener('keydown', (e: Event) => {
        if ((e as KeyboardEvent).key === 'Enter') commit()
      })
      play.addEventListener('click', () => this.handlers.togglePlay(binding.name))
      loop.addEventListener('click', () => this.handlers.toggleLoop(binding.name))
    }
    this.element.style.display = bindings.length > 0 ? '' : 'none'
    this.hovered = false
    this.focused = false
    this.anyPlaying = false
    this.updateCollapsed()
  }

  // Reflect the live values and play state. The number box a reader is
  // typing into keeps what they typed until they commit.
  sync(state: ReadonlyMap<string, ParamRowState>): void {
    let anyPlaying = false
    for (const row of this.rows) {
      const s = state.get(row.binding.name)
      if (!s) continue
      if (s.playing) anyPlaying = true
      const slide = String(s.value)
      const text = displayValue(row.binding, s.value)
      if (row.slider.value !== slide) row.slider.value = slide
      if (!row.editing && row.number.value !== text) row.number.value = text
      const play = s.playing ? '❚❚' : '▶'
      if (row.play.textContent !== play) row.play.textContent = play
      row.play.setAttribute('aria-pressed', String(s.playing))
      row.loop.setAttribute('aria-pressed', String(s.loop))
    }
    if (anyPlaying !== this.anyPlaying) {
      this.anyPlaying = anyPlaying
      this.updateCollapsed()
    }
  }

  dispose(): void {
    this.rows = []
    this.element.remove()
  }
}

// The parameter panel (plan E11, spec SP6 "Parameters"): a compact panel at
// the top left of the view, one row per @param binding — its name, a range
// slider, a number box that commits on Enter or blur, a play button and a
// loop toggle. DOM, with pointer events on (the rest of the overlay has them
// off). It only reports what the reader did; the renderer owns the values,
// coalesces changes to one kernel rebuild per frame, and runs play.

import type { Binding } from '../config'
import { cssRgb, type SpaceColors } from '../theme'

export interface ParamsHandlers {
  change(name: string, value: number): void
  togglePlay(name: string): void
  toggleLoop(name: string): void
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

export class ParamsPanel {
  readonly element: HTMLDivElement
  private readonly handlers: ParamsHandlers
  private rows: Row[] = []

  constructor(overlay: HTMLElement, handlers: ParamsHandlers) {
    this.handlers = handlers
    this.element = overlay.ownerDocument.createElement('div')
    this.element.className = 'space-params'
    this.element.style.display = 'none'
    overlay.appendChild(this.element)
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

      slider.addEventListener('input', () => this.handlers.change(binding.name, Number(slider.value)))
      const commit = () => {
        const value = Number(number.value)
        if (number.value.trim() !== '' && Number.isFinite(value)) this.handlers.change(binding.name, value)
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
  }

  // Reflect the live values and play state. The number box a reader is
  // typing into keeps what they typed until they commit.
  sync(state: ReadonlyMap<string, ParamRowState>): void {
    for (const row of this.rows) {
      const s = state.get(row.binding.name)
      if (!s) continue
      const text = String(s.value)
      if (row.slider.value !== text) row.slider.value = text
      if (!row.editing && row.number.value !== text) row.number.value = text
      const play = s.playing ? '❚❚' : '▶'
      if (row.play.textContent !== play) row.play.textContent = play
      row.play.setAttribute('aria-pressed', String(s.playing))
      row.loop.setAttribute('aria-pressed', String(s.loop))
    }
  }

  dispose(): void {
    this.rows = []
    this.element.remove()
  }
}

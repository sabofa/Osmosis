// The lab's fps readout. The view is drawn on demand (a drag, a slider), so a
// rate means something only while frames are following one another: a run of
// frames reads as its own frame rate over the last second, a lone frame reads
// as what its render time could sustain (capped at the screen's 60), and a
// pause forgets the run rather than showing a stale or invented number.

const WINDOW_MS = 1000
// A gap this long between frames ends a run.
const PAUSE_MS = 250
const SCREEN_FPS = 60

export class FpsMeter {
  private times: number[] = []

  // Note a frame drawn at `now` (ms) that took `renderMs`; the rate to show.
  tick(now: number, renderMs: number): number {
    const last = this.times[this.times.length - 1]
    if (last !== undefined && now - last > PAUSE_MS) this.times = []
    this.times.push(now)
    while (this.times.length > 1 && now - this.times[0] > WINDOW_MS) this.times.shift()
    const span = now - this.times[0]
    if (this.times.length < 2 || span <= 0) return Math.min(SCREEN_FPS, 1000 / Math.max(renderMs, 1e-6))
    return ((this.times.length - 1) * 1000) / span
  }
}

// The readout's name for the painter that drew a frame. "baked" says what drew it. A live frame says why it is live when the baked painting is the
// painter's to choose: "live (bake off)" when the Bake switch is off (the painter's own choice, said plainly), "live (no bake here)" when the switch
// is on and the light is fixed in the world but the device or a failed bake rules the bake out (`why`), and plain "live" otherwise (a light that moves
// with the camera, a debug view, the first bake still being made).
export function pathLabel(path: 'baked' | 'live', bakeOn: boolean, why: string | null): string {
  if (path === 'baked') return 'baked'
  if (!bakeOn) return 'live (bake off)'
  return why ? 'live (no bake here)' : 'live'
}

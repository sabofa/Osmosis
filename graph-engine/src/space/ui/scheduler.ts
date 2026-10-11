// Render on demand (plan "Global Constraints", spec SP4 frame loop 6): there
// is no standing requestAnimationFrame loop. A frame is requested only after
// a scene, camera, size or theme change, and repeated only while the frame
// itself asks to continue (inertia). Any number of requests before the frame
// runs collapse into one.

export type RequestFrame = (callback: (time: number) => void) => number
export type CancelFrame = (handle: number) => void

export class FrameScheduler {
  private handle: number | null = null
  private readonly requestFrame: RequestFrame
  private readonly cancelFrame: CancelFrame
  // Draws one frame; returns true to be called again next frame.
  private readonly render: (time: number) => boolean

  constructor(requestFrame: RequestFrame, cancelFrame: CancelFrame, render: (time: number) => boolean) {
    this.requestFrame = requestFrame
    this.cancelFrame = cancelFrame
    this.render = render
  }

  get pending(): boolean {
    return this.handle !== null
  }

  request(): void {
    if (this.handle !== null) return
    this.handle = this.requestFrame((time) => {
      this.handle = null
      if (this.render(time)) this.request()
    })
  }

  cancel(): void {
    if (this.handle === null) return
    this.cancelFrame(this.handle)
    this.handle = null
  }
}

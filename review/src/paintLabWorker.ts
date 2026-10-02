// The Paint Lab's model worker: the painter's CPU work (particles, the model,
// the paper) on its own thread, so the controls never wait for a frame. A thin
// message wrapper around the paint session (graph-engine/src/space/paint/
// session.ts), which does all of it; the same session runs on the page's own
// thread when the worker cannot (or with ?worker=0).
//
// Messages in:   scene, colours, forget, frame (a SessionRequest; its G-buffer arrives as transferred buffers)
// Messages out:  frame (the SessionResponse; its arrays are handed back, not copied)

import { PaintSession, transferList, type SceneColourData, type SessionRequest, type SessionResponse } from '../../graph-engine/src/space/paint/session'
import type { SpaceScene } from '../../graph-engine/src/space/scene/types'

export type WorkerIn =
  | { type: 'scene'; sceneId: number; scene: SpaceScene; colours: SceneColourData }
  | { type: 'colours'; sceneId: number; colours: SceneColourData }
  | { type: 'forget'; sceneId: number }
  | { type: 'frame'; request: SessionRequest }

export type WorkerOut = { type: 'frame'; response: SessionResponse }

const session = new PaintSession()
const post = (message: WorkerOut, transfer: ArrayBuffer[]) => (self as unknown as { postMessage(m: unknown, t: ArrayBuffer[]): void }).postMessage(message, transfer)

self.onmessage = (event: MessageEvent<WorkerIn>) => {
  const m = event.data
  switch (m.type) {
    case 'scene':
      session.setScene(m.sceneId, m.scene, m.colours)
      break
    case 'colours':
      session.setColours(m.sceneId, m.colours)
      break
    case 'forget':
      session.forget(m.sceneId)
      break
    case 'frame': {
      const response = session.frame(m.request)
      post({ type: 'frame', response }, transferList(response))
      break
    }
  }
}

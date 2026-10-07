// The Paint Lab's model worker: the painter's CPU work (particles, the model,
// the paper, the baked painting) on its own thread, so the controls never wait
// for a frame or a bake. A thin message wrapper around the paint session
// (graph-engine/src/space/paint/session.ts), which does all of it; the same
// session runs on the page's own thread when the worker cannot (or with ?worker=0).
//
// Messages in:   scene, colours, forget, frame (a SessionRequest; its G-buffer arrives as transferred buffers),
//                bake (a BakeRequest), recolour (a RecolourRequest)
// Messages out:  frame (the SessionResponse; its arrays are handed back, not copied),
//                bake (the BakeAnswer: the painting's arrays are handed back, but for the few the session's recipes still read, which are copied),
//                recolour (the colour arrays alone, handed back), progress (a running bake's whole percent)

import {
  bakeTransferList,
  PaintSession,
  recolourTransferList,
  transferList,
  type BakeAnswer,
  type BakeRequest,
  type RecolourAnswer,
  type RecolourRequest,
  type SceneColourData,
  type SessionRequest,
  type SessionResponse,
} from '../../graph-engine/src/space/paint/session'
import type { SpaceScene } from '../../graph-engine/src/space/scene/types'

export type WorkerIn =
  | { type: 'scene'; sceneId: number; scene: SpaceScene; colours: SceneColourData }
  | { type: 'colours'; sceneId: number; colours: SceneColourData }
  | { type: 'forget'; sceneId: number }
  | { type: 'frame'; request: SessionRequest }
  | { type: 'bake'; request: BakeRequest }
  | { type: 'recolour'; request: RecolourRequest }

export type WorkerOut =
  | { type: 'frame'; response: SessionResponse }
  | { type: 'bake'; response: BakeAnswer }
  | { type: 'recolour'; response: RecolourAnswer }
  | { type: 'progress'; id: number; percent: number }

const session = new PaintSession()
const post = (message: WorkerOut, transfer: ArrayBuffer[] = []) => (self as unknown as { postMessage(m: unknown, t: ArrayBuffer[]): void }).postMessage(message, transfer)

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
    case 'bake': {
      // (the progress messages reach the page while the bake still runs: a worker's messages do not wait for its task to end)
      const response = session.bake(m.request, (percent) => post({ type: 'progress', id: m.request.id, percent }))
      post({ type: 'bake', response }, response.ok ? bakeTransferList(response.baked) : [])
      break
    }
    case 'recolour': {
      const response = session.recolour(m.request)
      post({ type: 'recolour', response }, response.ok ? recolourTransferList(response.colours) : [])
      break
    }
  }
}

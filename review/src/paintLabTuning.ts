// "Save as defaults" (spec §6, L6): the pure core of the dev middleware in
// review/vite.config.mts. The lab POSTs its params to /__paint/tuning; the
// middleware hands the body text here, with a `write` that puts text in
// graph-engine/src/space/paint/tuning.json. M2 reads that file as the shipping
// defaults, so what is written is always a whole, valid parameter set: the
// body laid over the defaults, every number inside its slider range.

import { resolvePaintParams, type PaintParamsOverride } from '../../graph-engine/src/space/paint/params'
import { sanitiseParams } from './paintLabParams'

// Repo-relative, for the reply (the middleware knows the absolute path).
export const TUNING_PATH = 'graph-engine/src/space/paint/tuning.json'

export interface TuningResult {
  status: 200 | 400 | 500
  body: { ok: true; path: string } | { ok: false; error: string }
}

export function handleTuningPost(bodyText: string, write: (text: string) => void): TuningResult {
  let data: unknown
  try {
    data = JSON.parse(bodyText)
  } catch (error) {
    return { status: 400, body: { ok: false, error: `The body is not valid JSON (${error instanceof Error ? error.message : String(error)}).` } }
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { status: 400, body: { ok: false, error: 'The body must be a JSON object of painter parameters.' } }
  }
  const params = sanitiseParams(resolvePaintParams(data as PaintParamsOverride))
  try {
    // Two-space indent and a final newline, so the file diffs cleanly.
    write(`${JSON.stringify(params, null, 2)}\n`)
  } catch (error) {
    return { status: 500, body: { ok: false, error: `Could not write ${TUNING_PATH}: ${error instanceof Error ? error.message : String(error)}` } }
  }
  return { status: 200, body: { ok: true, path: TUNING_PATH } }
}

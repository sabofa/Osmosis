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

// What the dev middleware checks of a request to /__paint/tuning before it reads the body: the pure core of
// review/vite.config.mts. The endpoint rewrites a file in the repo, so a page on another site must not be able to
// make the person's browser POST to it (the dev server is on localhost, and a browser will send a form or a
// no-cors fetch there from anywhere):
//   - the method is POST;
//   - the request is not marked cross-site by the browser (Sec-Fetch-Site), and when it names its Origin that is
//     this server's own host and port (a page on another port of localhost is another origin, and so is "null",
//     which a sandboxed frame or a data: page sends);
//   - the body is declared as JSON, exactly: the media type application/json, with at most a UTF-8 charset (a
//     substring match let "text/plain; x=application/json" through, and text/plain is what a cross-site form can send).
// A request with no Origin and no Sec-Fetch-Site (curl, a script) is not a browser's page and is let through.
export interface TuningRefusal {
  status: 403 | 405 | 415
  body: { ok: false; error: string }
  headers?: Record<string, string>
}

type Headers = Record<string, string | string[] | undefined>

const JSON_TYPE = /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i

export function refuseTuningRequest(method: string | undefined, headers: Headers): TuningRefusal | null {
  // a header sent twice is ambiguous: joined, it matches nothing below
  const one = (name: string): string | undefined => {
    const v = headers[name]
    return Array.isArray(v) ? v.join(', ') : v
  }
  if (method !== 'POST') return { status: 405, body: { ok: false, error: 'POST the params as JSON.' }, headers: { Allow: 'POST' } }
  if (one('sec-fetch-site')?.trim().toLowerCase() === 'cross-site') {
    return { status: 403, body: { ok: false, error: 'This page is not the lab: a request from another site is refused.' } }
  }
  const origin = one('origin')
  if (origin !== undefined) {
    let own = false
    try {
      const host = one('host')
      own = host !== undefined && new URL(origin).host === host
    } catch {
      // not a URL ("null"): not ours
    }
    if (!own) return { status: 403, body: { ok: false, error: 'This request comes from another origin than the lab’s own, and is refused.' } }
  }
  if (!JSON_TYPE.test((one('content-type') ?? '').trim())) {
    return { status: 415, body: { ok: false, error: 'Send Content-Type: application/json.' } }
  }
  return null
}

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

// The lab's URL state and saved interface state, in one place for the page, the
// view and the Showcase. Reading the URL is a side effect of importing this
// module on purpose: a dev-only ?state=no-webgl2 must take hold before any
// engine asks a canvas for WebGL2.

import type { PaintDebugMode } from '../../graph-engine/src/space/paint/types'
import { CURVE_SCHEMA, PARAM_SCHEMA } from '../../graph-engine/src/space/paint/params'
import type { Theme } from './paintLabColours'
import { figureById, PAINT_FIGURES } from './paintLabFigures'
import { labGroups } from './paintLabParams'
import { browserStorage } from './paintLabPresets'

export const DEBUG_MODES: { id: PaintDebugMode; label: string }[] = [
  { id: 'none', label: 'Painted' },
  { id: 'value', label: 'Value plan (u)' },
  { id: 'zones', label: 'Zones' },
  { id: 'planes', label: 'Planes' },
  { id: 'edges', label: 'Edge classes' },
  { id: 'roles', label: 'Stroke roles' },
  { id: 'grey', label: 'Greyscale check' },
  { id: 'paint-only', label: 'Paint only' },
]

// Dev-only failure injection, like the space review page's ?state=: a headless
// shot of the no-WebGL2 and engine-error states needs a real failure.
export type InjectedState = 'no-webgl2' | 'engine-error' | null

const UI_KEY = 'osmosis.paintLab.ui'
export const GROUPS = labGroups(PARAM_SCHEMA, CURVE_SCHEMA)
const FIRST_OPEN = ['Light']

export interface UiPrefs {
  panel: boolean
  open: string[]
}

export function readPrefs(): UiPrefs {
  try {
    const data: unknown = JSON.parse(browserStorage()?.getItem(UI_KEY) ?? 'null')
    if (data && typeof data === 'object') {
      const { panel, open } = data as Partial<UiPrefs>
      return { panel: panel !== false, open: Array.isArray(open) ? open.filter((t) => typeof t === 'string') : FIRST_OPEN }
    }
  } catch {
    // Blocked or corrupt storage: the defaults.
  }
  return { panel: true, open: FIRST_OPEN }
}

export function writePrefs(prefs: UiPrefs): void {
  try {
    browserStorage()?.setItem(UI_KEY, JSON.stringify(prefs))
  } catch {
    // Not persisted; the lab does not need it to work.
  }
}

export type Tab = 'tune' | 'showcase'

export interface UrlState {
  tab: Tab
  figure: string
  debug: PaintDebugMode
  theme: Theme
  seed: number | null
  panel: boolean | null
  open: string[] | null
  view: { azimuth?: number; elevation?: number; zoom?: number }
  // &set=path:value,path:value starts with those sliders moved (clamped to their ranges), e.g. set=particles.maxPerUnit2:3000.
  set: [string, number][]
  // &worker=0 runs the model on the page's own thread (the default is a worker, so the controls never wait for a frame).
  worker: boolean
  // &perf=1 keeps every frame's timings in window.__paintFrames and gives the page window.__paintLab (a handle to move sliders from a script), for measuring.
  perf: boolean
  injected: InjectedState
}

// The page's state lives in the URL (?tab=showcase, &figure=, &debug=,
// &theme=, &seed=, &set=, &worker=, &az=, &el=, &zoom=), so a link or a headless shot lands on exactly what was
// being looked at. &panel=0 starts with the panel folded; &open=Light,Edges
// starts with those groups open.
function readUrl(): UrlState {
  const q = new URLSearchParams(location.search)
  const number = (key: string) => {
    const v = q.get(key)
    return v !== null && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined
  }
  const state = q.get('state')
  return {
    tab: q.get('tab') === 'showcase' ? 'showcase' : 'tune',
    figure: figureById(q.get('figure'))?.id ?? PAINT_FIGURES[0].id,
    debug: DEBUG_MODES.find((m) => m.id === q.get('debug'))?.id ?? 'none',
    theme: q.get('theme') === 'dark' ? 'dark' : 'light',
    seed: number('seed') ?? null,
    panel: q.get('panel') === '0' ? false : q.get('panel') === '1' ? true : null,
    open: q.has('open') ? (q.get('open') ?? '').split(',').filter(Boolean) : null,
    view: { azimuth: number('az'), elevation: number('el'), zoom: number('zoom') },
    set: (q.get('set') ?? '')
      .split(',')
      .map((pair): [string, number] => {
        const [path, value] = pair.split(':')
        return [path?.trim() ?? '', Number(value)]
      })
      .filter(([path, value]) => path !== '' && Number.isFinite(value)),
    worker: q.get('worker') !== '0',
    perf: q.get('perf') === '1',
    injected: state === 'no-webgl2' || state === 'engine-error' ? state : null,
  }
}

export function writeUrl(tab: Tab, figure: string, debug: PaintDebugMode, theme: Theme): void {
  const url = new URL(location.href)
  if (tab === 'tune') url.searchParams.delete('tab')
  else url.searchParams.set('tab', tab)
  url.searchParams.set('figure', figure)
  if (debug === 'none') url.searchParams.delete('debug')
  else url.searchParams.set('debug', debug)
  if (theme === 'light') url.searchParams.delete('theme')
  else url.searchParams.set('theme', theme)
  history.replaceState(null, '', url)
}

function injectNoWebGL2(): void {
  const real = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    return type === 'webgl2' ? null : (real as (...a: unknown[]) => unknown).call(this, type, ...rest)
  } as typeof HTMLCanvasElement.prototype.getContext
}

export const URL_STATE = readUrl()
if (URL_STATE.injected === 'no-webgl2') injectNoWebGL2()

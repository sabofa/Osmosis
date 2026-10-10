// The H4 handling probe: how smooth is a wheel zoom on a styled figure, and
// what is the time spent on?
//
//   npx vite-node scripts/handling-probe.ts -- [--only name,name] [--runs 2]
//        [--trace] [--out results.json] [--list]
//
// It starts its own vite dev server on the package (port 5195; the review
// harness on :5181 is not touched), launches ONE headless Edge with a fresh
// profile, and for each scenario loads the harness, sets a spec, and drives
// ~60 synthetic wheel events over ~1.5 s (zoom in x8, then out) at the figure,
// recording requestAnimationFrame deltas and long tasks. With --trace a
// separate run is traced (devtools.timeline, cc, gpu, viz) and the burst's
// time is summed per thread and event name, which says raster / paint / script.
//
// Variants are injected at RUN TIME and never touch production code:
//   - page-side: hiding layers, stripping filters, blocking the commit's
//     writes, blocking will-change (an init script patches the DOM setters);
//   - build-side: a vite plugin (in this file) rewrites feel.ts's OVERSCAN, the
//     FigureView onLive wiring and adds render/commit counters, in the dev
//     server's module transform only, reading flags from window.__probe.
// Everything is bounded by a timeout, and the browser is closed through CDP.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { frameDeltas, summariseDeltas, sumByName, type FrameSummary, type TraceEvent } from './handling-probe-stats'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const PORT = 5195
const CDP_PORT = 9333
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync)

// ---------------------------------------------------------------------------
// The dev server, with the probe's module rewrites
// ---------------------------------------------------------------------------

const fmt = (n: number) => n.toFixed(1)

function mustReplace(code: string, from: string, to: string, file: string): string {
  if (!code.includes(from)) throw new Error(`probe: ${file} no longer contains ${JSON.stringify(from)}`)
  return code.replace(from, to)
}

function probePlugin(): Plugin {
  return {
    name: 'handling-probe',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0].replace(/\\/g, '/')
      if (file.endsWith('/src/view2d/feel.ts')) {
        return mustReplace(code, 'export const OVERSCAN = 0.3', "export const OVERSCAN: number = (globalThis as any).__probe?.overscan ?? 0.3", file)
      }
      if (file.endsWith('/src/FigureView.tsx')) {
        let out = code.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
        out = mustReplace(out, '    onLive: LIVE ? paintLive : undefined,', '    onLive: (globalThis as any).__probe?.noLive ? undefined : LIVE ? paintLive : undefined,', file)
        out = mustReplace(out, 'applyOverscan(root, OVERSCAN_USED)', ';((globalThis as any).__probe && ((globalThis as any).__probe.commits = ((globalThis as any).__probe.commits ?? 0) + 1, ((globalThis as any).__probe.commitStart ??= []).push(performance.now()))), applyOverscan(root, OVERSCAN_USED)', file)
        out = mustReplace(out, 'compensation.current = compensate(root, zoom, compensation.current)', 'compensation.current = compensate(root, zoom, compensation.current);;(globalThis as any).__probe && ((globalThis as any).__probe.commitEnd ??= []).push(performance.now())', file)
        out = mustReplace(out, '  const containerRef = useRef<HTMLDivElement | null>(null)\n', '  if ((globalThis as any).__probe) (globalThis as any).__probe.renders = ((globalThis as any).__probe.renders ?? 0) + 1\n  const containerRef = useRef<HTMLDivElement | null>(null)\n', file)
        return out
      }
      return null
    },
  }
}

async function startServer(): Promise<ViteDevServer> {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    plugins: [probePlugin(), react()],
    server: { port: PORT, strictPort: true, hmr: false, host: '127.0.0.1' },
    optimizeDeps: { noDiscovery: false },
  })
  await server.listen()
  return server
}

// ---------------------------------------------------------------------------
// CDP
// ---------------------------------------------------------------------------

class Cdp {
  private id = 0
  private pending = new Map<number, { resolve(v: any): void; reject(e: Error): void }>()
  private listeners = new Map<string, ((p: any) => void)[]>()
  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(String(m.data))
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) p?.reject(new Error(`${msg.error.message}`))
        else p?.resolve(msg.result)
      } else if (msg.method) for (const l of this.listeners.get(msg.method) ?? []) l(msg.params)
    })
  }
  static connect(url: string): Promise<Cdp> {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url)
      ws.addEventListener('open', () => res(new Cdp(ws)))
      ws.addEventListener('error', () => rej(new Error('cdp socket error')))
    })
  }
  send<T = any>(method: string, params: object = {}, timeoutMs = 60000): Promise<T> {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`cdp timeout: ${method}`)), timeoutMs)
      this.pending.set(id, { resolve: (v) => (clearTimeout(timer), resolve(v)), reject: (e) => (clearTimeout(timer), reject(e)) })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  on(method: string, fn: (p: any) => void): void {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), fn])
  }
  async eval<T = any>(expression: string, timeoutMs = 60000): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs)
    if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    return r.result.value
  }
  close(): void {
    this.ws.close()
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function launchEdge(gpu: 'hw' | 'sw'): Promise<{ proc: ChildProcess; cdp: Cdp }> {
  if (!EDGE) throw new Error('msedge.exe not found')
  const profile = mkdtempSync(resolve(tmpdir(), 'handling-probe-'))
  const proc = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--window-size=1400,900', '--no-first-run', '--disable-extensions', '--hide-scrollbars', ...(gpu === 'sw' ? ['--disable-gpu'] : ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist']), 'about:blank'], { stdio: 'ignore' })
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      const list: any[] = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page) return { proc, cdp: await Cdp.connect(page.webSocketDebuggerUrl) }
    } catch {
      // not up yet
    }
    await sleep(250)
  }
  throw new Error('edge did not come up')
}

// ---------------------------------------------------------------------------
// Page side
// ---------------------------------------------------------------------------

// Runs before the page's own scripts: the setters the "block" variants patch.
const INIT = (flags: object) => `
window.__probe = ${JSON.stringify(flags)};
(() => {
  const P = window.__probe;
  const origSet = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (P.noCommit && !P.allowCommit && this.ownerSVGElement !== undefined) {
      if (name === 'viewBox' || name === 'font-size' || name === 'r') return;
    }
    if (P.noCompensate && (name === 'font-size' || name === 'r')) return;
    return origSet.call(this, name, value);
  };
  const proto = CSSStyleDeclaration.prototype;
  for (const prop of ['transform', 'willChange']) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set) continue;
    Object.defineProperty(proto, prop, { configurable: true, get: d.get, set(v) {
      if (P.noCommit && !P.allowCommit && prop === 'transform' && v === '') return;
      if (P.noWillChange && prop === 'willChange') return;
      d.set.call(this, v);
    } });
  }
})();`

const PAGE_LIB = `
window.__p = {
  setSpec(text) {
    const ta = document.querySelector('textarea.app-textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  },
  info() {
    const svg = document.querySelector('.figure-view-surface svg');
    if (!svg) return null;
    const layers = {};
    svg.querySelectorAll('[data-layer]').forEach((l) => {
      const k = l.getAttribute('data-layer');
      const a = layers[k] || (layers[k] = { groups: 0, elements: 0, pathBytes: 0, filters: 0 });
      a.groups++;
      a.elements += l.querySelectorAll('*').length;
      l.querySelectorAll('path').forEach((p) => (a.pathBytes += (p.getAttribute('d') || '').length));
      a.filters += (l.hasAttribute('filter') ? 1 : 0) + l.querySelectorAll('[filter]').length;
    });
    const r = svg.getBoundingClientRect();
    return {
      style: svg.getAttribute('data-style'), bytes: svg.outerHTML.length, elements: svg.querySelectorAll('*').length,
      paths: svg.querySelectorAll('path').length, defsFilters: svg.querySelectorAll('filter').length,
      patterns: svg.querySelectorAll('pattern').length, layers, w: r.width, h: r.height,
      viewBox: svg.getAttribute('viewBox'), errors: [...document.querySelectorAll('.app-errors li')].map((l) => l.textContent),
    };
  },
  style(css) {
    let s = document.getElementById('probe-style');
    if (!s) { s = document.createElement('style'); s.id = 'probe-style'; document.head.appendChild(s); }
    s.textContent = css;
  },
  stripFilters() {
    document.querySelectorAll('.figure-view-surface svg [filter]').forEach((e) => e.removeAttribute('filter'));
    document.querySelectorAll('.figure-view-surface svg [style*="filter"]').forEach((e) => (e.style.filter = ''));
  },
  burst(o) {
    return new Promise((resolve) => {
      const surf = document.querySelector('.figure-view-surface');
      const r = surf.getBoundingClientRect();
      const cx = r.left + r.width * 0.45, cy = r.top + r.height * 0.5;
      const P = window.__probe; P.commits = 0; P.renders = 0; P.commitStart = []; P.commitEnd = [];
      const ts = []; let alive = true;
      const loop = (t) => { ts.push(t); if (alive) requestAnimationFrame(loop); };
      const lt = [];
      let po = null;
      try { po = new PerformanceObserver((l) => l.getEntries().forEach((e) => lt.push([e.startTime, e.duration]))); po.observe({ entryTypes: ['longtask'] }); } catch (e) {}
      requestAnimationFrame(loop);
      performance.mark('probe-start');
      const n = o.events, dt = o.span / n, t0 = performance.now();
      let i = 0;
      const fire = () => {
        const now = performance.now();
        while (i < n && t0 + i * dt <= now) {
          const dy = i < n / 2 ? -o.dy : o.dy;
          surf.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
          i++;
        }
        if (i < n) return setTimeout(fire, 3);
        const tLast = performance.now();
        performance.mark('probe-end-events');
        setTimeout(() => {
          alive = false; performance.mark('probe-end');
          if (po) po.disconnect();
          resolve({ ts, t0, tLast, tEnd: performance.now(), commits: P.commits, renders: P.renders, longtasks: lt, commitStart: P.commitStart, commitEnd: P.commitEnd });
        }, o.settle);
      };
      fire();
    });
  },
};`

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const FIGURE = `@mode: figure
polygon: A(0,0), B(4,0), C(4,4), D(0,4)
M = (2, 2)
O = circle M, 2
fill: square ABCD minus circle O name: R
label: area R
given: area R = 16 − 4π`

interface Scenario {
  name: string
  style: 'clean' | 'ink' | 'marker' | 'chalk'
  paper?: string
  flags?: Record<string, unknown>
  // Page JS run after the figure is up (CSS injections and the like).
  setup?: string
}

const hide = (layer: string) => `__p.style('.figure-view-surface svg [data-layer="${layer}"]{display:none !important}')`

function specFor(s: Scenario): string {
  const head = [s.style === 'clean' ? '' : `@style: ${s.style}`, s.paper ? `@style-paper: ${s.paper}` : ''].filter(Boolean).join('\n')
  return `${head}${head ? '\n' : ''}${FIGURE}`
}

function buildScenarios(layers: string[]): Scenario[] {
  const out: Scenario[] = []
  // The matrix.
  for (const style of ['clean', 'ink', 'marker', 'chalk'] as const) {
    out.push({ name: `${style} / no paper`, style })
    out.push({ name: `${style} / rough-graph`, style, paper: 'rough-graph' })
  }
  // Layers hidden one at a time, under ink on rough graph paper.
  for (const layer of layers) out.push({ name: `ink+rough / hide ${layer}`, style: 'ink', paper: 'rough-graph', setup: hide(layer) })
  out.push({ name: 'ink+rough / strip filters', style: 'ink', paper: 'rough-graph', setup: '__p.stripFilters()' })
  // Machinery suspects, on ink with no paper (a styled figure at its plainest) and on clean.
  for (const [style, paper] of [['ink', undefined], ['ink', 'rough-graph'], ['clean', undefined]] as const) {
    const tag = `${style}${paper ? '+rough' : ''}`
    const base = { style, paper } as const
    out.push({ ...base, name: `${tag} / no commits during burst`, flags: { noCommit: true } })
    out.push({ ...base, name: `${tag} / no live transform (onApply every frame)`, flags: { noLive: true } })
    out.push({ ...base, name: `${tag} / overscan 0`, flags: { overscan: 0 } })
    out.push({ ...base, name: `${tag} / overscan 0.1`, flags: { overscan: 0.1 } })
    out.push({ ...base, name: `${tag} / no will-change`, flags: { noWillChange: true } })
    out.push({ ...base, name: `${tag} / no label/dot compensation`, flags: { noCompensate: true } })
  }
  out.push({ name: 'clean / vector-effect off', style: 'clean', setup: `__p.style('.figure-view-surface svg *{vector-effect:none !important}')` })
  return out
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

let SIZE = [1400, 900]
let DPR = 1
const BURST = { events: 60, span: 1500, dy: 46, settle: 700 }

interface RunResult {
  name: string
  info: any
  whole: FrameSummary
  burst: FrameSummary
  commits: number
  renders: number
  longtasks: number
  longestTask: number
  // Mean synchronous JS time of one commit (ms), and how many frames over 14 ms had a commit in them.
  commitJsMs: number
  slowFrames: number
  slowWithCommit: number
}

async function load(cdp: Cdp, s: Scenario, initId: { id?: string }): Promise<any> {
  if (initId.id) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initId.id })
  initId.id = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT(s.flags ?? {}) })).identifier
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` })
  const deadline = Date.now() + 40000
  while (Date.now() < deadline) {
    if (await cdp.eval(`!!document.querySelector('textarea.app-textarea') && typeof window.__probe === 'object'`).catch(() => false)) break
    await sleep(200)
  }
  await cdp.eval(PAGE_LIB)
  await cdp.eval(`__p.setSpec(${JSON.stringify(specFor(s))})`)
  for (let i = 0; i < 60; i++) {
    await sleep(250)
    const info = await cdp.eval('__p.info()')
    if (info && (s.style === 'clean' || info.style)) break
  }
  await sleep(500)
  if (s.setup) await cdp.eval(s.setup)
  await sleep(300)
  return cdp.eval('__p.info()')
}

async function measure(cdp: Cdp, s: Scenario, runs: number, initId: { id?: string }): Promise<RunResult> {
  try {
    return await measureOnce(cdp, s, runs, initId)
  } catch (e) {
    if (!/navigated or closed|Illegal invocation|cdp timeout/.test((e as Error).message)) throw e
    await sleep(3000)
    return measureOnce(cdp, s, runs, initId)
  }
}

async function measureOnce(cdp: Cdp, s: Scenario, runs: number, initId: { id?: string }): Promise<RunResult> {
  const info = await load(cdp, s, initId)
  await cdp.eval(`__p.burst(${JSON.stringify(BURST)})`) // warm-up
  await sleep(500)
  const wholeD: number[] = []
  const burstD: number[] = []
  let commits = 0
  let renders = 0
  let longtasks = 0
  let longest = 0
  const jsMs: number[] = []
  let slow = 0
  let slowCommit = 0
  for (let r = 0; r < runs; r++) {
    const b = await cdp.eval(`__p.burst(${JSON.stringify(BURST)})`, 90000)
    const whole = (b.ts as number[]).filter((t) => t >= b.t0 && t <= b.tEnd)
    const during = (b.ts as number[]).filter((t) => t >= b.t0 && t <= b.tLast + 350)
    wholeD.push(...frameDeltas(whole))
    burstD.push(...frameDeltas(during))
    commits += b.commits
    const starts: number[] = b.commitStart
    const ends: number[] = b.commitEnd
    starts.forEach((t, i) => ends[i] !== undefined && jsMs.push(ends[i] - t))
    const frames = (b.ts as number[]).filter((t) => t >= b.t0 && t <= b.tEnd)
    for (let i = 1; i < frames.length; i++) {
      if (frames[i] - frames[i - 1] <= 14) continue
      slow++
      // A commit ran in the main-thread task that ended this frame's start (between the two timestamps).
      if (starts.some((t) => t >= frames[i - 1] - 1 && t <= frames[i] + 1)) slowCommit++
    }
    renders += b.renders
    longtasks += b.longtasks.length
    for (const [, d] of b.longtasks) longest = Math.max(longest, d)
    await sleep(400)
  }
  return { name: s.name, info, whole: summariseDeltas(wholeD), burst: summariseDeltas(burstD), commits: commits / runs, renders: renders / runs, longtasks: longtasks / runs, longestTask: longest, commitJsMs: jsMs.length ? jsMs.reduce((a, b) => a + b, 0) / jsMs.length : 0, slowFrames: slow, slowWithCommit: slowCommit }
}

// A traced burst: where the time goes, per thread and event name.
async function traced(cdp: Cdp, s: Scenario, initId: { id?: string }): Promise<string> {
  await load(cdp, s, initId)
  await cdp.eval(`__p.burst(${JSON.stringify(BURST)})`)
  await sleep(500)
  const events: TraceEvent[] = []
  cdp.on('Tracing.dataCollected', (p) => events.push(...p.value))
  const complete = new Promise<void>((res) => cdp.on('Tracing.tracingComplete', () => res()))
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,cc,gpu,viz,blink.user_timing,benchmark', transferMode: 'ReportEvents' })
  await cdp.eval(`__p.burst(${JSON.stringify(BURST)})`, 90000)
  await cdp.send('Tracing.end')
  await Promise.race([complete, sleep(30000)])
  const start = events.find((e) => e.name === 'probe-start')?.ts ?? 0
  const end = events.find((e) => e.name === 'probe-end')?.ts ?? Infinity
  const threadName = new Map<string, string>()
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threadName.set(`${e.pid}:${e.tid}`, String(e.args?.name))
  const groups = new Map<string, TraceEvent[]>()
  for (const e of events) {
    const n = threadName.get(`${e.pid}:${e.tid}`) ?? 'other'
    const g = /CrRendererMain/.test(n) ? 'renderer main' : /TileWorker|Raster/i.test(n) ? 'raster workers' : /Compositor/.test(n) && !/Viz/.test(n) ? 'compositor' : /Gpu|Viz/.test(n) ? 'gpu/viz' : null
    if (g) (groups.get(g) ?? groups.set(g, []).get(g)!).push(e)
  }
  const seconds = (end - start) / 1e6
  const lines = [`### ${s.name} (burst window ${seconds.toFixed(2)} s)`]
  for (const [g, evs] of groups) {
    const sums = [...sumByName(evs, start, end)].sort((a, b) => b[1].ms - a[1].ms).slice(0, 9)
    lines.push(`- ${g}: ` + sums.map(([n, v]) => `${n} ${v.ms.toFixed(0)} ms x${v.count}`).join('; '))
  }
  const draws = (groups.get('compositor') ?? []).concat(groups.get('gpu/viz') ?? []).filter((e) => e.name === 'DrawFrame' && e.ts >= start && e.ts <= end).length
  const mainFrames = (groups.get('renderer main') ?? []).filter((e) => e.name === 'BeginMainThreadFrame' && e.ts >= start && e.ts <= end).length
  const rasterTasks = (groups.get('raster workers') ?? []).filter((e) => e.name === 'RasterTask' && e.ts >= start && e.ts <= end)
  lines.push(`- compositor DrawFrame ${draws} (${(draws / seconds).toFixed(0)}/s); main BeginMainThreadFrame ${mainFrames} (${(mainFrames / seconds).toFixed(0)}/s); RasterTask ${rasterTasks.length}, ${rasterTasks.reduce((a, e) => a + (e.dur ?? 0) / 1000, 0).toFixed(0)} ms total`)
  return lines.join('\n')
}


async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => a !== '--')
  const flag = (n: string) => argv.indexOf(n)
  const arg = (n: string) => (flag(n) >= 0 ? argv[flag(n) + 1] : undefined)
  const only = arg('--only')?.split(',').map((x) => x.trim().toLowerCase())
  const runs = Number(arg('--runs') ?? 2)
  const doTrace = flag('--trace') >= 0
  const out = arg('--out')
  if (arg('--size')) SIZE = arg('--size')!.split('x').map(Number)
  if (arg('--dpr')) DPR = Number(arg('--dpr'))

  const server = await startServer()
  const gpu = arg('--gpu') === 'sw' ? 'sw' : 'hw'
  const { proc, cdp } = await launchEdge(gpu)
  const hardStop = setTimeout(() => {
    console.error('probe: overall timeout')
    process.exit(2)
  }, 40 * 60 * 1000)
  try {
    await cdp.send('Page.enable')
    try {
      const si = await cdp.send('SystemInfo.getInfo')
      console.log(`gpu mode ${gpu}:`, JSON.stringify(si.gpu?.featureStatus ?? {}), si.gpu?.devices?.[0]?.deviceString)
    } catch (e) {
      console.log('no SystemInfo', (e as Error).message)
    }
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: SIZE[0], height: SIZE[1], deviceScaleFactor: DPR, mobile: false })
    const initId: { id?: string } = {}
    const first = await load(cdp, { name: 'discover', style: 'ink', paper: 'rough-graph' }, initId)
    const layers = Object.keys(first?.layers ?? {})
    console.log('layers:', layers.join(', '))
    let scenarios = buildScenarios(layers)
    if (flag('--list') >= 0) return void scenarios.forEach((s) => console.log(s.name))
    if (only) scenarios = scenarios.filter((s) => only.some((o) => s.name.toLowerCase().includes(o)))
    const results: RunResult[] = []
    const traces: string[] = []
    for (const s of scenarios) {
      try {
        if (doTrace) traces.push(await traced(cdp, s, initId))
        else results.push(await measure(cdp, s, runs, initId))
        if (!doTrace) {
          const r = results[results.length - 1]
          console.log(`| ${r.name} | ${fmt(r.whole.p50)} | ${fmt(r.whole.p95)} | ${fmt(r.whole.max)} | ${r.whole.over10} | ${r.whole.over20} | ${r.whole.over50} | ${fmt(r.burst.p95)} | ${fmt(r.whole.fps)} | ${r.commits} | ${r.renders} | ${fmt(r.commitJsMs)} | ${r.slowFrames}/${r.slowWithCommit} |`)
        } else console.log(traces[traces.length - 1])
      } catch (e) {
        console.log(`| ${s.name} | FAILED: ${(e as Error).message}`)
      }
    }
    if (out) {
      mkdirSync(dirname(resolve(out)), { recursive: true })
      writeFileSync(out, JSON.stringify({ results, traces }, null, 2))
    }
    if (flag('--info') >= 0) for (const r of results) console.log(r.name, JSON.stringify(r.info))
  } finally {
    clearTimeout(hardStop)
    await cdp.send('Browser.close').catch(() => undefined)
    cdp.close()
    await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(5000)])
    await server.close()
  }
}

{
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(e)
      process.exit(1)
    },
  )
}

// The handling trace: how smooth is a 2D view under real input, measured where
// it shows (the GPU's own buffer swaps), on this machine's real GPU.
//
//   node graph-engine/scripts/handling-trace.mjs <label> <url> [setup.js]
//
// It launches its OWN Brave (a fresh temporary profile, real GPU, its own
// window) with remote debugging, loads <url> (a review-harness page, e.g. the
// style lab on :5181), optionally evaluates a setup script in the page, then
// drives input over CDP while tracing, and prints a summary.
//
// Scenarios (environment):
//   (default)          a drag: 300 mouse moves in a loop around the centre
//   PATH_MODE=long     a long side-to-side drag with four short pauses
//   STEP=<ms>          the gap between drag moves (default 8; 4 is ~ a 250 Hz mouse)
//   ZOOM=<n>           n wheel notches in (at the shaded corner) before the drag
//   ZPATH=1            instead of a drag: zoom in 45 notches and out 45, twice
//   WHEEL=1            after the drag, 240 wheel events in and out
//   SHOTS=1            screenshots mid-drag (shot-<label>-<i>.jpg in the cwd)
//   STOPAT=<i>         release the drag at move i, wait, screenshot (rest-<label>.jpg)
//   SETUPSHOT=1        a screenshot right after the setup script (setup-<label>.png)
//   EXTRA="<flags>"    more browser flags (e.g. --disable-gpu)
//
// What to read: `active` is the frame gaps while input is arriving (p50 at a
// 144 Hz display is ~6.9 ms); `stalls` are gaps over 25 ms with input waiting;
// `gpuLong` are GPU-thread tasks over 8 ms [ms since start, duration]. The
// main thread's frame clock (rAF) and the compositor's DrawAndSwap do NOT
// show a GPU stall: only the swaps do. Event Timing does not report
// pointermove. A hidden or occluded tab draws no frames at all, which is why
// this runs its own window rather than measuring a tab Ben has open.
//
// Kill only this script's own browser (it does, by its PID tree, on exit and
// on a 90 s timeout). Never `taskkill /IM`.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [label, url, setupFile] = process.argv.slice(2)
if (!label || !url) {
  console.error('usage: node handling-trace.mjs <label> <url> [setup.js]')
  process.exit(1)
}
const BRAVE = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe'
const PORT = 9300 + Math.floor(Math.random() * 90)
const profile = mkdtempSync(join(tmpdir(), 'drag-trace-'))
const proc = spawn(BRAVE, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--window-position=0,0', '--window-size=1920,1040', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--force-device-scale-factor=1', ...(process.env.EXTRA?process.env.EXTRA.split(' '):[]), 'about:blank',
], { stdio: 'ignore' })
const killAll = () => { try { spawn('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore' }) } catch {} }
const hard = setTimeout(() => { console.error('timeout'); killAll(); process.exit(2) }, 90000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let targets
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.find((t) => t.type === 'page')) break } catch {}
  await sleep(200)
}
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
const traceChunks = []
let traceDone
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  else if (msg.method === 'Tracing.dataCollected') traceChunks.push(...msg.params.value)
  else if (msg.method === 'Tracing.tracingComplete') traceDone()
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value

await send('Page.enable')
await send('Page.navigate', { url })
await sleep(4000)
if (setupFile) console.log('setup:', await evaluate(readFileSync(setupFile, 'utf8')))
if (process.env.SETUPSHOT) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(process.cwd(), `setup-${label}.png`), Buffer.from(r.result.data, 'base64')) }
const rect = await evaluate(`(()=>{const r=document.querySelector('.figure-view-surface').getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height}})()`)
const info = await evaluate(`JSON.stringify({dpr:devicePixelRatio, w:innerWidth, layers:[...document.querySelectorAll('svg[data-figure-layer]')].map(s=>s.getAttribute('data-figure-layer')+':'+s.querySelectorAll('*').length)})`)
console.log(label, info)

await send('Tracing.start', {
  categories: 'blink.user_timing,input,latencyInfo,devtools.timeline,disable-by-default-devtools.timeline,disable-by-default-devtools.timeline.frame,cc,gpu,viz,benchmark,blink,disable-by-default-cc.debug.scheduler.frames',
  transferMode: 'ReportEvents',
})
console.log('before', await evaluate(`[...document.querySelectorAll('svg[data-figure-layer]')].map(s=>s.getAttribute('viewBox')).join(' | ')`))
await evaluate(`window.__et=[];new PerformanceObserver(l=>l.getEntries().forEach(e=>__et.push([e.name,e.duration,e.processingStart-e.startTime,e.processingEnd-e.processingStart]))).observe({type:'event',durationThreshold:16});1`)
await sleep(300)
const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2
const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 })
if (process.env.ZOOM) {
  for (let i = 0; i < Number(process.env.ZOOM); i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rect.x + rect.w * 0.33, y: rect.y + rect.h * 0.22, deltaX: 0, deltaY: -100 }); await sleep(30) }
  await sleep(1500)
}
const shots = []
const t0 = Date.now()
if (process.env.ZPATH) {
  const hx = rect.x + rect.w * 0.33, hy = rect.y + rect.h * 0.22
  for (let rep = 0; rep < 2; rep++) {
    for (const dir of [-1, 1]) {
      for (let i = 0; i < 45; i++) {
        send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: hx, y: hy, deltaX: 0, deltaY: dir * 100 })
        await sleep(16)
      }
      await sleep(700)
    }
  }
} else {
await mouse('mousePressed', cx, cy, 1)
const N = 300
const LONG = process.env.PATH_MODE === 'long'
for (let i = 1; i <= (Number(process.env.STOPAT) || N); i++) {
  const a = (i / N) * Math.PI * 2
  const x = LONG ? cx + 650 * Math.sin(2 * a) : cx + 300 * Math.sin(a)
  const y = LONG ? cy + 120 * Math.sin(a) : cy + 150 * Math.sin(2 * a)
  mouse('mouseMoved', x, y, 1)
  await sleep(LONG && i % 75 === 0 ? 160 : Number(process.env.STEP ?? 8))
  if (process.env.SHOTS && i % 25 === 12) { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 60 }); shots.push(r.result.data) }
}
await mouse('mouseReleased', cx, cy, 0)
}
if (process.env.WHEEL) {
  for (let i = 0; i < 240; i++) {
    const d = (Math.floor(i / 40) % 2 === 0 ? -1 : 1) * 60
    send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx + 200 * Math.sin(i / 20), y: cy, deltaX: 0, deltaY: d })
    send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + 200 * Math.sin(i / 20), y: cy, buttons: 0 })
    await sleep(8)
  }
}
if (process.env.STOPAT) { await sleep(2500); const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }); writeFileSync(join(process.cwd(), `rest-${label}.jpg`), Buffer.from(r.result.data, 'base64')) }
const dragMs = Date.now() - t0
await sleep(400)
const et = await evaluate('JSON.stringify(__et)')
const commits = (()=>{const a=JSON.parse(et).filter(e=>e[0]==='pointermove').map(e=>e[1]).sort((x,y)=>x-y);return {movesOver16:a.length,p50:a[a.length>>1],p90:a[Math.floor(a.length*.9)],max:a[a.length-1]}})()
const vb = `[...document.querySelectorAll('svg[data-figure-layer]')].map(s=>s.getAttribute('viewBox')+' T'+s.style.transform).join(' | ')`
console.log('mid-release', await evaluate(vb))
await sleep(1200)
const done = new Promise((r) => (traceDone = r))
await send('Tracing.end')
await done
ws.close()
killAll()
clearTimeout(hard)
setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }) } catch {} }, 1500)

// ---- analysis
const ev = traceChunks
const threads = new Map()
for (const e of ev) if (e.ph === 'M' && e.name === 'thread_name') threads.set(`${e.pid}:${e.tid}`, e.args.name)
// window: from first to last DispatchMouseEvent / EventDispatch
const disp = ev.filter((e) => e.name === 'EventDispatch' && (e.args?.data?.type?.startsWith('mouse') || e.args?.data?.type === 'wheel'))
const start = Math.min(...disp.map((e) => e.ts)), end = Math.max(...disp.map((e) => e.ts + (e.dur ?? 0)))
const inWin = (e) => e.ts >= start && e.ts <= end + 300000
const sums = new Map()
for (const e of ev) {
  if (e.ph !== 'X' || !inWin(e) || !e.dur) continue
  const k = `${threads.get(`${e.pid}:${e.tid}`) ?? e.tid} | ${e.name}`
  const s = sums.get(k) ?? { n: 0, ms: 0, max: 0 }
  s.n++; s.ms += e.dur / 1000; s.max = Math.max(s.max, e.dur / 1000)
  sums.set(k, s)
}
const top = [...sums].sort((a, b) => b[1].ms - a[1].ms).slice(0, 22)
// presented frames: viz Display::DrawAndSwap timestamps
const swaps = ev.filter((e) => e.name === 'SkiaOutputSurfaceImplOnGpu::SwapBuffers' && inWin(e)).map((e) => e.ts + (e.dur ?? 0)).sort((a, b) => a - b)
const uniq = swaps.filter((t, i) => i === 0 || t - swaps[i - 1] > 1000)
const gaps = uniq.slice(1).map((t, i) => (t - uniq[i]) / 1000).sort((a, b) => a - b)
const q = (p) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))].toFixed(1) : 'n/a')
// pipeline reporter states
const states = {}
for (const e of ev) if (e.name === 'PipelineReporter' && e.ph === 'b' && inWin(e)) { const s = e.args?.chrome_frame_reporter?.state ?? 'unknown'; states[s] = (states[s] ?? 0) + 1 }
const lat = new Map()
for (const e of ev) {
  if (e.name !== 'EventLatency') continue
  const k = e.id2?.local ?? e.id ?? e.id2?.global
  const r = lat.get(k) ?? {}
  if (e.ph === 'b') { r.b = e.ts; r.type = e.args?.event_latency?.event_type ?? e.args?.data?.type }
  if (e.ph === 'e') r.e = e.ts
  lat.set(k, r)
}
const byType = {}
for (const r of lat.values()) if (r.b && r.e) (byType[r.type] ??= []).push((r.e - r.b) / 1000)
const latency = Object.fromEntries(Object.entries(byType).map(([t, a]) => { a.sort((x, y) => x - y); return [t, { n: a.length, p50: a[a.length >> 1].toFixed(1), p90: a[Math.floor(a.length * 0.9)].toFixed(1), max: a[a.length - 1].toFixed(1) }] }))
const tilesPainted = ev.filter((e) => e.cat === 'blink.user_timing' && e.name.startsWith('view2d tile') && e.ph === 'b' && inWin(e)).length
const tileDur = []
{ const open = new Map(); for (const e of ev) if (e.cat === 'blink.user_timing' && e.name.startsWith('view2d tile')) { const k = e.name + (e.id ?? e.id2?.local); if (e.ph === 'b') open.set(k, e.ts); else if (e.ph === 'e' && open.has(k)) tileDur.push([Math.round((e.ts - open.get(k)) / 1000), e.name.includes('moving') ? 'M' : 'R', Math.round((open.get(k) - start) / 1000), e.name.replace('view2d tile ', '')]) } }
const longMain = ev.filter((e) => e.ph === 'X' && inWin(e) && e.dur > 12000 && (threads.get(`${e.pid}:${e.tid}`) ?? '') === 'CrRendererMain' && /^(RunTask|ThreadControllerImpl::RunTask)$/.test(e.name)).map((e) => Math.round(e.dur / 1000))
const longNames = {}
for (const e of ev) if (e.ph === 'X' && inWin(e) && e.dur > 8000 && (threads.get(`${e.pid}:${e.tid}`) ?? '') === 'CrRendererMain') { const k = e.name; longNames[k] = (longNames[k] ?? 0) + 1 }
const gpuLong = ev.filter((e) => e.ph === 'X' && inWin(e) && e.dur > 8000 && (threads.get(`${e.pid}:${e.tid}`) ?? '') === 'CrGpuMain' && e.name === 'Scheduler::RunTask').map((e) => [Math.round((e.ts - start) / 1000), Math.round(e.dur / 1000)])
const moveTs = disp.filter((e) => e.args.data.type === 'mousemove' || e.args.data.type === 'wheel').map((e) => e.ts).sort((a, b) => a - b)
const stalls = []
for (let i = 1; i < uniq.length; i++) {
  const a = uniq[i - 1], b = uniq[i]
  if (b - a < 25000) continue
  const inputs = moveTs.filter((t) => t > a && t < b - 8000).length
  if (inputs >= 2) stalls.push([Math.round((a - start) / 1000), Math.round((b - a) / 1000), inputs])
}
const activeGaps = []
for (let i = 1; i < uniq.length; i++) { const a = uniq[i - 1], b = uniq[i]; if (moveTs.some((t) => t > a - 30000 && t < b)) activeGaps.push((b - a) / 1000) }
activeGaps.sort((x, y) => x - y)
const aq = (p) => activeGaps.length ? activeGaps[Math.min(activeGaps.length - 1, Math.floor(p * activeGaps.length))].toFixed(1) : 'n/a'
const active = { n: activeGaps.length, p50: aq(0.5), p90: aq(0.9), p99: aq(0.99), over12: activeGaps.filter((g) => g > 12).length }
const summary = { active, stalls, gpuLong, tilesPainted, tileDur, longMain, longNames, latency,
  label, dragMs, commits, windowMs: Math.round((end - start) / 1000),
  presented: uniq.length, frameGap: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: q(1) }, over50ms: gaps.filter((g) => g > 50).length,
  pipeline: states,
  raster: [...sums].filter(([k])=>/Raster|TileWorker|ImageDecode|GpuRaster|Skia|Filter/i.test(k)).sort((a,b)=>b[1].ms-a[1].ms).slice(0,10).map(([k, s]) => `${s.ms.toFixed(0).padStart(6)} ms  n=${String(s.n).padStart(5)}  max=${s.max.toFixed(1).padStart(6)}  ${k}`),
  top: top.map(([k, s]) => `${s.ms.toFixed(0).padStart(6)} ms  n=${String(s.n).padStart(5)}  max=${s.max.toFixed(1).padStart(6)}  ${k}`),
}
console.log(JSON.stringify(summary, null, 1))
writeFileSync(join(process.cwd(), `trace-${label}.json`), JSON.stringify(summary, null, 1))
shots.forEach((d, i) => writeFileSync(join(process.cwd(), `shot-${label}-${i}.jpg`), Buffer.from(d, 'base64')))
process.exit(0)

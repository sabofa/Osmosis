import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Chrome motion is tokenised: every duration lives in motion.css (the
// definition block); Ribbon.css and ViewerControls.css only reference the
// custom properties, and animate only transform / opacity / colours / outline.
const raw = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')
const css = (f: string) => raw(f).replace(/\/\*[\s\S]*?\*\//g, '')
const FILES = ['./ribbon/Ribbon.css', './ViewerControls.css']
const ALLOWED_PROPS = new Set(['transform', 'opacity', 'color', 'background-color', 'border-color', 'outline-color'])
const decls = (src: string, prop: RegExp) => [...src.matchAll(new RegExp(String.raw`(?:^|[;{\s])(${prop.source})\s*:\s*([^;}]+)`, 'g'))].map((m) => [m[1], m[2].trim()] as const)

describe.each(FILES)('%s motion', (f) => {
  const src = css(f)
  it('has no raw time literal anywhere (durations and delays come from --m-* / --de-motion-*)', () => {
    expect(src).not.toMatch(/(?<![\w-])-?\d*\.?\d+m?s\b/)
  })
  it('every transition and animation names a --m-* duration and the --de-ease curve (or a token list)', () => {
    const all = [...decls(src, /transition/), ...decls(src, /animation/)]
    expect(all.length).toBeGreaterThan(0)
    for (const [prop, v] of all) {
      expect(v, `${prop}: ${v}`).toMatch(/var\(--(?:m-(?:fast|med|out)|r-t-ui)\)/)
      expect(v.replace(/var\([^)]*\)/g, ''), `${prop}: ${v}`).not.toMatch(/\b(?:ease|ease-in|ease-out|ease-in-out|linear)\b/)
    }
  })
  it('transitions only paint-cheap properties (no layout)', () => {
    for (const [, v] of decls(src, /transition/)) {
      if (/^var\(--r-t-ui\)$/.test(v)) continue
      for (const part of v.split(/,(?![^(]*\))/)) {
        const name = part.trim().split(/\s+/)[0]
        expect(ALLOWED_PROPS.has(name), part).toBe(true)
      }
    }
  })
  it('does not use will-change', () => {
    expect(src).not.toMatch(/will-change/)
  })
})

describe('motion.css (the definition block)', () => {
  const src = css('./motion.css')
  it('defines the host-tunable properties with defaults', () => {
    for (const v of ['--de-motion-scale: 1', '--de-motion-fast: 120ms', '--de-motion-med: 200ms', '--de-ease: cubic-bezier']) expect(src).toContain(v)
  })
  it('multiplies every effective duration by --de-motion-scale', () => {
    for (const n of ['fast', 'med', 'out', 'stagger']) expect(src).toMatch(new RegExp(String.raw`--m-${n}: calc\(var\(--de-motion-${n}\) \* var\(--de-motion-scale\)\)`))
  })
  it('reduced motion caps durations at 60ms and zeroes stagger and distances', () => {
    const rm = src.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}\n/)?.[0] ?? ''
    expect(rm).toMatch(/min\(var\(--de-motion-fast\), 60ms\)/)
    for (const z of ['--m-stagger: 0ms', '--m-rise: 0px', '--m-slide: 0px', '--m-lift: 0px', '--m-press: 1']) expect(rm).toContain(z)
  })
  it('keyframes animate only opacity and transform', () => {
    for (const kf of src.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\n\}/g)) {
      const props = [...kf[1].matchAll(/([\w-]+)\s*:/g)].map((m) => m[1])
      for (const p of props) expect(['opacity', 'transform']).toContain(p)
    }
  })
})

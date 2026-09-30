// Gate fix C1: the on-figure display cap (DISPLAY_DIGITS) must never show a
// digit the true value, anywhere within its stated error, contradicts.
//
// The bug: approxText/approxTupleText used to call chosenDisplay(a)
// UNCAPPED, then round its already-rounded result a SECOND time, to fewer
// digits (Math.min(DISPLAY_DIGITS, d.digits)) — never re-checking S5's own
// half-unit rule (honestAt) at that coarser unit. Rounding an
// already-rounded number again is not the same as rounding the raw value
// there, and can carry a digit the truth contradicts. A seeded 200,000-value
// sweep (the gate reviewer's own cap-probe.ts) found 1,452 contradictions in
// 148,231 capped values that differed from the full text.
//
// The fix: chosenDisplay itself takes a `maxDigits` cap and never searches
// finer than it — the coarsening search (already re-rounding the RAW value
// at each unit it tries) simply starts, and stays, within the cap. A capped
// result is honestAt its own unit exactly like an uncapped one, because it
// is found by the same search.
//
// This file is a smaller, permanent, deterministic version of the same
// probe (a few thousand values instead of 200,000), plus the hand-worked
// pins. Reverting the fix (restoring the old Math.min(DISPLAY_DIGITS,
// d.digits) truncation, or dropping chosenDisplay's maxDigits parameter)
// fails every test below immediately, with concrete counterexamples.

import { describe, expect, it } from 'vitest'
import { approx, lastDigitUnit } from './testing'
import { approxText, approxTextFull, approxTupleText, type Approx } from './common'

// Parses "≈ 25.133" or "≈ 1.235×10⁵" back into a value and how many
// significant digits were printed — reading the text the way a viewer
// does, never the internal { value, digits } chosenDisplay returns.
function parseApprox(text: string): { v: number; digits: number } {
  let t = text.replace('≈ ', '').replace(/−/g, '-')
  let exp = 0
  const sci = /^(.*)×10([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/.exec(t)
  if (sci) {
    const sup = '⁰¹²³⁴⁵⁶⁷⁸⁹'
    const s = sci[2]
    exp = Number((s.startsWith('⁻') ? '-' : '') + [...s.replace('⁻', '')].map((c) => sup.indexOf(c)).join(''))
    t = sci[1]
  }
  const v = Number(t) * 10 ** exp
  const sig = t.replace('-', '').replace('.', '').replace(/^0+/, '')
  return { v, digits: Math.max(1, sig.length) }
}

// S5's own rule (common.ts's honestAt), checked from the outside on the
// printed text: the gap between the shown number and the raw value, plus
// SAFETY times the stated error, must fit within half the unit the shown
// digit count implies.
function ruleHolds(text: string, a: Approx): boolean {
  const p = parseApprox(text)
  const lead = Math.floor(Math.log10(Math.abs(p.v)))
  const unitExp = lead - p.digits + 1
  const safety = a.mesh ? 1 : 100
  const gap = Math.abs(p.v - a.value)
  return gap + safety * a.error <= 10 ** unitExp / 2 * (1 + 1e-12)
}

// Whether the shown text contradicts the truth: the whole interval the raw
// (unscaled) error allows, [value − error, value + error], rounds — at the
// unit the shown digit count implies — to one single multiple of that
// unit, and that multiple is not the one printed. (When the raw interval
// straddles more than one multiple, the shown digit is merely uncertain,
// never contradicted — not counted here.)
function contradicts(text: string, a: Approx): boolean {
  const p = parseApprox(text)
  const lead = Math.floor(Math.log10(Math.abs(p.v)))
  const unitExp = lead - p.digits + 1
  const unit = 10 ** unitExp
  const lo = Math.round((a.value - a.error) / unit)
  const hi = Math.round((a.value + a.error) / unit)
  const shownN = Math.round(p.v / unit)
  return lo === hi && lo !== shownN
}

describe('gate fix C1: the display cap never shows a contradicted digit', () => {
  // Hand-worked: 25.13274995 ± 1e-8, quadrature (SAFETY = 100).
  // chosenDisplay's own (uncapped) unit is 1e-5, "≈ 25.13275" — honest.
  // Capped at DISPLAY_DIGITS = 6 digits, unit 1e-4 gives "25.1327":
  // |25.1327 − 25.13274995| + 1e-6 = 4.995e-5 + 1e-6 = 5.095e-5 > 5e-5 —
  // NOT honest at 6 digits either, so the search must walk one unit
  // coarser still, to 1e-3 (5 digits): "25.133", where
  // 2.5005e-4 + 1e-6 ≤ 5e-4 holds.
  it('25.13274995 ± 1e-8 (quadrature) prints "≈ 25.133", never "≈ 25.1328" (the old double-rounded, dishonest text)', () => {
    const a: Approx = { value: 25.13274995, error: 1e-8, scale: 25 }
    expect(approxText(a)).toBe('≈ 25.133')
    expect(ruleHolds(approxText(a), a)).toBe(true)
  })

  // The same value as a bounded mesh sum (SAFETY = 1): the far smaller
  // scaled error supports two more digits, honest already at 1e-4 (6
  // digits): 4.995e-5 + 1e-8 ≤ 5e-5.
  it('the same value as a mesh sum prints "≈ 25.1327"', () => {
    const a: Approx = { value: 25.13274995, error: 1e-8, scale: 25, mesh: true }
    expect(approxText(a)).toBe('≈ 25.1327')
    expect(ruleHolds(approxText(a), a)).toBe(true)
  })

  // Hand-worked: 0.12345649999 ± 1e-10, mesh. 6 digits (unit 1e-6,
  // "0.123456") fails by a hair: 4.9999e-7 + 1e-10 > 5e-7. 5 digits (unit
  // 1e-5, "0.12346") holds: 3.50001e-6 + 1e-10 ≤ 5e-6.
  it('0.12345649999 ± 1e-10 (mesh) prints "≈ 0.12346"', () => {
    const a: Approx = { value: 0.12345649999, error: 1e-10, scale: 1, mesh: true }
    expect(approxText(a)).toBe('≈ 0.12346')
    expect(ruleHolds(approxText(a), a)).toBe(true)
  })

  it('a tuple (a centroid coordinate) follows the same per-coordinate rule: "≈ (25.133)"', () => {
    expect(approxTupleText([{ value: 25.13274995, error: 1e-8, scale: 25 }])).toBe('≈ (25.133)')
  })

  it('a seeded sweep of a few thousand values: every capped text holds the half-unit rule, and the truth anywhere in [raw − err·SAFETY, raw + err·SAFETY] never contradicts a shown digit', () => {
    let seed = 12345
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    let checked = 0
    const ruleFailures: string[] = []
    const contradictions: string[] = []
    for (let i = 0; i < 5000; i++) {
      const value = (rnd() * 9 + 1) * 10 ** Math.floor(rnd() * 6 - 2)
      const relErr = 10 ** -(7 + rnd() * 6)
      const mesh = rnd() < 0.5
      const a: Approx = { value, error: value * relErr, scale: value, mesh }
      const cap = approxText(a)
      const full = approxTextFull(a)
      if (cap === full) continue // the cap never kicked in for this value
      checked++
      if (!ruleHolds(cap, a)) ruleFailures.push(`${a.value} ± ${a.error}${mesh ? ' mesh' : ''} -> "${cap}" (full "${full}")`)
      if (contradicts(cap, a)) contradictions.push(`${a.value} ± ${a.error}${mesh ? ' mesh' : ''} -> "${cap}" (full "${full}")`)
    }
    // The cap needs to have actually kicked in a good number of times for
    // this sweep to mean anything (it did, on ~74% of the reviewer's own
    // 200,000-value run).
    expect(checked).toBeGreaterThan(1000)
    expect(ruleFailures).toEqual([])
    expect(contradictions).toEqual([])
  })

  // Gate fix I1: this is exactly why refusals.test.ts's `read` helper now
  // checks the capped `.text` as well as the full text — a C1-style
  // regression can corrupt the capped text alone while the full text
  // (chosenDisplay's own uncapped search) stays honest, so a check that
  // only ever reads full text can never see it.
  it('a capped text can be dishonest while the full text stays honest — why a checker must read both', () => {
    const a: Approx = { value: 25.13274995, error: 1e-8, scale: 25 }
    const full = approxTextFull(a) // "≈ 25.13275" — unaffected by the cap
    const cap = approxText(a) // "≈ 25.133" today; "≈ 25.1328" under the bug
    const readsLike = (text: string) => `dA ${text}`
    // Both readings, in the shape refusals.test.ts's `read` helper checks
    // them (a name-tagged "dA ≈ ..." string parsed by approx/lastDigitUnit
    // from testing.ts), must independently satisfy the half-unit rule.
    for (const text of [readsLike(cap), readsLike(full)]) {
      expect(Math.abs(approx(text, 'dA') - a.value)).toBeLessThanOrEqual(lastDigitUnit(text, 'dA'))
    }
  })
})

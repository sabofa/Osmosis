// Codepoint <-> UTF-16 offset conversion. The engine exposes codepoint
// indices; JS strings index by UTF-16 code units (they differ for surrogate
// pairs such as emoji). Lone surrogates count as one codepoint each.
//
// Clamping: out-of-range or non-finite-low inputs clamp to [0, end of text].

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff

// Number of codepoints in `text`.
export function cpLength(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    if (isHigh(text.charCodeAt(i)) && i + 1 < text.length && isLow(text.charCodeAt(i + 1))) i++
    n++
  }
  return n
}

// UTF-16 index of codepoint index `cp`. cp < 0 -> 0; cp >= cpLength -> text.length.
export function cpToUtf16(text: string, cp: number): number {
  if (cp <= 0) return 0
  let i = 0
  let n = 0
  while (i < text.length && n < cp) {
    i += isHigh(text.charCodeAt(i)) && i + 1 < text.length && isLow(text.charCodeAt(i + 1)) ? 2 : 1
    n++
  }
  return i
}

// Codepoint index of UTF-16 index `i`. i < 0 -> 0; i > text.length -> cpLength.
// An index inside a surrogate pair maps to that pair's codepoint index.
export function utf16ToCp(text: string, i: number): number {
  if (i <= 0) return 0
  if (i >= text.length) return cpLength(text)
  let end = i
  if (isLow(text.charCodeAt(end)) && isHigh(text.charCodeAt(end - 1))) end -= 1
  return cpLength(text.slice(0, end))
}

// Substring by codepoint range [startCp, endCp). Clamped; empty if end <= start.
export function sliceCp(text: string, startCp: number, endCp: number): string {
  const s = cpToUtf16(text, startCp)
  const e = cpToUtf16(text, endCp)
  return e > s ? text.slice(s, e) : ''
}

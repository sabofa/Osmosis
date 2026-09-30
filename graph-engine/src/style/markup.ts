// A few lines of SVG writing for the style module's own markup — textures and
// papers, which are SVG filters and patterns by nature.
//
// Kept here rather than borrowed from the figure renderer so that style/
// imports nothing from figure/ (the graphing engine may adopt it). Numbers
// are written the same way the figure's own formatter writes them: three
// decimals, trailing zeros dropped, no negative zero — so a styled figure is
// as byte-stable as a clean one.

export function num(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Cannot write ${n} into SVG markup`)
  let s = n.toFixed(3)
  if (s.includes('.')) s = s.replace(/\.?0+$/, '')
  return s === '-0' || s === '' ? '0' : s
}

export type Attributes = Record<string, string | number | null | undefined>

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function tag(name: string, attributes: Attributes, children: readonly string[] | null = null): string {
  let out = `<${name}`
  for (const key of Object.keys(attributes)) {
    const value = attributes[key]
    if (value === null || value === undefined) continue
    out += ` ${key}="${typeof value === 'number' ? num(value) : escape(value)}"`
  }
  return children === null ? `${out}/>` : `${out}>${children.join('')}</${name}>`
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

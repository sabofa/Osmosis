import type { Rect } from './types'

// An <svg> document re-rooted to show `window` at `width` × `height` CSS
// pixels: the root keeps its own attributes (namespace, data-style, …) but its
// viewBox, size and fitting are replaced, so as an image it paints exactly that
// window, stretched to exactly that size. `style` (CSS) is put first inside it:
// an image is not reached by the page's stylesheets. Null if `svg` does not
// start with a root it can read.
export function svgWindow(svg: string, window: Rect, width: number, height: number, style = ''): string | null {
  const open = /^<svg\b[^>]*>/.exec(svg)
  if (!open) return null
  const n = (v: number): string => String(Number(v.toPrecision(12)))
  const attrs = open[0]
    .slice(4, -1)
    .replace(/\s(viewBox|width|height|preserveAspectRatio)="[^"]*"/g, '')
    .replace(/\/$/, '')
  const root =
    `<svg${attrs} width="${n(width)}" height="${n(height)}"` +
    ` viewBox="${n(window.x)} ${n(window.y)} ${n(window.width)} ${n(window.height)}" preserveAspectRatio="none">`
  return root + (style ? `<style>${style}</style>` : '') + svg.slice(open[0].length)
}

// A figure drawn as stacked layers.
//
// The renderer writes ONE <svg> whose body is a set of `<g data-layer="...">`
// groups (paper, grid, regions, auxiliary, primary, marks, points, labels).
// The view splits it into a few svgs laid one over another, each handled on
// its own terms (see FigureView):
// - paper, grid and content are painted into tiles (view2d/dom/svgTiles.ts),
//   each its own plane, so a host can fade the paper and the grid apart from
//   the drawing (the workspace's graph-paper and graph-grid alphas);
// - live (points and labels) stays a live svg over the tiles, given the
//   window on every frame: it keeps its size on the screen.
// The markup the renderer writes does not change.
//
// To add a layer, add an entry to FIGURE_LAYER_SPECS: its `groups` are the
// renderer's `data-layer` names it takes, and where it sits in the list is where
// it sits in the stack (first is at the bottom). A group no entry names goes to
// the last layer.

export interface LayerSpec {
  name: string
  // The renderer's `data-layer` names this layer draws.
  groups: readonly string[]
}

export const FIGURE_LAYER_SPECS: readonly LayerSpec[] = [
  { name: 'paper', groups: ['paper'] },
  { name: 'grid', groups: ['grid'] },
  { name: 'content', groups: ['regions', 'auxiliary', 'primary', 'marks'] },
  { name: 'live', groups: ['points', 'labels'] },
]

export interface FigureLayerSvg {
  name: string
  svg: string
  spec: LayerSpec
}

// The top-level elements of `body`, each as its markup and its tag name. Tags
// are told apart by a plain scan: the renderer escapes `<` and `>` in text and
// attribute values, so a tag's end is the next `>`.
function topLevel(body: string): { tag: string; markup: string }[] {
  const out: { tag: string; markup: string }[] = []
  const tags = /<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g
  let depth = 0
  let start = -1
  let name = ''
  for (let m = tags.exec(body); m !== null; m = tags.exec(body)) {
    const closing = m[1] === '/'
    const selfClosing = m[3] === '/'
    if (!closing && depth === 0) {
      start = m.index
      name = m[2]
    }
    if (!closing && !selfClosing) depth++
    else if (closing) depth--
    if (depth === 0 && start >= 0) {
      out.push({ tag: name, markup: body.slice(start, m.index + m[0].length) })
      start = -1
    }
  }
  return out
}

const layerOf = (markup: string): string | null => /^<[^>]*\sdata-layer="([^"]*)"/.exec(markup)?.[1] ?? null

// The renderer's svg, split into one svg per layer that has anything in it, in
// stacking order (bottom first). Every layer carries the root's attributes and
// a copy of the defs, plus `data-figure-layer`. Markup that is not an svg it can
// read comes back whole, as the last layer.
export function splitFigureSvg(svg: string, specs: readonly LayerSpec[] = FIGURE_LAYER_SPECS): FigureLayerSvg[] {
  const last = specs[specs.length - 1]
  const open = /^<svg\b[^>]*>/.exec(svg)
  if (!open || !svg.endsWith('</svg>')) return [{ name: last.name, svg, spec: last }]
  const body = svg.slice(open[0].length, svg.length - '</svg>'.length)
  const nodes = topLevel(body)
  const defs = nodes
    .filter((n) => n.tag === 'defs')
    .map((n) => n.markup)
    .join('')
  const rest = nodes.filter((n) => n.tag !== 'defs')
  const taken = new Map<LayerSpec, string[]>(specs.map((s) => [s, []]))
  for (const node of rest) {
    const group = layerOf(node.markup)
    const spec = (group !== null && specs.find((s) => s.groups.includes(group))) || last
    taken.get(spec)!.push(node.markup)
  }
  const root = open[0].slice(0, -1)
  return specs
    .filter((s) => taken.get(s)!.length > 0)
    .map((spec) => ({ name: spec.name, spec, svg: `${root} data-figure-layer="${spec.name}">${defs}${taken.get(spec)!.join('')}</svg>` }))
}

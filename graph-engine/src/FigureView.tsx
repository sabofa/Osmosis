import type { GraphConfig } from './parser/config'
import './FigureView.css'

export interface FigureViewProps {
  // A complete <svg> document, as produced by figure/render.ts's
  // renderFigure. Passed as markup rather than as React elements because the
  // renderer's contract is *bytes* — byte-identical output across runs is
  // what makes a figure cacheable and diffable — and rebuilding that string
  // into a React tree would put a second, untested serialiser between the
  // renderer and the screen.
  svg: string
  theme: GraphConfig['theme']
}

// The figure view: paper, not a graph with things drawn on it.
//
// Static by design (E6). No pan, no zoom, no hover, no camera — interaction
// arrives with the tutor layer and will hang off the data-statement /
// data-object attributes every element already carries (E4), rather than off
// a viewer-level gesture model built now and thrown away later.
export default function FigureView({ svg, theme }: FigureViewProps) {
  // The markup is produced entirely by this package's own emitter, which
  // escapes every label and attribute value it writes (see figure/svg.ts's
  // svgEscape) — spec text never reaches the DOM unescaped.
  return <div className={`figure-view figure-view-${theme}`} dangerouslySetInnerHTML={{ __html: svg }} />
}

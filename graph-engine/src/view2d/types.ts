// The plain shapes the 2D handling model passes around.
//
// Three coordinate spaces meet in this directory and mixing them up is the
// classic bug, so each shape says which space it is in. A `Rect` or `Vec` is
// in *content* units (the engine's own: drawing coordinates, a table's pixel
// box, a flowchart's layout units) unless a function says otherwise; a `Size`
// and anything called `...Px` is in *screen* pixels, origin top-left. Content
// y points down, as in SVG, so the two spaces never flip against each other.

export interface Vec {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// Screen pixels.
export interface Size {
  width: number
  height: number
}

// Where the view is looking. `cx, cy` is the content point at the middle of
// the screen; `zoom` is relative to the fitted view, so 1 always means "the
// whole content frame fits" whatever the engine's units or the screen's size.
export interface Camera {
  cx: number
  cy: number
  zoom: number
}

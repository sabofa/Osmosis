// The Paint Lab's figures (spec 2026-10-02-painted-figures-design.md §6): real
// space specs, written in the space grammar that exists today, so the painter
// is tuned on exactly what the space engine builds. Each carries its own
// authored camera (@camera), so double-click returns to a view that frames it.
//
// A statement named `table` is a support surface: the lab's local-colour
// override leaves it alone, so a recoloured sphere still sits on a table.
// Hex colours are written without the "#" (which starts a comment in the grammar).
// `@frame: none` is the honest header for a painted figure: the ground is
// primed canvas, and the box is never drawn.
//
// paintLabFigures.test.ts (graph-engine/src/space/paint/lab) parses and builds
// every one and checks the closed-form geometry each promises.

export interface PaintFigure {
  id: string
  label: string
  // What a painter should look at, in one line (shown over the view).
  caption: string
  spec: string
}

export const PAINT_FIGURES: readonly PaintFigure[] = [
  {
    id: 'sphere',
    label: 'Sphere on a table',
    caption: 'Light, half-tone, core, reflected light and a cast shadow, on the simplest form there is.',
    spec: `@frame: none
@bounds3d: x [-2.5, 2.5], y [-2.5, 2.5], z [0, 2.2]
@aspect: equal
@camera: azimuth 32, elevation 24, zoom 1.6
z = 0 for x in [-2.5, 2.5], y in [-2.5, 2.5] res: 12 color: a39c88 name: table
(sin(v) cos(u), sin(v) sin(u), 1 + cos(v)) for v in [0, pi], u in [0, 2*pi] color: b7603a name: sphere`,
  },
  {
    id: 'saddle',
    label: 'Saddle, z = x² − y²',
    caption: 'A surface that turns two ways at once: form-turning strokes must follow both.',
    spec: `@frame: none
@bounds3d: x [-1.5, 1.5], y [-1.5, 1.5], z [-2.3, 2.3]
@camera: azimuth 38, elevation 28, zoom 1.65
z = x^2 - y^2 for x in [-1.5, 1.5], y in [-1.5, 1.5] res: 72 color: 6f8f7e name: saddle`,
  },
  {
    id: 'saddle-height',
    label: 'Saddle, coloured by height',
    caption: 'A colormapped surface: hue keeps a third of its swing, value is held, and the data stays readable.',
    spec: `@frame: none
@bounds3d: x [-1.5, 1.5], y [-1.5, 1.5], z [-2.3, 2.3]
@camera: azimuth 38, elevation 28, zoom 1.65
z = x^2 - y^2 for x in [-1.5, 1.5], y in [-1.5, 1.5] res: 72 colormap: height name: saddle`,
  },
  {
    id: 'torus',
    label: 'Torus',
    caption: 'Strokes go around the tube; the hole gives a real core shadow and a cast one.',
    spec: `@frame: none
@bounds3d: x [-3, 3], y [-3, 3], z [-1, 1]
@aspect: equal
@camera: azimuth 35, elevation 38, zoom 2.0
((2 + 0.8 cos(v)) cos(u), (2 + 0.8 cos(v)) sin(u), 0.8 sin(v)) for u in [0, 2*pi], v in [0, 2*pi] res: 96 color: b5533c name: torus`,
  },
  {
    id: 'ridges',
    label: 'Ridges and valleys',
    caption: 'z = 0.2 sin(5.4x) cos(5.4y): many small planes, many gradients, not one.',
    spec: `@frame: none
@bounds3d: x [-1.2, 1.2], y [-1.2, 1.2]
@camera: azimuth 30, elevation 32, zoom 1.45
z = 0.2 sin(5.4 x) cos(5.4 y) for x in [-1.2, 1.2], y in [-1.2, 1.2] res: 120 color: c9a56a name: ridges`,
  },
  {
    id: 'tangent-plane',
    label: 'Tangent plane at P',
    caption: 'A hill with a tangent plane, its x and y slices and the normal at P. The data marks stay exact and found.',
    spec: `@frame: none
@bounds3d: x [-2.5, 2.5], y [-2.5, 2.5], z [-0.5, 2.5]
@camera: azimuth 28, elevation 30, zoom 1.6
f(x, y) = 1.6*exp(-(x^2 + y^2)/1.5) + 0.3*x
z = f(x, y) for x in [-2.5, 2.5], y in [-2.5, 2.5] res: 80 color: 8d9a6a name: hill
P = (0.8, 0.5, f(0.8, 0.5))
tangent-plane: f at (0.8, 0.5) normal
trace: f at x = 0.8 tangent at y = 0.5
trace: f at y = 0.5 tangent at x = 0.8`,
  },
  {
    id: 'level-curves',
    label: 'Level curves on the floor',
    caption: 'Two hills as a veil, with their level curves traced on the surface and projected onto the floor.',
    spec: `@frame: none
@bounds3d: x [-2.5, 2.5], y [-2.5, 2.5], z [0, 1.5]
@camera: azimuth 30, elevation 34, zoom 1.3
f(x, y) = exp(-((x - 1)^2 + y^2)) + 0.7*exp(-((x + 1)^2 + (y + 0.6)^2)/0.8)
z = f(x, y) for x in [-2.5, 2.5], y in [-2.5, 2.5] res: 80 opacity: 0.55 color: 9a7fa6 name: hills
contour: f levels 10 floor`,
  },
  {
    id: 'helix-sheet',
    label: 'Helix through a translucent sheet',
    caption: 'What is behind a veil is painted first and tinted by it; the helix itself stays crisp.',
    spec: `@frame: none
@bounds3d: x [-1.6, 1.6], y [-1.6, 1.6], z [-2, 2]
@aspect: equal
@camera: azimuth 35, elevation 22, zoom 1.9
z = 0.25*x for x in [-1.6, 1.6], y in [-1.6, 1.6] res: 24 opacity: 0.4 color: 4f86a8 name: sheet
(0.9 cos(t), 0.9 sin(t), t/4) for t in [-8, 8] width: 3 color: 7a2b1a name: helix`,
  },
  {
    id: 'plane-hill',
    label: 'Plane cutting a hill',
    caption: 'A slanted plane through a hill, with the exact curve where they meet drawn on top.',
    spec: `@frame: none
@bounds3d: x [-2.5, 2.5], y [-2.5, 2.5], z [0, 2]
@camera: azimuth 52, elevation 26, zoom 1.4
z = 1.5*exp(-(x^2 + y^2)/1.2) for x in [-2.5, 2.5], y in [-2.5, 2.5] res: 80 color: 8d9a6a name: hill
plane: x + y = 0.5 opacity: 0.3 color: c9703a name: plane
(t, 0.5 - t, 1.5*exp(-(t^2 + (0.5 - t)^2)/1.2)) for t in [-2, 2] width: 3 color: 7a2b1a name: intersection`,
  },
]

export function figureById(id: string | null | undefined): PaintFigure | undefined {
  return PAINT_FIGURES.find((f) => f.id === id)
}

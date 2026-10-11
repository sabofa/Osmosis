# 2D Handling: Moving Around, Pointing and Focus — Design

*2026-10-04. The figure styles design's part 2 ("movement"), redefined by Ben: one handling model for every 2D view in the graph engine. It is built for the geometry figures first (flat and solid, which are both SVG) and is reusable by the flowchart and table engines. Written by the geometry track. Approved in outline by Ben on 2026-10-04 ("yes go ahead, write the spec").*

## What Ben asked for

- **The 3D engine's feel, for 2D.** "Double click to reset position, you can zoom out or zoom more than you can for the geometry engine, actual smoothing while moving around and any other improvements." The 3D engine is a reference for how a reset feels, not for its handling; 3D handling is improved separately, later.
- **One reusable model.** "This will be also used for the flowchart engine (2D) and table engine (2D) so make it highly adaptable."
- **Pointing and focus, with focus by coordinates.** Hover and click on things, yes. But focus means a coordinate and a zoom level, not "go to point A". A tool lets the tutor find those coordinates.
- **No accidental text selection.** Moving around a figure today selects the givens table, point labels and any other text. That stops.
- **Later, not now:** the 2D graphing engine (plots) gets a custom version of this model, built a little differently and with much more control for the tutor.

## Today

`figure/viewport.ts` holds pure pan and zoom arithmetic over the SVG viewBox:
- zoom runs 0.5× to 12× of the fitted view, about the cursor;
- the wheel sensitivity is 0.0015.

`FigureView.tsx` wires one-pointer drag, the wheel and a "Reset view" button. Labels and point dots keep their on-screen size by rescaling their written sizes.

It has none of the following:
- smoothing, coasting, double-click reset, pinch or a keyboard;
- hover, selection or focus;
- protection against text selection.

None of it is reusable by another view. React's wheel listener is passive, so `preventDefault` there is unreliable.

## The rules that don't bend

1. **The renderer stays pure.** `renderFigure` output is byte-identical to today; the clean golden and every figure test stand. Navigation changes the window onto the drawing, never the drawing. New information the handling needs (the author frame, the hit items) travels in `renderFigure`'s return value, never in the SVG string.
2. **The core is pure and testable.** Every decision lives in DOM-free TypeScript that node tests reach, with a fake clock. Components only plumb events.
3. **Exact where it matters.** A zoom keeps the content point under the cursor (or between the fingers) fixed. A drag tracks the cursor exactly. Smoothing changes *when* the view arrives, never *where*.
4. **No text selection, ever.** Dragging, double-clicking or long-pressing inside a handled view never selects or highlights text.
5. **Reduced motion is honoured.** With `prefers-reduced-motion: reduce`, moves are instant and nothing coasts.
6. **Readable at any zoom.** Labels and point dots keep their on-screen size, as now.

## The model

### Content, camera and limits

A **content frame** is the rectangle the engine's content occupies, in the engine's own units. That is the figure's drawing coordinates, a table's pixel box or a flowchart's layout units. The **fitted view** shows it whole.

The **camera** is `{ centre: { x, y }, zoom }`, with zoom relative to the fitted view (1 = fitted). It converts between content and screen coordinates in both directions.

**Limits** are a policy object that each engine may override:

| Limit | Default | Was |
|---|---|---|
| Zoom out | 0.1× | 0.5× |
| Zoom in | 64× | 12× |
| Pan | at least 15% of the content frame stays on screen in each axis | none |

A move that would break a limit is clamped smoothly. The view eases to the bound and does not bounce.

### Motion

The view has a **current** camera and a **target** camera. Input moves the target; each animation frame moves the current camera toward it.

- **Smoothing:** exponential approach, with time constant **τ = 70 ms** for wheel and keyboard zoom and pan. The view arrives within about 0.3 s and never overshoots.
- **Drag:** exact, so the current camera equals the target while the pointer is down.
- **Coasting:** on release, the drag's velocity over the last 80 ms carries on and decays with **τ = 300 ms**. It stops below 5 px/s or at a limit. A release after holding still for 80 ms or more does not coast.
- **Animated moves** (reset and focus) ease out cubically over **280 ms**, matching the 3D engine's double-click reset. A new input interrupts them.

All of these are constants in one file (`view2d/feel.ts`), named and commented, so they can be tuned and other engines can read them.

### Input

`view2d/input.ts` turns raw events into intents:

| Gesture | Intent |
|---|---|
| Drag (mouse, pen or one finger) | Pan; coasts on release |
| Wheel or trackpad scroll | Zoom about the cursor (sensitivity 0.0015 per wheel unit, smoothed) |
| Trackpad pinch (ctrl + wheel) or two fingers | Zoom about the fingers' midpoint; two fingers also pan |
| **Double-click or double-tap** | **Reset** to the start view, animated (see Focus) |
| A press that moves less than 4 px | A click, not a drag |
| `+` / `−` | Zoom in or out about the centre, ×1.25, smoothed |
| Arrow keys | Pan by 10% of the visible width or height |
| `0` | Reset |
| `Esc` | Clear the selection |

- **Keys work only when the view has keyboard focus.** It is tab-focusable and clicking it gives it focus, so it never takes the page's keys.
- **The wheel is a native non-passive listener,** so the page doesn't scroll while you zoom a figure.

### No text selection

The handled view's surface gets `user-select: none` (and `-webkit-user-select`) and `-webkit-touch-callout: none`. A pointer-down inside it calls `preventDefault`, which blocks text selection and native drag. Focus is given to the view explicitly. A double-click therefore resets the view and never selects a word.

This lives in the shared adapter, so tables and flowcharts get it free. Selected text in a figure has no use; copying coordinates is the coordinate tool's job (below).

### Pointing

Each engine supplies **items**: things that can be pointed at, each with an id and a hit shape in content coordinates. The shapes are point, segment, polyline, circle or arc, and polygon.

`view2d/pointing.ts` hit-tests them with a **tolerance in screen pixels**: 8 px for a mouse and 16 px for touch, converted to content units at the current zoom. When several items are hit, the nearest wins, and a point beats a line that beats an area.

The core emits two events:
- **hover** (item or none), only for fine pointers, never during a drag;
- **select** (item or none), on a click: clicking empty space or pressing Esc clears it. It is single-select.

The engine decides what a hover or a selection looks like.

### Focus by coordinates

A **focus** is `{ at: { x, y }, zoom }` in the engine's **author coordinates**:
- a 2D figure's `(x, y)` as written in the spec;
- a table's `(row, column)` cell centre;
- a flowchart's layout units.

Each engine supplies a mapping from author coordinates to content coordinates.

Focus reaches a view in three ways:
- **`@focus: (3, 2) zoom 4`** in a spec sets the starting view. The zoom is relative to the fitted view, and it defaults to 1 if omitted. A bad `@focus` is refused with a message, and the figure starts fitted.
- **A viewer prop,** `focus`, moves the view at any time, animated. This is how the app or the tutor directs attention while a figure is on screen.
- **Reset** (double-click or double-tap, `0`, or the reset button) returns to the **start view**: the spec's `@focus` view when it set one, otherwise the fitted view. A reset while already at the start view fits the whole content, so two double-clicks always get you everything.

### The coordinate tool

The tool helps the tutor find a focus by looking. It is a small toggle in the view's corner (and the `C` key) that opens a readout showing three things:
- the cursor's position, in author coordinates;
- the view's centre and zoom;
- a **Copy** button that puts the matching `@focus:` line on the clipboard.

It is on in the review harness. In the app it is behind a viewer prop (`coordinates`) that the tutor's surfaces turn on.

## Geometry figures: the first adapter

**Content frame:** the figure's drawing coordinates, which come from the fitted viewBox the renderer already writes. **Applier:** the SVG viewBox, as now, plus the existing label and dot size compensation.

**Author coordinates.** `renderFigure` returns a `frame` beside `svg` and `errors`:
- **flat figures:** the similarity transform from author `(x, y)` to drawing coordinates (scale, y-flip and offset);
- **solid figures:** the projection from author `(X, Y, Z)` (z-up) to drawing coordinates, through the figure's camera.

`@focus` on a solid figure takes `(X, Y, Z)` and focuses on its projection. The readout cannot invert a projection, so on a solid figure:
- the cursor line shows the author coordinates of the hovered point, vertex or other item, and only drawing coordinates when nothing is hovered;
- Copy writes the centre as the nearest point's `(X, Y, Z)` when one is within the tolerance, and otherwise as `@focus: view (u, v) zoom k`. `view` coordinates are the figure's own drawing units, which are stable for a fixed spec and camera.

**Items.** `renderFigure` also returns `items`: one per drawn object that has an identity (the existing `data-statement` and `data-object` identities). Each has its hit shape in drawing coordinates. Points are points; segments, lines and sides are segments; circles and arcs are circles and arcs; regions and faces are polygons; and the givens table is a rectangle. Hidden (dashed) edges are items too.

**Hover and selection look.** Hover thickens the item's stroke or ring a little and brings its own label to full strength. Selection draws a soft accent halo behind the item and its label. Both are applied as classes on the existing elements (matched by `data-object` and `data-statement`), never by changing the markup. They work in every style.

**Selecting several (added 2026-10-07).** A plain click selects one item and replaces any earlier selection; shift + click toggles an item in or out of the selection; a click on empty space or Esc clears it. The selection is an ordered set (`PointerSelection`), and every selected item gets the halo. Hover still outlines only the one item under the pointer.

**Reporting.** FigureView takes `onSelect(ids)`, where `ids` is the array of every selected item's id in the order added (empty when nothing is selected), and GraphViewer passes it through. The tutor can react to "the student clicked side AB", or to a set of them.

## Moving a heavy drawing (added 2026-10-07)

Rewriting the SVG `viewBox` re-rasterises everything in it, and a figure with chalk texture, paper noise or a scribble is dear to rasterise, so redrawing on every frame lagged. While the view is moving (a drag, a zoom, a coast, an eased move), the figure is therefore **not redrawn**: the already-drawn SVG is slid and scaled with a CSS transform (the compositor does it) and the real `viewBox` is **committed** now and then. The arithmetic is `view2d/liveTransform.ts` (`liveTransform`, `commitDue`, `growRect`); `useView2d` takes `onLive(transform)` beside `onApply`, plus `overscan`.

- The committed drawing covers the screen grown by `OVERSCAN` (30%) on every side, so a pan has drawing to reveal instead of blank paper.
- **Commit rule.** The view is committed (a) when it has been still for `SETTLE_MS` (100 ms), which makes it sharp; (b) when the live view has drifted past `COMMIT_DRIFT` (×2 in or out) from the committed one, or has left the overscanned window, though never more often than every `COMMIT_THROTTLE_MS` (250 ms); and (c) when the screen is resized, or on the first draw.
- **Highlights are cheap.** Only the outermost matching element gets `figure-hovered` or `figure-selected`, and the filter region is the visible window plus a small margin, resized at commit only (`figure/highlight.ts`).
- At a commit, labels, dots and halos snap to their right size for the new view.
- Reduced motion keeps its meaning (no smoothing, no coasting) but, as built, commits on every frame; a drag then has the old lag (open, H5).

The feel constants live in `view2d/feel.ts`: `COAST_TAU` 150 ms and `COAST_STOP` 20 px/s (tuned 2026-10-07 to be less slippery), and `OVERSCAN`, `SETTLE_MS`, `COMMIT_DRIFT`, `COMMIT_THROTTLE_MS` above.

**Toolbar.**
- The reset button stays, shown when the view is not at the start view.
- The coordinate toggle appears when `coordinates` is on.

## Built for later, not built now

| View | Content frame | Applier | Items | Author coordinates |
|---|---|---|---|---|
| Tables (`TableView`, HTML) | the table's own pixel box | CSS transform on the table | cells, by DOM hit test | `(row, column)` |
| Flowcharts (not real yet) | layout units | SVG viewBox or canvas | nodes and edges | layout units |
| 2D graphing engine (plots) | the plotted window | its own, in the WebGL renderer | curves, points, features | world `(x, y)` |

The 2D graphing engine gets a **custom variant** of this model later: the same core and feel, but its camera changes the plotted window rather than magnifying a drawing, and it gives the tutor much more control. The core's interfaces (limits policy, items, author mapping, focus) are shaped so that variant extends them rather than forking them.

## Architecture

```
graph-engine/src/view2d/            (pure, DOM-free; node-tested)
  camera.ts     Camera, content <-> screen, fitted view
  limits.ts     LimitsPolicy (zoom range, pan margin), smooth clamping
  feel.ts       every tuning constant, named and commented
  motion.ts     current -> target smoothing, coasting, eased moves (fake-clock steppable)
  input.ts      gesture recogniser: events -> intents (drag, click, double-click, wheel, pinch, keys)
  pointing.ts   items, hit shapes, tolerance, hover/select state
  focus.ts      Focus, the @focus grammar and formatting, author mapping interface
  index.ts
graph-engine/src/view2d/dom/        (browser adapters)
  useView2d.ts  React hook: native listeners (non-passive wheel), pointer capture, rAF loop, no-select
  appliers.ts   svgViewBox (figures), cssTransform (tables), canvasTransform (later)
  CoordinateTool.tsx  the readout and Copy
figure/viewport.ts      shrinks to the figure-specific parts (parseViewBox, label size compensation)
figure/render.ts        returns { svg, errors, frame, items }; the SVG is unchanged
FigureView.tsx          uses useView2d with the figure adapter; hover/select classes; onSelect
parser/parseConfig.ts   @focus
GraphViewer.tsx         passes focus, coordinates and onSelect through
```

`view2d/` has no imports from `figure/`. A figure is one client of it.

## Testing

**The core (node, fake clock):**
- **camera:** content and screen round-trips at random cameras;
- **zoom:** the point under the cursor or between the fingers stays fixed to 1e-9 through a wheel step, a pinch and a smoothed zoom at every frame;
- **limits:** zoom clamps at 0.1× and 64×; at least 15% of the frame stays visible after an extreme pan;
- **smoothing:** it arrives within tolerance by about 0.3 s and never overshoots;
- **coasting:** it decays and stops, and doesn't coast after a hold;
- **eased moves:** they last 280 ms, and input interrupts them;
- **reduced motion:** moves are instant and nothing coasts;
- **gestures:** a 3 px move is a click, a 5 px move is a drag; a double-click resets; Esc clears; keys need focus;
- **pointing:** tolerance scales with zoom; a point beats a line beats an area; there's no hover during a drag;
- **focus:** `@focus` parses (2D, 3D and `view` forms), refuses bad input with a message, and formats back to the same line; the author mapping round-trips.

**Figures:**
- `renderFigure`'s SVG is byte-identical to today: the clean golden and the figure suite stand;
- `frame` maps a spec's points onto where they are drawn, flat and solid;
- `items` cover every identified object, and their shapes contain the drawn geometry;
- `@focus` on a flat and a solid figure lands its point at the view's centre.

**By eye.** The feel is judged by Ben in the review harness. Static shots can't show motion, so the harness gets the coordinate tool turned on.

Any test that pins behaviour is shown to fail by deleting that behaviour.

## Out of scope

- The table, flowchart and plot adapters (designed for above, not built).
- 3D (space) handling.
- Dragging items and editing the figure by pointing. (Multi-select was out of scope here and was built on 2026-10-07.)
- Persisting a reader's view between visits.

# Style settings guide

Every look setting of Osmosis graphs has a path in one registry (`paint.*`, `style.*`, `media.*`, `board.*`). This guide says what each path means, its range and default, and how much it moves the picture. The tables are in the engine pages below; this page says how to use them.

## The six-layer stack

A setting's value is resolved through six layers, in this order. A later layer wins:

1. defaults (the registry)
2. type (the graph type's own defaults)
3. theme.all (the theme, for every graph type)
4. theme.byType (the theme, for this graph type)
5. document
6. figure

The theme's per-type layer wins over its all-types layer, and over the type's defaults.

## How to set a value

- Per figure: a line in the figure's spec, `@style-set: <path> <value>`. Colours are written without the `#`.

```
@style: pencil
@style-set: style.line.looseness 0.4
@style-set: media.graphite.hint 0.01
```

- Per document: the host's base style, an object `{ preset?, set? }` (the `set` map is path to value): `{ "preset": "pencil", "set": { "style.line.looseness": 0.4 } }`.
- Per graph type and per theme: the theme's style-set JSON, `all` for every type and `byType` for one type. A value outside its range is refused with the valid range, never clamped.

```json
{
  "all": { "set": { "style.line.looseness": 0.2 } },
  "byType": { "space": { "set": { "paint.value.terminatorSoftness": 0.4 } } }
}
```

## How to read a rating

The rating says how far the picture moves over the setting's whole range, measured against its default.

- none: below the lowest edge. subtle, moderate, strong: the edges, by what is measured. Colour is OKLab delta E: 0.005, 0.02, 0.06. Geometry is px: 0.1, 0.75, 2.5. Structure (stroke counts and edge shares) is a share: 0.02, 0.1, 0.3.
- active range: the smallest span of the swept values that holds 80% of the change. Outside it the setting does little.
- safe range: the active range widened by one swept step on each side. Staying inside it keeps the setting in the part of its range that works.
- saturates: the last two steps add under 5% of the change; pushing further does nothing.
- not drawn yet: the setting is registered but wired to nothing. Setting it changes nothing; don't rely on it.
- renderer only (not measured by the sweep): the sweep measures the per-frame painter model. These settings (stroke load, impasto, bristles, dryness, wetness, the canvas texture and weave, the underpaint, the shadow map, the drag-time particle density) are read only by the renderer's shader. They are real and visible in the painting, but have no measured numbers worth quoting.
- A remaining none means no change on the measured fixtures, for instance the `detect.*` thresholds, which the fixtures never cross. It does not prove the setting is dead on other scenes.

## Where the measurements come from

`sweep.json` holds every number; its `header.note` is the method. In short:

- paint: the per-frame painter only (never the bake), on one fixture (a sphere on a table) in several views. Each setting is swept over 9 values (or all of them, when there are fewer), and the frame is compared with the default frame. The rating is the strongest of colour, geometry, structure and edge change, taken over the stroke roles.
- figures: three example figures drawn under four looks (ink, pencil, marker, blackboard); a figure setting's rating is the largest over those looks.
- media: the colour each medium gives 13 theme roles, over 6 themes.
- backgrounds: statistics of the paper tile as the figure bakes it (mean colour shift and the change in lightness spread), averaged over 6 themes, plus the board colours derived from each theme's accent.
- `style.paper.tile` rates none on tile statistics on purpose: it only changes how often the tile repeats, not what it looks like.

## Engine pages

- [Paint](paint.md): 221 settings
- [Figures](figures.md): 21 settings
- [Media](media.md): 9 settings
- [Backgrounds](backgrounds.md): 9 settings

## Recipes

### Calmer brush fill

Goal: steadier painted brushwork: straighter strokes, evener edges and surface, less wandering.

```
@style-set: paint.roles.form.curvature 0.2
@style-set: paint.roles.glaze.curvature 0.05
@style-set: paint.edges.noise 0.04
@style-set: paint.value.deviation 0.005
```

- `paint.roles.form.curvature` (default 0.5): sweep: "subtle", active range 0 to 0.5.
- `paint.roles.glaze.curvature` (default 0.15): sweep: "subtle", active range 0.25 to 1. Below 0.25 the change is small.
- `paint.edges.noise` (default 0.12): sweep: "strong", active range 0 to 0.375. This evens out the found-and-lost edges.
- `paint.value.deviation` (default 0.018): sweep: "subtle", active range 0.025 to 0.1. It is already near its quietest, so it moves little.
- Skip `paint.roles.line.curvature` (and the edge, reflected and scumble roles' curvature): sweep: "none".

### Chalkier board

Goal: a blackboard with dustier, paler chalk and a more textured slate.

```
@style: blackboard
@style-set: style.line.grain 0.5
@style-set: style.paper.texture 0.6
@style-set: media.chalk.chroma 0.5
@style-set: board.blackboard.chromaCap 0.01
```

- `style.line.grain` (default 0): sweep: "moderate", active range 0 to 0.125. Chalk scatters loose dust specks with it.
- `style.paper.texture` (default 0): sweep: "moderate", active range 0 to 0.875. It is the slate grain and the haze of an erased board.
- `media.chalk.chroma` (default 0.6): sweep: "subtle", active range 0.5 to 0.675. Lower is paler, greyer chalk.
- `board.blackboard.chromaCap` (default 0.03): sweep: "moderate", active range 0 to 0.03. A lower cap keeps the slate neutral; above 0.03 nothing changes.

### More colour distortion

Goal: a more broken, varied colour: loosely juxtaposed hues in the painter, and a bolder palette in the 2D figures.

```
@style-set: paint.mix.strength 1.75
@style-set: paint.mix.hueMax 45
@style-set: paint.mix.chromaMax 2
@style-set: style.colour.saturation 1.3
@style-set: media.colouredPencil.chroma 1.05
```

- `paint.mix.strength` (default 1): sweep: "moderate", active range 0 to 1.75. The master strength of the distortion.
- `paint.mix.hueMax` (default 25): sweep: "moderate", active range 15 to 60.
- `paint.mix.chromaMax` (default 1.35): sweep: "subtle", active range 0.75 to 2.25.
- `style.colour.saturation` (default 1): sweep: "moderate", active range 0 to 0.9375. Above 1 it moves little, so it is a weak way to get more.
- `media.colouredPencil.chroma` (default 0.8): sweep: "moderate", active range 0 to 1.05. Only the coloured pencil medium reads it.

### Rougher pencil

Goal: a looser, drier, sketchier graphite line.

```
@style: pencil
@style-set: style.line.looseness 0.5
@style-set: style.line.wobble 0.4
@style-set: style.line.passes 3
@style-set: style.line.grain 0.5
```

- `style.line.looseness` (default 0): sweep: "strong", active range 0 to 0.875.
- `style.line.wobble` (default 0): sweep: "subtle", active range 0 to 0.875.
- `style.line.passes` (default 1): sweep: "subtle", active range 1 to 3. Only pencil reads it.
- `style.line.grain` (default 0): sweep: "moderate", active range 0 to 0.125. It saturates early, so past 0.125 more grain changes little.
- `media.graphite.grain` is sweep: "not-drawn-yet" (registered, wired to nothing): do not set it. The graphite medium has nothing else that roughens the line.

### Softer terminator

Goal: blur the edge between the light and the form shadow on a painted solid, so it grades instead of stepping.

```
@style-set: paint.value.terminatorSoftness 0.5
@style-set: paint.value.reflectedSoftness 0.6
@style-set: paint.value.coreWidth 0.1
```

- `paint.value.terminatorSoftness` (default 0.1): sweep: "strong", active range 0.125 to 0.875.
- `paint.value.reflectedSoftness` (default 0.35): sweep: "strong", active range 0 to 0.75.
- `paint.value.coreWidth` (default 0.2): sweep: "strong", active range 0 to 0.4. A narrower core lets the reflected light start sooner.
- Leave `paint.value.castContact` alone: sweep: "none".

As a theme's own look for space figures only (the theme style-set JSON, `byType`):

```json
{ "byType": { "space": { "set": { "paint.value.terminatorSoftness": 0.5 } } } }
```

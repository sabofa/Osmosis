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

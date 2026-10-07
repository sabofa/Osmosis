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

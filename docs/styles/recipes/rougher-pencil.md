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

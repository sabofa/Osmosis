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

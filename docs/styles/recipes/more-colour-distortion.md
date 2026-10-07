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

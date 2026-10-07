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

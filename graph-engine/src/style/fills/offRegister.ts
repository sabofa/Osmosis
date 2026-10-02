import type { Random } from '../random'
import type { Point } from '../tokens'

// OFF REGISTER — the seeded nudge flat and wash draw their tint by, above
// roughness 0: a hand-set plate never quite lining up with the printed
// line, the colour missing it on one side and running under it on the
// other (the pen clips the shifted area back to the region's exact
// outline, so nothing spills past that far side).

// A short step in a random direction, `random.range(1, 3)` drawing units
// long at roughness 1, scaled down with it. `undefined` at roughness 0, so
// a fill with no roughness draws exactly as before — no shift, no extra
// random draw.
export function offRegister(random: Random, roughness: number): Point | undefined {
  if (roughness <= 0) return undefined
  const length = random.range(1, 3) * roughness
  const angle = random.range(0, 2 * Math.PI)
  return { x: Math.cos(angle) * length, y: Math.sin(angle) * length }
}

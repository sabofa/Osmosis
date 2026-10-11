// The calculus of a surface's review examples (S4b), appended to
// SPACE_EXAMPLES. examples.test.ts builds every one through the space kernel
// and asserts it draws with no errors. Each draws its surface itself: the
// tools never draw it for you.

import type { Example } from '../examples'

export const SURFACE_TOOL_EXAMPLES: Example[] = [
  {
    label: 'Space · Level curves of a saddle', group: 'Space',
    spec: `@bounds3d: x [-2, 2], y [-2, 2]
f(x, y) = x^2 - y^2
z = f(x, y) opacity: 0.5
contour: f levels 9 floor labels         # -3..3 on the surface, and projected onto the floor`,
  },
  {
    label: 'Space · Limits along two paths', group: 'Space',
    spec: `@bounds3d: x [-1, 1], y [-1, 1], z [-1, 1]
f(x, y) = x*y/(x^2 + y^2)
z = f(x, y) opacity: 0.55 res: 120      # undefined at the origin: an honest hole
path: on f along (t, t) for t in [0, 1] toward (0, 0)    # heads to 1/2
path: on f along (t, 0) for t in [0, 1] toward (0, 0)    # heads to 0: no limit`,
  },
  {
    label: 'Space · Traces and partial derivatives', group: 'Space',
    spec: `@bounds3d: x [-2, 2], y [-2, 2], z [-4, 4]
f(x, y) = x^2 - y^2
z = f(x, y) opacity: 0.6
trace: f at x = 1 tangent at y = 1       # slope ∂f/∂y (1, 1) = -2
trace: f at y = -1 tangent at x = -1     # slope ∂f/∂x (-1, -1) = -2`,
  },
  {
    label: 'Space · A tangent plane you can drag', group: 'Space',
    spec: `@bounds3d: x [-2, 2], y [-2, 2], z [-4, 4]
@param a = 1 range [-2, 2] step 0.1
@param b = 0.5 range [-2, 2] step 0.1
f(x, y) = 4 - x^2 - y^2
z = f(x, y) opacity: 0.8
P = (a, b, f(a, b))                      # drag P, or the sliders: the plane follows
tangent-plane: f at (a, b) normal`,
  },
  {
    label: 'Space · The gradient and its level curve', group: 'Space',
    spec: `@bounds3d: x [-2, 2], y [-2, 2], z [-4, 4]
f(x, y) = x^2 - y^2
z = f(x, y) opacity: 0.55
gradient: f at (0.5, 0.25)               # on the floor, square to the level curve
gradient: f at (0.5, -1) lifted          # in the plane z = f(0.5, -1), on the surface`,
  },
  {
    label: 'Space · A directional derivative', group: 'Space',
    spec: `@bounds3d: x [-2, 2], y [-2, 2], z [-4, 4]
f(x, y) = x^2 - y^2
z = f(x, y) opacity: 0.55
directional: f at (1, 0.5) toward <3, 4>     # D_u f = 2(0.6) - 1(0.8) = 0.4`,
  },
  {
    label: 'Space · Critical points, classified', group: 'Space',
    spec: `@bounds3d: x [-2.5, 2.5], y [-2, 2]
f(x, y) = x^3 - 3x + y^2
z = f(x, y) opacity: 0.5
critical: f                              # a saddle at (-1, 0), a min at (1, 0)`,
  },
  {
    label: 'Space · Lagrange on the unit circle', group: 'Space',
    spec: `@bounds3d: x [-1.5, 1.5], y [-1.5, 1.5], z [-3, 3]
@camera: azimuth 230, elevation 30       # face the plane z = x + y
z = x + y opacity: 0.45
lagrange: extrema x + y subject to x^2 + y^2 = 1    # ∇f ∥ ∇g at ±(√2/2, √2/2)`,
  },
  {
    label: 'Space · Lagrange in three variables', group: 'Space',
    spec: `@bounds3d: x [-4, 4], y [-4, 4], z [-4, 4]
@camera: azimuth -20, elevation 15       # (1, 2, 2) near the limb, so ∇f and ∇g show their length
lagrange: max x + 2y + 2z subject to x^2 + y^2 + z^2 = 9     # (1, 2, 2), f = 9, λ = 1/2`,
  },
]

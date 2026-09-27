// Space's review-harness examples, one per capability, concatenated onto
// EXAMPLES by examples.ts. examples.test.ts builds every one through the
// space kernel and asserts it draws with no errors; space/examples.test.ts
// checks that each S3 example exercises what its label promises.

import type { Example } from '../examples'

export const SPACE_EXAMPLES: Example[] = [
  {
    label: 'Space · Paraboloid over a disk',
    spec: `z = 4 - x^2 - y^2 over x^2 + y^2 <= 4   # an inequality domain, clipped exactly`,
  },
  {
    label: 'Space · Saddle over a type I region',
    spec: `z = x^2 - y^2 over x in [-1, 1], y in [x^2 - 1, 1 - x^2]   # inner bounds read x`,
  },
  {
    label: 'Space · Polar domain',
    spec: `z = r^2 sin(2 theta) / 2 over r in [0, 2], theta in [0, 2*pi]   # r and theta in the body`,
  },
  {
    label: 'Space · A helix on a sphere, named r(t)',
    spec: `hx(t) = 2 cos(8t) sin(t)
hy(t) = 2 sin(8t) sin(t)
hz(t) = 2 cos(t)
r(t) = <hx(t), hy(t), hz(t)>        # a named vector function: |r(t)| = 2
(2 cos(u) sin(v), 2 sin(u) sin(v), 2 cos(v)) for u in [0, 2*pi], v in [0, pi] opacity: 0.5
(hx(t), hy(t), hz(t)) for t in [0, pi] width: 3`,
  },
  {
    label: 'Space · A parameter',
    spec: `@param a = 1 range [-2, 2] step 0.1
z = a*x^2 + y^2 for x in [-2, 2], y in [-2, 2]`,
  },
  {
    label: 'Space · Ticks in multiples of pi',
    spec: `@ticks3d: x pi/2, y pi/2
z = sin(x) cos(y) for x in [-2*pi, 2*pi], y in [-2*pi, 2*pi]`,
  },
  {
    label: 'Space · A diverging colormap',
    spec: `z = x^2 - y^2 for x in [-2, 2], y in [-2, 2] colormap: x*y diverging   # balance: blue below 0, red above; see the colorbar`,
  },
  {
    label: 'Space · Play a parameter',
    spec: `@param k = 1 range [0.5, 3]   # press ▶ beside k; ⟲ ping-pongs
z = sin(k x) cos(k y) for x in [-3, 3], y in [-3, 3]`,
  },
  {
    label: 'Space · Drag a point on a paraboloid',
    spec: `@param a = 0.8 range [-2, 2]
@param b = 0.6 range [-2, 2]
z = x^2 + y^2 for x in [-2, 2], y in [-2, 2] opacity: 0.6
P = (a, b, a^2 + b^2)   # drag P: it stays on the surface, and a and b follow`,
  },
  {
    label: 'Space · A helix through a translucent sphere',
    spec: `(sin(v) cos(u), sin(v) sin(u), cos(v)) for v in [0, pi], u in [0, 2*pi] opacity: 0.4
(0.6 cos(6t), 0.6 sin(6t), t) for t in [-1.6, 1.6] width: 3   # inside the sphere it reads through it`,
  },
  {
    label: 'Space · A helix behind a surface',
    spec: `z = x^2 - y^2 for x in [-1.5, 1.5], y in [-1.5, 1.5]
(1.2 cos(t), 1.2 sin(t), t/3) for t in [-6, 6] width: 3   # faint and dashed where the saddle hides it`,
  },
  {
    label: 'Space · A pole cut by the box',
    spec: `z = 1/(x^2 + y^2) for x in [-2, 2], y in [-2, 2]   # the box's ceiling cuts it cleanly; hover to read f and its partials`,
  },
  {
    label: 'Space · Axes, points and vectors',
    spec: `@frame: axes
A = (1, 2, 3)
B = (-2, 1, 1)
vector: (0,0,0) -> (1,2,3)
vector: (0,0,0) -> (-2,1,1) color: purple
(1,2,3) -- (-2,1,1)`,
  },
]

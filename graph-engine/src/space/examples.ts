// Space's review-harness examples (S1), one per new capability, concatenated
// onto EXAMPLES by examples.ts. examples.test.ts builds every one through the
// space kernel and asserts it draws with no errors. Until S2 swaps the
// renderer, the harness draws them with the old three.js renderer, which does
// not know the space forms.

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
    label: 'Space · Axes, points and vectors',
    spec: `@frame: axes
A = (1, 2, 3)
B = (-2, 1, 1)
vector: (0,0,0) -> (1,2,3)
vector: (0,0,0) -> (-2,1,1) color: purple
(1,2,3) -- (-2,1,1)`,
  },
]

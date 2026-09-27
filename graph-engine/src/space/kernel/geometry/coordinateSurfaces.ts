// Coordinate surfaces (plan A5): "cylindrical: r = 2" (a cylinder),
// "cylindrical: z = r" (a cone), "spherical: phi = pi/4" (a cone),
// "spherical: rho = 2 sin(phi)", "spherical: theta = pi/3" (a half-plane).
//
// Each is a parametric surface through the exact coordinate map,
//   cylindrical (r, θ, z) -> (r cos θ, r sin θ, z)
//   spherical  (ρ, θ, φ) -> (ρ sin φ cos θ, ρ sin φ sin θ, ρ cos φ)
// with the solved coordinate replaced by its expression, over the other two
// (in the order r, θ, z / ρ, θ, φ), which name the pick's parameters. It is
// built by the parametric surface's builder, so normals, mesh lines, style
// and the pick are that builder's; the pick also carries the hit in the
// surface's own coordinates.
//
// θ is the azimuth from +x toward +y; φ is measured from +z (OpenStax).
// Default ranges: θ over a full turn and φ over a half turn (in the spec's
// @angle unit, since the map's trig reads it), z over the box's z range, and
// r and ρ over [0, R], R the box's largest half-span. The box is box.ts's
// (@bounds3d, else [-5, 5] per axis), as for an implicit surface.

import type { Expr, Statement } from '../../../parser/types'
import { call, mul, num, substitute, variable } from '../../../math/expr'
import type { CoordinateSurfaceForm } from '../../grammar/keywords/geometryForms'
import type { ParamRange } from '../../grammar/types'
import { formatNumber } from '../../pick/format'
import type { Box3, MeshMark, Vec3 } from '../../scene/types'
import { reversedWinding } from '../mesh'
import { PARAMETRIC_SURFACE } from '../parametric'
import { boxOf, sameBox, type BuildContext, type BuildResult, type BuilderEntry, type PreparedStatement } from '../registry'
import { largestSpan, spaceBox } from './box'

type System = CoordinateSurfaceForm['system']
type Angle = 'radians' | 'degrees'

const v = variable

// The coordinate maps, over the coordinates' own names.
const MAPS: Record<System, [Expr, Expr, Expr]> = {
  cylindrical: [mul(v('r'), call('cos', v('theta'))), mul(v('r'), call('sin', v('theta'))), v('z')],
  spherical: [
    mul(mul(v('rho'), call('sin', v('phi'))), call('cos', v('theta'))),
    mul(mul(v('rho'), call('sin', v('phi'))), call('sin', v('theta'))),
    mul(v('rho'), call('cos', v('phi'))),
  ],
}

const ORDER: Record<System, readonly string[]> = {
  cylindrical: ['r', 'theta', 'z'],
  spherical: ['rho', 'theta', 'phi'],
}

const LABELS: Record<System, string> = { cylindrical: '(r, θ, z)', spherical: '(ρ, θ, φ)' }

// Every form faces its INCREASING solved coordinate s, as an implicit
// surface faces increasing F. The parametric normal is r_u × r_v, u and v
// the free coordinates in order; with r = p(s = f(u, v), u, v), its component
// along p_s is det[r_u, r_v, p_s] = det[p_u, p_v, p_s] (the f terms are
// multiples of p_s), the coordinate map's Jacobian up to order:
// det[p_r, p_θ, p_z] = r and det[p_ρ, p_θ, p_φ] = -ρ² sin φ. So
//   cylindrical r (θ, z): det[p_θ, p_z, p_r] = +r         kept
//   cylindrical θ (r, z): det[p_r, p_z, p_θ] = -r         flipped
//   cylindrical z (r, θ): det[p_r, p_θ, p_z] = +r         kept
//   spherical ρ (θ, φ):   det[p_θ, p_φ, p_ρ] = -ρ² sin φ  flipped
//   spherical θ (ρ, φ):   det[p_ρ, p_φ, p_θ] = +ρ² sin φ  kept
//   spherical φ (ρ, θ):   det[p_ρ, p_θ, p_φ] = -ρ² sin φ  flipped
// A flipped form's normals are negated and its triangles rewound, so the
// winding still agrees with them.
const FLIPPED: ReadonlySet<string> = new Set(['cylindrical theta', 'spherical rho', 'spherical phi'])

function flipped(mark: MeshMark): MeshMark {
  return { ...mark, normals: mark.normals.map((c) => -c), indices: reversedWinding(mark.indices) }
}

function form(statement: Statement): CoordinateSurfaceForm {
  if (statement.kind === 'space' && statement.form.form === 'coordinateSurface') return statement.form
  throw new Error(`not a coordinate surface: ${statement.kind}`)
}

function defaultRange(name: string, box: Box3, angle: Angle): ParamRange {
  const turn = angle === 'degrees' ? num(360) : mul(num(2), v('pi'))
  const half = angle === 'degrees' ? num(180) : v('pi')
  switch (name) {
    case 'theta':
      return { param: name, from: num(0), to: turn }
    case 'phi':
      return { param: name, from: num(0), to: half }
    case 'z':
      return { param: name, from: num(box.z.min), to: num(box.z.max) }
    default:
      return { param: name, from: num(0), to: num(largestSpan(box) / 2) }
  }
}

// The point p in the system's coordinates, angles in the given unit; θ in
// [0, a full turn), φ in [0, a half turn].
export function coordinatesOf(system: System, p: Vec3, angle: Angle): [number, number, number] {
  const [x, y, z] = p
  const toUnit = (a: number) => (angle === 'degrees' ? (a * 180) / Math.PI : a)
  let theta = Math.atan2(y, x)
  if (theta < 0) theta += 2 * Math.PI
  if (system === 'cylindrical') return [Math.hypot(x, y), toUnit(theta), z]
  const rho = Math.hypot(x, y, z)
  const phi = rho > 0 ? Math.acos(Math.max(-1, Math.min(1, z / rho))) : 0
  return [rho, toUnit(theta), toUnit(phi)]
}

export function coordinateRow(system: System, p: Vec3, angle: Angle): { label: string; value: string } {
  const [a, b, c] = coordinatesOf(system, p, angle)
  const deg = angle === 'degrees' ? '°' : ''
  const value =
    system === 'cylindrical'
      ? `(${formatNumber(a)}, ${formatNumber(b)}${deg}, ${formatNumber(c)})`
      : `(${formatNumber(a)}, ${formatNumber(b)}${deg}, ${formatNumber(c)}${deg})`
  return { label: LABELS[system], value }
}

function prepareCoordinateSurface(statement: Statement, context: BuildContext): PreparedStatement {
  const f = form(statement)
  const angle = context.config.angle
  const params = ORDER[f.system].filter((c) => c !== f.solved)
  const solved = new Map([[f.solved, f.body]])
  const [fx, fy, fz] = MAPS[f.system].map((e) => substitute(e, solved))
  // The parametric surface over the box's default ranges. A default range is
  // a number read off the box, so the surface is prepared again when the box
  // it was prepared for moves (J1); what it reads does not depend on them.
  const defaulted = params.some((name) => !f.ranges.some((r) => r.param === name))
  const parametricIn = (box: Box3): PreparedStatement => {
    const ranges = params.map((name) => f.ranges.find((r) => r.param === name) ?? defaultRange(name, box, angle)) as [ParamRange, ParamRange]
    const parametric: Statement = {
      kind: 'space',
      form: { form: 'parametricSurface', fx, fy, fz, u: ranges[0], v: ranges[1], style: f.style },
      color: statement.color,
      statementName: statement.statementName,
    }
    return PARAMETRIC_SURFACE.prepare(parametric, context)
  }
  // Prepared once here, in the authored box, so a bad body is refused at setup.
  let preparedBox: Box3 = spaceBox(context.config)
  let prepared = parametricIn(preparedBox)
  const coordinates = (p: Vec3) => coordinateRow(f.system, p, angle)
  const flip = FLIPPED.has(`${f.system} ${f.solved}`)
  const build = (): BuildResult => {
    const box = boxOf(context)
    if (defaulted && !sameBox(box, preparedBox)) {
      prepared = parametricIn(box)
      preparedBox = box
    }
    const result = prepared.build()
    const marks = result.marks.map((mark) => {
      if (mark.kind !== 'mesh') return mark
      const faced = flip ? flipped(mark) : mark
      return faced.pick?.kind === 'parametric' ? ({ ...faced, pick: { ...faced.pick, coordinates } } satisfies MeshMark) : faced
    })
    return { ...result, marks }
  }
  return { reads: prepared.reads, build }
}

export const COORDINATE_SURFACE: BuilderEntry = {
  draws: true,
  prepare: prepareCoordinateSurface,
  colorScale: (statement) => (form(statement).style.colormap?.by.kind ?? 'none') !== 'none',
}

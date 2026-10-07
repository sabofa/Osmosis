// The unit of each setting that has one, by registry path.
//
// A unit is part of the table (what a slider's number counts) and not of the prose, so it is
// here and not in meanings/: the registry, which every renderer imports, carries it, and the
// prose, which only the guide, the lab and the tests import, does not (style/settings/guide.ts).
// A setting that is a plain number, a share or a switch has no unit.

import { DEFAULT_PAINT_PARAMS } from '../../space/paint/params'

// The width and the length of each stroke role are in screen pixels at the standard framing.
const ROLE_SIZES = (Object.keys(DEFAULT_PAINT_PARAMS.roles) as (keyof typeof DEFAULT_PAINT_PARAMS.roles)[]).flatMap((role) => [
  `paint.roles.${role}.width`,
  `paint.roles.${role}.length`,
])

const PATHS_BY_UNIT: Readonly<Record<string, readonly string[]>> = {
  '×': ['style.line.width', 'style.lettering.size', 'style.colour.saturation', 'paint.mix.chromaMin', 'paint.mix.chromaMax', 'paint.particles.zoomGrowMax', 'paint.particles.zoomBigMax', 'media.ink.chroma', 'media.colouredPencil.chroma', 'media.chalk.chroma', 'board.tilt'],
  '°': ['style.fill.angle', 'paint.light.azimuth', 'paint.light.elevation', 'paint.environment.hue', 'paint.curve.warmHue', 'paint.curve.coolHue', 'paint.curve.shiftMax', 'paint.curve.accentHue', 'paint.curve.accentMax', 'paint.curve.planeStepA', 'paint.curve.planeStepB', 'paint.curve.skyHue', 'paint.curve.bounceHue', 'paint.curve.devH', 'paint.mix.hueMin', 'paint.mix.hueMax', 'paint.edges.planeCellDeg', 'paint.impasto.lightAzimuth', 'paint.impasto.lightElevation'],
  'drawing units': ['style.fill.spacing', 'style.paper.grid'],
  'px': ['paint.environment.occlusionRadiusPx', 'paint.detect.scumbleMinPx', 'paint.detect.dabMinPx', 'paint.detect.edgeReachPx', 'paint.mix.loadBreakPx', ...ROLE_SIZES],
  'N·L': ['paint.detect.formBandNL', 'paint.value.lightTurn', 'paint.value.lightSoftness', 'paint.value.terminatorSoftness', 'paint.value.coreWidth', 'paint.value.reflectedSoftness'],
  'world units': ['paint.mix.loadCell'],
  'px²': ['paint.edges.planeMinPx'],
  'per world unit²': ['paint.particles.maxPerUnit2'],
  'per 10,000 px²': ['paint.particles.targetPer10kPx'],
  ': 1': ['media.ink.contrast'],
  'chroma': ['media.graphite.hint', 'board.blackboard.chromaCap', 'board.greenboard.chromaCap', 'board.whiteboard.chromaCap'],
}

export const UNITS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(PATHS_BY_UNIT).flatMap(([unit, paths]) => paths.map((path) => [path, unit] as const)))
)

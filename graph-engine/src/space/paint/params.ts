// The painter's parameters (spec 2026-10-02-painted-figures-design.md, §3).
// Every number the paint model and the paint renderer read lives here, with
// the defaults Ben approved in the mockup rounds. The Paint Lab builds its
// sliders from PARAM_SCHEMA; "Save as defaults" writes the tuned values to
// tuning.json, which M2 reads as the shipping defaults.

import type { CurvePoints, CurveSpec } from './curves'

export interface PaintParams {
  seed: number
  // Editable curves (curves.ts). Defaults are the identity / flat, so the spec
  // formulas are the look until Ben edits them. The model applies them; the
  // renderer never reads them.
  curves: {
    // Key-light response: Lambert N·L (0..1) → lit fraction (0..1).
    lightResponse: CurvePoints
    // Raw value u → the value the plan zones (0..1), applied after occlusion.
    value: CurvePoints
    // Over value u: added to the curve's L (−0.2..0.2).
    lAdjust: CurvePoints
    // Over value u: multiplier on the curve's C (0..2).
    cAdjust: CurvePoints
    // Over value u: degrees added to the curve's H (−60..60).
    hAdjust: CurvePoints
    // Over value u: multiplier on the brush-load mix strength (0..2).
    mixAmount: CurvePoints
  }
  // The environment's light colour and how the object takes it in.
  environment: {
    // OKLCH hue (deg) and chroma of the ambient/sky/bounce light.
    hue: number
    chroma: number
    // 0 = the object ignores the environment colour, 1 = its ambient share
    // takes the full environment tint (in OKLab, L untouched).
    absorption: number
    // Screen-space ambient occlusion from the G-buffer depth: how much creases
    // and contact areas darken (0 off).
    occlusion: number
    occlusionRadiusPx: number
  }
  // How strokes are detected and assigned their role (§3.7).
  detect: {
    // Form strokes go on particles within this band of the terminator, in N·L units (the surface turns from
    // the key light at N·L = 0). It was `formBand` in u units: a saved preset's old key is ignored.
    formBandNL: number
    // Scumble goes where |∇u| per CSS px is below this over at least
    // scumbleMinPx (a wide transition).
    scumbleGradient: number
    scumbleMinPx: number
    // Dabs: the top fraction of value maxima, at least dabMinPx apart.
    dabTopFraction: number
    dabMinPx: number
    // Glaze takes the core/cast zones when the particle's value is below this.
    glazeBelow: number
    // Reflected strokes need at least this much bounce in the value.
    reflectedMin: number
    // A boundary counts as an edge only above this value contrast.
    edgeMinContrast: number
    // A stroke takes its behaviour from an edge within this many px.
    edgeReachPx: number
  }
  light: {
    // The key light's direction, as an azimuth (deg) and an elevation (deg, + = above).
    //   worldFixed 1 (the default): placed in the WORLD, the painter's studio setup, a lamp that stays on the motif
    //     while you walk around it. z is up; the azimuth is about the z axis from +x toward +y, and the elevation is
    //     above the xy-plane: (0, 90) is (0, 0, 1), straight down on the figure. Orbiting moves the viewer, never the light.
    //   worldFixed 0: relative to the camera, as it was: the azimuth is + = to the viewer's left and the elevation is
    //     above the line of sight, so the light turns with the view.
    // (Only the lab reads it, to make PaintView.lightDir; the shadow map, the G-buffer and the model all take that.
    // The canvas's relief light, impasto.lightAzimuth, stays on the screen in both: the canvas is the screen.)
    azimuth: number
    elevation: number
    worldFixed: number
    intensity: number
    ambient: number
    // Sky term on up-facing normals, bounce term on down-facing normals.
    sky: number
    bounce: number
    // Shadow-map cast and self shadow on (1) or off (0).
    shadows: number
  }
  value: {
    // The value plan (spec §3.3, §12: Ben's classical form-shadow model). Two families, divided by the
    // terminator (N·L = 0); every value of the shadow family is darker than every value of the light family.
    //
    // The LIGHT family (facing the key light, not in cast shadow), from dark to bright: the half-tone ramp from
    // halfLo (its darkest value, at the terminator) to halfHi, then the light ramp from lightLo to lightHi (the
    // highlight, at N·L = 1). The PLAN value u a stroke is painted at (the mockup's 0.52..0.72 and 0.85..0.94).
    halfLo: number
    halfHi: number
    lightLo: number
    lightHi: number
    // Where the half-tone turns to light, in N·L, and how wide that turn is (N·L units): a wide, smooth gradation.
    lightTurn: number
    lightSoftness: number
    // The terminator: the light-to-core edge, centred on N·L = 0, this wide. Crisper than the two other turns.
    terminatorSoftness: number
    // The SHADOW family. Just past the terminator is the core shadow, its darkest band: corePlateau, from N·L 0 to
    // -coreWidth. Beyond it the form shadow lightens with the reflected (bounce) light, softly over reflectedSoftness
    // (N·L units), but never past reflectedMax = corePlateau + reflectedShare (0..0.9) x (halfLo - corePlateau):
    // always darker than the darkest half-tone.
    coreWidth: number
    corePlateau: number
    reflectedShare: number
    reflectedSoftness: number
    // The cast shadow: castPlateau away from the contact, castContact at it (the occlusion, over
    // environment.occlusionRadiusPx). Never lighter than reflectedMax.
    castPlateau: number
    castContact: number
    deviation: number
  }
  curve: {
    lSlope: number
    lPivot: number
    cBase: number
    cPeak: number
    cCentre: number
    cWidth: number
    warmHue: number
    coolHue: number
    kWarm: number
    kCool: number
    // The most the warm or cool swing may turn a colour's hue away from its own, in degrees (both sides). The swing is
    // relative to the local colour (toward its warmer or cooler neighbour, by kWarm or kCool of the arc to warmHue or
    // coolHue) and capped here, so a terracotta's shadow is a dark red and never a purple. The tints, the sky and the
    // bounce, the environment and the reflected-light mix keep the final hue within shiftMax + 3 degrees of the colour's
    // own (a grey, with no hue to keep, takes them whole).
    shiftMax: number
    accentHue: number
    accentMax: number
    planeStepA: number
    planeStepB: number
    tintWarm: number
    tintCool: number
    skyTint: number
    skyHue: number
    bounceTint: number
    bounceHue: number
    reflectedBounceMix: number
    devL: number
    devC: number
    devH: number
    // Colormapped surfaces keep this fraction of the hue rotation and tints.
    colormapHue: number
  }
  mix: {
    strength: number
    hueMin: number
    hueMax: number
    chromaMin: number
    chromaMax: number
    valueHold: number
    valueStepFraction: number
    valueStep: number
    greyChroma: number
    greyVecMin: number
    greyVecMax: number
    flipHue: number
    flipChroma: number
    drift: number
    loadMin: number
    loadMax: number
    loadBreakPx: number
    loadCell: number
    colormapScale: number
    // The ± balance of the mix (−1..1, 0 = symmetric): hue toward + (counter-
    // clockwise) or −, chroma up or down, value steps lighter or darker. A bias
    // b makes the + direction come up (1 + b)/2 of the time.
    hueBias: number
    chromaBias: number
    valueBias: number
    roleBlock: number
    roleForm: number
    roleScumble: number
    roleGlaze: number
    roleLine: number
    roleEdge: number
    roleDab: number
  }
  edges: {
    // Weights per transition kind (§3.6): internal, silhouette, shadow.
    wContrast: [number, number, number]
    wCurvature: [number, number, number]
    wFocal: [number, number, number]
    wLight: [number, number, number]
    wDepth: [number, number, number]
    wShadowDist: number
    noise: number
    lostBelow: number
    softBelow: number
    firmBelow: number
    stopAt: number
    bleedAt: number
    planeCellDeg: number
    planeMinPx: number
    planeGradient: number
  }
  // Per-role stroke shape (§3.7). Sizes in CSS px at the default framing.
  roles: Record<
    'block' | 'form' | 'scumble' | 'glaze' | 'reflected' | 'dab' | 'edge' | 'line',
    { density: number; width: number; length: number; curvature: number; load: number; impasto: number; bristles: number; bristleVar: number; dry: number; wet: number }
  >
  particles: {
    maxPerUnit2: number
    targetPer10kPx: number
    fadeLo: number
    fadeHi: number
    // The share of the strokes drawn in a frame made while the camera is dragged. It has no slider (round 2): the lab
    // no longer makes frames while dragging, it re-projects the last frame's strokes (nothing is thinned), so the
    // slider moved nothing. The model still reads it for a frame made for a dragged view (the debug views, which the
    // lab runs on every drag frame), and the field stays so that a preset saved with it resolves to it.
    dragDensity: number
    // Zoomed in, the particles (capped by maxPerUnit2) fall short of the screen target, and the strokes
    // grow by min(sqrt(target / available), zoomGrowMax) so they still overlap and cover the form.
    zoomGrowMax: number
    // A painter picks a bigger brush up close, not only more of the same dabs: the strokes' size also
    // follows the zoom, as size x zoom^zoomStrokeScale (0 keeps the size, 1 follows the zoom exactly).
    zoomStrokeScale: number
    // The two multiply, and a brush six times the size it was tuned at is not a brush but a leaf: the
    // combined factor never goes past this (the strokes stay long and brushy, and the underpainting
    // carries the form).
    zoomBigMax: number
  }
  // The underpainting: a thin, scumbled imprimatura laid first, in the curve colour of every pixel of a
  // form, so the gaps between strokes show paint and never bare canvas (spec addendum, Ben 2026-10-02).
  underpaint: {
    // How opaque it is (the canvas weave and the streaks thin it a little).
    opacity: number
    // How much the seeded, directional brush streaks break its coverage up (0 is a flat wash).
    streak: number
  }
  impasto: {
    strength: number
    lightAzimuth: number
    lightElevation: number
  }
  canvas: {
    texture: number
    weave: 'duck' | 'linen'
    // OKLab of the canvas tone (the theme base by default).
    tone: [number, number, number]
  }
}

const role = (
  density: number, width: number, length: number, curvature: number, load: number,
  impasto: number, bristles: number, bristleVar: number, dry: number, wet: number,
) => ({ density, width, length, curvature, load, impasto, bristles, bristleVar, dry, wet })

export const DEFAULT_PAINT_PARAMS: PaintParams = {
  seed: 1,
  curves: {
    lightResponse: [[0, 0], [1, 1]],
    value: [[0, 0], [1, 1]],
    lAdjust: [[0, 0], [1, 0]],
    cAdjust: [[0, 1], [1, 1]],
    hAdjust: [[0, 0], [1, 0]],
    mixAmount: [[0, 1], [1, 1]],
  },
  environment: { hue: 250, chroma: 0.02, absorption: 0.3, occlusion: 0.35, occlusionRadiusPx: 14 },
  detect: {
    formBandNL: 0.18, scumbleGradient: 0.004, scumbleMinPx: 6, dabTopFraction: 0.015, dabMinPx: 12,
    glazeBelow: 0.4, reflectedMin: 0.04, edgeMinContrast: 0.05, edgeReachPx: 20,
  },
  // The key light is the mockup's: from 56 degrees to the viewer's left and 27 up (its CAMLIGHT (-0.74, 0.45, 0.50) in
  // screen right, up and toward-the-viewer). A light higher and nearer the view than that puts most of a form in the
  // light zone, and the picture reads pale. It is fixed in the world now (worldFixed 1), so the same lamp is given as a
  // world direction: the one the mockup's light has at a typical authored camera (azimuth 38, elevation 28, which puts
  // it at 35 degrees clockwise of +x seen from above, 39 up), so a figure at its authored view is lit as it was. A
  // camera-relative light (worldFixed 0) wants its own 56 and 27.
  light: { azimuth: -35, elevation: 39, worldFixed: 1, intensity: 1, ambient: 0.18, sky: 0.12, bounce: 0.1, shadows: 1 },
  value: {
    halfLo: 0.52, halfHi: 0.72, lightLo: 0.85, lightHi: 0.94, lightTurn: 0.6, lightSoftness: 0.5,
    terminatorSoftness: 0.1, coreWidth: 0.2, corePlateau: 0.24, reflectedShare: 0.4, reflectedSoftness: 0.35,
    castPlateau: 0.32, castContact: 0.2, deviation: 0.018,
  },
  curve: {
    lSlope: 0.8, lPivot: 0.62, cBase: 0.42, cPeak: 0.88, cCentre: 0.5, cWidth: 0.25,
    warmHue: 75, coolHue: 280, kWarm: 0.4, kCool: 0.46, shiftMax: 12, accentHue: 95, accentMax: 18,
    planeStepA: 10, planeStepB: 6, tintWarm: 0.018, tintCool: 0.022,
    skyTint: 0.03, skyHue: 250, bounceTint: 0.034, bounceHue: 68, reflectedBounceMix: 0.55,
    devL: 0.01, devC: 0.06, devH: 2.2, colormapHue: 1 / 3,
  },
  mix: {
    strength: 1, hueMin: 12, hueMax: 25, chromaMin: 0.7, chromaMax: 1.35, valueHold: 0.012,
    valueStepFraction: 0.25, valueStep: 0.03, greyChroma: 0.05, greyVecMin: 0.012, greyVecMax: 0.026,
    flipHue: 0.8, flipChroma: 0.75, drift: 0.45, loadMin: 3, loadMax: 8, loadBreakPx: 120, loadCell: 0.5,
    colormapScale: 1 / 3,
    hueBias: 0, chromaBias: 0, valueBias: 0,
    roleBlock: 1, roleForm: 0.7, roleScumble: 0.85, roleGlaze: 0.6, roleLine: 0.75, roleEdge: 0.5, roleDab: 0.4,
  },
  edges: {
    wContrast: [0.32, 0.52, 0.36],
    wCurvature: [0.22, 0.08, 0.08],
    wFocal: [0.26, 0.14, 0.06],
    wLight: [0.1, 0.08, 0.08],
    wDepth: [0.1, 0.18, 0.12],
    wShadowDist: 0.3,
    noise: 0.12, lostBelow: 0.24, softBelow: 0.46, firmBelow: 0.68,
    stopAt: 0.46, bleedAt: 0.24, planeCellDeg: 26, planeMinPx: 70, planeGradient: 0.45,
  },
  roles: {
    block: role(1, 22, 46, 0.15, 0.9, 1, 9, 0.35, 0.25, 0.15),
    form: role(1, 12, 40, 0.5, 0.8, 0.9, 7, 0.35, 0.3, 0.2),
    scumble: role(0.8, 9, 22, 0.3, 0.55, 0.6, 6, 0.5, 0.6, 0.35),
    glaze: role(0.7, 26, 50, 0.15, 0.3, 0.1, 10, 0.25, 0.2, 0.4),
    reflected: role(0.6, 10, 24, 0.3, 0.5, 0.5, 6, 0.35, 0.35, 0.3),
    dab: role(0.15, 7, 9, 0.1, 1.2, 1.6, 5, 0.3, 0.1, 0),
    edge: role(1, 4, 30, 0.2, 0.9, 0.8, 4, 0.25, 0.2, 0.2),
    line: role(1, 3, 36, 0, 1, 0.7, 4, 0.2, 0.1, 0),
  },
  // Task 6 tuning (performance, not look): the world is box-normalised, so a figure's surface is a few
  // world units² and 900 particles a unit left a zoomed-in view short of particles (the supply, not
  // the screen density, set the stroke count). 3000 lets the screen target decide at any zoom, at no
  // cost per frame (the strokes drawn are the screen's, the particles are built once). dragDensity stays
  // 1: an orbit does not thin the strokes (the lab re-projects the last frame's strokes instead).
  particles: { maxPerUnit2: 3000, targetPer10kPx: 90, fadeLo: 0.08, fadeHi: 0.25, dragDensity: 1, zoomGrowMax: 3, zoomStrokeScale: 0.35, zoomBigMax: 4 },
  underpaint: { opacity: 0.85, streak: 0.4 },
  impasto: { strength: 1, lightAzimuth: 135, lightElevation: 23 },
  // The mockup painted every figure on fine primed linen (its Painter's default), not on cotton duck, whose threads are
  // half again as coarse and whose relief is stronger. Half the generator's default texture (1) is what its canvas
  // reads as: measured on a bare patch, the weave's grey standard deviation is 2.9 of 255 in the mockup, 3.3 here
  // at texture 0.5, and was 16 at 1 with the relief lit into the tile as well as by the composite.
  canvas: { texture: 0.5, weave: 'linen', tone: [0.93, 0.004, 0.022] },
}

// One slider in the Paint Lab. `path` is a dotted path into PaintParams; an
// index suffix addresses a tuple entry ("edges.wContrast.1").
export interface ParamSpec {
  path: string
  label: string
  group: string
  min: number
  max: number
  step: number
}

const ROLE_KEYS = ['block', 'form', 'scumble', 'glaze', 'reflected', 'dab', 'edge', 'line'] as const
const ROLE_FIELDS: [keyof PaintParams['roles']['block'], number, number, number][] = [
  ['density', 0, 2, 0.01], ['width', 1, 60, 0.5], ['length', 2, 120, 1], ['curvature', 0, 1, 0.01],
  ['load', 0, 2, 0.01], ['impasto', 0, 3, 0.01], ['bristles', 1, 24, 1], ['bristleVar', 0, 1, 0.01],
  ['dry', 0, 1, 0.01], ['wet', 0, 1, 0.01],
]
const KINDS = ['internal', 'silhouette', 'shadow']

export const PARAM_SCHEMA: ParamSpec[] = [
  { path: 'seed', label: 'Seed', group: 'General', min: 1, max: 999, step: 1 },
  { path: 'light.worldFixed', label: 'Light fixed in the world', group: 'Light', min: 0, max: 1, step: 1 },
  { path: 'light.azimuth', label: 'Azimuth (°)', group: 'Light', min: -180, max: 180, step: 1 },
  { path: 'light.elevation', label: 'Elevation (°)', group: 'Light', min: -10, max: 90, step: 1 },
  { path: 'light.intensity', label: 'Intensity', group: 'Light', min: 0, max: 2, step: 0.01 },
  { path: 'light.ambient', label: 'Ambient', group: 'Light', min: 0, max: 1, step: 0.01 },
  { path: 'light.sky', label: 'Sky', group: 'Light', min: 0, max: 1, step: 0.01 },
  { path: 'light.bounce', label: 'Bounce', group: 'Light', min: 0, max: 1, step: 0.01 },
  { path: 'light.shadows', label: 'Shadows', group: 'Light', min: 0, max: 1, step: 1 },
  { path: 'environment.hue', label: 'Environment hue', group: 'Environment', min: 0, max: 360, step: 1 },
  { path: 'environment.chroma', label: 'Environment chroma', group: 'Environment', min: 0, max: 0.2, step: 0.001 },
  { path: 'environment.absorption', label: 'Absorption', group: 'Environment', min: 0, max: 1, step: 0.01 },
  { path: 'environment.occlusion', label: 'Occlusion', group: 'Environment', min: 0, max: 1, step: 0.01 },
  { path: 'environment.occlusionRadiusPx', label: 'Occlusion radius (px)', group: 'Environment', min: 2, max: 60, step: 1 },
  ...(
    [
      ['formBandNL', 'Form band (N·L)', 0, 0.5, 0.005], ['scumbleGradient', 'Scumble below |∇u| per px', 0, 0.05, 0.0005],
      ['scumbleMinPx', 'Scumble min width (px)', 0, 40, 1], ['dabTopFraction', 'Dab top fraction', 0, 0.2, 0.001],
      ['dabMinPx', 'Dab min spacing (px)', 0, 80, 1], ['glazeBelow', 'Glaze below u', 0, 1, 0.01],
      ['reflectedMin', 'Reflected min bounce', 0, 0.3, 0.005], ['edgeMinContrast', 'Edge min contrast', 0, 0.3, 0.005],
      ['edgeReachPx', 'Edge reach (px)', 0, 80, 1],
    ] as const
  ).map(([k, label, min, max, step]) => ({ path: `detect.${k}`, label, group: 'Stroke detection', min, max, step })),
  { path: 'mix.hueBias', label: 'Hue ± balance', group: 'Brush-load mix', min: -1, max: 1, step: 0.01 },
  { path: 'mix.chromaBias', label: 'Chroma ± balance', group: 'Brush-load mix', min: -1, max: 1, step: 0.01 },
  { path: 'mix.valueBias', label: 'Value-step ± balance', group: 'Brush-load mix', min: -1, max: 1, step: 0.01 },
  ...(
    [
      ['halfLo', 'Half-tone, darkest (at terminator)', 0, 1, 0.001], ['halfHi', 'Half-tone, lightest', 0, 1, 0.001],
      ['lightLo', 'Light from', 0, 1, 0.001], ['lightHi', 'Light to (highlight)', 0, 1, 0.001],
      ['lightTurn', 'Half-tone turns to light (N·L)', 0, 1, 0.005], ['lightSoftness', 'Light / half-tone softness (N·L)', 0, 1, 0.005],
      ['terminatorSoftness', 'Terminator softness (N·L)', 0, 0.4, 0.005], ['coreWidth', 'Core shadow width (N·L)', 0, 0.8, 0.005],
      ['corePlateau', 'Core shadow value', 0, 1, 0.001], ['reflectedShare', 'Reflected share (core to half-tone)', 0, 0.9, 0.005],
      ['reflectedSoftness', 'Reflected / core softness (N·L)', 0, 1, 0.005], ['castPlateau', 'Cast shadow value', 0, 1, 0.001],
      ['castContact', 'Cast shadow at the contact', 0, 1, 0.001], ['deviation', 'Deviation', 0, 0.1, 0.001],
    ] as const
  ).map(([k, label, min, max, step]) => ({ path: `value.${k}`, label, group: 'Value plan', min, max, step })),
  ...(
    [
      ['lSlope', 'L slope', 0, 2, 0.01], ['lPivot', 'L pivot', 0, 1, 0.01], ['cBase', 'C base', 0, 2, 0.01],
      ['cPeak', 'C peak', 0, 2, 0.01], ['cCentre', 'C centre', 0, 1, 0.01], ['cWidth', 'C width', 0.02, 1, 0.01],
      ['warmHue', 'Warm hue', 0, 360, 1], ['coolHue', 'Cool hue', 0, 360, 1], ['kWarm', 'Warm pull', 0, 1, 0.01],
      ['kCool', 'Cool pull', 0, 1, 0.01], ['shiftMax', 'Max hue shift (°)', 0, 60, 0.5], ['accentHue', 'Accent hue', 0, 360, 1], ['accentMax', 'Accent max (°)', 0, 60, 0.5],
      ['planeStepA', 'Plane step A (°)', 0, 40, 0.5], ['planeStepB', 'Plane step B (°)', 0, 40, 0.5],
      ['tintWarm', 'Warm tint', 0, 0.1, 0.001], ['tintCool', 'Cool tint', 0, 0.1, 0.001],
      ['skyTint', 'Sky tint', 0, 0.1, 0.001], ['skyHue', 'Sky hue', 0, 360, 1],
      ['bounceTint', 'Bounce tint', 0, 0.1, 0.001], ['bounceHue', 'Bounce hue', 0, 360, 1],
      ['reflectedBounceMix', 'Reflected bounce mix', 0, 1, 0.01], ['devL', 'Deviation L', 0, 0.05, 0.001],
      ['devC', 'Deviation C', 0, 0.3, 0.005], ['devH', 'Deviation H (°)', 0, 10, 0.1],
      ['colormapHue', 'Colormap hue share', 0, 1, 0.01],
    ] as const
  ).map(([k, label, min, max, step]) => ({ path: `curve.${k}`, label, group: 'Lighting curve', min, max, step })),
  ...(
    [
      ['strength', 'Strength', 0, 2, 0.01], ['hueMin', 'Hue min (°)', 0, 60, 0.5], ['hueMax', 'Hue max (°)', 0, 60, 0.5],
      ['chromaMin', 'Chroma min ×', 0, 2, 0.01], ['chromaMax', 'Chroma max ×', 0, 3, 0.01],
      ['valueHold', 'Value hold ±', 0, 0.1, 0.001], ['valueStepFraction', 'Value-step loads', 0, 1, 0.01],
      ['valueStep', 'Value step ±', 0, 0.15, 0.001], ['greyChroma', 'Grey below C', 0, 0.2, 0.005],
      ['greyVecMin', 'Grey vector min', 0, 0.08, 0.001], ['greyVecMax', 'Grey vector max', 0, 0.08, 0.001],
      ['flipHue', 'Flip hue p', 0, 1, 0.01], ['flipChroma', 'Flip chroma p', 0, 1, 0.01], ['drift', 'Drift to', 0, 1, 0.01],
      ['loadMin', 'Load min strokes', 1, 20, 1], ['loadMax', 'Load max strokes', 1, 30, 1],
      ['loadBreakPx', 'Load break (px)', 10, 400, 1], ['loadCell', 'Load cell (world)', 0.05, 3, 0.01],
      ['colormapScale', 'Colormap share', 0, 1, 0.01], ['roleBlock', 'Block ×', 0, 2, 0.01], ['roleForm', 'Form ×', 0, 2, 0.01],
      ['roleScumble', 'Scumble ×', 0, 2, 0.01], ['roleGlaze', 'Glaze ×', 0, 2, 0.01], ['roleLine', 'Line ×', 0, 2, 0.01],
      ['roleEdge', 'Edge ×', 0, 2, 0.01], ['roleDab', 'Dab ×', 0, 2, 0.01],
    ] as const
  ).map(([k, label, min, max, step]) => ({ path: `mix.${k}`, label, group: 'Brush-load mix', min, max, step })),
  ...(['wContrast', 'wCurvature', 'wFocal', 'wLight', 'wDepth'] as const).flatMap((w) =>
    KINDS.map((kind, i) => ({ path: `edges.${w}.${i}`, label: `${w.slice(1)} (${kind})`, group: 'Edges', min: 0, max: 1, step: 0.01 })),
  ),
  ...(
    [
      ['wShadowDist', 'shadow distance (shadow)', 0, 1, 0.01], ['noise', 'Noise', 0, 0.5, 0.01],
      ['lostBelow', 'Lost below', 0, 1, 0.01], ['softBelow', 'Soft below', 0, 1, 0.01], ['firmBelow', 'Firm below', 0, 1, 0.01],
      ['stopAt', 'Stroke stops at', 0, 1, 0.01], ['bleedAt', 'Stroke bleeds from', 0, 1, 0.01],
      ['planeCellDeg', 'Plane cell (°)', 5, 90, 1], ['planeMinPx', 'Plane min (px)', 0, 400, 1],
      ['planeGradient', 'Plane gradient share', 0, 1, 0.01],
    ] as const
  ).map(([k, label, min, max, step]) => ({ path: `edges.${k}`, label, group: 'Edges', min, max, step })),
  ...ROLE_KEYS.flatMap((r) =>
    ROLE_FIELDS.map(([f, min, max, step]) => ({ path: `roles.${r}.${f}`, label: f, group: `Stroke: ${r}`, min, max, step })),
  ),
  { path: 'particles.maxPerUnit2', label: 'Max per world unit²', group: 'Particles', min: 50, max: 4000, step: 10 },
  { path: 'particles.targetPer10kPx', label: 'Target per 10k px²', group: 'Particles', min: 10, max: 300, step: 1 },
  { path: 'particles.fadeLo', label: 'Fade |n·v| from', group: 'Particles', min: 0, max: 1, step: 0.01 },
  { path: 'particles.fadeHi', label: 'Fade |n·v| to', group: 'Particles', min: 0, max: 1, step: 0.01 },
  { path: 'particles.zoomGrowMax', label: 'Zoom growth max (x)', group: 'Particles', min: 1, max: 6, step: 0.1 },
  { path: 'particles.zoomStrokeScale', label: 'Stroke size follows zoom', group: 'Particles', min: 0, max: 1, step: 0.01 },
  { path: 'particles.zoomBigMax', label: 'Zoom size cap, both together (x)', group: 'Particles', min: 1, max: 8, step: 0.1 },
  { path: 'underpaint.opacity', label: 'Opacity', group: 'Underpainting', min: 0, max: 1, step: 0.01 },
  { path: 'underpaint.streak', label: 'Brush streaks', group: 'Underpainting', min: 0, max: 1, step: 0.01 },
  { path: 'impasto.strength', label: 'Impasto', group: 'Impasto & canvas', min: 0, max: 3, step: 0.01 },
  { path: 'impasto.lightAzimuth', label: 'Relief light azimuth', group: 'Impasto & canvas', min: 0, max: 360, step: 1 },
  { path: 'impasto.lightElevation', label: 'Relief light elevation', group: 'Impasto & canvas', min: 1, max: 89, step: 1 },
  { path: 'canvas.texture', label: 'Canvas texture', group: 'Impasto & canvas', min: 0, max: 2, step: 0.01 },
  { path: 'canvas.tone.0', label: 'Canvas L', group: 'Impasto & canvas', min: 0.1, max: 1, step: 0.005 },
  { path: 'canvas.tone.1', label: 'Canvas a', group: 'Impasto & canvas', min: -0.1, max: 0.1, step: 0.001 },
  { path: 'canvas.tone.2', label: 'Canvas b', group: 'Impasto & canvas', min: -0.1, max: 0.1, step: 0.001 },
]

// The curve editors (Paint Lab), one per entry of PaintParams.curves.
export const CURVE_SCHEMA: CurveSpec[] = [
  { path: 'curves.lightResponse', label: 'Light response', group: 'Curves', xLabel: 'N·L', yMin: 0, yMax: 1, yLabel: 'lit' },
  { path: 'curves.value', label: 'Value curve', group: 'Curves', xLabel: 'raw value', yMin: 0, yMax: 1, yLabel: 'value' },
  { path: 'curves.lAdjust', label: 'Lightness (L) over value', group: 'Curves', xLabel: 'value', yMin: -0.2, yMax: 0.2, yLabel: 'ΔL' },
  { path: 'curves.cAdjust', label: 'Chroma (C) over value', group: 'Curves', xLabel: 'value', yMin: 0, yMax: 2, yLabel: '×C' },
  { path: 'curves.hAdjust', label: 'Hue (H) over value', group: 'Curves', xLabel: 'value', yMin: -60, yMax: 60, yLabel: 'ΔH°' },
  { path: 'curves.mixAmount', label: 'Mix strength over value', group: 'Curves', xLabel: 'value', yMin: 0, yMax: 2, yLabel: '×mix' },
]

// A partial override (tuning.json, a preset, @style-* later) applied over
// the defaults, deep, tuples by index. Unknown keys are ignored.
export type PaintParamsOverride = { [K in keyof PaintParams]?: unknown }

export function resolvePaintParams(...layers: (PaintParamsOverride | null | undefined)[]): PaintParams {
  const out = structuredClone(DEFAULT_PAINT_PARAMS) as unknown as Record<string, unknown>
  const merge = (target: Record<string, unknown>, src: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(src)) {
      if (!(k in target)) continue
      const t = target[k]
      // A curve (an array of [x, y] points) is replaced whole when the
      // override is a valid curve: at least 2 points, numbers, x ascending.
      if (Array.isArray(t) && Array.isArray(t[0])) {
        const ok = Array.isArray(v) && v.length >= 2 &&
          v.every((p, i) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number' &&
            (i === 0 || p[0] > (v[i - 1] as number[])[0]))
        if (ok) target[k] = (v as number[][]).map((p) => [p[0], p[1]])
      } else if (Array.isArray(t) && Array.isArray(v)) {
        v.forEach((x, i) => { if (typeof x === typeof t[i]) t[i] = x })
      } else if (t !== null && typeof t === 'object' && v !== null && typeof v === 'object') {
        merge(t as Record<string, unknown>, v as Record<string, unknown>)
      } else if (typeof v === typeof t) {
        target[k] = v
      }
    }
  }
  for (const layer of layers) if (layer) merge(out, layer as Record<string, unknown>)
  return out as unknown as PaintParams
}

export function getParam(params: PaintParams, path: string): number {
  let cur: unknown = params
  for (const key of path.split('.')) cur = (cur as Record<string, unknown>)[key]
  return cur as number
}

export function setParam(params: PaintParams, path: string, value: number): PaintParams {
  const next = structuredClone(params)
  const keys = path.split('.')
  let cur = next as unknown as Record<string, unknown>
  for (const key of keys.slice(0, -1)) cur = cur[key] as Record<string, unknown>
  cur[keys[keys.length - 1]] = value
  return next
}

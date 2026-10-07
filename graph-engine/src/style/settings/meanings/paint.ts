// What the painter's settings mean in the picture (the Paint Lab's PARAM_SCHEMA and
// CURVE_SCHEMA in space/paint/params.ts, and the two settings the lab has no slider
// for, canvas.weave and particles.dragDensity).
//
// Written from the painter's own code, and checked against the baked painting, which
// is what the default (the light fixed in the world) draws: space/paint/model/ (the
// value plan, the lighting curve, the brush-load mix, the strokes and the edges),
// space/paint/bake/ (the same decisions made once on the surface), and the shaders of
// space/paint/gl/ (the brush, the underpainting and the composite). The stroke roles
// and the edge weights, which come in families, are in paintTemplates.ts.
//
// THE TWO PATHS. The Paint Lab paints in two ways: the BAKED painting (the default: the light fixed in the world, made once on the
// surface and only selected and projected per frame) and the LIVE per-frame model (baking off, or the light fixed to the camera, and
// the debug views). Every meaning here holds for both, or says plainly where they differ. They differ most in the edges: the view's
// own outline is built per frame (bake/silhouettes.ts), the edge runs and the planes are baked in the world (bake/edges.ts,
// bake/planes.ts), and the focal points and the depth are taken from the authored view.
//
// The vocabulary is a painter's. N·L is how squarely a surface faces the lamp: 0 at
// the terminator (where the light turns off the form), 1 facing the lamp. A value is a
// lightness from black to white. The light family is the highlight, the light and the
// half-tone; the shadow family is the core shadow, the reflected light and the cast
// shadow; every value of the shadow family is darker than every value of the light
// family.
//
// Rules the registry test holds: the first sentence of every meaning stands alone and is
// short (the guide's tables show it by itself); no meaning quotes a default (the
// registry carries it, and a copy goes stale).

import type { Meanings } from '../types'
import { EDGE_WEIGHT_MEANINGS, ROLE_MEANINGS } from './paintTemplates'

const LITERAL: Meanings = {
  'paint.seed': {
    meaning:
      "Rerolls everything the painter leaves to chance: the stroke anchors, each stroke's small variations, how each paint mix tips, how edges waver and the underpainting's streaks. The same seed always repaints the same picture; a new seed is the same value plan and the same planes painted by a different hand.",
    interactions: [],
  },

  // ---- light ----
  'paint.light.worldFixed': {
    meaning:
      'Whether the key light stays put in the world or turns with the camera. On puts it in the world, a studio lamp that stays on the subject while you walk around it, so orbiting changes the view and never the lighting. Off ties it to the camera, so the light turns with you and the whole painting is redone with every move, which is slow.',
    interactions: ['paint.light.azimuth', 'paint.light.elevation'],
  },
  'paint.light.azimuth': {
    meaning:
      "Which way around the figure the key light comes from. With the light fixed in the world it is a compass bearing, measured about the vertical from the +x axis toward +y; with it fixed to the camera, positive is the viewer's left. Turning it swings the terminator and the cast shadow around the form, so the values change place.",
    unit: '°',
    interactions: ['paint.light.elevation', 'paint.light.worldFixed'],
  },
  'paint.light.elevation': {
    meaning:
      'How high the key light stands above the table, in degrees: 0 is level with it, 90 straight overhead. A low light stretches the cast shadow far across the table and rakes across the form; a high light pulls the shadow in under the figure and lights its top. Below 0 the light comes from under the table.',
    unit: '°',
    interactions: ['paint.light.azimuth', 'paint.light.shadows'],
  },
  'paint.light.intensity': {
    meaning:
      "How strongly the key light lights the lit side. It scales how squarely a surface faces the lamp before the value plan reads it, so below 1 the lit side climbs less far toward the highlight (low enough and it stays in the half-tones), and above 1 the light and the highlight spread over more of the form. At 0 the whole lit side is one flat value, the darkest half-tone. It leaves the shadows alone: their values come from the plan.",
    interactions: ['paint.value.lightTurn', 'paint.value.lightHi', 'paint.curves.lightResponse'],
  },
  'paint.light.ambient': {
    meaning:
      'The light that fills the shadows from everywhere. In the form shadow it lifts the reflected light on the far side of the core band toward its ceiling and never past it, and it supplies part of the share of the light that takes on the environment colour. Past about 0.45 more ambient adds no more lift, and it cannot turn a shadow into a half-tone, because the ceiling is set by the reflected share.',
    interactions: ['paint.value.reflectedShare', 'paint.light.sky', 'paint.light.bounce', 'paint.environment.absorption'],
  },
  'paint.light.sky': {
    meaning:
      'Light from the sky onto up-facing surfaces. In the form shadow, up-facing surfaces take it as reflected light (lifting that band toward its ceiling and no further), and it adds to the share of the light that takes on the environment colour. Past about 0.3 more sky adds no more lift; 0 removes the sky from the shadows.',
    interactions: ['paint.value.reflectedShare', 'paint.light.ambient', 'paint.light.bounce', 'paint.environment.absorption'],
  },
  'paint.light.bounce': {
    meaning:
      "Light bounced up off the table onto surfaces that face down. It builds the reflected light on the underside of the shadow, always held under the darkest half-tone; the ambient light and the sky still lift the shadow's far side without it, so 0 removes the table's bounce and not the lift altogether. It also decides where reflected-light strokes are laid: only where the bounce reaching a downward-facing surface is at least the minimum, so at 0 there are none unless the minimum is 0 too. Past about 0.15 more bounce adds no more lift, though the stroke test keeps counting.",
    interactions: ['paint.value.reflectedShare', 'paint.detect.reflectedMin', 'paint.curve.reflectedBounceMix', 'paint.light.ambient', 'paint.light.sky'],
  },
  'paint.light.shadows': {
    meaning:
      'Whether the figure casts a shadow, onto the table and onto itself, on the live path. On casts shadows from the key light; off turns cast shadows off, so the table and the lit parts carry no shadow of the figure, while the form shadow and the terminator stay. The baked painting (the default) always casts its shadows, so there this setting has no effect.',
    interactions: ['paint.value.castPlateau', 'paint.value.castContact', 'paint.light.elevation'],
  },

  // ---- environment ----
  'paint.environment.hue': {
    meaning:
      'The colour of the surrounding light, as a hue in degrees on the colour wheel (a cool blue room light, at the default). It only shows where the environment has some colour and the object takes it in, and mostly in the dim parts, where ambient light is a large share of what lights the surface.',
    unit: '°',
    interactions: ['paint.environment.chroma', 'paint.environment.absorption'],
  },
  'paint.environment.chroma': {
    meaning:
      'How coloured the environment light is: 0 is neutral and larger is a more strongly coloured room. It leans the shadows and the ambient-lit parts toward the environment hue, never changing their lightness, so it recolours the picture without moving a value.',
    interactions: ['paint.environment.hue', 'paint.environment.absorption'],
  },
  'paint.environment.absorption': {
    meaning:
      "How much the object takes the environment's colour in. 0 ignores it altogether; 1 lets the ambient share of the light tint the object fully. The tint is strongest where the ambient light is most of what lights a surface, so it shows in the shadows and hardly at all in the light.",
    interactions: ['paint.environment.hue', 'paint.environment.chroma', 'paint.light.ambient', 'paint.light.sky', 'paint.light.bounce'],
  },
  'paint.environment.occlusion': {
    meaning:
      'How much creases and contacts darken. Where the figure meets the table, the cast shadow goes down to its darkest contact value and the form shadow loses its bounce, so a contact reads as a dark crease. It never darkens the light family. 0 turns it off; the higher it is, the darker the contact.',
    interactions: ['paint.environment.occlusionRadiusPx', 'paint.value.castContact'],
  },
  'paint.environment.occlusionRadiusPx': {
    meaning:
      'How far from a contact the darkening reaches, in screen pixels. A small radius is a tight dark crease right at the contact; a large one is a broad, soft darkening round it. It has no effect while the occlusion is 0.',
    unit: 'px',
    interactions: ['paint.environment.occlusion', 'paint.value.castContact'],
  },

  // ---- stroke detection ----
  'paint.detect.formBandNL': {
    meaning:
      'How wide a band round the terminator gets form-turning strokes, in N·L (0 is the terminator; larger reaches farther toward the lamp and into the shadow). Wider puts the curved strokes that turn round the form over more of the figure; narrower confines them to a thin line at the terminator. Strokes never start in the deep core shadow.',
    unit: 'N·L',
    interactions: ['paint.roles.form.density', 'paint.value.terminatorSoftness'],
  },
  'paint.detect.scumbleGradient': {
    meaning:
      'The steepest change of value, per screen pixel, that a dry scumble stroke may lie over, inside a transition between zones. Higher scumbles steeper transitions, so more of the half-tone area is scumbled; 0 turns scumbling off. Wide, soft turns (a lit sphere, a soft terminator) qualify first.',
    interactions: ['paint.detect.scumbleMinPx', 'paint.value.lightSoftness', 'paint.roles.scumble.density'],
  },
  'paint.detect.scumbleMinPx': {
    meaning:
      'How wide, in screen pixels, a gentle transition must be before it is scumbled. Raising it confines scumbling to broad, soft transitions and drops it from narrow ones; 0 scumbles any gentle transition however thin.',
    unit: 'px',
    interactions: ['paint.detect.scumbleGradient'],
  },
  'paint.detect.dabTopFraction': {
    meaning:
      'What share of the value maxima (the brightest spots, at least 0.8) get a highlight dab. There is always at least one dab where there is a highlight. Raise it for more dabs, scattered over more of the lit surface.',
    interactions: ['paint.detect.dabMinPx'],
  },
  'paint.detect.dabMinPx': {
    meaning:
      'The least distance between two highlight dabs, in screen pixels. Larger spreads the dabs apart, so a broad highlight gets one dab where a small value would give several touches side by side.',
    unit: 'px',
    interactions: ['paint.detect.dabTopFraction'],
  },
  'paint.detect.glazeBelow': {
    meaning:
      'Glaze strokes (thin and transparent) go over the core and cast shadows whose value is below this. Raising it lets glaze climb into the lighter shadows, so more of the shadow is glazed; lowering it keeps glazes to the darkest core.',
    interactions: ['paint.roles.glaze.density', 'paint.value.corePlateau'],
  },
  'paint.detect.reflectedMin': {
    meaning:
      'How much bounce a downward-facing surface needs before it gets reflected-light strokes: the bounce light times how squarely the surface faces down must reach this. Higher confines reflected strokes to the underside of the form; 0 allows them wherever the reflected zone is.',
    interactions: ['paint.light.bounce', 'paint.roles.reflected.density'],
  },
  'paint.detect.edgeMinContrast': {
    meaning:
      'The least difference of value between the two sides of a boundary for it to count as an edge. Below it no edge strokes are laid along the boundary and the strokes beside it take no behaviour from it. A block-in or form stroke can still stop or bleed at such a faint boundary, because the planes record every boundary whatever its contrast. Raise it to drop the faint edges, a quieter, less drawn picture; lower it to find even the faintest.',
    interactions: ['paint.detect.edgeReachPx'],
  },
  'paint.detect.edgeReachPx': {
    meaning:
      'How near an edge a stroke must be, in screen pixels, to take its behaviour from it: distinct at a hard edge, blended at a soft one, dissolving at a lost one. Larger lets edges shape the brushwork farther from them, so more of the picture responds to its edges; smaller confines the effect to strokes right on an edge. Live, the figure\'s own outline is an edge like any other; in the baked painting the outline is drawn per frame and is not part of the edge field the strokes read, though the creases, borders, terminator and plane boundaries are.',
    unit: 'px',
    interactions: ['paint.detect.edgeMinContrast'],
  },

  // ---- the value plan ----
  'paint.value.halfLo': {
    meaning:
      'The value of the darkest half-tone, where the light meets the terminator, from black to white. Raising it lightens the half-tones, most at the terminator and less and less toward the light, while the light and the highlight stay put. It also raises the ceiling the reflected light can reach, and the core shadow is held under it so the shadow always stays darker than the darkest half-tone.',
    interactions: ['paint.value.corePlateau', 'paint.value.reflectedShare', 'paint.value.halfHi', 'paint.curves.value'],
  },
  'paint.value.halfHi': {
    meaning:
      'The value the half-tone ramp climbs to by the point where it turns into light. Raising it lightens the middle of the half-tone, most near that turn and not at the terminator or in the light. The gap between this and the darkest half-tone is how much the half-tone gradates; it is held at least as high as the darkest half-tone.',
    interactions: ['paint.value.halfLo', 'paint.value.lightLo', 'paint.value.lightTurn'],
  },
  'paint.value.lightLo': {
    meaning:
      'The value where the light begins, just past the soft turn from the half-tone. Raising it lightens the light just past that turn and leaves the terminator and the highlight alone. The step from the half-tone up to here is the visible jump into the light: close the gap and the lit side becomes one smooth ramp, open it and the light reads as a separate, brighter plane.',
    interactions: ['paint.value.halfHi', 'paint.value.lightHi', 'paint.value.lightSoftness'],
  },
  'paint.value.lightHi': {
    meaning:
      'The brightest value, the highlight, where the surface faces the lamp square on (N·L of 1). Raise it for a stronger glint: it lightens only the top of the light, from the turn up to the lamp-facing point. It is held at least as high as the start of the light.',
    interactions: ['paint.value.lightLo', 'paint.light.intensity'],
  },
  'paint.value.lightTurn': {
    meaning:
      'Where, across the lit side, the half-tone turns into light, in N·L (0 at the terminator, 1 facing the lamp). Higher keeps the half-tone going farther and shrinks the light to a small area round the lamp-facing point; lower gives the light more of the form.',
    unit: 'N·L',
    interactions: ['paint.value.lightSoftness', 'paint.light.intensity', 'paint.curves.lightResponse'],
  },
  'paint.value.lightSoftness': {
    meaning:
      'How wide the turn from half-tone to light is, in N·L. Wide is a smooth, classical gradation with no visible boundary; near 0 it is a distinct step, a boundary you can see. Wide, soft turns are also where scumble strokes appear.',
    unit: 'N·L',
    interactions: ['paint.value.lightTurn', 'paint.detect.scumbleGradient'],
  },
  'paint.value.terminatorSoftness': {
    meaning:
      "How wide the edge between the light and the form shadow, the terminator, is, in N·L, centred on N·L = 0. At the default it is crisper than the other two turns; wider is a blurred, gentle gradient from light to shadow, and the brushwork follows: the edges at the terminator go soft, then lost (their hardness is scaled by 0.1 over the softness, to no less than a fifth, so past 0.5 every edge there is lost), and the underpainting's band widens. The change is greatest between 0.1 and 0.5.",
    unit: 'N·L',
    interactions: [
      'paint.edges.lostBelow',
      'paint.edges.softBelow',
      'paint.edges.firmBelow',
      'paint.edges.stopAt',
      'paint.edges.wContrast.0',
      'paint.edges.wCurvature.0',
      'paint.edges.wFocal.0',
      'paint.edges.wLight.0',
      'paint.edges.wDepth.0',
      'paint.detect.formBandNL',
      'paint.value.coreWidth',
    ],
  },
  'paint.value.coreWidth': {
    meaning:
      'How far into the shadow the core shadow, the darkest band, extends from the terminator, in N·L. Wider makes a broader band of deepest dark before the reflected light starts to lift it; narrower lets the reflected light begin right at the terminator. A softer terminator pushes the start of the lift out by the extra half-width of its edge, so the core stays as dark.',
    unit: 'N·L',
    interactions: ['paint.value.corePlateau', 'paint.value.reflectedSoftness', 'paint.value.terminatorSoftness'],
  },
  'paint.value.corePlateau': {
    meaning:
      'The value of the core shadow, the darkest band of the form shadow. Lower is a deeper shadow. It is always held at least 0.02 under the darkest half-tone, so no setting can make the core as light as the half-tone.',
    interactions: ['paint.value.halfLo', 'paint.value.reflectedShare', 'paint.value.coreWidth', 'paint.detect.glazeBelow'],
  },
  'paint.value.reflectedShare': {
    meaning:
      'How far the reflected light may climb from the core toward the darkest half-tone, as a share of the gap between them. 0 holds the whole shadow at the core value, with no reflected light; a larger share is a stronger lift; the share is held under 0.9, so it never reaches the half-tone. The cast shadow is held under the same ceiling.',
    interactions: ['paint.value.halfLo', 'paint.value.corePlateau', 'paint.light.bounce', 'paint.light.ambient', 'paint.light.sky', 'paint.value.castPlateau'],
  },
  'paint.value.reflectedSoftness': {
    meaning:
      'How wide the transition from the core shadow to the reflected light is, in N·L: wide is a gentle lightening of the underside, narrow a distinct band of reflected light.',
    unit: 'N·L',
    interactions: ['paint.value.coreWidth', 'paint.value.reflectedShare'],
  },
  'paint.value.castPlateau': {
    meaning:
      'The value of the cast shadow on the table away from the contact. It is never lighter than the reflected-light ceiling, so a cast shadow is always a shadow value whatever is set here.',
    interactions: ['paint.value.castContact', 'paint.value.reflectedShare', 'paint.light.shadows'],
  },
  'paint.value.castContact': {
    meaning:
      'The value of the cast shadow right at the contact, where the figure meets the table. It is never lighter than the cast shadow away from the contact, and the shadow darkens toward it as the occlusion takes hold, so a lower value gives a darker contact.',
    interactions: ['paint.value.castPlateau', 'paint.environment.occlusion', 'paint.environment.occlusionRadiusPx'],
  },
  'paint.value.deviation': {
    meaning:
      'A smooth, seeded wander of the value across the surface, by up to this much either way, so no patch is quite the value the plan says: the painter is not a machine. 0 is a perfect gradation; larger gives a visibly patchier surface. Within a plane it is scaled by the plane gradient.',
    interactions: ['paint.edges.planeGradient'],
  },

  // ---- the lighting curve ----
  'paint.curve.lSlope': {
    meaning:
      "How strongly the colour's lightness follows the value plan: a stroke's lightness is the colour's own plus this times its value away from the pivot. 0 gives every value the same lightness as the local colour, so only hue and colour strength carry the form and the figure goes flat; larger exaggerates the fall-off toward near-black shadows and near-white lights. Line marks use 55% of it and highlight dabs 135%.",
    interactions: ['paint.curve.lPivot', 'paint.curves.lAdjust'],
  },
  'paint.curve.lPivot': {
    meaning:
      'The value at which the colour keeps its own lightness. Values above it are lightened, below it darkened (by the slope). Raising it darkens the whole figure, because more of it falls below the pivot; lowering it lightens the whole figure.',
    interactions: ['paint.curve.lSlope', 'paint.curves.lAdjust'],
  },
  'paint.curve.cBase': {
    meaning:
      "The share of the colour's own strength kept at the two ends of the value range, the deepest shadow and the brightest light. Low mutes the extremes strongly and concentrates colour in the half-tones; 1 or more keeps full colour even at the extremes.",
    interactions: ['paint.curve.cPeak', 'paint.curves.cAdjust'],
  },
  'paint.curve.cPeak': {
    meaning:
      'How much extra colour strength the half-tones get above the base: the colour peaks at the base plus this. Raise it for more vivid half-tones; 0 removes the peak, so the colour has the same strength at every value.',
    interactions: ['paint.curve.cBase', 'paint.curve.cCentre', 'paint.curve.cWidth'],
  },
  'paint.curve.cCentre': {
    meaning:
      'The value at which the colour is most vivid. A middle value puts the peak in the half-tones; moving it down brings the most vivid colour into the shadows, up toward the lights.',
    interactions: ['paint.curve.cPeak', 'paint.curve.cWidth'],
  },
  'paint.curve.cWidth': {
    meaning:
      'How wide the colour peak is along the value axis. A narrow peak concentrates colour in a thin band of half-tone; a wide one spreads vivid colour across the whole range of values.',
    interactions: ['paint.curve.cPeak', 'paint.curve.cCentre'],
  },
  'paint.curve.warmHue': {
    meaning:
      'The hue the colour leans toward in the light, as degrees on the colour wheel (an orange-yellow at the default). The lean is relative to the local colour: a red moves toward its own warmer neighbour, not to this absolute hue, and the lean is capped by the maximum hue shift.',
    unit: '°',
    interactions: ['paint.curve.kWarm', 'paint.curve.shiftMax', 'paint.curve.tintWarm'],
  },
  'paint.curve.coolHue': {
    meaning:
      'The hue the colour leans toward in the shadow, as degrees on the colour wheel (a blue-violet at the default). The lean is relative to the local colour: a terracotta moves toward its own cooler neighbour (a dark red), never all the way to this hue, and the lean is capped by the maximum hue shift.',
    unit: '°',
    interactions: ['paint.curve.kCool', 'paint.curve.shiftMax', 'paint.curve.tintCool'],
  },
  'paint.curve.kWarm': {
    meaning:
      'How far toward the warm hue the colour leans in the light, as a share of the way there: 0 no lean, 1 all the way (before the cap). Raise it for warmer lights.',
    interactions: ['paint.curve.warmHue', 'paint.curve.shiftMax'],
  },
  'paint.curve.kCool': {
    meaning:
      'How far toward the cool hue the colour leans in the shadow, as a share of the way there: 0 no lean, 1 all the way (before the cap). Raise it for cooler shadows.',
    interactions: ['paint.curve.coolHue', 'paint.curve.shiftMax'],
  },
  'paint.curve.shiftMax': {
    meaning:
      "The most, in degrees, that the warm and cool swing may turn a colour's hue, either side: a terracotta's shadow stays a dark red and never goes purple. It is also the limit every environment, sky, bounce and warm or cool tint is held to (this plus 3 degrees from the colour's own hue). It does not limit the colour distortion of the brush-load mix or the planes' hue steps, which add on top. 0 switches the warm and cool swing off.",
    unit: '°',
    interactions: [
      'paint.curve.kWarm',
      'paint.curve.kCool',
      'paint.curve.warmHue',
      'paint.curve.coolHue',
      'paint.curve.tintWarm',
      'paint.curve.tintCool',
      'paint.curve.skyTint',
      'paint.curve.bounceTint',
      'paint.curve.reflectedBounceMix',
      'paint.environment.absorption',
    ],
  },
  'paint.curve.accentHue': {
    meaning:
      "The hue the half-tones are nudged toward, as degrees on the colour wheel (a yellow at the default): a painter's half-tone accent, a slightly different colour in the middle values. It peaks around a value of 0.56 and fades out over a few tenths either side.",
    unit: '°',
    interactions: ['paint.curve.accentMax'],
  },
  'paint.curve.accentMax': {
    meaning:
      'The most the half-tones may be turned toward the accent hue, in degrees either way. 0 removes the half-tone accent; larger gives the half-tones a more distinct colour of their own.',
    unit: '°',
    interactions: ['paint.curve.accentHue'],
  },
  'paint.curve.planeStepA': {
    meaning:
      'The main hue step between planes, in degrees: every plane of the form gets a hue offset that depends on which way it faces. It runs up to this many either way, so neighbouring planes differ in hue and read as separate touches of paint. It adds on top of the warm and cool swing and is not capped by it; with both steps at 0 every plane has the same hue.',
    unit: '°',
    interactions: ['paint.curve.planeStepB'],
  },
  'paint.curve.planeStepB': {
    meaning:
      'A second, finer hue step between planes, in degrees, added to the first: together they make neighbouring planes differ by roughly 8 to 20 degrees at the defaults. 0 leaves only the main step.',
    unit: '°',
    interactions: ['paint.curve.planeStepA'],
  },
  'paint.curve.tintWarm': {
    meaning:
      'A warm tint added to every colour in the lights, leaning greys warm; it grows from nothing at mid-values to full at a value of 0.9 and above. Unlike the swing it is not relative to the colour, so it is what gives a grey a temperature. It never changes lightness.',
    interactions: ['paint.curve.warmHue', 'paint.curve.shiftMax'],
  },
  'paint.curve.tintCool': {
    meaning:
      'A cool tint added to every colour in the shadows, leaning greys cool; it grows from nothing at mid-values to full at a value of 0.1 and below. Unlike the swing it is not relative to the colour, so it is what gives a grey shadow its temperature. It never changes lightness.',
    interactions: ['paint.curve.coolHue', 'paint.curve.shiftMax'],
  },
  'paint.curve.skyTint': {
    meaning:
      'How strongly up-facing surfaces take a tint of sky colour. It fades down to a quarter by the highlights, so the lights stay their own colour while the tops of shadowed forms go cool. It does not depend on the sky light: that lifts values, this tints colour.',
    interactions: ['paint.curve.skyHue', 'paint.curve.shiftMax'],
  },
  'paint.curve.skyHue': {
    meaning: 'The colour of the sky tint, as a hue in degrees (a blue at the default). It only shows where the sky tint is above 0.',
    unit: '°',
    interactions: ['paint.curve.skyTint'],
  },
  'paint.curve.bounceTint': {
    meaning:
      'How strongly down-facing surfaces take a tint of the colour bounced from the table: the warm glow on the underside of a form. It fades to about 40% by the highlights. It does not depend on the bounce light: that lifts values, this tints colour.',
    interactions: ['paint.curve.bounceHue', 'paint.curve.shiftMax'],
  },
  'paint.curve.bounceHue': {
    meaning: 'The colour of the bounce tint, as a hue in degrees (a warm orange at the default). It only shows where the bounce tint is above 0.',
    unit: '°',
    interactions: ['paint.curve.bounceTint'],
  },
  'paint.curve.reflectedBounceMix': {
    meaning:
      "How far the reflected-light band is pulled toward the bounce colour. That colour is the canvas's own tone made a little darker and about twice as strong; 0 pulls not at all, and 1 completely once the reflected light has lifted a good part of its range. It changes the band's hue and colour strength only; its value is the plan's, so it can never lift a shadow into the half-tones.",
    interactions: ['paint.light.bounce', 'paint.canvas.tone.0', 'paint.canvas.tone.1', 'paint.canvas.tone.2', 'paint.curve.shiftMax'],
  },
  'paint.curve.devL': {
    meaning:
      'A smooth wander in lightness, so the colour does not follow the formula exactly: not perfect, as a hand is not. It comes in three parts: a wave along the value axis (about this much either way, up to about twice it), a second smooth field across the surface that the strokes of the surface add (up to about twice again), and a small jitter of each stroke, so the strongest drift is roughly four times this before the jitter. 0 is a machine-perfect colour; larger gives a patchier, more broken surface.',
    interactions: [],
  },
  'paint.curve.devC': {
    meaning:
      'A smooth wander in colour strength, so the saturation of a stroke varies a little as a mix does. It is a fraction of the colour, and it comes in three parts: a wave along the value axis (about this much either way, up to about twice it), a second smooth field across the surface that the strokes of the surface add (up to about twice again), and a small jitter of each stroke, so the strongest drift is roughly four times this before the jitter. 0 removes it; larger gives patches of duller and more vivid colour.',
    interactions: [],
  },
  'paint.curve.devH': {
    meaning:
      'A smooth wander in hue, so a colour drifts a little warmer or cooler from place to place. It comes in three parts: a wave along the value axis (about this many degrees either way, up to about twice that), a second smooth field across the surface that the strokes of the surface add (up to about twice again), and a small jitter of each stroke, so the strongest drift is roughly four times this before the jitter. 0 removes it. It is small by design; the brush-load mix is what varies hue strongly.',
    unit: '°',
    interactions: [],
  },
  'paint.curve.colormapHue': {
    meaning:
      "On surfaces coloured by data (a colour map), the share of the hue swing, the accent, the planes' steps and the tints that is kept, so the colour bar stays true to the data. 0 leaves data colours alone; 1 treats them like any painted colour.",
    interactions: ['paint.mix.colormapScale'],
  },

  // ---- the brush-load mix (colour distortion) ----
  'paint.mix.strength': {
    meaning:
      "The master strength of the colour distortion: every load of paint on the brush is mixed a little differently from the lighting curve's colour, as a painter's mixes never repeat. 0 turns it off, so every stroke is exactly the curve's colour; larger is a stronger distortion. It is scaled by each role's own multiplier and over value by the mix strength curve, and the underpainting takes the block-in's mix at half strength.",
    interactions: ['paint.curves.mixAmount', 'paint.mix.hueMax', 'paint.mix.chromaMax'],
  },
  'paint.mix.hueMin': {
    meaning:
      'The smallest hue turn a paint load gets, in degrees. Each load is turned by an amount between this and the largest, one way or the other, and neighbouring loads tend to go opposite ways, so patches of the same colour differ gently. It adds on top of the capped warm and cool swing.',
    unit: '°',
    interactions: ['paint.mix.hueMax', 'paint.mix.strength'],
  },
  'paint.mix.hueMax': {
    meaning:
      'The largest hue turn a paint load gets, in degrees. Larger gives a more obviously broken, varied colour, like loosely juxtaposed hues in a painting; with the smallest and this both at 0, only the small per-stroke jitter of about two degrees is left. Scaled by the strength and the role.',
    unit: '°',
    interactions: ['paint.mix.hueMin', 'paint.mix.strength'],
  },
  'paint.mix.chromaMin': {
    meaning:
      "How dull a load may be, as a multiple of the colour's strength, at full strength of the mix: below 1 dulls, and 0.5 would be a load at most half as strong. Each load's colour strength is multiplied by a factor between this and the vivid limit, alternating dull and vivid from one load to the next. 1 never dulls a colour.",
    unit: '×',
    interactions: ['paint.mix.chromaMax', 'paint.mix.chromaBias'],
  },
  'paint.mix.chromaMax': {
    meaning:
      "How vivid a load may be, as a multiple of the colour's strength, at full strength of the mix: above 1 intensifies. Widening this and the dull limit together gives a more broken, jewel-and-grey surface. 1 never makes a colour more vivid.",
    unit: '×',
    interactions: ['paint.mix.chromaMin', 'paint.mix.chromaBias', 'paint.mix.strength'],
  },
  'paint.mix.valueHold': {
    meaning:
      "How tightly a load's lightness is held to the lighting curve's value (within this much, in lightness), for loads that do not take a value step. The natural wander is about 0.004 and rarely more than 0.012, so raising this above about 0.012 changes nothing; lowering it below that trims the wander, and 0 pins every such load to the plan's lightness.",
    interactions: ['paint.mix.valueStepFraction'],
  },
  'paint.mix.valueStepFraction': {
    meaning:
      'The share of loads that also take a step in value, a lighter or darker mix of nearly the same colour: 0 never steps, 1 steps every load. A step never carries a shadow stroke into the half-tones or the reverse.',
    interactions: ['paint.mix.valueStep', 'paint.mix.valueBias', 'paint.mix.valueHold'],
  },
  'paint.mix.valueStep': {
    meaning:
      "How big the value step of a stepped load is, in lightness either way. Bigger gives a visible patchwork of lighter and darker touches inside one colour; it can never move a stroke across the line between the shadow and the light, because the value plan's two families stay apart.",
    interactions: ['paint.mix.valueStepFraction', 'paint.mix.valueBias'],
  },
  'paint.mix.greyChroma': {
    meaning:
      'A colour counts as a grey when its colour strength is below this. A grey has no hue to turn, so instead of a hue rotation it is nudged toward warm, cool, green-grey or violet-grey. Raise it to treat more of the muted colours as greys; lower it and fewer colours are, so more of them get the hue turn like any other.',
    interactions: ['paint.mix.greyVecMin', 'paint.mix.greyVecMax'],
  },
  'paint.mix.greyVecMin': {
    meaning:
      'The smallest nudge a grey load gets toward its warm, cool, green or violet lean, as a distance across the colour plane. Larger leans greys more visibly; 0 leaves them neutral.',
    interactions: ['paint.mix.greyVecMax', 'paint.mix.greyChroma'],
  },
  'paint.mix.greyVecMax': {
    meaning:
      "The largest nudge a grey load gets toward its warm, cool, green or violet lean, as a distance across the colour plane. Raise it for greys that clearly lean from patch to patch, as a painter's mixed greys do.",
    interactions: ['paint.mix.greyVecMin', 'paint.mix.greyChroma'],
  },
  'paint.mix.flipHue': {
    meaning:
      'The chance that the next load turns hue the opposite way from the last, so that neighbours contrast gently instead of averaging out: near 1 is usually opposite, 0.5 a coin toss, 0 always the same way. It acts on line marks and on edge strokes, which are mixed in loads, with one exception: in the baked painting the view\'s own outline ignores it (its strokes take their mix by patch of surface), while on the live path the outline takes it like any other edge stroke. The strokes of the surface take their mix from a patch of surface, where neighbouring patches alternate, and ignore it.',
    interactions: ['paint.mix.hueBias'],
  },
  'paint.mix.flipChroma': {
    meaning:
      'The chance that the next load swings colour strength the opposite way from the last: near 1 a dull load is usually followed by a vivid one. It acts on line marks and on edge strokes, which are mixed in loads, with one exception: in the baked painting the view\'s own outline ignores it (its strokes take their mix by patch of surface), while on the live path the outline takes it like any other edge stroke. The strokes of the surface alternate patch by patch and ignore it.',
    interactions: ['paint.mix.chromaBias'],
  },
  'paint.mix.drift': {
    meaning:
      "How much a load's colour offset fades as the brush runs out: by the last stroke of a load the distortion is this fraction of the first. 1 is no fade, a load stays one even mix; 0 fades right back to the plain curve colour. Strokes on a surface each take a seeded place along the fade.",
    interactions: ['paint.mix.loadMin', 'paint.mix.loadMax'],
  },
  'paint.mix.loadMin': {
    meaning:
      'The fewest strokes in one load of paint, for line marks and edge strokes: each run of this many consecutive strokes of one role shares one mix. Larger loads mean longer stretches of a line or edge in one colour variation. Live this reaches every edge stroke, outlines included; in the baked painting it reaches the terminator, cast-shadow, crease, border and plane-boundary strokes, and the view\'s own outline ignores it. Strokes on a surface take their mix from a patch of surface instead and ignore it.',
    interactions: ['paint.mix.loadMax', 'paint.mix.loadBreakPx', 'paint.mix.drift'],
  },
  'paint.mix.loadMax': {
    meaning:
      'The most strokes in one load of paint, for line marks and edge strokes. Larger gives longer unbroken stretches in one colour variation; set equal to the smallest for loads of one size. Live this reaches every edge stroke, outlines included; in the baked painting it reaches the terminator, cast-shadow, crease, border and plane-boundary strokes, and the view\'s own outline ignores it. Strokes on a surface take their mix from a patch of surface instead and ignore it.',
    interactions: ['paint.mix.loadMin', 'paint.mix.loadBreakPx', 'paint.mix.drift'],
  },
  'paint.mix.loadBreakPx': {
    meaning:
      'How far apart, in screen pixels, two consecutive strokes may be and still share a load: a painter reloads the brush when they move across the canvas. Larger lets one load run across a longer line or edge before it is remixed; smaller remixes after a short move. It acts on line marks and edge strokes (live, every edge stroke; in the baked painting, all but the view\'s own outline), measured on the screen live and in the world, at the reference scale, when baked.',
    unit: 'px',
    interactions: ['paint.mix.loadMin', 'paint.mix.loadMax'],
  },
  'paint.mix.loadCell': {
    meaning:
      'The size of a patch of surface that shares one paint mix, in world units: strokes on a surface take their mix from the patch they start on, and neighbouring patches tend to go opposite ways. Small is a fine patchwork of different mixes; large is broad areas of one mix. The patch halves each time the zoom doubles, so the patchwork stays about a brush wide on the screen.',
    unit: 'world units',
    interactions: [],
  },
  'paint.mix.colormapScale': {
    meaning:
      'On surfaces coloured by data (a colour map), the share of the hue and colour-strength distortion that is kept, with lightness held within a few thousandths so the data colour stays true. 0 never distorts data colours; 1 distorts them like any painted colour.',
    interactions: ['paint.curve.colormapHue'],
  },
  'paint.mix.hueBias': {
    meaning:
      'The plus or minus balance of the hue turn. 0 is symmetric; positive makes the turn the way red goes to orange, yellow, green and blue come up more often, in a share of the loads equal to a half plus half the bias (so 1 is always); negative turns the other way. It tips all the painting\'s mixes one way round the colour wheel.',
    interactions: ['paint.mix.flipHue'],
  },
  'paint.mix.chromaBias': {
    meaning:
      'The plus or minus balance of the colour-strength swing. 0 is symmetric; positive makes the vivid loads come up more often, so the painting runs more saturated; negative makes the dull ones, so it runs greyer. The extremes allow only one direction.',
    interactions: ['paint.mix.chromaMin', 'paint.mix.chromaMax', 'paint.mix.flipChroma'],
  },
  'paint.mix.valueBias': {
    meaning:
      'The plus or minus balance of the value steps. 0 is symmetric; positive makes the steps go lighter more often, so the stepped touches are lighter than their ground; negative makes them darker. It only matters where loads take a value step.',
    interactions: ['paint.mix.valueStep', 'paint.mix.valueStepFraction'],
  },
  'paint.mix.roleBlock': {
    meaning:
      'How much of the colour distortion block-in strokes take, as a multiplier on the master strength (0 none, 1 full, 2 double). The underpainting takes the block-in\'s mix too, at half strength, so this moves the colour of the first layer under every stroke as well.',
    interactions: ['paint.mix.strength'],
  },
  'paint.mix.roleForm': {
    meaning:
      'How much of the colour distortion form-turning strokes take, as a multiplier on the master strength (0 none, 1 full, 2 double). Below 1 is a milder mix than the block-in beneath.',
    interactions: ['paint.mix.strength'],
  },
  'paint.mix.roleScumble': {
    meaning:
      'How much of the colour distortion scumble strokes take, as a multiplier on the master strength (0 none, 1 full, 2 double).',
    interactions: ['paint.mix.strength'],
  },
  'paint.mix.roleGlaze': {
    meaning:
      'How much of the colour distortion glaze strokes take, as a multiplier on the master strength (0 none, 1 full, 2 double). Reflected-light strokes take their mix strength from this too.',
    interactions: ['paint.mix.strength'],
  },
  'paint.mix.roleLine': {
    meaning:
      "How much of the colour distortion line marks take, as a multiplier on the master strength (0 none, 1 full, 2 double). A line stays crisp and exact whatever this is; it only varies the line's colour a little from piece to piece.",
    interactions: ['paint.mix.strength'],
  },
  'paint.mix.roleEdge': {
    meaning:
      'How much of the colour distortion edge strokes take, as a multiplier on the master strength (0 none, 1 full, 2 double). A small value keeps an edge one colour with a hint of variation.',
    interactions: ['paint.mix.strength'],
  },
  'paint.mix.roleDab': {
    meaning:
      'How much of the colour distortion highlight dabs take, as a multiplier on the master strength (0 none, 1 full, 2 double). A small value keeps the highlights clean.',
    interactions: ['paint.mix.strength'],
  },

  // ---- edges ----
  'paint.edges.wShadowDist': {
    meaning:
      'How much nearness to what casts the shadow counts toward the hardness of cast-shadow edges (these edges only). A cast shadow is hard and dark where it meets the thing that casts it and softens away from it, over roughly 8 to 110 screen pixels (measured from the shape that casts it, in the baked painting; from the figure\'s outline on the screen, live). Raise it for a shadow edge that is crisp at the contact and lost farther out; 0 makes the edge the same all along.',
    interactions: ['paint.edges.wContrast.2', 'paint.edges.wDepth.2'],
  },
  'paint.edges.noise': {
    meaning:
      'How much a slow, seeded waver is added to the hardness of an edge, so a long edge can run firm, then soft, then firm again: found and lost along its length, as a painter leaves it. 0 is an even edge; larger is a stronger alternation. The waver is seeded by the surface point, so it does not flicker as you orbit.',
    interactions: ['paint.edges.lostBelow', 'paint.edges.softBelow', 'paint.edges.firmBelow'],
  },
  'paint.edges.lostBelow': {
    meaning:
      "Edges whose hardness is below this are lost: the strokes dissolve into each other with no line between them (they pick up the paint beneath, run out softly and are thinly painted). Raising it loses more of the picture's edges; lowering it finds more. Keep it below the soft limit.",
    interactions: ['paint.edges.softBelow', 'paint.value.terminatorSoftness'],
  },
  'paint.edges.softBelow': {
    meaning:
      'Edges whose hardness is below this (and not lost) are soft: the brush blends across them, picking up the paint beneath and ending softly. Raising it makes more edges soft; lowering it makes them firm sooner. Keep it between the lost and firm limits.',
    interactions: ['paint.edges.lostBelow', 'paint.edges.firmBelow', 'paint.value.terminatorSoftness'],
  },
  'paint.edges.firmBelow': {
    meaning:
      'Edges whose hardness is below this (and not soft) are firm: distinct, with a clear stroke but a little blending. Above it they are hard: crisp, fully loaded strokes that pick up nothing. Raising it softens the hard edges into firm ones; lowering it hardens the picture. Keep it above the soft limit.',
    interactions: ['paint.edges.softBelow', 'paint.value.terminatorSoftness'],
  },
  'paint.edges.stopAt': {
    meaning:
      "A brushstroke is stopped by the boundary between two planes when that boundary's hardness is at least this. Raise it to let strokes run across more boundaries, a more blended look; lower it to stop strokes at softer boundaries, a more faceted look. Between the bleed limit and this, a stroke crosses and goes on for part of its length.",
    interactions: ['paint.edges.bleedAt', 'paint.value.terminatorSoftness'],
  },
  'paint.edges.bleedAt': {
    meaning:
      'A stroke that meets a boundary between planes harder than this, but not hard enough to stop it, bleeds across: it carries on for 60% of the length it had left. Below this it runs on freely. Lower it and more strokes shorten at their boundaries; raise it and most run straight across.',
    interactions: ['paint.edges.stopAt'],
  },
  'paint.edges.planeCellDeg': {
    meaning:
      'How coarsely the form is divided into planes: the direction the surface faces is sorted into cells this many degrees across. Small cells give many small facets, more edges and more separate gradients (many gradients, not one); big cells give a few large planes and a blockier figure. In the baked painting the cells are in world directions, so the planes stay put as you orbit; on the live path they are the directions the surface faces in the view, and shift as it turns.',
    unit: '°',
    interactions: ['paint.edges.planeMinPx', 'paint.edges.planeGradient'],
  },
  'paint.edges.planeMinPx': {
    meaning:
      'Planes smaller than this area, in screen pixels squared, are merged into the neighbouring plane of the same value family that they share most border with, so no tiny slivers of paint are left. Larger merges more, giving fewer, larger planes. In the baked painting (the default) a floor of 216 pixels squared (three triangles of the underpainting lattice) applies whatever is set, so values under that change nothing there; on the live path (baking off, or the light fixed to the camera) the setting is honoured as given, down to a single pixel.',
    unit: 'px²',
    interactions: ['paint.edges.planeCellDeg'],
  },
  'paint.edges.planeGradient': {
    meaning:
      "How much a stroke's own value follows the smooth value plan instead of its plane's average. 0 paints every stroke in a plane at that plane's one value: flat facets with visible steps between them. 1 follows the plan exactly: one smooth gradient and no planes. In between each plane gets its own short gradient, many gradients rather than one.",
    interactions: ['paint.edges.planeCellDeg', 'paint.value.deviation'],
  },

  // ---- particles ----
  'paint.particles.maxPerUnit2': {
    meaning:
      'The most stroke anchors per unit of surface area (the anchors strokes grow from, spaced evenly and never clumped). It caps how finely the picture can be worked when zoomed in: once the screen asks for more strokes than there are anchors, the strokes grow bigger instead of multiplying. More anchors cost more time and memory and only show up close; at the standard framing this is about speed and not look.',
    unit: 'per world unit²',
    interactions: ['paint.particles.targetPer10kPx', 'paint.particles.zoomGrowMax'],
  },
  'paint.particles.targetPer10kPx': {
    meaning:
      "How many strokes cover the picture: the target number for a role of full density, per 10,000 screen pixels (a square 100 pixels on a side). Higher is a denser, fuller cover and lower a sparser one with more underpainting showing between the strokes. It changes the number of strokes and not their size, except zoomed in, where the anchors run short and a higher target grows the strokes to cover, up to the growth cap. Each role's own density scales it.",
    unit: 'per 10,000 px²',
    interactions: ['paint.particles.maxPerUnit2', 'paint.particles.zoomGrowMax', 'paint.particles.dragDensity'],
  },
  'paint.particles.fadeLo': {
    meaning:
      'Where strokes begin to fade as a surface turns edge-on to the viewer, measured by how squarely it faces you (0 edge-on, 1 face-on). Below this a stroke is gone; between this and the full-strength limit it fades in. Raising it makes strokes vanish farther in from the outline, leaving a bare band at the limb where the underpainting and canvas show; lowering it lets strokes run right to the silhouette.',
    interactions: ['paint.particles.fadeHi'],
  },
  'paint.particles.fadeHi': {
    meaning:
      'Where strokes reach full strength as a surface turns toward the viewer, measured by how squarely it faces you (0 edge-on, 1 face-on). Raising it makes the fade at the limb longer and gentler, with strokes only fully solid on surfaces that face you; lowering it makes the fade quick and the strokes solid almost to the outline.',
    interactions: ['paint.particles.fadeLo'],
  },
  'paint.particles.zoomGrowMax': {
    meaning:
      'Zoomed in, the anchors run out and the strokes grow to keep covering the form. This is the most they may grow by, as a multiple of the size they were tuned at. Higher keeps a close-up well covered with bigger strokes; 1 never grows them, so the underpainting shows between the strokes.',
    unit: '×',
    interactions: ['paint.particles.zoomStrokeScale', 'paint.particles.zoomBigMax', 'paint.particles.maxPerUnit2', 'paint.particles.targetPer10kPx'],
  },
  'paint.particles.zoomStrokeScale': {
    meaning:
      'How much the strokes follow the zoom, as a painter picks a bigger brush up close. 0 keeps the strokes the same size on the screen at every zoom (a close-up is then more finely worked); 1 scales them exactly with the zoom, so the painting looks the same at every zoom, only bigger (never past the combined growth ceiling). In between is a compromise.',
    interactions: ['paint.particles.zoomGrowMax', 'paint.particles.zoomBigMax'],
  },
  'paint.particles.zoomBigMax': {
    meaning:
      'The growth that keeps strokes covering the form and the brush that follows the zoom multiply, so this is a hard ceiling on the two together, as a multiple of the tuned size. A stroke six times as big is not a brush mark but a leaf; lower keeps strokes long and brushy and lets the underpainting carry the form, higher allows ever bigger brushes in extreme close-ups.',
    unit: '×',
    interactions: ['paint.particles.zoomGrowMax', 'paint.particles.zoomStrokeScale'],
  },
  'paint.particles.dragDensity': {
    meaning:
      'The share of the strokes drawn in a frame made while the camera is being dragged: 1 draws them all, a lower value thins them for speed and the picture fills back in when the drag ends. The Paint Lab has no slider for it, and at its usual value a drag shows no thinning.',
    interactions: ['paint.particles.targetPer10kPx'],
  },

  // ---- the underpainting ----
  'paint.underpaint.opacity': {
    meaning:
      'How opaque the thin first layer of colour (the imprimatura, laid in the colour the form will be) is. It stops bare canvas showing in the gaps between strokes inside a form: 1 is a solid ground, 0 leaves the gaps bare. The canvas weave and the streaks thin it a little.',
    interactions: ['paint.underpaint.streak', 'paint.canvas.texture'],
  },
  'paint.underpaint.streak': {
    meaning:
      'How much seeded, directional brush streaks break up the underpainting. 0 is a flat, even wash; 1 shows long thin streaks in one brush direction (within about 40 degrees of horizontal), thinning its coverage by up to 30%. Streaks only show where the strokes over it leave gaps.',
    interactions: ['paint.underpaint.opacity'],
  },

  // ---- impasto and the canvas ----
  'paint.impasto.strength': {
    meaning:
      "How strongly the paint's thickness reads as relief. It scales the height of all the paint before it is lit, so the ridges of the bristles and the loaded strokes stand up. 0 is flat paint (the canvas weave still shows through thin paint); larger is heavier relief. Each stroke role's own impasto sets how thick it is before this scales it.",
    interactions: ['paint.impasto.lightElevation', 'paint.impasto.lightAzimuth'],
  },
  'paint.impasto.lightAzimuth': {
    meaning:
      'The direction the relief light rakes the paint from, in degrees on the screen, counter-clockwise from the right (90 is from the top, 180 from the left). Ridges facing the light brighten and the sides turned from it darken. The relief light stays on the screen as you orbit, because the canvas is the screen.',
    unit: '°',
    interactions: ['paint.impasto.lightElevation', 'paint.impasto.strength'],
  },
  'paint.impasto.lightElevation': {
    meaning:
      'How high the relief light stands above the canvas, in degrees. Low is a raking light: long, strong shading on every ridge and a strong relief. High is almost straight on, and the relief flattens out until it nearly disappears.',
    unit: '°',
    interactions: ['paint.impasto.strength', 'paint.impasto.lightAzimuth'],
  },
  'paint.canvas.texture': {
    meaning:
      "How strong the canvas weave is: the relief of its threads and the cloth's own tone, and how much of its tooth a dry brush catches, so a dry stroke skips over the peaks of the weave. 0 is a smooth primed board; larger is a stronger relief of the same threads, whose size is the weave's (see `paint.canvas.weave`). It also lets a little of the weave through the thin underpainting.",
    interactions: ['paint.underpaint.opacity', 'paint.canvas.weave'],
  },
  'paint.canvas.weave': {
    meaning:
      'Which cloth the canvas is woven from: linen is a fine primed linen, duck a coarser cotton duck whose threads are about half again as coarse and whose relief is stronger. It changes the canvas under the paint, its weave and the tooth a dry brush catches, and not the strokes themselves.',
    interactions: ['paint.canvas.texture'],
  },
  'paint.canvas.tone.0': {
    meaning:
      'The lightness of the canvas, from black to white: the colour of the ground the figure is painted on. A darker ground is a darker canvas value, since the value of bare canvas follows its tone, and the bounce colour in the shadows follows it too.',
    interactions: ['paint.canvas.tone.1', 'paint.canvas.tone.2', 'paint.curve.reflectedBounceMix'],
  },
  'paint.canvas.tone.1': {
    meaning:
      "The canvas's tilt along the green to red axis of its colour (negative greener, positive redder). Near 0 is neutral. It tints the whole ground and, through the bounce colour, the reflected light in the shadows.",
    interactions: ['paint.canvas.tone.0', 'paint.canvas.tone.2', 'paint.curve.reflectedBounceMix'],
  },
  'paint.canvas.tone.2': {
    meaning:
      "The canvas's tilt along the blue to yellow axis of its colour (negative bluer, positive yellower); a small positive value is a warm primed-linen cream. It tints the whole ground and, through the bounce colour, the reflected light in the shadows.",
    interactions: ['paint.canvas.tone.0', 'paint.canvas.tone.1', 'paint.curve.reflectedBounceMix'],
  },

  // ---- the curves ----
  'paint.curves.lightResponse': {
    meaning:
      "How the key light's strength becomes the lit fraction, on the lit side only, before the value plan reads it. The horizontal axis is how squarely the surface faces the lamp, the vertical the lit fraction. The straight diagonal leaves the plan as it is; bending the curve up lights the form faster, pushing more of the lit side toward the light and the highlight, and bending it down keeps more of it in the half-tone. The shadows are not affected.",
    interactions: ['paint.light.intensity', 'paint.value.lightTurn'],
  },
  'paint.curves.value': {
    meaning:
      "A tone curve applied last, to the finished value plan, like a painter's levels. The horizontal axis is the plan's value, the vertical the value painted. The diagonal changes nothing; steepening the middle raises contrast, and lifting the low end lifts the shadows. A curve that only ever rises keeps every shadow darker than every light; one that rises and then falls can reorder them.",
    interactions: ['paint.value.halfLo', 'paint.value.corePlateau'],
  },
  'paint.curves.lAdjust': {
    meaning:
      "Over value, an amount added to the lightness of the colour (the vertical axis is the lightness added). Up in the lights brightens the lit paint; up in the darks lifts the colour of the shadows. It changes the colour a stroke is painted in, not the value plan, so the planes and the edges stay where they are.",
    interactions: ['paint.curve.lSlope', 'paint.curve.lPivot'],
  },
  'paint.curves.cAdjust': {
    meaning:
      'Over value, a multiplier on the colour strength (the vertical axis is the multiplier). 1 changes nothing; above 1 at some value makes the colour more vivid there, below 1 duller, and 0 is grey. It stacks on the colour-strength bell of the lighting curve.',
    interactions: ['paint.curve.cBase', 'paint.curve.cPeak'],
  },
  'paint.curves.hAdjust': {
    meaning:
      "Over value, a turn of the hue in degrees (the vertical axis is the turn). Positive turns hues the way red goes to orange, yellow, green, blue and violet; negative the other way. It adds on top of the capped warm and cool swing, so the cap on the swing does not limit it.",
    interactions: [],
  },
  'paint.curves.mixAmount': {
    meaning:
      "Over value, a multiplier on the strength of the brush-load colour distortion (the vertical axis is the multiplier). 1 is as the master strength says; lower at some values calms the distortion there (in the lights, say) and higher exaggerates it. 0 at a value makes the strokes there exactly the lighting curve's colour.",
    interactions: ['paint.mix.strength'],
  },
}

// The literal entries and the two families, together: every PARAM_SCHEMA and CURVE_SCHEMA path, and the extra settings.
export const PAINT_MEANINGS: Meanings = { ...LITERAL, ...ROLE_MEANINGS, ...EDGE_WEIGHT_MEANINGS }

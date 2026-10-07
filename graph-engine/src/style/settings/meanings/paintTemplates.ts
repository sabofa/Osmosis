// The paint meanings that come in families: the eight stroke roles times their
// ten fields (80 settings), and the edge hardness weights times their three kinds
// of edge (15 settings). Each is written as a template with the role or the kind
// filled in, so every one reads correctly for what it is about, and the templates
// carry what is true of that role only (a dab has no density, an edge has no
// bow, a line is always crisp).
//
// Written from the code that consumes them: space/paint/model/roles.ts and
// bake/strokes.ts (the strokes of the surface), model/contours.ts and
// bake/edgeStrokes.ts (edge strokes), model/lines.ts (data lines), model/edges.ts
// and bake/edges.ts (an edge's hardness, its class, and what each class does to
// the brush), model/view.ts (density and growth) and gl/shaders/stroke.ts (load,
// bristles, dryness, wet pickup, impasto).
//
// The first sentence of every meaning stands alone (it is what the guide's tables
// show), so the long description of a role goes in a sentence after it.

import { DEFAULT_PAINT_PARAMS } from '../../../space/paint/params'
import type { Meaning, Meanings } from '../types'

type RoleName = keyof typeof DEFAULT_PAINT_PARAMS.roles
const ROLE_NAMES = Object.keys(DEFAULT_PAINT_PARAMS.roles) as RoleName[]

// A registry path, quoted the way the guide quotes one.
const at = (path: string) => '`' + path + '`'

// What each role is, short, for the first sentence of every field.
const TAG: Record<RoleName, string> = {
  block: 'block-in strokes (the broad first layer)',
  form: 'form-turning strokes (the curved ones across the terminator)',
  scumble: 'scumble strokes (the dry, broken ones)',
  glaze: 'glaze strokes (the thin, transparent ones)',
  reflected: 'reflected-light strokes (the ones in the bounce light of a shadow)',
  dab: 'highlight dabs (the short, thick, loaded touches)',
  edge: 'edge strokes (the ones along outlines and plane boundaries)',
  line: 'line marks (the exact strokes for data)',
}

// What each role is, in full: the second sentence of a role's density and width.
const IS: Record<RoleName, string> = {
  block: 'Block-in strokes are the broad, flat first layer, laid along the planes of the form.',
  form: 'Form-turning strokes are curved strokes that cross the terminator, loaded at the lighter end and stopping where the shadow begins.',
  scumble: 'Scumble strokes are dry, broken strokes over the wide, soft transitions between zones, alternating the lighter and the darker neighbour.',
  glaze: 'Glaze strokes are thin, transparent strokes over the core and cast shadows.',
  reflected: 'Reflected-light strokes lie in the lightened underside of a shadow, where the bounce light reaches.',
  dab: 'Highlight dabs are short, thick, loaded touches at the brightest spots, painted last.',
  edge: 'Edge strokes draw the outline of a form and the boundaries between its planes, found where the values differ and lost where they match.',
  line: 'Line marks are the crisp, exact strokes that draw curves, axes and other data.',
}

// The roles that get wider, longer, fuller and thicker in the light and slighter in the shadow.
const LIT: readonly RoleName[] = ['block', 'form', 'scumble']
// The roles that take how they behave from the nearest edge: distinct at a hard edge, blended at a soft one, dissolving at a lost one.
const CLASSED: readonly RoleName[] = ['block', 'form', 'scumble', 'edge']
// The roles that follow the zoom: a bigger brush up close, with more bristles.
const ZOOMS: readonly RoleName[] = ['block', 'form', 'scumble', 'glaze', 'reflected', 'dab']

const isIn = (list: readonly RoleName[], role: RoleName) => list.includes(role)
const roleAt = (role: RoleName, field: string) => `paint.roles.${role}.${field}`

// What the nearest edge's class does to a role that takes its behaviour from it. A scumble is only ever near a soft or a firm edge.
// `lead` starts the sentence with a capital (after a full stop) or runs on from a colon.
function byClass(role: RoleName, said: { hard: string; firm: string; soft: string; lost: string }, lead: 'sentence' | 'colon' = 'sentence'): string {
  if (!isIn(CLASSED, role)) return ''
  const near = lead === 'sentence' ? ' Near' : ' near'
  if (role === 'scumble') return near + ' a firm edge ' + said.firm + ' and near a soft edge ' + said.soft + '; a scumble is never treated as near a hard or a lost edge.'
  return near + ' a hard edge ' + said.hard + ', near a firm edge ' + said.firm + ', near a soft edge ' + said.soft + ' and near a lost edge ' + said.lost + '.'
}

// Where a surface role is only wanted in some places: the setting that says where.
const WHERE: Partial<Record<RoleName, [string, string]>> = {
  block: [' This sets how solid the first layer is.', ''],
  form: [' They only appear near the terminator (see ' + at('paint.detect.formBandNL') + ').', 'paint.detect.formBandNL'],
  scumble: [' They only appear over wide, soft transitions (see ' + at('paint.detect.scumbleGradient') + ').', 'paint.detect.scumbleGradient'],
  glaze: [' They only appear over deep shadow (see ' + at('paint.detect.glazeBelow') + '), and on a translucent sheet they run at a tenth of this.', 'paint.detect.glazeBelow'],
  reflected: [' They only appear where reflected light reaches (see ' + at('paint.detect.reflectedMin') + ').', 'paint.detect.reflectedMin'],
}

function density(role: RoleName): Meaning {
  if (role === 'dab') {
    return {
      meaning:
        'No effect on highlight dabs: how many there are is decided by ' + at('paint.detect.dabTopFraction') + ' and ' + at('paint.detect.dabMinPx') + ', and every dab chosen is painted whole.',
      interactions: [],
    }
  }
  if (role === 'line') {
    return { meaning: 'No effect on line marks: curves, axes and contours are always drawn whole, so there is nothing to thin out.', interactions: [] }
  }
  if (role === 'edge') {
    return {
      meaning:
        'The share of the edge strokes that is drawn along outlines and plane boundaries. ' + IS.edge + ' 1 draws every stroke, 0.5 about half (a broken outline, found in places and left out in others), 0 none at all, and a value above 1 draws no more than 1. A seeded draw decides which strokes are left out, so the same ones go every time.',
      interactions: ['paint.detect.edgeMinContrast'],
    }
  }
  const [extra, link] = WHERE[role] as [string, string]
  return {
    meaning:
      'How many ' + TAG[role] + ' the picture gets, as a share of the overall stroke density. ' + IS[role] + ' 1 is the full target set by ' + at('paint.particles.targetPer10kPx') + ', 0.5 half as many, 0 none. Fewer strokes leave more of the underpainting and canvas showing between them; where every anchor already has a stroke, a higher value makes the strokes bigger (up to ' + at('paint.particles.zoomGrowMax') + ') and not more numerous.' +
      extra,
    interactions: ['paint.particles.targetPer10kPx', 'paint.particles.zoomGrowMax', ...(link === '' ? [] : [link])],
  }
}

function width(role: RoleName): Meaning {
  if (role === 'line') {
    return {
      meaning:
        'The weight of line marks (curves, axes, contours), in screen pixels at the standard framing. ' + IS.line + ' Each mark\'s own line weight scales it, from half to three times, and heavier lines read as bolder, more drawn data.',
      interactions: [],
    }
  }
  if (role === 'edge') {
    return {
      meaning:
        'The base width of edge strokes, in screen pixels at the standard framing. ' + IS.edge + ' A hard edge is drawn at 0.7 of it and a firm one at 0.475, while the wide strokes that drag across a soft edge to blend it are 2.6 times it and the bridging strokes on a lost edge 1.8 times.',
      interactions: [roleAt(role, 'bristles')],
    }
  }
  if (role === 'dab') {
    return {
      meaning:
        'How thick each highlight dab is, in screen pixels at the standard framing: the width of one short, fat touch. ' + IS.dab + ' Wider dabs read as bolder, flatter highlights; narrower ones as small crisp glints, and a dab grows with the zoom.',
      interactions: [roleAt(role, 'bristles'), 'paint.particles.zoomStrokeScale'],
    }
  }
  return {
    meaning:
      'How wide ' + TAG[role] + ' are, in screen pixels at the standard framing. ' + IS[role] + ' Wider strokes cover more ground each and their bristle ridges are coarser; narrower is finer, more detailed work. They also grow with the zoom (see ' + at('paint.particles.zoomStrokeScale') + ').' +
      (isIn(LIT, role) ? ' They run about 16% wider in the light and 14% narrower in shadow.' : '') +
      (role === 'block' ? ' On the bare table they are 2.3 times as wide.' : '') +
      (role === 'glaze' ? ' On a translucent sheet they are twice as wide.' : ''),
    interactions: [roleAt(role, 'bristles'), 'paint.particles.zoomStrokeScale'],
  }
}

function length(role: RoleName): Meaning {
  if (role === 'line') {
    return {
      meaning:
        'The length of the pieces line marks are cut into, in screen pixels. Between 8 and 21 it sets the length; every value from 21 up gives pieces of 21, and every value under 8 gives pieces of 8. Each piece follows the line closely, so shorter pieces hug a tight curve a little better; the cuts themselves do not show, and a line is crisp and exact whatever this is, so it has little visible effect.',
      interactions: [],
    }
  }
  if (role === 'edge') {
    return {
      meaning:
        'How long edge strokes run, in screen pixels at the standard framing. A crisp (hard or firm) stroke follows its edge for up to three times this; the short pulls across a soft edge and the bridging strokes on a lost one are roughly three quarters to nine tenths of it.',
      interactions: [roleAt(role, 'width')],
    }
  }
  if (role === 'dab') {
    return {
      meaning: 'How long each highlight dab is, in screen pixels at the standard framing. Dabs are short, so this is only a little more than their width: longer turns a dab into a short stroke.',
      interactions: [roleAt(role, 'width')],
    }
  }
  return {
    meaning:
      'How long ' + TAG[role] + ' run, in screen pixels at the standard framing: longer is more sweeping brushwork, shorter more dabbed and broken.' +
      (isIn(LIT, role) ? ' They run about 16% longer in the light and 14% shorter in shadow.' : '') +
      (role === 'block' ? ' On the bare table they are 25% longer.' : '') +
      (role === 'form' ? ' They also stop where the shadow begins and where the surface turns away, so many end short of this.' : '') +
      (role === 'glaze' ? ' On a translucent sheet they are twice as long.' : ''),
    interactions: [roleAt(role, 'width')],
  }
}

function curvature(role: RoleName): Meaning {
  if (role === 'edge') return { meaning: 'No effect on edge strokes: they follow the edge as it is found, so they never bow.', interactions: [] }
  if (role === 'line') return { meaning: 'No effect on line marks: they follow the data exactly, so they never bow.', interactions: [] }
  return {
    meaning:
      'How much ' + TAG[role] + ' bow away from straight. Each gets its own seeded bow, to either side, in proportion to this: at 1 a typical stroke turns through roughly 55 degrees along its length and the most curved about 140. 0 draws every stroke straight along its direction. Curved strokes read as turning round the form, straight ones as flat planes.',
    interactions: [roleAt(role, 'length')],
  }
}

function load(role: RoleName): Meaning {
  return {
    meaning:
      'How much paint ' + TAG[role] + ' carry on the brush. More lays a fuller, more opaque stroke' + (role === 'line' ? '' : ' with a heavier loaded start') + '; less is thinner and more broken, with the underpainting and canvas showing through.' +
      (isIn(LIT, role) ? ' They carry about 8% more in the light and 10% less in shadow.' : '') +
      byClass(role, { hard: 'they carry 12% more', firm: 'the same', soft: '5% less', lost: '15% less' }) +
      (role === 'glaze' ? ' A glaze is a thin film that never gets more than about a third opaque, so a low load makes it fainter and more broken, and a high load only fills it out up to that limit.' : '') +
      (role === 'dab' ? ' A dab is the loaded last touch of paint.' : '') +
      (role === 'line' ? ' A line mark has no loaded start: it is laid evenly from end to end, so keep this near 1 and the lines stay solid and readable.' : ''),
    interactions: [roleAt(role, 'dry')],
  }
}

function impasto(role: RoleName): Meaning {
  return {
    meaning:
      'How thick the paint of ' + TAG[role] + ' stands: the raised ridge that catches the relief light (see ' + at('paint.impasto.strength') + '). 0 is thin, flat paint; larger is thicker, buttery paint with stronger ridges.' +
      (isIn(LIT, role) ? ' It is up to 25% thicker in the light and up to 35% thinner in shadow, as a painter keeps shadows thin and lights thick.' : '') +
      byClass(role, { hard: 'it is 40% thicker', firm: '15% thicker', soft: '30% thinner', lost: 'half as thick' }) +
      (role === 'glaze' ? ' A glaze is a thin film, so it wants a value near 0; on a translucent sheet it has no thickness at all.' : '') +
      (role === 'dab' ? ' Dabs are meant to be the thickest touches, the last loaded paint on the highlights.' : '') +
      (role === 'line' ? ' A value above 0 lets line marks stand a little proud of the canvas.' : ''),
    interactions: ['paint.impasto.strength'],
  }
}

function bristles(role: RoleName): Meaning {
  if (role === 'line') {
    return {
      meaning:
        'The number of bristles in the brush that draws line marks. Lines are drawn with an even, crisp brush whose bristles are all equal and evenly spaced, so this barely shows: a line stays exact whatever it is set to.',
      interactions: [],
    }
  }
  return {
    meaning:
      'How many bristle ridges run along ' + TAG[role] + ', across their width (the brush always has at least 2). Few is a coarse, bold brush with wide stripes; many is a fine, soft brush with fine streaks. The ridges only show where the bristles are unevenly loaded (see ' + at(roleAt(role, 'bristleVar')) + ') and where the paint is thick.' +
      (isIn(ZOOMS, role) ? ' A bigger brush up close has more bristles, though not in proportion.' : ' Unlike the strokes of the surface, edge strokes get no more bristles up close.'),
    interactions: [roleAt(role, 'bristleVar'), roleAt(role, 'width')],
  }
}

function bristleVar(role: RoleName): Meaning {
  if (role === 'line') {
    return { meaning: 'No effect on line marks: the brush that draws them is crisp, with every bristle equal, so a line never streaks.', interactions: [] }
  }
  return {
    meaning:
      'How unevenly the bristles that make ' + TAG[role] + ' are loaded. 0 puts the same paint on every bristle: a smooth, even stroke. 1 gives very different loads: pronounced streaks, some bristles nearly dry, ragged edges.' +
      byClass(role, { hard: 'it is turned up by 15%', firm: 'it is as set', soft: 'it is toned down to 60%', lost: 'to 45%' }),
    interactions: [roleAt(role, 'bristles')],
  }
}

function dry(role: RoleName): Meaning {
  return {
    meaning:
      'How much ' + TAG[role] + ' run dry. The paint catches only the high threads of the canvas weave, so the stroke breaks into skips and speckle, throughout and most strongly toward its end. 0 is solid paint right to the end and 1 a thoroughly dry brush. The weave decides where it skips (see ' + at('paint.canvas.texture') + '): on a smooth canvas only the bristles\' own streaks thin the stroke.' +
      (isIn(CLASSED, role)
        ? ' Only half of this is used, and the nearest edge sets a floor under it:' +
          byClass(role, { hard: 'the floor is 0.1', firm: 'the floor is 0.15', soft: 'the floor is 0.35', lost: 'the floor is 0.45' }, 'colon') +
          ' So a value under ' + (role === 'scumble' ? '0.3' : '0.2') + ' changes nothing, and near a soft or lost edge the floor wins.'
        : '') +
      (role === 'glaze' ? ' On a translucent sheet the strokes along its border are fixed at 0.6.' : ''),
    interactions: ['paint.canvas.texture', roleAt(role, 'load')],
  }
}

function wet(role: RoleName): Meaning {
  return {
    meaning:
      'How much ' + TAG[role] + ' pick up and drag the colour already under them (the earlier layers, or bare canvas), wet into wet. 0 lays the stroke\'s own clean colour; 1 would dissolve it completely into what is beneath, a smear. Every stroke also picks up a little more at its start, as a loaded brush does when it first touches wet paint.' +
      (isIn(CLASSED, role)
        ? ' The nearest edge decides whether strokes blend or stay distinct:' +
          byClass(role, { hard: 'they pick up nothing', firm: 'they pick up 0.6 of this', soft: 'they pick up 1.6 times this (at least 0.22)', lost: 'they pick up 2.2 times this (at least 0.32)' }, 'colon')
        : '') +
      (role === 'glaze' ? ' A glaze takes on the colour of what lies beneath it.' : '') +
      (role === 'dab' ? ' Dabs are clean paint: keep it at 0 so a highlight stays a distinct touch.' : '') +
      (role === 'line' ? ' Keep it at 0 so the lines stay crisp and found.' : ''),
    interactions: [],
  }
}

const FIELDS: Record<string, (role: RoleName) => Meaning> = { density, width, length, curvature, load, impasto, bristles, bristleVar, dry, wet }

// paint.roles.<role>.<field>, all eighty.
export const ROLE_MEANINGS: Meanings = Object.fromEntries(
  ROLE_NAMES.flatMap((role) => Object.entries(FIELDS).map(([field, make]) => [roleAt(role, field), make(role)] as const))
)

// ---------------------------------------------------------------------------
// The edge weights
// ---------------------------------------------------------------------------

// The three kinds of transition, in the order of the weights' tuple.
const KINDS = [
  { name: 'internal edges, the boundaries between two planes inside one form', also: 'The terminator, and the edge of a shadow cast on the form itself, are internal edges too.', short: 'internal' },
  { name: 'silhouette edges, the outline of the form against what lies behind it', also: 'The creases where two faces meet sharply, and the border of an open sheet, are silhouette edges too.', short: 'silhouette' },
  { name: 'cast-shadow edges, the edge of the figure\'s shadow on the table', also: '', short: 'shadow' },
]

// What each term of an edge's hardness is for each kind of edge, and what raising its weight does. The same five terms are
// summed for every kind (model/edges.ts edgeHardness, bake/edges.ts); what differs is how a term is measured.
type Term = (kind: number) => string
const TERMS: Record<string, { name: string; says: Term }> = {
  wContrast: {
    name: 'value contrast',
    says: (kind) =>
      'Raising it makes these edges harder where the two sides differ most in value (a dark against a light is hard, a gentle step is soft). ' +
      (kind === 0
        ? 'Inside a form it takes a big step, about 0.6 in value, to count as full contrast.'
        : 'Against the background or the table it takes less: a step of about a third already counts as full contrast.') +
      ' Where the two sides differ by under about 0.03 the edge is lost whatever the weights say.',
  },
  wCurvature: {
    name: 'curvature',
    says: (kind) =>
      kind === 0
        ? 'Raising it makes these edges harder where the surface turns sharply across the boundary (a sharp turn is firm, a round one soft).'
        : 'For ' +
          (kind === 1 ? 'silhouette' : 'cast-shadow') +
          ' edges the curvature term is not measured: it is a constant (' +
          (kind === 1 ? '0.55' : '0.3') +
          '), so this weight adds the same fixed amount of hardness to every one of them, hardening or softening all of them evenly whatever their shape.',
  },
  wFocal: {
    name: 'focal emphasis',
    says: () =>
      'Raising it makes these edges harder near the two places a painter makes sharp: where the terminator comes nearest the viewer and the brightest highlight. An edge there is firm, one far from them soft. In the baked painting the two places are taken from the view the picture is composed for and fixed in the world, so they stay put as you orbit; on the live path they follow the current view.',
  },
  wLight: {
    name: 'light side',
    says: () =>
      'Raising it makes these edges harder where the two sides are light, on average (a boundary in the light is firmer than one in the shadow, where edges get lost).',
  },
  wDepth: {
    name: 'depth',
    says: (kind) =>
      'Raising it makes these edges harder the nearer they are to the viewer (near edges are harder, far ones softer), measured against the depth of what the picture shows. In the baked painting the depth is measured from the view the picture is composed for and fixed in the world; on the live path it is the current view.' +
      (kind === 1 ? ' In the baked painting the view\'s own outline, which is built per frame, is scored with no depth term at all, so here this weight reaches only the creases and borders; live, it reaches the outline too.' : ''),
  },
}

export const EDGE_WEIGHT_MEANINGS: Meanings = Object.fromEntries(
  Object.entries(TERMS).flatMap(([weight, term]) =>
    KINDS.map((kind, i) => {
      const meaning: Meaning = {
        meaning:
          'How much ' + term.name + ' counts toward the hardness of ' + kind.name + '. ' + (kind.also === '' ? '' : kind.also + ' ') + 'An edge\'s hardness is a weighted sum of several such terms, and this is the weight of one. ' + term.says(i) +
          ' The hardness then sorts the edge into lost, soft, firm or hard, which decides whether the strokes there blend into each other or stay distinct.' +
          (i === 0 ? ' The edges at the terminator are also softened by ' + at('paint.value.terminatorSoftness') + '.' : '') +
          (i === 1 ? ' An outline whose own side is in shadow against a lighter side is never softer than firm, whatever the weights say.' : ''),
        interactions: i === 0 ? ['paint.value.terminatorSoftness'] : [],
      }
      return [`paint.edges.${weight}.${i}`, meaning] as const
    })
  )
)

import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_VERSION } from "../protocol.js";

export interface BootstrapResult {
  node: { protocol_version: number; bank_size: number; last_write_at: string | null };
  subject: string | null;
  tags: { slug: string; label: string; parent_slug: string | null; description: string | null; question_count: number }[];
  skill_level: { target_difficulty: number; notes: string };
  results_pointer: {
    total_attempts: number;
    weakest_tags: { slug: string; mean_score: number; responses: number }[];
    stale_tags: { slug: string; last_seen: string | null }[];
  };
  graph_dsl_reference: string | null;
}

// Top-level tag subtrees where graph_spec plausibly comes up — a prefix
// allowlist rather than a hardcoded "math" check, so a new top-level subject
// slug (e.g. "chem") just gets added here rather than requiring a code
// change to the gating logic itself.
const GRAPH_CAPABLE_SUBJECTS = new Set(["math", "physics", "chemistry", "statistics", "engineering"]);

function subjectIsGraphCapable(subject: string | null): boolean {
  if (!subject) return false;
  const top = subject.split(":")[0];
  return GRAPH_CAPABLE_SUBJECTS.has(top);
}

// Condensed from graph-engine/src/parser/types.ts's grammar comment (source
// of truth for the actual parser) and parser/parseConfig.ts's directive
// switch — one line per statement form / directive, implementation asides
// dropped. Keep this in sync if either file's grammar changes; a mismatch
// here just means Claude writes syntax that then bounces off
// validateQuestionInput's invalid_graph_spec check, it doesn't corrupt data.
const GRAPH_DSL_REFERENCE = `
graph_spec is a small text DSL, one statement per line ("#" starts a comment). Statement forms:
  y = <expr(x)> [if <condition>]              2D explicit function of x; "if x < 0" (or a range) makes it piecewise
  x = <expr(y)> [if <condition>]              2D explicit function of y
  z = <expr(x,y)>                             3D surface
  r = <expr(theta)> [for theta in [a, b]]      polar curve; theta defaults to [0, 2*pi]
  <expr(x,y)> = <expr(x,y)>                    implicit curve (conics, circles, etc.)
  <expr(x,y)> <|<=|>|>= <expr(x,y)>            shaded inequality region
  field: dy/dx = <expr(x,y)>                   slope/direction field
  scatter: (x1,y1), (x2,y2), ...               scatter points + auto linear regression
  label = (x, y[, z])  |  (x, y[, z])          point, label optional; 3-tuple is a 3D point
  (x1,y1[,z1]) -- (x2,y2[,z2])                 segment
  (x1,y1[,z1]) -> (x2,y2[,z2])                 ray
  vector: (x1,y1[,z1]) -> (x2,y2[,z2])         like a ray, labeled with its magnitude
  (fx(t), fy(t)[, fz(t)]) for t in [a, b]      parametric curve; 3-tuple is a 3D curve
  (fx(u,v), fy(u,v), fz(u,v)) for u in [a,b], v in [c,d]   parametric surface
  tangent: <expr(x)> at x = <value>            tangent line + point at that x
  animate: (fx(t), fy(t)[, fz(t)]) for t in [a, b]   a point that continuously traces the path
  <name>(<param>) = <expr(param)>              named function, reusable later (composable: y = k(k(x)))
  <name> = <expr>                              named constant, usable as a bare variable later
  circle: (cx, cy), r                          circle by center + radius
  polygon: A(x,y), B(x,y), C(x,y), ...          closed shape, >= 3 named vertices; each vertex is also
                                                usable by name later, including by angle:/tick:/right-angle:
  angle: A-B-C [label: <text>]                  interior-angle arc at B between rays B->A and B->C
  tick: A-B [count: <n>]                        congruence tick mark(s); matching count = congruent segments
  right-angle: A-B-C                            small square marker for a 90-degree angle at B
  [<name>.]header: cell | cell | ...            table header row
  [<name>.]row: cell | cell | ...               table data row
  [<name>.]table: y = <expr(x)> for x in [a, b] step s   auto-generated value table

Any statement may end with "color: <name-or-#hex>" and/or "name: <id>" (for @hide/@show targeting below).
Named colors: red orange yellow green teal blue purple pink brown black gray cyan (or "#rrggbb").
A "[<name>.]" prefix on header:/row:/table: targets one of several named tables in the same spec.

Config directives, one per line anywhere in the spec, "@key: value" (order doesn't matter, last wins):
  @bounds: xMin,xMax,yMin,yMax     axis window
  @xstep: <n>  @ystep: <n>         gridline spacing
  @grid: on|off   @axes: on|off    toggle grid/axes (both default on)
  @angle: degrees|radians          default radians
  @mode: graph|table                force table-only rendering
  @points: intercepts,vertices,all,none   auto-mark these feature points
  @asymptotes: on|off              dashed guide at detected vertical asymptotes (default on)
  @formulas: on|off                show a table generator's formula alongside its table (default off)
  @theme: light|dark    @hover: all|points|none
  @hide: <name>[,<name>...]   @show: <name>[,<name>...]   hide/show specific named statements or tables
`.trim();

export function bootstrap(db: DatabaseSync, subject: string | null): BootstrapResult {
  const bankSize = (
    db.prepare("SELECT COUNT(*) AS n FROM question WHERE retired_at IS NULL").get() as { n: number }
  ).n;
  const lastWrite = db
    .prepare(
      `SELECT MAX(t) AS last_write_at FROM (
         SELECT MAX(created_at) AS t FROM question
         UNION ALL
         SELECT MAX(created_at) AS t FROM tag
       )`
    )
    .get() as { last_write_at: string | null };

  const tagClauses = ["retired_at IS NULL"];
  const tagParams: unknown[] = [];
  if (subject) {
    tagClauses.push("(slug = ? OR slug LIKE ?)");
    tagParams.push(subject, `${subject}:%`);
  } else {
    tagClauses.push("parent_slug IS NULL");
  }

  const tags = db
    .prepare(
      `SELECT t.slug, t.label, t.parent_slug, t.description,
              (SELECT COUNT(*) FROM question_tag qt
               JOIN question q ON q.id = qt.question_id
               WHERE qt.tag_slug = t.slug AND q.retired_at IS NULL) AS question_count
       FROM tag t
       WHERE ${tagClauses.join(" AND ")}
       ORDER BY t.slug`
    )
    .all(...(tagParams as any[])) as unknown as BootstrapResult["tags"];

  const totalAttempts = (
    db.prepare("SELECT COUNT(*) AS n FROM attempt WHERE submitted_at IS NOT NULL").get() as { n: number }
  ).n;

  const weakestTags = db
    .prepare(
      `SELECT tag_slug AS slug, mean_score, responses FROM tag_performance
       ORDER BY mean_score ASC LIMIT 4`
    )
    .all() as { slug: string; mean_score: number; responses: number }[];

  const staleTags = db
    .prepare(
      `SELECT t.slug, tp.last_seen
       FROM tag t
       LEFT JOIN tag_performance tp ON tp.tag_slug = t.slug
       WHERE t.retired_at IS NULL
         AND (tp.last_seen IS NULL OR tp.last_seen < datetime('now', '-30 days'))
       ORDER BY tp.last_seen IS NOT NULL, tp.last_seen ASC
       LIMIT 10`
    )
    .all() as { slug: string; last_seen: string | null }[];

  return {
    node: { protocol_version: PROTOCOL_VERSION, bank_size: bankSize, last_write_at: lastWrite.last_write_at },
    subject,
    tags,
    skill_level: {
      target_difficulty: 3,
      notes: totalAttempts === 0 ? "No attempt history yet; write at the default difficulty." : "See results_pointer.",
    },
    results_pointer: {
      total_attempts: totalAttempts,
      weakest_tags: weakestTags,
      stale_tags: staleTags,
    },
    graph_dsl_reference: subjectIsGraphCapable(subject) ? GRAPH_DSL_REFERENCE : null,
  };
}

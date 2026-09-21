import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "./errors.js";

const SLUG_SEGMENT = "[a-z0-9]+([._][a-z0-9]+)*";
const SLUG_RE = new RegExp(`^${SLUG_SEGMENT}(:${SLUG_SEGMENT})*$`);

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

// The three reserved leading segments, each naming what a tag IS rather than
// where it sits: "node:" one teachable idea (and the same string a question's
// node_keys carry), "tech:" a rendering/tooling requirement, "topic:" a
// cross-subject theme. Anything else is part of a subject tree.
export type TagKind = "node" | "tech" | "topic" | "subject";

const RESERVED_KINDS = ["node", "tech", "topic"] as const;

export function tagKind(slug: string): TagKind {
  const head = slug.split(":")[0];
  return (RESERVED_KINDS as readonly string[]).includes(head) ? (head as TagKind) : "subject";
}

// SQL for "this row's kind is K", used by both listTags and countTags so a
// filtered listing and its total can't disagree.
function kindClause(kind: string, params: unknown[]): string {
  if ((RESERVED_KINDS as readonly string[]).includes(kind)) {
    params.push(`${kind}:%`);
    return "t.slug LIKE ?";
  }
  if (kind === "subject") {
    for (const k of RESERVED_KINDS) params.push(`${k}:%`);
    return `NOT (${RESERVED_KINDS.map(() => "t.slug LIKE ?").join(" OR ")})`;
  }
  throw new DomainError(
    "invalid_kind",
    `Unknown tag kind "${kind}". Expected one of: node, tech, topic, subject.`
  );
}

export interface TagRow {
  slug: string;
  label: string;
  parent_slug: string | null;
  description: string | null;
  created_at: string;
  retired_at: string | null;
}

export interface TagSummary extends TagRow {
  question_count: number;
  kind: TagKind;
}

function buildTagWhere(opts: { prefix?: string; kind?: string; includeRetired?: boolean }): {
  where: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!opts.includeRetired) clauses.push("t.retired_at IS NULL");
  if (opts.prefix) {
    clauses.push("(t.slug = ? OR t.slug LIKE ?)");
    params.push(opts.prefix, `${opts.prefix}:%`);
  }
  // prefix and kind compose: both are ANDed, so kind: "tech" with prefix:
  // "chemistry" is an empty listing rather than either filter winning.
  if (opts.kind) clauses.push(kindClause(opts.kind, params));

  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

const TAG_SUMMARY_SELECT = `SELECT t.slug, t.label, t.parent_slug, t.description, t.created_at, t.retired_at,
         (SELECT COUNT(*) FROM question_tag qt
          JOIN question q ON q.id = qt.question_id
          WHERE qt.tag_slug = t.slug AND q.retired_at IS NULL) AS question_count
  FROM tag t`;

// kind is derived from the slug rather than stored, so there is no column to
// migrate and no way for it to drift from the slug it describes.
function withKind(rows: Omit<TagSummary, "kind">[]): TagSummary[] {
  return rows.map((row) => ({ ...row, kind: tagKind(row.slug) }));
}

export function listTags(
  db: DatabaseSync,
  opts: { prefix?: string; kind?: string; includeRetired?: boolean; limit?: number; offset?: number } = {}
): TagSummary[] {
  const { where, params } = buildTagWhere(opts);
  const paged = opts.limit !== undefined;
  const sql = `${TAG_SUMMARY_SELECT} ${where} ORDER BY t.slug${paged ? " LIMIT ? OFFSET ?" : ""}`;
  const args = paged ? [...params, opts.limit, opts.offset ?? 0] : params;

  return withKind(db.prepare(sql).all(...(args as any[])) as unknown as Omit<TagSummary, "kind">[]);
}

export function countTags(
  db: DatabaseSync,
  opts: { prefix?: string; kind?: string; includeRetired?: boolean } = {}
): number {
  const { where, params } = buildTagWhere(opts);
  const row = db.prepare(`SELECT COUNT(*) AS n FROM tag t ${where}`).get(...(params as any[])) as { n: number };
  return row.n;
}

export function createTag(
  db: DatabaseSync,
  input: { slug: string; label: string; parent_slug?: string | null; description?: string | null }
): TagRow {
  if (!isValidSlug(input.slug)) {
    throw new DomainError(
      "invalid_slug_format",
      `Tag slug "${input.slug}" is invalid. Expected lowercase ascii segments separated by ":" ` +
        `with "_" or "." separating words within a segment — a separator always sits between ` +
        `alphanumerics, never leading, trailing or doubled ` +
        `(e.g. "math:functions:quadratic", "node:ebbing11e:2.4:atomic_weight").`
    );
  }

  const existing = db.prepare("SELECT slug FROM tag WHERE slug = ?").get(input.slug);
  if (existing) {
    throw new DomainError("slug_exists", `Tag "${input.slug}" already exists.`);
  }

  if (input.parent_slug) {
    const parent = db.prepare("SELECT slug FROM tag WHERE slug = ?").get(input.parent_slug);
    if (!parent) {
      throw new DomainError("unknown_parent", `Parent tag "${input.parent_slug}" does not exist.`);
    }
  }

  db.prepare(
    `INSERT INTO tag (slug, label, parent_slug, description) VALUES (@slug, @label, @parent_slug, @description)`
  ).run({
    slug: input.slug,
    label: input.label,
    parent_slug: input.parent_slug ?? null,
    description: input.description ?? null,
  });

  return db.prepare("SELECT * FROM tag WHERE slug = ?").get(input.slug) as unknown as TagRow;
}

export function mergeTags(
  db: DatabaseSync,
  fromSlug: string,
  toSlug: string
): {
  from_slug: string;
  to_slug: string;
  retired_at: string;
  questions_updated: number;
  node_keys_updated: number;
} {
  if (fromSlug === toSlug) {
    throw new DomainError("same_slug", "from_slug and to_slug must differ.");
  }

  const from = db.prepare("SELECT * FROM tag WHERE slug = ?").get(fromSlug) as TagRow | undefined;
  if (!from) throw new DomainError("unknown_tag", `Tag "${fromSlug}" does not exist.`);
  if (from.retired_at) throw new DomainError("already_retired", `Tag "${fromSlug}" is already retired.`);

  const to = db.prepare("SELECT * FROM tag WHERE slug = ?").get(toSlug) as TagRow | undefined;
  if (!to) throw new DomainError("unknown_tag", `Tag "${toSlug}" does not exist.`);

  db.exec("BEGIN");
  try {
    // Stamp every question whose tag set is about to change, so an
    // incremental pull (buildPullResponse's since-clause) re-sends it with
    // its new tags — the question row itself is otherwise untouched here.
    db.prepare(
      `UPDATE question SET updated_at = datetime('now')
       WHERE id IN (SELECT question_id FROM question_tag WHERE tag_slug = ?)`
    ).run(fromSlug);

    // Questions already carrying to_slug would collide on the (question_id, tag_slug) PK
    // if we blindly repointed from_slug -> to_slug, so drop those rows instead of updating them.
    db.prepare(
      `DELETE FROM question_tag
       WHERE tag_slug = ?
         AND question_id IN (SELECT question_id FROM question_tag WHERE tag_slug = ?)`
    ).run(fromSlug, toSlug);

    const result = db
      .prepare(`UPDATE question_tag SET tag_slug = ? WHERE tag_slug = ?`)
      .run(toSlug, fromSlug);

    // A "node:" tag's slug IS a node_key (Task 4's question_node_key table and
    // the singular question.node_key column both store the string), so merging
    // two of them has to move the keys as well or every item keeps pointing at
    // a retired slug. Only when BOTH sides are node: tags — repointing a node
    // key onto a non-node slug would mint an invalid node_key, so that case is
    // left alone rather than corrupted.
    let nodeKeysUpdated = 0;
    if (fromSlug.startsWith("node:") && toSlug.startsWith("node:")) {
      // Same reason as the question_tag stamp above: an incremental pull has
      // to re-send anything whose node keys just changed.
      db.prepare(
        `UPDATE question SET updated_at = datetime('now')
         WHERE node_key = ?
            OR id IN (SELECT question_id FROM question_node_key WHERE node_key = ?)`
      ).run(fromSlug, fromSlug);

      // (question_id, node_key) is the primary key, so a question already
      // carrying both keys would collide. Promote the surviving row to primary
      // when the merged one held that flag, then drop the duplicate.
      db.prepare(
        `UPDATE question_node_key SET is_primary = 1
         WHERE node_key = ?
           AND question_id IN (
             SELECT question_id FROM question_node_key WHERE node_key = ? AND is_primary = 1
           )`
      ).run(toSlug, fromSlug);
      db.prepare(
        `DELETE FROM question_node_key
         WHERE node_key = ?
           AND question_id IN (SELECT question_id FROM question_node_key WHERE node_key = ?)`
      ).run(fromSlug, toSlug);
      const moved = db.prepare(`UPDATE question_node_key SET node_key = ? WHERE node_key = ?`).run(toSlug, fromSlug);
      // The singular question.node_key column mirrors the primary row, so it
      // moves too but isn't counted twice: node_keys_updated is question_node_key
      // rows repointed.
      db.prepare(`UPDATE question SET node_key = ? WHERE node_key = ?`).run(toSlug, fromSlug);
      nodeKeysUpdated = Number(moved.changes);
    }

    db.prepare(`UPDATE tag SET parent_slug = ? WHERE parent_slug = ?`).run(toSlug, fromSlug);

    db.prepare(`UPDATE tag SET retired_at = datetime('now') WHERE slug = ?`).run(fromSlug);

    db.exec("COMMIT");

    const updated = db.prepare("SELECT retired_at FROM tag WHERE slug = ?").get(fromSlug) as {
      retired_at: string;
    };

    return {
      from_slug: fromSlug,
      to_slug: toSlug,
      retired_at: updated.retired_at,
      questions_updated: Number(result.changes),
      node_keys_updated: nodeKeysUpdated,
    };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

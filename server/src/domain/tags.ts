import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "./errors.js";

const SLUG_SEGMENT = "[a-z0-9]+([._][a-z0-9]+)*";
const SLUG_RE = new RegExp(`^${SLUG_SEGMENT}(:${SLUG_SEGMENT})*$`);

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
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
}

export function listTags(
  db: DatabaseSync,
  opts: { prefix?: string; includeRetired?: boolean; limit?: number; offset?: number } = {}
): TagSummary[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!opts.includeRetired) clauses.push("t.retired_at IS NULL");
  if (opts.prefix) {
    clauses.push("(t.slug = ? OR t.slug LIKE ?)");
    params.push(opts.prefix, `${opts.prefix}:%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  if (opts.limit === undefined) {
    return db
      .prepare(
        `SELECT t.slug, t.label, t.parent_slug, t.description, t.created_at, t.retired_at,
                (SELECT COUNT(*) FROM question_tag qt
                 JOIN question q ON q.id = qt.question_id
                 WHERE qt.tag_slug = t.slug AND q.retired_at IS NULL) AS question_count
         FROM tag t
         ${where}
         ORDER BY t.slug`
      )
      .all(...(params as any[])) as unknown as TagSummary[];
  }

  return db
    .prepare(
      `SELECT t.slug, t.label, t.parent_slug, t.description, t.created_at, t.retired_at,
              (SELECT COUNT(*) FROM question_tag qt
               JOIN question q ON q.id = qt.question_id
               WHERE qt.tag_slug = t.slug AND q.retired_at IS NULL) AS question_count
       FROM tag t
       ${where}
       ORDER BY t.slug LIMIT ? OFFSET ?`
    )
    .all(...([...params, opts.limit, opts.offset ?? 0] as any[])) as unknown as TagSummary[];
}

export function countTags(db: DatabaseSync, opts: { prefix?: string; includeRetired?: boolean } = {}): number {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!opts.includeRetired) clauses.push("t.retired_at IS NULL");
  if (opts.prefix) {
    clauses.push("(t.slug = ? OR t.slug LIKE ?)");
    params.push(opts.prefix, `${opts.prefix}:%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
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
): { from_slug: string; to_slug: string; retired_at: string; questions_updated: number } {
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
    };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

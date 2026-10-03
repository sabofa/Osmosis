export interface TagQuery {
  all?: string[];
  any?: string[];
  none?: string[];
}

// A slug matches itself and everything below it, cutting only at ":" — so
// "node:ebbing11e:2" never reaches "node:ebbing11e:2.4:…" — and every other
// character is literal. A LIKE pattern is not: it reads "_" as "any one
// character", so "a_b:%" also matched "a.b:…", the second spelling of a
// section the dotted grammar exists to rule out. Every subtree match in the
// app goes through this pair rather than LIKE.
export function slugSubtreeSql(column: string): string {
  return `(${column} = ? OR substr(${column}, 1, ?) = ?)`;
}

export function slugSubtreeParams(slug: string): [string, number, string] {
  return [slug, slug.length + 1, `${slug}:`];
}

function isNodeSlug(slug: string): boolean {
  return slug === "node" || slug.startsWith("node:");
}

// Whether question `q` carries `slug` or anything below it. A node: slug is
// an identity an item can carry three ways — as a tag, in node_keys, or (a
// row written before question_node_key, or by a sync pull) in the singular
// column — and all three count. The column test is guarded against NULL:
// unguarded, a NULL node_key makes the whole OR NULL, and a `none` group
// would then drop every item without a key instead of keeping it.
function itemCarriesSql(slug: string): { sql: string; params: unknown[] } {
  const p = slugSubtreeParams(slug);
  const asTag = `EXISTS (SELECT 1 FROM question_tag qt WHERE qt.question_id = q.id AND ${slugSubtreeSql("qt.tag_slug")})`;
  if (!isNodeSlug(slug)) return { sql: asTag, params: p };
  return {
    sql:
      `(${asTag}` +
      ` OR EXISTS (SELECT 1 FROM question_node_key nk WHERE nk.question_id = q.id AND ${slugSubtreeSql("nk.node_key")})` +
      ` OR (q.node_key IS NOT NULL AND ${slugSubtreeSql("q.node_key")}))`,
    params: [...p, ...p, ...p],
  };
}

function anyOf(slugs: string[]): { sql: string; params: unknown[] } {
  const parts = slugs.map(itemCarriesSql);
  return { sql: `(${parts.map((x) => x.sql).join(" OR ")})`, params: parts.flatMap((x) => x.params) };
}

// Returns a SQL fragment (starting with "AND ...", or "" if the query is empty)
// that can be appended to a WHERE clause filtering a `question` row aliased `q`.
export function buildTagQueryClause(query: TagQuery): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const slug of query.all ?? []) {
    const one = itemCarriesSql(slug);
    clauses.push(one.sql);
    params.push(...one.params);
  }

  if (query.any && query.any.length > 0) {
    const group = anyOf(query.any);
    clauses.push(group.sql);
    params.push(...group.params);
  }

  if (query.none && query.none.length > 0) {
    const group = anyOf(query.none);
    clauses.push(`NOT ${group.sql}`);
    params.push(...group.params);
  }

  if (clauses.length === 0) return { sql: "", params: [] };
  return { sql: `AND ${clauses.join(" AND ")}`, params };
}

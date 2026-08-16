export interface TagQuery {
  all?: string[];
  any?: string[];
  none?: string[];
}

// Hierarchy expands downward lexically: "math" matches "math" and "math:*" —
// slug format guarantees ":" only ever separates levels, so a prefix match is
// sufficient and needs no recursive parent_slug walk through the tag table.
function matchGroupSql(slugs: string[]): { sql: string; params: string[] } {
  const params: string[] = [];
  const ors = slugs.map((slug) => {
    params.push(slug, `${slug}:%`);
    return "(qt.tag_slug = ? OR qt.tag_slug LIKE ?)";
  });
  return { sql: `(${ors.join(" OR ")})`, params };
}

// Returns a SQL fragment (starting with "AND ...", or "" if the query is empty)
// that can be appended to a WHERE clause filtering a `question` row aliased `q`.
export function buildTagQueryClause(query: TagQuery): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const slug of query.all ?? []) {
    const group = matchGroupSql([slug]);
    clauses.push(`EXISTS (SELECT 1 FROM question_tag qt WHERE qt.question_id = q.id AND ${group.sql})`);
    params.push(...group.params);
  }

  if (query.any && query.any.length > 0) {
    const group = matchGroupSql(query.any);
    clauses.push(`EXISTS (SELECT 1 FROM question_tag qt WHERE qt.question_id = q.id AND ${group.sql})`);
    params.push(...group.params);
  }

  if (query.none && query.none.length > 0) {
    const group = matchGroupSql(query.none);
    clauses.push(`NOT EXISTS (SELECT 1 FROM question_tag qt WHERE qt.question_id = q.id AND ${group.sql})`);
    params.push(...group.params);
  }

  if (clauses.length === 0) return { sql: "", params: [] };
  return { sql: `AND ${clauses.join(" AND ")}`, params };
}

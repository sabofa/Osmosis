import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_VERSION } from "../protocol.js";

export interface BootstrapResult {
  node: { protocol_version: number; bank_size: number; last_write_at: string | null };
  subject: string | null;
  tags: { slug: string; label: string; parent_slug: string | null; description: string | null; question_count: number }[];
  conventions: {
    prompt_style: string;
    explanation_style: string;
    difficulty_scale: string;
    mc_choice_count: string;
    written_length_target: string;
  };
  skill_level: { target_difficulty: number; notes: string };
  results_pointer: {
    total_attempts: number;
    weakest_tags: { slug: string; mean_score: number; responses: number }[];
    stale_tags: { slug: string; last_seen: string | null }[];
  };
  calculator_convention: string;
}

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
    conventions: {
      prompt_style: "Direct, single-question prompts. No multi-part questions inside one prompt.",
      explanation_style: "2-4 sentences, explain why the correct answer is correct.",
      difficulty_scale: "1 = intro/recall, 3 = standard practice, 5 = exam-level synthesis.",
      mc_choice_count: "4 choices, exactly one correct unless testing a multi-select concept.",
      written_length_target: "1-3 sentences or a short derivation; not an essay.",
    },
    skill_level: {
      target_difficulty: 3,
      notes: totalAttempts === 0 ? "No attempt history yet; write at the default difficulty." : "See results_pointer.",
    },
    results_pointer: {
      total_attempts: totalAttempts,
      weakest_tags: weakestTags,
      stale_tags: staleTags,
    },
    calculator_convention:
      "calculator_policy defaults to n_a. Set 'forbidden' for by-hand computation, 'allowed' when tool use doesn't change what's being tested.",
  };
}

import { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import { migrate } from "../src/db/migrate.js";

export function openTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

export function insertTag(db: DatabaseSync, slug: string, parentSlug: string | null = null): void {
  db.prepare("INSERT INTO tag (slug, label, parent_slug) VALUES (?, ?, ?)").run(slug, slug, parentSlug);
}

export interface SeedQuestionInput {
  type?: "mc" | "written";
  tags: string[];
  difficulty?: number;
  calculator_policy?: "allowed" | "forbidden" | "n_a";
  prompt?: string;
}

let counter = 0;

export function insertQuestion(db: DatabaseSync, input: SeedQuestionInput): { id: string; lineage_id: string } {
  counter += 1;
  const id = uuidv4();
  const lineageId = uuidv4();
  const type = input.type ?? "mc";

  db.prepare(
    `INSERT INTO question (id, lineage_id, version, type, prompt, model_answer, difficulty, calculator_policy)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?)`
  ).run(
    id,
    lineageId,
    type,
    input.prompt ?? `question ${counter}`,
    type === "written" ? "model answer" : null,
    input.difficulty ?? 3,
    input.calculator_policy ?? "n_a"
  );

  for (const tag of input.tags) {
    db.prepare("INSERT INTO question_tag (question_id, tag_slug) VALUES (?, ?)").run(id, tag);
  }

  if (type === "mc") {
    db.prepare("INSERT INTO choice (id, question_id, body, is_correct, ordinal) VALUES (?, ?, ?, 1, 0)").run(
      uuidv4(),
      id,
      "correct"
    );
    db.prepare("INSERT INTO choice (id, question_id, body, is_correct, ordinal) VALUES (?, ?, ?, 0, 1)").run(
      uuidv4(),
      id,
      "incorrect"
    );
  }

  return { id, lineage_id: lineageId };
}

// Seeds a submitted attempt with one graded response for `questionId`, so
// weak_weighted's per-lineage score history has something to read.
export function seedScoredResponse(
  db: DatabaseSync,
  questionId: string,
  score: number,
  answeredAt: string
): void {
  const attemptId = uuidv4();
  const responseId = uuidv4();

  db.prepare(
    `INSERT INTO attempt (id, node_id, source, started_at, submitted_at)
     VALUES (?, 'test-node', 'adhoc', ?, ?)`
  ).run(attemptId, answeredAt, answeredAt);

  db.prepare(
    `INSERT INTO response (id, attempt_id, question_id, ordinal, answered_at)
     VALUES (?, ?, ?, 0, ?)`
  ).run(responseId, attemptId, questionId, answeredAt);

  db.prepare(`INSERT INTO grade (id, response_id, grader, score, graded_at) VALUES (?, ?, 'self', ?, ?)`).run(
    uuidv4(),
    responseId,
    score,
    answeredAt
  );
}

export function isoAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
}

// Deterministic PRNG so distribution tests are reproducible.
export function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

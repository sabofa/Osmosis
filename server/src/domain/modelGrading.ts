import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";

export const RUBRIC_VERSION = "v1";

export interface GradeCallParams {
  prompt: string;
  modelAnswer: string;
  rubric: unknown | null;
  responseText: string;
}

export interface GradeCallResult {
  score: number;
  feedback: string;
}

function buildGradingPrompt(params: GradeCallParams): string {
  const rubricText = params.rubric ? `\n\nRubric (JSON): ${JSON.stringify(params.rubric)}` : "";
  return (
    `You are grading a written answer to a quiz question. Respond ONLY with JSON of the exact shape ` +
    `{"score": <number between 0 and 1>, "feedback": "<1-3 sentence explanation>"}.\n\n` +
    `Question: ${params.prompt}\n\n` +
    `Model answer: ${params.modelAnswer}${rubricText}\n\n` +
    `Student's answer: ${params.responseText}\n\n` +
    `Score the student's answer for correctness and completeness against the model answer` +
    `${params.rubric ? " and rubric" : ""}. A score of 1.0 means fully correct, 0.0 means entirely wrong.`
  );
}

export async function gradeWithDeepSeek(
  apiKey: string,
  params: GradeCallParams,
  fetchImpl: typeof fetch = fetch
): Promise<GradeCallResult> {
  const res = await fetchImpl("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: buildGradingPrompt(params) }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    throw new Error(`DeepSeek API request failed: HTTP ${res.status}`);
  }

  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("DeepSeek API response missing choices[0].message.content");
  }

  let parsed: { score?: unknown; feedback?: unknown };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`DeepSeek API response content is not valid JSON: ${content}`);
  }

  if (typeof parsed.score !== "number" || Number.isNaN(parsed.score)) {
    throw new Error(`DeepSeek API response missing a numeric "score" field: ${content}`);
  }

  const score = Math.max(0, Math.min(1, parsed.score));
  const feedback = typeof parsed.feedback === "string" ? parsed.feedback : "";

  return { score, feedback };
}

export function writeModelGrade(db: DatabaseSync, responseId: string, result: GradeCallResult): void {
  const live = db
    .prepare("SELECT id FROM grade WHERE response_id = ? AND superseded_at IS NULL")
    .get(responseId) as { id: string } | undefined;

  const id = uuidv4();
  db.exec("BEGIN");
  try {
    if (live) {
      db.prepare("UPDATE grade SET superseded_at = datetime('now') WHERE id = ?").run(live.id);
    }
    db.prepare(
      `INSERT INTO grade (id, response_id, grader, score, feedback, model_name, rubric_version, graded_at)
       VALUES (?, ?, 'model', ?, ?, 'deepseek-v4-flash', ?, datetime('now'))`
    ).run(id, responseId, result.score, result.feedback, RUBRIC_VERSION);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export interface SweepResult {
  graded: number;
  skipped: number;
  errors: number;
}

export async function sweepModelGrading(
  db: DatabaseSync,
  apiKey: string,
  dailyLimit: number,
  fetchImpl: typeof fetch = fetch
): Promise<SweepResult> {
  const writtenGraderRow = db.prepare("SELECT value FROM config WHERE key = 'written_grader'").get() as
    | { value: string }
    | undefined;
  const writtenGrader = writtenGraderRow ? (JSON.parse(writtenGraderRow.value) as string) : "self_only";
  if (writtenGrader !== "model_when_online") {
    return { graded: 0, skipped: 0, errors: 0 };
  }

  const gradedInWindow = (
    db
      .prepare("SELECT COUNT(*) AS n FROM grade WHERE grader = 'model' AND graded_at >= datetime('now', '-1 day')")
      .get() as { n: number }
  ).n;
  const remainingBudget = Math.max(0, dailyLimit - gradedInWindow);

  // Eligible: written question, live grade is 'self'. The grade_one_live_per_response
  // unique index guarantees at most one live grade per response, so "live grade is
  // self" already implies "no live model grade" — no extra NOT EXISTS needed.
  const eligible = db
    .prepare(
      `SELECT r.id AS response_id, q.prompt, q.model_answer, q.rubric, r.response_text
       FROM response r
       JOIN question q ON q.id = r.question_id
       JOIN grade g ON g.response_id = r.id AND g.superseded_at IS NULL
       WHERE q.type = 'written' AND g.grader = 'self'
       ORDER BY r.answered_at ASC`
    )
    .all() as { response_id: string; prompt: string; model_answer: string; rubric: string | null; response_text: string | null }[];

  let graded = 0;
  let errors = 0;
  const toProcess = eligible.slice(0, remainingBudget);
  const skipped = eligible.length - toProcess.length;

  for (const row of toProcess) {
    try {
      const result = await gradeWithDeepSeek(
        apiKey,
        {
          prompt: row.prompt,
          modelAnswer: row.model_answer,
          rubric: row.rubric ? JSON.parse(row.rubric) : null,
          responseText: row.response_text ?? "",
        },
        fetchImpl
      );
      writeModelGrade(db, row.response_id, result);
      graded += 1;
    } catch (err) {
      errors += 1;
      console.error(`model grading failed for response ${row.response_id}:`, err);
    }
  }

  return { graded, skipped, errors };
}

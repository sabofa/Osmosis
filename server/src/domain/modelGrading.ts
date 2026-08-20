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

import { describe, it, expect, vi } from "vitest";
import { gradeWithDeepSeek, writeModelGrade, RUBRIC_VERSION } from "../src/domain/modelGrading.js";
import { insertTag, insertQuestion, openTestDb } from "./helpers.js";
import { v4 as uuidv4 } from "uuid";

function mockFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("gradeWithDeepSeek", () => {
  it("calls the DeepSeek chat completions endpoint and parses a valid score/feedback response", async () => {
    const fetchImpl = mockFetch({
      choices: [{ message: { content: JSON.stringify({ score: 0.8, feedback: "Mostly correct, missed one point." }) } }],
    });

    const result = await gradeWithDeepSeek(
      "test-key",
      { prompt: "Why is the sky blue?", modelAnswer: "Rayleigh scattering.", rubric: null, responseText: "Because of scattering." },
      fetchImpl
    );

    expect(result).toEqual({ score: 0.8, feedback: "Mostly correct, missed one point." });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.deepseek.com/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      })
    );
    const callBody = JSON.parse((fetchImpl as any).mock.calls[0][1].body);
    expect(callBody.model).toBe("deepseek-v4-flash");
    expect(callBody.response_format).toEqual({ type: "json_object" });
  });

  it("clamps an out-of-range score into [0, 1]", async () => {
    const fetchImpl = mockFetch({
      choices: [{ message: { content: JSON.stringify({ score: 1.4, feedback: "great" }) } }],
    });
    const result = await gradeWithDeepSeek("k", { prompt: "p", modelAnswer: "m", rubric: null, responseText: "r" }, fetchImpl);
    expect(result.score).toBe(1);

    const fetchImpl2 = mockFetch({
      choices: [{ message: { content: JSON.stringify({ score: -0.3, feedback: "bad" }) } }],
    });
    const result2 = await gradeWithDeepSeek("k", { prompt: "p", modelAnswer: "m", rubric: null, responseText: "r" }, fetchImpl2);
    expect(result2.score).toBe(0);
  });

  it("throws a clear error when the response body isn't valid JSON with a numeric score", async () => {
    const fetchImpl = mockFetch({ choices: [{ message: { content: "not json at all" } }] });
    await expect(
      gradeWithDeepSeek("k", { prompt: "p", modelAnswer: "m", rubric: null, responseText: "r" }, fetchImpl)
    ).rejects.toThrow();
  });

  it("throws when the HTTP call itself fails", async () => {
    const fetchImpl = mockFetch({}, false, 500);
    await expect(
      gradeWithDeepSeek("k", { prompt: "p", modelAnswer: "m", rubric: null, responseText: "r" }, fetchImpl)
    ).rejects.toThrow();
  });
});

describe("writeModelGrade", () => {
  it("supersedes a live self-grade and writes the model grade live", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { type: "written", tags: ["a"] });
    const attemptId = uuidv4();
    const responseId = uuidv4();
    db.prepare("INSERT INTO attempt (id, node_id, source, started_at) VALUES (?, 'n1', 'adhoc', datetime('now'))").run(attemptId);
    db.prepare("INSERT INTO response (id, attempt_id, question_id, ordinal, response_text) VALUES (?, ?, ?, 0, 'my answer')").run(
      responseId, attemptId, q.id
    );
    const selfGradeId = uuidv4();
    db.prepare(
      "INSERT INTO grade (id, response_id, grader, score, graded_at) VALUES (?, ?, 'self', 0.5, datetime('now'))"
    ).run(selfGradeId, responseId);

    writeModelGrade(db, responseId, { score: 0.9, feedback: "Well explained." });

    const oldGrade = db.prepare("SELECT superseded_at FROM grade WHERE id = ?").get(selfGradeId) as { superseded_at: string | null };
    expect(oldGrade.superseded_at).not.toBeNull();

    const live = db.prepare("SELECT * FROM grade WHERE response_id = ? AND superseded_at IS NULL").get(responseId) as any;
    expect(live.grader).toBe("model");
    expect(live.score).toBe(0.9);
    expect(live.feedback).toBe("Well explained.");
    expect(live.model_name).toBe("deepseek-v4-flash");
    expect(live.rubric_version).toBe(RUBRIC_VERSION);
  });

  it("writes a model grade even when there is no prior live grade", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { type: "written", tags: ["a"] });
    const attemptId = uuidv4();
    const responseId = uuidv4();
    db.prepare("INSERT INTO attempt (id, node_id, source, started_at) VALUES (?, 'n1', 'adhoc', datetime('now'))").run(attemptId);
    db.prepare("INSERT INTO response (id, attempt_id, question_id, ordinal, response_text) VALUES (?, ?, ?, 0, 'my answer')").run(
      responseId, attemptId, q.id
    );

    writeModelGrade(db, responseId, { score: 0.7, feedback: "OK." });

    const live = db.prepare("SELECT * FROM grade WHERE response_id = ? AND superseded_at IS NULL").get(responseId) as any;
    expect(live.grader).toBe("model");
    expect(live.score).toBe(0.7);
  });
});

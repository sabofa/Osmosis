import { describe, it, expect } from "vitest";
import { openTestDb, insertTag } from "./helpers.js";
import { createQuestions } from "../src/domain/questions.js";
import { presentItem } from "../src/domain/attempts.js";

// Choice order is authored order: the tutor writes the choices in the order it
// wants them read, and the app must present them that way. Ordinal is the
// carrier, so it has to survive the write and come back on the snapshot.
describe("choice ordinal is stable from authoring to presentation", () => {
  it("stores 0-4 in the order sent and presents them sorted by ordinal", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const bodies = ["alpha", "beta", "gamma", "delta", "epsilon"];
    const result = createQuestions(db, [
      {
        type: "mc",
        prompt: "x",
        tags: ["a"],
        choices: bodies.map((body, i) => ({ body, is_correct: i === 2 })),
      },
    ]);
    expect(result.created).toHaveLength(1);
    const questionId = result.created[0]!.id;

    const stored = db
      .prepare("SELECT body, ordinal FROM choice WHERE question_id = ? ORDER BY ordinal")
      .all(questionId) as unknown as { body: string; ordinal: number }[];
    expect(stored.map((c) => c.ordinal)).toEqual([0, 1, 2, 3, 4]);
    expect(stored.map((c) => c.body)).toEqual(bodies);

    const item = presentItem(db, { node_id: "test-node", question_id: questionId }) as {
      question: { choices: { body: string; ordinal: number }[] };
    };
    expect(item.question.choices.map((c) => c.ordinal)).toEqual([0, 1, 2, 3, 4]);
    expect(item.question.choices.map((c) => c.body)).toEqual(bodies);
  });
});

import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { searchQuestions } from "../src/domain/questions.js";

describe("search_questions has_more derivation", () => {
  it("computing has_more from total/offset/questions.length is correct at both page boundaries", () => {
    const db = openTestDb();
    insertTag(db, "a");
    for (let i = 0; i < 3; i++) insertQuestion(db, { tags: ["a"] });

    const page1 = searchQuestions(db, { limit: 2, offset: 0 });
    const hasMore1 = (page1 as any).offset !== undefined
      ? undefined // searchQuestions doesn't echo offset today; compute from the call params instead
      : 0 + page1.questions.length < page1.total;
    expect(0 + page1.questions.length < page1.total).toBe(true); // 2 < 3

    const page2 = searchQuestions(db, { limit: 2, offset: 2 });
    expect(2 + page2.questions.length < page2.total).toBe(false); // 3 < 3 is false
  });
});

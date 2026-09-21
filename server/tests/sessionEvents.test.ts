import { describe, it, expect } from "vitest";
import { emitSessionEvent, onSessionEvent, sessionEventListenerCount } from "../src/lib/events.js";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { createSession, endSession } from "../src/domain/sessions.js";
import { presentItem, answerResponse, submitAttempt, pauseAttempt, resumeAttempt } from "../src/domain/attempts.js";

// ----------------------------------------------------------------------------
// Task 6, §5.4 — the push channel. events.ts is the in-process fan-out the SSE
// route reads from; the domain writes are what feed it. An event is emitted
// after the write it describes has committed, so a client that re-reads on the
// event always sees the state the event announced.
// ----------------------------------------------------------------------------

describe("emitSessionEvent", () => {
  it("delivers an event to the listeners on that session and nobody else", () => {
    const mine: Record<string, unknown>[] = [];
    const theirs: Record<string, unknown>[] = [];
    const offMine = onSessionEvent("s1", (e) => mine.push(e));
    const offTheirs = onSessionEvent("s2", (e) => theirs.push(e));

    emitSessionEvent("s1", { type: "item_presented", attempt_id: "a1", response_id: "r1" });

    expect(mine).toHaveLength(1);
    expect(mine[0].type).toBe("item_presented");
    expect(mine[0].attempt_id).toBe("a1");
    expect(typeof mine[0].at).toBe("string");
    expect(new Date(mine[0].at as string).toString()).not.toBe("Invalid Date");
    expect(theirs).toHaveLength(0);

    offMine();
    offTheirs();
  });

  it("is a no-op for a null session id — a session-less attempt has nobody to tell", () => {
    const seen: unknown[] = [];
    const off = onSessionEvent("s1", (e) => seen.push(e));
    expect(() => emitSessionEvent(null, { type: "item_presented", attempt_id: "a1" })).not.toThrow();
    expect(seen).toHaveLength(0);
    off();
  });

  it("removes the listener on unsubscribe, leaving nothing behind", () => {
    const off = onSessionEvent("s3", () => {});
    expect(sessionEventListenerCount("s3")).toBe(1);
    off();
    expect(sessionEventListenerCount("s3")).toBe(0);
    // Unsubscribing twice must not take a later subscriber's listener with it.
    off();
    expect(sessionEventListenerCount("s3")).toBe(0);
  });
});

describe("the domain writes that emit", () => {
  function seed() {
    const db = openTestDb();
    insertTag(db, "algebra");
    const q = insertQuestion(db, { tags: ["algebra"] });
    const session = createSession(db, { name: "Live" });
    return { db, q, session };
  }

  it("emits item_presented when the tutor presents an item into a session", () => {
    const { db, q, session } = seed();
    const seen: Record<string, unknown>[] = [];
    const off = onSessionEvent(session.id, (e) => seen.push(e));

    const item = presentItem(db, { node_id: "test-node", question_id: q.id, session_id: session.id });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      type: "item_presented",
      attempt_id: item.attempt_id,
      response_id: item.response_id,
    });
    off();
  });

  it("emits nothing for a present_item outside a session", () => {
    const { db, q, session } = seed();
    const seen: unknown[] = [];
    const off = onSessionEvent(session.id, (e) => seen.push(e));
    presentItem(db, { node_id: "test-node", question_id: q.id });
    expect(seen).toHaveLength(0);
    off();
  });

  // item_answered announces a *recorded outcome*, so only submitAttempt emits
  // it. answerResponse is a draft save — the learner picking a choice, then
  // another, then a confidence — and announcing each of those as an answer
  // made every live screen re-read an attempt that had not finished changing.
  it("emits item_answered once, on submit — not on every draft PATCH", () => {
    const { db, q, session } = seed();
    const item = presentItem(db, { node_id: "test-node", question_id: q.id, session_id: session.id });

    const seen: Record<string, unknown>[] = [];
    const off = onSessionEvent(session.id, (e) => seen.push(e));

    pauseAttempt(db, item.attempt_id);
    resumeAttempt(db, item.attempt_id);
    const choice = db.prepare("SELECT id FROM choice WHERE question_id = ? LIMIT 1").get(q.id) as { id: string };
    answerResponse(db, item.attempt_id, item.response_id, { selected_choice_id: choice.id });
    submitAttempt(db, item.attempt_id);
    endSession(db, session.id, { summary: "Done." });

    expect(seen.map((e) => e.type)).toEqual([
      "attempt_paused",
      "attempt_resumed",
      "item_answered",
      "session_ended",
    ]);
    expect(seen[0].attempt_id).toBe(item.attempt_id);
    expect(seen[2].response_id).toBe(item.response_id);
    expect(seen[3].session_id).toBe(session.id);
    off();
  });

  it("emits item_answered only after the write it announces has landed", () => {
    const { db, q, session } = seed();
    const item = presentItem(db, { node_id: "test-node", question_id: q.id, session_id: session.id });
    let submittedAtWhenHeard: string | null = null;
    const off = onSessionEvent(session.id, (e) => {
      if (e.type !== "item_answered") return;
      const row = db.prepare("SELECT submitted_at FROM attempt WHERE id = ?").get(item.attempt_id) as {
        submitted_at: string | null;
      };
      submittedAtWhenHeard = row.submitted_at;
    });

    submitAttempt(db, item.attempt_id);
    expect(submittedAtWhenHeard).not.toBeNull();
    off();
  });
});

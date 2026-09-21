import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { createSession, endSession, listSessions, getSessionDetail } from "../src/domain/sessions.js";
import { createAttempt, presentItem, listAttempts } from "../src/domain/attempts.js";
import { DomainError } from "../src/domain/errors.js";

// ----------------------------------------------------------------------------
// Task 6, §6.2/§6.3 — the tutor's closing words stored on the session, and the
// tutor/self distinction on an attempt row. Both exist so the app can show a
// closed session as something you can read back rather than a bare list.
// ----------------------------------------------------------------------------

describe("end_session summary text", () => {
  it("stores the tutor's summary and reports it back as summary_text", () => {
    const db = openTestDb();
    const s = createSession(db, { name: "Tuesday algebra" });

    const ended = endSession(db, s.id, { summary: "We covered **factoring**. Next time: the quadratic formula." });

    expect(ended.summary_text).toBe("We covered **factoring**. Next time: the quadratic formula.");
    // The counts object keeps its own name — the two summaries never collide.
    expect(ended.summary.presented).toBe(0);
    expect(ended.summary.retired_ephemeral).toBe(0);
  });

  it("leaves summary null when the tutor ends a session without one", () => {
    const db = openTestDb();
    const s = createSession(db, { name: "No words" });
    const ended = endSession(db, s.id);
    expect(ended.summary_text).toBeNull();
  });

  it("rejects a non-string summary rather than storing it", () => {
    const db = openTestDb();
    const s = createSession(db, { name: "Bad summary" });
    expect(() => endSession(db, s.id, { summary: 42 as unknown as string })).toThrow(DomainError);
  });

  it("surfaces summary, status and source on listSessions rows", () => {
    const db = openTestDb();
    const open = createSession(db, { name: "Still running" });
    const closed = createSession(db, { name: "Wrapped up" });
    endSession(db, closed.id, { summary: "Good session." });

    const { sessions } = listSessions(db);
    const byId = new Map(sessions.map((s) => [s.id, s]));

    expect(byId.get(open.id)!.status).toBe("open");
    expect(byId.get(open.id)!.summary).toBeNull();
    expect(byId.get(open.id)!.source).toBe("tutor");

    expect(byId.get(closed.id)!.status).toBe("closed");
    expect(byId.get(closed.id)!.summary).toBe("Good session.");
    expect(byId.get(closed.id)!.source).toBe("tutor");
  });

  it("surfaces summary, status and source on getSessionDetail", () => {
    const db = openTestDb();
    const s = createSession(db, { name: "Detail" });

    expect(getSessionDetail(db, s.id).status).toBe("open");

    endSession(db, s.id, { summary: "# Recap\n\nAll good." });
    const detail = getSessionDetail(db, s.id);
    expect(detail.summary).toBe("# Recap\n\nAll good.");
    expect(detail.status).toBe("closed");
    expect(detail.source).toBe("tutor");
  });
});

describe("listAttempts source_kind", () => {
  it("calls an attempt tutor when it belongs to a session, self otherwise", () => {
    const db = openTestDb();
    insertTag(db, "algebra");
    const q = insertQuestion(db, { tags: ["algebra"] });

    const session = createSession(db, { name: "Session" });
    const live = presentItem(db, { node_id: "test-node", question_id: q.id, session_id: session.id });
    const own = createAttempt(db, {
      node_id: "test-node",
      source: "adhoc",
      question_ids: [q.id],
      delivery_mode: "chat_quick_check",
    });

    const { attempts } = listAttempts(db);
    const byId = new Map(attempts.map((a) => [a.id as string, a]));

    expect(byId.get(own.attempt_id)!.source_kind).toBe("self");
    expect(byId.get(live.attempt_id)!.source_kind).toBe("tutor");
  });

  it("calls a session-less app_live attempt tutor too - the tutor is what creates one", () => {
    const db = openTestDb();
    insertTag(db, "algebra");
    const q = insertQuestion(db, { tags: ["algebra"] });

    const live = createAttempt(db, {
      node_id: "test-node",
      source: "adhoc",
      question_ids: [q.id],
      delivery_mode: "app_live",
    });

    const { attempts } = listAttempts(db);
    expect(attempts.find((a) => a.id === live.attempt_id)!.source_kind).toBe("tutor");
  });
});

import { describe, it, expect } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { createSession, endSession, listSessions, getSessionDetail } from "../src/domain/sessions.js";
import { createAttempt, presentItem, getAttemptDetail } from "../src/domain/attempts.js";
import { createTemplate, listTemplates } from "../src/domain/templates.js";
import { DomainError } from "../src/domain/errors.js";

// ----------------------------------------------------------------------------
// Task 1.6 — tutor sessions. The whole point of the nullable FKs is that
// session-less rows keep behaving exactly as they did, so several of these
// tests assert the *absence* of leakage as much as the presence of grouping.
// ----------------------------------------------------------------------------

describe("createSession", () => {
  it("creates a session with a name and no tag", () => {
    const db = openTestDb();
    const s = createSession(db, { name: "Tuesday algebra" });

    expect(s.id).toBeTruthy();
    expect(s.name).toBe("Tuesday algebra");
    expect(s.tag_slug).toBeNull();

    const row = db.prepare("SELECT * FROM tutor_session WHERE id = ?").get(s.id) as {
      name: string;
      tag_slug: string | null;
      created_at: string;
      ended_at: string | null;
    };
    expect(row.name).toBe("Tuesday algebra");
    expect(row.tag_slug).toBeNull();
    expect(row.created_at).toBeTruthy();
    expect(row.ended_at).toBeNull();
  });

  it("scopes a session to a tag when one is given", () => {
    const db = openTestDb();
    insertTag(db, "algebra");
    const s = createSession(db, { name: "Algebra", tag_slug: "algebra" });
    expect(s.tag_slug).toBe("algebra");
  });

  it("rejects a tag_slug that does not exist", () => {
    const db = openTestDb();
    expect(() => createSession(db, { name: "s", tag_slug: "nope" })).toThrow(DomainError);
  });

  it("rejects an empty name", () => {
    const db = openTestDb();
    expect(() => createSession(db, { name: "  " })).toThrow(DomainError);
  });
});

describe("endSession", () => {
  it("stamps ended_at", () => {
    const db = openTestDb();
    const s = createSession(db, { name: "s" });
    const result = endSession(db, s.id);
    expect(result.ended_at).toBeTruthy();

    const row = db.prepare("SELECT ended_at FROM tutor_session WHERE id = ?").get(s.id) as { ended_at: string };
    expect(row.ended_at).toBe(result.ended_at);
  });

  it("throws not_found for an unknown session and already_ended on a second call", () => {
    const db = openTestDb();
    expect(() => endSession(db, uuidv4())).toThrow(/does not exist/);

    const s = createSession(db, { name: "s" });
    endSession(db, s.id);
    expect(() => endSession(db, s.id)).toThrow(/already ended/);
  });
});

describe("listSessions", () => {
  it("returns { total, sessions } and pages with limit/offset, newest first", () => {
    const db = openTestDb();
    const ids = ["a", "b", "c"].map((n) => createSession(db, { name: n }).id);

    const all = listSessions(db);
    expect(all.total).toBe(3);
    expect(all.sessions).toHaveLength(3);
    expect(all.sessions.map((s) => s.id).sort()).toEqual([...ids].sort());

    const page1 = listSessions(db, { limit: 2, offset: 0 });
    expect(page1.total).toBe(3);
    expect(page1.sessions).toHaveLength(2);

    const page2 = listSessions(db, { limit: 2, offset: 2 });
    expect(page2.total).toBe(3);
    expect(page2.sessions).toHaveLength(1);
    // No overlap between pages.
    const seen = new Set(page1.sessions.map((s) => s.id));
    expect(seen.has(page2.sessions[0].id)).toBe(false);
  });

  it("returns an empty page with total 0 on a fresh db", () => {
    const db = openTestDb();
    expect(listSessions(db)).toEqual({ total: 0, sessions: [] });
  });
});

describe("getSessionDetail", () => {
  it("throws not_found for an unknown session", () => {
    const db = openTestDb();
    expect(() => getSessionDetail(db, uuidv4())).toThrow(/does not exist/);
  });

  it("returns the session row plus its attempts and templates, and nothing else's", () => {
    const db = openTestDb();
    insertTag(db, "geo");
    const q1 = insertQuestion(db, { tags: ["geo"] });
    const q2 = insertQuestion(db, { tags: ["geo"] });
    const q3 = insertQuestion(db, { tags: ["geo"] });

    const session = createSession(db, { name: "Geometry", tag_slug: "geo" });
    const other = createSession(db, { name: "Other" });

    const mine = presentItem(db, { node_id: "n1", question_id: q1.id, session_id: session.id });
    presentItem(db, { node_id: "n1", question_id: q2.id, session_id: other.id });
    // Session-less attempt — the pre-session behavior, still untouched.
    presentItem(db, { node_id: "n1", question_id: q3.id });

    const sessionTemplate = createTemplate(db, {
      name: "post-test",
      tag_query: { all: ["geo"] },
      question_count: 1,
      session_id: session.id,
    });
    createTemplate(db, { name: "homework", tag_query: { all: ["geo"] }, question_count: 1 });

    const detail = getSessionDetail(db, session.id);
    expect(detail.id).toBe(session.id);
    expect(detail.name).toBe("Geometry");
    expect(detail.tag_slug).toBe("geo");
    expect(detail.ended_at).toBeNull();

    const attempts = detail.attempts as { id: string; delivery_mode: string; question_count: number }[];
    expect(attempts).toHaveLength(1);
    expect(attempts[0].id).toBe(mine.attempt_id);
    expect(attempts[0].delivery_mode).toBe("app_live");
    expect(attempts[0].question_count).toBe(1);

    const templates = detail.templates as { id: string; name: string; frozen: boolean }[];
    expect(templates).toHaveLength(1);
    expect(templates[0].id).toBe(sessionTemplate.id);
    expect(templates[0].frozen).toBe(false);
  });

  it("returns empty attempt/template lists for a session with no activity", () => {
    const db = openTestDb();
    const s = createSession(db, { name: "quiet" });
    const detail = getSessionDetail(db, s.id);
    expect(detail.attempts).toEqual([]);
    expect(detail.templates).toEqual([]);
  });
});

describe("session_id threading", () => {
  it("createAttempt (adhoc) records session_id and getAttemptDetail surfaces it", () => {
    const db = openTestDb();
    insertTag(db, "t");
    const q = insertQuestion(db, { tags: ["t"] });
    const s = createSession(db, { name: "s" });

    const created = createAttempt(db, {
      node_id: "n1",
      source: "adhoc",
      question_ids: [q.id],
      delivery_mode: "chat_quick_check",
      session_id: s.id,
    });

    const row = db.prepare("SELECT session_id FROM attempt WHERE id = ?").get(created.attempt_id) as {
      session_id: string | null;
    };
    expect(row.session_id).toBe(s.id);
    expect(getAttemptDetail(db, created.attempt_id).session_id).toBe(s.id);
  });

  it("createAttempt leaves session_id null when none is given", () => {
    const db = openTestDb();
    insertTag(db, "t");
    const q = insertQuestion(db, { tags: ["t"] });

    const created = createAttempt(db, {
      node_id: "n1",
      source: "adhoc",
      question_ids: [q.id],
      delivery_mode: "app_live",
    });
    const row = db.prepare("SELECT session_id FROM attempt WHERE id = ?").get(created.attempt_id) as {
      session_id: string | null;
    };
    expect(row.session_id).toBeNull();
  });

  it("createAttempt rejects an unknown session_id with a DomainError, not a raw FK error", () => {
    const db = openTestDb();
    insertTag(db, "t");
    const q = insertQuestion(db, { tags: ["t"] });
    expect(() =>
      createAttempt(db, {
        node_id: "n1",
        source: "adhoc",
        question_ids: [q.id],
        delivery_mode: "app_live",
        session_id: uuidv4(),
      })
    ).toThrow(DomainError);
  });

  it("presentItem threads session_id into the attempt it creates", () => {
    const db = openTestDb();
    insertTag(db, "t");
    const q = insertQuestion(db, { tags: ["t"] });
    const s = createSession(db, { name: "s" });

    const presented = presentItem(db, { node_id: "n1", question_id: q.id, session_id: s.id });
    const row = db.prepare("SELECT session_id, delivery_mode FROM attempt WHERE id = ?").get(
      presented.attempt_id
    ) as { session_id: string | null; delivery_mode: string };
    expect(row.session_id).toBe(s.id);
    expect(row.delivery_mode).toBe("app_live");
  });

  it("createTemplate records session_id, exposes it on the summary, and rejects an unknown one", () => {
    const db = openTestDb();
    insertTag(db, "t");
    insertQuestion(db, { tags: ["t"] });
    const s = createSession(db, { name: "s" });

    const scoped = createTemplate(db, {
      name: "scoped",
      tag_query: { all: ["t"] },
      question_count: 1,
      session_id: s.id,
    });
    const plain = createTemplate(db, { name: "plain", tag_query: { all: ["t"] }, question_count: 1 });

    const summaries = listTemplates(db);
    expect(summaries.find((t) => t.id === scoped.id)!.session_id).toBe(s.id);
    expect(summaries.find((t) => t.id === plain.id)!.session_id).toBeNull();

    expect(() =>
      createTemplate(db, { name: "bad", tag_query: { all: ["t"] }, question_count: 1, session_id: uuidv4() })
    ).toThrow(DomainError);
  });
});

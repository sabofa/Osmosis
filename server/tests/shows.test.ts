import { describe, it, expect, beforeEach } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { createSession, endSession } from "../src/domain/sessions.js";
import { presentItem, answerResponse, submitAttempt } from "../src/domain/attempts.js";
import {
  presentShow,
  updateShow,
  getShowOutcome,
  markShowSeen,
  acknowledgeShow,
  getSessionStream,
} from "../src/domain/shows.js";
import { onSessionEvent, type SessionEvent } from "../src/lib/events.js";
import { DomainError } from "../src/domain/errors.js";

const GOOD_SPEC = "y = x^2";

describe("present_show (§5.1)", () => {
  let db: DatabaseSync;
  let sessionId: string;

  beforeEach(() => {
    db = openTestDb();
    sessionId = createSession(db, { name: "showing" }).id;
  });

  it("stores a text show and returns its id and time", () => {
    const { show_id, presented_at } = presentShow(db, {
      session_id: sessionId,
      kind: "text",
      payload: "Two moles of water.",
    });
    expect(show_id).toBeTruthy();
    expect(presented_at).toBeTruthy();

    const row = db.prepare("SELECT * FROM show WHERE id = ?").get(show_id) as Record<string, unknown>;
    expect(row.kind).toBe("text");
    expect(row.payload).toBe("Two moles of water.");
    expect(row.seen_at).toBeNull();
    expect(row.acknowledged_at).toBeNull();
    expect(row.updated_at).toBeNull();
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      presentShow(db, { session_id: sessionId, kind: "video" as never, payload: "x" })
    ).toThrowError(/kind/);
  });

  it("rejects an empty payload", () => {
    expect(() => presentShow(db, { session_id: sessionId, kind: "text", payload: "   " })).toThrowError(
      /payload/
    );
  });

  it("rejects a caption over 500 characters", () => {
    try {
      presentShow(db, { session_id: sessionId, kind: "text", payload: "x", caption: "c".repeat(501) });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as DomainError).code).toBe("caption_too_long");
    }
  });

  it("rejects a graph payload the graph parser refuses, naming the parser's own message", () => {
    try {
      presentShow(db, { session_id: sessionId, kind: "graph", payload: "!!! not a spec !!!" });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as DomainError).code).toBe("invalid_graph_spec");
      expect((err as DomainError).message.length).toBeGreaterThan("invalid_graph_spec".length);
    }
  });

  it("accepts a graph payload the parser is happy with", () => {
    const { show_id } = presentShow(db, { session_id: sessionId, kind: "graph", payload: GOOD_SPEC });
    expect(show_id).toBeTruthy();
  });

  it("refuses a closed session and an unknown one", () => {
    endSession(db, sessionId);
    expect(() => presentShow(db, { session_id: sessionId, kind: "text", payload: "late" })).toThrowError(
      /ended/
    );
    expect(() => presentShow(db, { session_id: "nope", kind: "text", payload: "x" })).toThrowError(
      /does not exist/
    );
  });

  it("stores context verbatim and rejects a mistyped timer", () => {
    const { show_id } = presentShow(db, {
      session_id: sessionId,
      kind: "text",
      payload: "x",
      context: { course: "chem", unit: "2", node: "moles", step: "3", timer_s: 90 },
    });
    const row = db.prepare("SELECT context_json FROM show WHERE id = ?").get(show_id) as {
      context_json: string;
    };
    expect(JSON.parse(row.context_json)).toEqual({
      course: "chem",
      unit: "2",
      node: "moles",
      step: "3",
      timer_s: 90,
    });

    expect(() =>
      presentShow(db, {
        session_id: sessionId,
        kind: "text",
        payload: "x",
        context: { timer_s: "90" } as never,
      })
    ).toThrowError(/timer_s/);
  });

  it("publishes show_presented after the write commits", () => {
    const seen: SessionEvent[] = [];
    const off = onSessionEvent(sessionId, (e) => {
      // Re-read inside the callback: the event must announce a row that exists.
      const row = db.prepare("SELECT id FROM show WHERE id = ?").get(e.show_id as string);
      expect(row).toBeTruthy();
      seen.push(e);
    });
    const { show_id } = presentShow(db, { session_id: sessionId, kind: "text", payload: "hi" });
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe("show_presented");
    expect(seen[0].show_id).toBe(show_id);
  });
});

describe("update_show (§5.2)", () => {
  let db: DatabaseSync;
  let sessionId: string;

  beforeEach(() => {
    db = openTestDb();
    sessionId = createSession(db, { name: "showing" }).id;
  });

  it("replaces a graph's spec, stamps updated_at and publishes show_updated", () => {
    const { show_id } = presentShow(db, { session_id: sessionId, kind: "graph", payload: GOOD_SPEC });
    const seen: SessionEvent[] = [];
    const off = onSessionEvent(sessionId, (e) => seen.push(e));
    const result = updateShow(db, show_id, "y = x^3");
    off();

    expect(result.show_id).toBe(show_id);
    expect(result.updated_at).toBeTruthy();
    const row = db.prepare("SELECT payload, updated_at FROM show WHERE id = ?").get(show_id) as {
      payload: string;
      updated_at: string;
    };
    expect(row.payload).toBe("y = x^3");
    expect(row.updated_at).toBeTruthy();
    expect(seen.map((e) => e.type)).toEqual(["show_updated"]);
  });

  it("refuses a non-graph show", () => {
    const { show_id } = presentShow(db, { session_id: sessionId, kind: "markdown", payload: "**hi**" });
    try {
      updateShow(db, show_id, "**bye**");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as DomainError).code).toBe("update_not_supported");
    }
  });

  it("re-validates the new spec and refuses a closed session", () => {
    const { show_id } = presentShow(db, { session_id: sessionId, kind: "graph", payload: GOOD_SPEC });
    try {
      updateShow(db, show_id, "!!! not a spec !!!");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as DomainError).code).toBe("invalid_graph_spec");
    }
    // The bad update left the good spec in place.
    expect(
      (db.prepare("SELECT payload FROM show WHERE id = ?").get(show_id) as { payload: string }).payload
    ).toBe(GOOD_SPEC);

    endSession(db, sessionId);
    expect(() => updateShow(db, show_id, "y = x^3")).toThrowError(/ended/);
  });

  it("404s an unknown show", () => {
    try {
      updateShow(db, "nope", GOOD_SPEC);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as DomainError).code).toBe("not_found");
    }
  });
});

describe("show outcome and the learner's acknowledgement", () => {
  let db: DatabaseSync;
  let sessionId: string;
  let showId: string;

  beforeEach(() => {
    db = openTestDb();
    sessionId = createSession(db, { name: "showing" }).id;
    showId = presentShow(db, { session_id: sessionId, kind: "text", payload: "look" }).show_id;
  });

  it("walks pending → seen → acknowledged", () => {
    expect(getShowOutcome(db, showId).status).toBe("pending");

    markShowSeen(db, showId, 1200);
    const seen = getShowOutcome(db, showId);
    expect(seen.status).toBe("seen");
    expect(seen.seen_at).toBeTruthy();
    expect(seen.dwell_ms).toBe(1200);
    expect(seen.acknowledged_at).toBeNull();

    acknowledgeShow(db, showId, 4000);
    const acked = getShowOutcome(db, showId);
    expect(acked.status).toBe("acknowledged");
    expect(acked.acknowledged_at).toBeTruthy();
    expect(acked.dwell_ms).toBe(4000);
  });

  it("keeps the first seen_at and never lets dwell go backwards", () => {
    markShowSeen(db, showId, 5000);
    const first = getShowOutcome(db, showId).seen_at;
    markShowSeen(db, showId, 10);
    const second = getShowOutcome(db, showId);
    expect(second.seen_at).toBe(first);
    expect(second.dwell_ms).toBe(5000);
  });

  it("acknowledging without a prior seen sets both", () => {
    acknowledgeShow(db, showId, 800);
    const out = getShowOutcome(db, showId);
    expect(out.seen_at).toBeTruthy();
    expect(out.status).toBe("acknowledged");
  });

  it("404s an unknown show and refuses to acknowledge one whose session closed", () => {
    expect(() => getShowOutcome(db, "nope")).toThrowError(/does not exist/);
    endSession(db, sessionId);
    try {
      acknowledgeShow(db, showId, 10);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as DomainError).code).toBe("session_ended");
    }
  });

  it("still takes a seen report after the session closed", () => {
    // Being seen is a measurement of something that already happened, not an
    // act — and a card that was on screen when the tutor ended the session is
    // exactly the one whose dwell would otherwise be lost for good.
    endSession(db, sessionId);
    const out = markShowSeen(db, showId, 9000);
    expect(out.status).toBe("seen");
    expect(out.seen_at).toBeTruthy();
    expect(out.dwell_ms).toBe(9000);
  });

  it("404s a seen report for a show that does not exist", () => {
    expect(() => markShowSeen(db, "nope", 10)).toThrowError(/does not exist/);
  });
});

describe("the session stream (§5.3)", () => {
  let db: DatabaseSync;
  let sessionId: string;

  beforeEach(() => {
    db = openTestDb();
    insertTag(db, "chem");
    sessionId = createSession(db, { name: "streaming" }).id;
  });

  function present(context?: Record<string, unknown>) {
    const q = insertQuestion(db, { tags: ["chem"] });
    return presentItem(db, { node_id: "node-1", question_id: q.id, session_id: sessionId, context });
  }

  it("merges items and shows in time order, oldest first", () => {
    const a = present();
    const s1 = presentShow(db, { session_id: sessionId, kind: "text", payload: "one" });
    const b = present();
    const s2 = presentShow(db, { session_id: sessionId, kind: "markdown", payload: "two" });
    // A real session has the learner answering between entries; the test
    // writes all four inside one second, so spread them out by hand rather
    // than assert on a tie-break this ordering isn't about.
    db.prepare("UPDATE attempt SET started_at = ? WHERE id = ?").run("2026-09-21 10:00:00", a.attempt_id);
    db.prepare("UPDATE show SET presented_at = ? WHERE id = ?").run("2026-09-21 10:00:10", s1.show_id);
    db.prepare("UPDATE attempt SET started_at = ? WHERE id = ?").run("2026-09-21 10:00:20", b.attempt_id);
    db.prepare("UPDATE show SET presented_at = ? WHERE id = ?").run("2026-09-21 10:00:30", s2.show_id);

    const { entries } = getSessionStream(db, sessionId);
    expect(entries.map((e) => e.kind)).toEqual(["item", "show", "item", "show"]);
    expect(entries.map((e) => (e.kind === "item" ? e.attempt_id : e.show_id))).toEqual([
      a.attempt_id,
      s1.show_id,
      b.attempt_id,
      s2.show_id,
    ]);
    for (let i = 1; i < entries.length; i += 1) {
      expect(entries[i].at >= entries[i - 1].at).toBe(true);
    }
  });

  it("puts a show before an item written in the same second, and keeps two shows in call order", () => {
    // The tutor's live loop is show-then-ask over one MCP turn, so both land
    // inside the same second; the stream must not invert them.
    const s1 = presentShow(db, { session_id: sessionId, kind: "text", payload: "first" });
    const s2 = presentShow(db, { session_id: sessionId, kind: "text", payload: "second" });
    const item = present();

    const entries = getSessionStream(db, sessionId).entries;
    expect(entries.map((e) => (e.kind === "item" ? e.attempt_id : e.show_id))).toEqual([
      s1.show_id,
      s2.show_id,
      item.attempt_id,
    ]);
  });

  it("carries an item's status, reveal and response id", () => {
    const a = present();
    let entries = getSessionStream(db, sessionId).entries;
    expect(entries[0]).toMatchObject({
      kind: "item",
      attempt_id: a.attempt_id,
      response_id: a.response_id,
      status: "pending",
      reveal: "immediate",
      revealed: false,
    });

    answerResponse(db, a.attempt_id, a.response_id, { skipped: true });
    submitAttempt(db, a.attempt_id);
    entries = getSessionStream(db, sessionId).entries;
    expect(entries[0]).toMatchObject({ status: "answered", revealed: true });
  });

  it("holds `revealed` back on a deferred item until the session ends", () => {
    const q = insertQuestion(db, { tags: ["chem"] });
    const a = presentItem(db, {
      node_id: "node-1",
      question_id: q.id,
      session_id: sessionId,
      reveal: "deferred",
    });
    answerResponse(db, a.attempt_id, a.response_id, { skipped: true });
    submitAttempt(db, a.attempt_id);

    expect(getSessionStream(db, sessionId).entries[0]).toMatchObject({
      reveal: "deferred",
      revealed: false,
      status: "answered",
    });
    endSession(db, sessionId);
    expect(getSessionStream(db, sessionId).entries[0]).toMatchObject({ revealed: true });
  });

  it("reports a paused item as paused and an abandoned one as abandoned", () => {
    const a = present();
    db.prepare("UPDATE attempt SET paused_at = datetime('now') WHERE id = ?").run(a.attempt_id);
    expect(getSessionStream(db, sessionId).entries[0].status).toBe("paused");
    db.prepare("UPDATE attempt SET paused_at = NULL, abandoned_at = datetime('now') WHERE id = ?").run(
      a.attempt_id
    );
    expect(getSessionStream(db, sessionId).entries[0].status).toBe("abandoned");
  });

  it("carries the show's payload, caption and acknowledgement times", () => {
    const { show_id } = presentShow(db, {
      session_id: sessionId,
      kind: "graph",
      payload: GOOD_SPEC,
      caption: "the parabola",
    });
    acknowledgeShow(db, show_id, 2500);
    const entry = getSessionStream(db, sessionId).entries[0];
    expect(entry).toMatchObject({
      kind: "show",
      show_id,
      show_kind: "graph",
      payload: GOOD_SPEC,
      caption: "the parabola",
    });
    if (entry.kind !== "show") throw new Error("expected a show");
    expect(entry.seen_at).toBeTruthy();
    expect(entry.acknowledged_at).toBeTruthy();
  });

  it("reports the session's latest non-null context across both kinds", () => {
    const first = present({ course: "chem", unit: "1" });
    const show = presentShow(db, {
      session_id: sessionId,
      kind: "text",
      payload: "x",
      context: { course: "chem", unit: "2", step: "b" },
    });
    // A later entry with no context of its own does not blank the banner.
    const last = present();
    db.prepare("UPDATE attempt SET started_at = ? WHERE id = ?").run("2026-09-21 10:00:00", first.attempt_id);
    db.prepare("UPDATE show SET presented_at = ? WHERE id = ?").run("2026-09-21 10:00:10", show.show_id);
    db.prepare("UPDATE attempt SET started_at = ? WHERE id = ?").run("2026-09-21 10:00:20", last.attempt_id);

    const { session } = getSessionStream(db, sessionId);
    expect(session.context).toEqual({ course: "chem", unit: "2", step: "b" });
    expect(session.status).toBe("open");
    expect(session.name).toBe("streaming");
  });

  it("is empty but well-formed for a session with nothing in it", () => {
    const { session, entries } = getSessionStream(db, sessionId);
    expect(entries).toEqual([]);
    expect(session.context).toBeNull();
    expect(session.summary).toBeNull();
  });

  it("404s an unknown session", () => {
    expect(() => getSessionStream(db, "nope")).toThrowError(/does not exist/);
  });
});

describe("end_session counts shows", () => {
  it("reports how many shows the session put up", () => {
    const db = openTestDb();
    const sessionId = createSession(db, { name: "showing" }).id;
    presentShow(db, { session_id: sessionId, kind: "text", payload: "a" });
    presentShow(db, { session_id: sessionId, kind: "text", payload: "b" });
    expect(endSession(db, sessionId).summary.shows).toBe(2);
  });
});

describe("present_item carries the tutor's context (§5.1)", () => {
  it("stores it on the attempt and reads it back on the stream entry", () => {
    const db = openTestDb();
    insertTag(db, "chem");
    const sessionId = createSession(db, { name: "ctx" }).id;
    const q = insertQuestion(db, { tags: ["chem"] });
    const a = presentItem(db, {
      node_id: "node-1",
      question_id: q.id,
      session_id: sessionId,
      context: { course: "chem", step: "probe", timer_s: 60 },
    });
    const entry = getSessionStream(db, sessionId).entries[0];
    expect(entry.context).toEqual({ course: "chem", step: "probe", timer_s: 60 });
    const row = db.prepare("SELECT context_json FROM attempt WHERE id = ?").get(a.attempt_id) as {
      context_json: string;
    };
    expect(JSON.parse(row.context_json).timer_s).toBe(60);
  });
});

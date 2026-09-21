import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import { createSession, endSession } from "../src/domain/sessions.js";
import { presentItem } from "../src/domain/attempts.js";
import { presentShow } from "../src/domain/shows.js";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";

// ----------------------------------------------------------------------------
// Task 8, §5.1/§5.3 — the two routes the app's session stream needs: the
// stream itself, and the two things the learner can tell the server about a
// show.
// ----------------------------------------------------------------------------

describe("the show routes", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof openTestDb>;

  beforeAll(async () => {
    db = openTestDb();
    insertTag(db, "chem");
    const env = {
      role: "canonical" as const,
      label: "c",
      port: 0,
      dbPath: ":memory:",
      remoteUrl: null,
      uploadsDir: ".",
      mcpAuthToken: "t",
      webDistDir: null,
    };
    const node = bootstrapNode(db, env);
    app = buildApp({ db, env, node, runtime: createSyncRuntime(), logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves a session's stream with its entries in order", async () => {
    const s = createSession(db, { name: "Streamed" });
    const show = presentShow(db, {
      session_id: s.id,
      kind: "markdown",
      payload: "**two** moles",
      caption: "worked",
      context: { course: "chem", step: "worked example" },
    });
    const q = insertQuestion(db, { tags: ["chem"] });
    const item = presentItem(db, { node_id: node_id(), question_id: q.id, session_id: s.id });

    const res = await app.inject({ method: "GET", url: `/api/sessions/${s.id}/stream` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      session: { id: string; name: string; status: string; summary: string | null; context: unknown };
      entries: Record<string, unknown>[];
    };
    expect(body.session).toMatchObject({ id: s.id, name: "Streamed", status: "open", summary: null });
    expect(body.session.context).toEqual({ course: "chem", step: "worked example" });
    expect(body.entries.map((e) => e.kind)).toEqual(["show", "item"]);
    expect(body.entries[0]).toMatchObject({
      show_id: show.show_id,
      show_kind: "markdown",
      payload: "**two** moles",
      caption: "worked",
      seen_at: null,
      acknowledged_at: null,
      updated_at: null,
    });
    expect(body.entries[1]).toMatchObject({
      attempt_id: item.attempt_id,
      response_id: item.response_id,
      status: "pending",
      revealed: false,
    });
  });

  it("404s the stream of a session that does not exist", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions/nope/stream" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "not_found" });
  });

  it("records seen and then acknowledge, keeping the larger dwell", async () => {
    const s = createSession(db, { name: "Acked" });
    const show = presentShow(db, { session_id: s.id, kind: "text", payload: "look here" });

    const seen = await app.inject({
      method: "POST",
      url: `/api/shows/${show.show_id}/seen`,
      payload: { dwell_ms: 4200 },
    });
    expect(seen.statusCode).toBe(200);
    expect(seen.json()).toMatchObject({ status: "seen", dwell_ms: 4200, acknowledged_at: null });

    const acked = await app.inject({
      method: "POST",
      url: `/api/shows/${show.show_id}/acknowledge`,
      payload: { dwell_ms: 100 },
    });
    expect(acked.statusCode).toBe(200);
    const body = acked.json() as { status: string; dwell_ms: number; acknowledged_at: string };
    expect(body.status).toBe("acknowledged");
    expect(body.dwell_ms).toBe(4200);
    expect(body.acknowledged_at).toBeTruthy();
  });

  it("takes an empty body", async () => {
    const s = createSession(db, { name: "No dwell" });
    const show = presentShow(db, { session_id: s.id, kind: "text", payload: "x" });
    const res = await app.inject({ method: "POST", url: `/api/shows/${show.show_id}/seen` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "seen", dwell_ms: null });
  });

  it("400s a dwell_ms that isn't a number", async () => {
    const s = createSession(db, { name: "Bad dwell" });
    const show = presentShow(db, { session_id: s.id, kind: "text", payload: "x" });
    const res = await app.inject({
      method: "POST",
      url: `/api/shows/${show.show_id}/seen`,
      payload: { dwell_ms: "a while" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a seen report after the session closed, but not an acknowledge", async () => {
    const s = createSession(db, { name: "Closed under a card" });
    const show = presentShow(db, { session_id: s.id, kind: "text", payload: "still reading" });
    endSession(db, s.id);

    // Seen is an observation of something that already happened, so the closed
    // session takes it — otherwise the show Ben was reading when the tutor
    // wrapped up reads 'pending' with no dwell forever.
    const seen = await app.inject({
      method: "POST",
      url: `/api/shows/${show.show_id}/seen`,
      payload: { dwell_ms: 6000 },
    });
    expect(seen.statusCode).toBe(200);
    expect(seen.json()).toMatchObject({ status: "seen", dwell_ms: 6000 });

    // Acknowledging is an act, and the session is over.
    const acked = await app.inject({
      method: "POST",
      url: `/api/shows/${show.show_id}/acknowledge`,
      payload: { dwell_ms: 6000 },
    });
    expect(acked.statusCode).toBe(409);
  });

  it("404s an unknown show and 409s an acknowledge whose session has closed", async () => {
    const missing = await app.inject({ method: "POST", url: "/api/shows/nope/acknowledge", payload: {} });
    expect(missing.statusCode).toBe(404);

    const s = createSession(db, { name: "Closed" });
    const show = presentShow(db, { session_id: s.id, kind: "text", payload: "x" });
    endSession(db, s.id);
    const late = await app.inject({
      method: "POST",
      url: `/api/shows/${show.show_id}/acknowledge`,
      payload: { dwell_ms: 10 },
    });
    expect(late.statusCode).toBe(409);
    expect(late.json()).toMatchObject({ error: "session_ended" });
  });

  it("carries a closed session's summary on the stream", async () => {
    const s = createSession(db, { name: "Wrapped" });
    presentShow(db, { session_id: s.id, kind: "text", payload: "x" });
    endSession(db, s.id, { summary: "We did **moles**." });
    const body = (await app.inject({ method: "GET", url: `/api/sessions/${s.id}/stream` })).json() as {
      session: { status: string; summary: string };
    };
    expect(body.session.status).toBe("closed");
    expect(body.session.summary).toBe("We did **moles**.");
  });

  function node_id(): string {
    return (db.prepare("SELECT id FROM node LIMIT 1").get() as { id: string }).id;
  }
});

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DomainError } from "../domain/errors.js";
import * as ws from "../domain/workspace/index.js";
import { inSavepoint } from "../domain/workspace/savepoint.js";
import type { AppContext } from "./app.js";

// ----------------------------------------------------------------------------
// /api/ws: the workspace graph over HTTP (Learn spec/osmosis/workspace/
// 02-data-layer.md). Thin: each route is one domain call, named for the
// operation it makes. Four things live here and not in the domain:
//   - Everything the app writes is Ben's. The author of a version is set by the
//     route, never read from the body, so a request cannot sign as the tutor or
//     the planner (they have their own door, the ws_* MCP tools).
//   - A request body is validated for shape before it reaches the domain, so a
//     missing field is a 400 and not a TypeError deep in a query.
//   - An empty query parameter means "not given" (the app sends `?q=&scope=` for
//     a blank search box), and a parameter given twice is a 400. A domain call
//     therefore never sees the empty string as a value.
//   - A PATCH names the fields it may change, so a typo or a field that belongs
//     to another route is a 400 instead of being dropped without a word.
// Errors are {error, message}, with the domain error's `detail` when it has one:
// the current version of a 409 stale_version, the free name of a name_taken.
// not_found is a 404, stale_version a 409 and every other refusal a 400. LAN-only
// like the rest of /api; a local node forwards the whole prefix to canonical
// (http/liveProxy.ts).
// ----------------------------------------------------------------------------

function sendDomainError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof DomainError) {
    const status = err.code === "not_found" ? 404 : err.code === "stale_version" ? 409 : 400;
    return reply.code(status).send({ error: err.code, message: err.message, ...(err.detail !== undefined ? { detail: err.detail } : {}) });
  }
  throw err;
}

type Handler = (request: FastifyRequest, reply: FastifyReply) => unknown;

// Runs a handler and turns a DomainError into its response.
function guarded(handler: Handler) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (err) {
      return sendDomainError(reply, err);
    }
  };
}

const invalid = (message: string) => new DomainError("invalid_input", message);

function bodyOf(request: FastifyRequest): Record<string, unknown> {
  const body = request.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw invalid("The request body must be a JSON object.");
  return body as Record<string, unknown>;
}

const has = (obj: Record<string, unknown>, key: string): boolean => Object.hasOwn(obj, key);

function requiredString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string") throw invalid(`${key} (string) is required.`);
  return v;
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw invalid(`${key} must be a string.`);
  return v;
}

// A string, or null for "none"; undefined when the key is absent.
function optionalNullableString(obj: Record<string, unknown>, key: string): string | null | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return v;
  if (typeof v !== "string") throw invalid(`${key} must be a string or null.`);
  return v;
}

// A request may carry only the fields it names. Anything else is refused: a typo
// (`titel`, `container`) would otherwise be a silent no-op, and a field that belongs
// to another route (`name` on a node patch, `author` anywhere) would look as if it
// had worked. The PATCH routes and POST /nodes use it.
function onlyFields(obj: Record<string, unknown>, allowed: readonly string[], what: string): void {
  const unknown = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) throw invalid(`${what} has no field ${unknown.map((k) => `"${k}"`).join(", ")}; it takes ${allowed.join(", ")}.`);
}

// A query parameter: absent and empty both mean "not given", and one given twice
// (Fastify hands those over as an array) is refused, not guessed at.
function queryString(request: FastifyRequest, key: string): string | undefined {
  const v = (request.query as Record<string, unknown>)[key];
  if (v === undefined || v === "") return undefined;
  if (typeof v !== "string") throw invalid(`${key} must be given once.`);
  return v;
}

// `?with_orphans=true|false`. Absent is false; any other value is a mistake that
// must not turn into a delete that takes more (or less) than the caller meant.
function withOrphans(request: FastifyRequest): boolean {
  const v = queryString(request, "with_orphans");
  if (v === undefined || v === "false") return false;
  if (v === "true") return true;
  throw invalid(`with_orphans must be true or false, not "${v}".`);
}

const idOf = (request: FastifyRequest): string => (request.params as { id: string }).id;

export function registerWorkspaceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  // ---- reads -----------------------------------------------------------------
  app.get("/api/ws/roots", guarded(() => ws.roots(db)));

  app.get("/api/ws/unplaced", guarded(() => ws.unplaced(db)));

  app.get("/api/ws/archive", guarded(() => ws.archived(db)));

  app.get("/api/ws/formats", guarded(() => ws.listFormats()));

  app.get("/api/ws/nodes/:id", guarded((request) => ws.getNodeDetail(db, idOf(request))));

  app.get("/api/ws/nodes/:id/children", guarded((request) => ws.children(db, idOf(request))));

  app.get("/api/ws/nodes/:id/subtree", guarded((request) => ws.subtree(db, idOf(request))));

  app.get("/api/ws/nodes/:id/context", guarded((request) => ws.context(db, idOf(request))));

  app.get(
    "/api/ws/search",
    guarded((request) =>
      ws.search(db, {
        q: queryString(request, "q"),
        scope: queryString(request, "scope"),
        kind_tag: queryString(request, "kind_tag"),
      })
    )
  );

  app.get(
    "/api/ws/by-kind-tag",
    guarded((request) => {
      const tag = queryString(request, "tag");
      if (tag === undefined) throw invalid("tag is required.");
      return ws.byKindTag(db, tag, queryString(request, "scope"));
    })
  );

  // ---- content ---------------------------------------------------------------
  app.get("/api/ws/nodes/:id/content", guarded((request) => ws.readContent(db, idOf(request))));

  app.get("/api/ws/nodes/:id/versions", guarded((request) => ws.listVersions(db, idOf(request))));

  app.put(
    "/api/ws/nodes/:id/content",
    guarded((request) => {
      const input = bodyOf(request);
      // Neither is guessed: a save with no base would be a blind overwrite.
      if (!has(input, "body") || (input.body !== null && typeof input.body !== "string")) throw invalid("body (string, or null) is required.");
      const base = input.base_version;
      if (typeof base !== "number" || !Number.isInteger(base)) throw invalid("base_version (integer) is required: the version this edit started from.");
      return ws.saveContent(db, idOf(request), { body: input.body as string | null, base_version: base, author: "ben" });
    })
  );

  // ---- nodes -----------------------------------------------------------------
  app.post(
    "/api/ws/nodes",
    guarded((request, reply) => {
      const input = bodyOf(request);
      // A misspelled `container` would otherwise be a 201 and an unplaced node, and an
      // `author` would look as if it had been obeyed. The author is the route's, so a
      // body that names one is refused.
      onlyFields(input, ["kind", "title", "kind_tag", "format", "body", "asset_id", "container_id", "name"], "A new node");
      const create: ws.CreateNodeInput = {
        kind: requiredString(input, "kind") as ws.NodeKind,
        title: requiredString(input, "title"),
        author: "ben",
      };
      const kindTag = optionalNullableString(input, "kind_tag");
      const body = optionalNullableString(input, "body");
      const assetId = optionalNullableString(input, "asset_id");
      if (kindTag !== undefined) create.kind_tag = kindTag;
      if (body !== undefined) create.body = body;
      if (assetId !== undefined) create.asset_id = assetId;
      create.format = optionalString(input, "format");
      create.container_id = optionalString(input, "container_id");
      create.name = optionalString(input, "name");
      return reply.code(201).send(ws.createNode(db, create));
    })
  );

  // The title and the kind tag, both or either, and both land or neither does.
  // The title is only the fallback name: a placement's own name is PATCH
  // /placements/:id, so renaming here never reaches into a container.
  app.patch(
    "/api/ws/nodes/:id",
    guarded((request) => {
      const id = idOf(request);
      const input = bodyOf(request);
      onlyFields(input, ["title", "kind_tag"], "A node patch");
      const retitle = has(input, "title");
      const retag = has(input, "kind_tag");
      if (!retitle && !retag) throw invalid("Nothing to change: send a title, a kind_tag, or both.");
      if (retitle && typeof input.title !== "string") throw invalid("title must be a string.");
      const tag = retag ? optionalNullableString(input, "kind_tag") : undefined;
      return inSavepoint(db, "ws_patch_node", () => {
        let node = ws.getNode(db, id);
        if (retitle) node = ws.retitle(db, id, input.title as string);
        if (retag) node = ws.setKindTag(db, id, tag ?? null);
        return node;
      });
    })
  );

  // What deleting the node would do, so the app can show it first.
  app.get("/api/ws/nodes/:id/delete-preview", guarded((request) => ws.deletePreview(db, idOf(request))));

  // Archives the node everywhere (its placements are marked, not dropped, so
  // restore can offer them back). This is deliberately not DELETE /placements/:id,
  // which removes one appearance: one is "delete", the other "trash". Only the
  // archive's own DELETE destroys anything.
  app.delete("/api/ws/nodes/:id", guarded((request) => ws.deleteNode(db, idOf(request), { with_orphans: withOrphans(request) })));

  app.get("/api/ws/nodes/:id/archived-placements", guarded((request) => ws.archivedPlacements(db, idOf(request))));

  // The caller chooses which placements come back. Leaving the list out is not
  // the same as sending none (that restores the node unplaced and drops the
  // rest), so it is a 400 and not a default.
  app.post(
    "/api/ws/nodes/:id/restore",
    guarded((request) => {
      const placements = bodyOf(request).placements;
      if (!Array.isArray(placements) || placements.some((p) => typeof p !== "string")) {
        throw invalid("placements (a list of placement ids, possibly empty) is required.");
      }
      return ws.restore(db, idOf(request), placements as string[]);
    })
  );

  // The one route that destroys: the node must already be archived.
  app.delete("/api/ws/archive/:id", guarded((request) => ws.purge(db, idOf(request))));

  // ---- placements ------------------------------------------------------------
  app.post(
    "/api/ws/placements",
    guarded((request, reply) => {
      const input = bodyOf(request);
      const placement = ws.place(db, {
        container_id: requiredString(input, "container_id"),
        child_id: requiredString(input, "child_id"),
        name: optionalString(input, "name"),
      });
      return reply.code(201).send(placement);
    })
  );

  app.patch(
    "/api/ws/placements/:id",
    guarded((request) => {
      const id = idOf(request);
      const input = bodyOf(request);
      onlyFields(input, ["name", "container_id"], "A placement patch");
      const name = optionalString(input, "name");
      const containerId = optionalString(input, "container_id");
      if (name === undefined && containerId === undefined) throw invalid("Nothing to change: send a name, a container_id, or both.");
      // Move first, so the new name is checked against the container it will live
      // in. Both land or neither does.
      return inSavepoint(db, "ws_patch_placement", () => {
        let placement;
        if (containerId !== undefined) placement = ws.move(db, id, containerId);
        if (name !== undefined) placement = ws.rename(db, id, name);
        return placement;
      });
    })
  );

  // Trash: remove this one appearance. The node lives on, unplaced if this was
  // its last place, and the response says so.
  app.delete("/api/ws/placements/:id", guarded((request) => ws.trash(db, idOf(request))));
}

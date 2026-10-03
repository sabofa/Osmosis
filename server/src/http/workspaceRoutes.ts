import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DomainError } from "../domain/errors.js";
import {
  coursesIn,
  createNode,
  destroyNode,
  getNode,
  getNodeDetail,
  listChildren,
  listFileTypes,
  listRoots,
  listTrash,
  movePlacement,
  placeNode,
  purgeNode,
  readContent,
  removePlacement,
  renameNode,
  renamePlacement,
  restoreNode,
  saveContent,
  searchWorkspace,
  setKindTag,
} from "../domain/workspace/index.js";
import type { CreateNodeInput, KindTag, NodeKind } from "../domain/workspace/index.js";
import { inSavepoint } from "../domain/workspace/savepoint.js";
import type { AppContext } from "./app.js";

// ----------------------------------------------------------------------------
// /api/ws: the workspace graph over HTTP (Learn spec/osmosis/workspace/01-shell
// .md). Thin: each route is one domain call. Two things live here and not in
// the domain:
//   - Everything the app writes is Ben's. The author of a revision is set by
//     the route, never read from the body, so a request cannot sign as the
//     tutor or the planner (they have their own door, the ws_* MCP tools).
//   - A request body is validated for shape before it reaches the domain, so a
//     missing field is a 400 and not a TypeError deep in a query.
// Errors are the usual {error, message} (a domain error's `detail`, when it
// has one, rides along: the current revision of a 409, the free name of a
// name_taken). LAN-only like the rest of /api; a local node forwards the whole
// prefix to canonical (http/liveProxy.ts).
// ----------------------------------------------------------------------------

function sendDomainError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof DomainError) {
    const status = err.code === "not_found" ? 404 : err.code === "stale_revision" ? 409 : 400;
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
  return objectOf(request.body, "The request body");
}

function objectOf(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid(`${what} must be a JSON object.`);
  return value as Record<string, unknown>;
}

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

// A query parameter: absent and empty both mean "not given" (the app sends
// `?q=&scope=` for a blank search box).
function queryString(request: FastifyRequest, key: string): string | undefined {
  const v = (request.query as Record<string, unknown>)[key];
  if (v === undefined || v === "") return undefined;
  if (typeof v !== "string") throw invalid(`${key} must be given once.`);
  return v;
}

const idOf = (request: FastifyRequest): string => (request.params as { id: string }).id;

export function registerWorkspaceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  // ---- reads -----------------------------------------------------------------
  app.get("/api/ws/roots", guarded(() => listRoots(db)));

  app.get("/api/ws/file-types", guarded(() => listFileTypes().map((t) => ({ type: t.type, storage: t.storage, appendable: t.appendable }))));

  app.get("/api/ws/nodes/:id", guarded((request) => getNodeDetail(db, idOf(request))));

  app.get("/api/ws/nodes/:id/children", guarded((request) => listChildren(db, idOf(request))));

  app.get("/api/ws/nodes/:id/courses", guarded((request) => coursesIn(db, idOf(request))));

  app.get("/api/ws/nodes/:id/content", guarded((request) => readContent(db, idOf(request))));

  app.get(
    "/api/ws/search",
    guarded((request) =>
      searchWorkspace(db, {
        q: queryString(request, "q"),
        scope: queryString(request, "scope"),
        kind_tag: queryString(request, "kind_tag") as KindTag | undefined,
      })
    )
  );

  app.get("/api/ws/trash", guarded(() => listTrash(db)));

  // ---- content ---------------------------------------------------------------
  app.put(
    "/api/ws/nodes/:id/content",
    guarded((request) => {
      const body = bodyOf(request);
      // The domain checks the body and the revision are the right types.
      return saveContent(db, idOf(request), { body: body.body as string | null, base_revision: body.base_revision as number, author: "ben" });
    })
  );

  // ---- nodes -----------------------------------------------------------------
  app.post(
    "/api/ws/nodes",
    guarded((request, reply) => {
      const body = bodyOf(request);
      const input: CreateNodeInput = { kind: requiredString(body, "kind") as NodeKind, title: requiredString(body, "title"), author: "ben" };
      if (body.kind_tag !== undefined) input.kind_tag = body.kind_tag as KindTag | null;
      if (body.file !== undefined) {
        const file = objectOf(body.file, "file");
        const assetId = file.asset_id;
        if (assetId !== undefined && assetId !== null && typeof assetId !== "string") throw invalid("file.asset_id must be a string.");
        input.file = { type: requiredString(file, "type"), body: file.body as string | null | undefined, asset_id: assetId };
      }
      if (body.place_in !== undefined) {
        const place = objectOf(body.place_in, "place_in");
        input.place_in = { container_id: requiredString(place, "container_id"), name: optionalString(place, "name") };
      }
      const created = createNode(db, input);
      return reply.code(201).send(created);
    })
  );

  app.patch(
    "/api/ws/nodes/:id",
    guarded((request) => {
      const id = idOf(request);
      const body = bodyOf(request);
      const title = optionalString(body, "title");
      const everywhere = body.everywhere;
      if (everywhere !== undefined && typeof everywhere !== "boolean") throw invalid("everywhere must be true or false.");
      const retag = body.kind_tag !== undefined;
      if (title === undefined && !retag) throw invalid("Nothing to change: send a title, a kind_tag, or both.");
      // Both land or neither does.
      return inSavepoint(db, "ws_patch_node", () => {
        let node = getNode(db, id);
        if (title !== undefined) node = renameNode(db, id, title, { everywhere });
        if (retag) node = setKindTag(db, id, body.kind_tag as KindTag | null);
        return node;
      });
    })
  );

  // Trashes the node (placements stay, hidden, so restore puts it all back).
  // This is deliberately a different path from DELETE /placements/:id, which
  // only removes it from one container: one is "destroy", the other "remove".
  app.delete(
    "/api/ws/nodes/:id",
    guarded((request) => destroyNode(db, idOf(request), { withOrphans: queryString(request, "with_orphans") === "true" }))
  );

  // ---- placements ------------------------------------------------------------
  app.post(
    "/api/ws/placements",
    guarded((request, reply) => {
      const body = bodyOf(request);
      const placement = placeNode(db, {
        container_id: requiredString(body, "container_id"),
        child_id: requiredString(body, "child_id"),
        name: optionalString(body, "name"),
      });
      return reply.code(201).send(placement);
    })
  );

  app.patch(
    "/api/ws/placements/:id",
    guarded((request) => {
      const id = idOf(request);
      const body = bodyOf(request);
      const name = optionalString(body, "name");
      const containerId = optionalString(body, "container_id");
      if (name === undefined && containerId === undefined) throw invalid("Nothing to change: send a name, a container_id, or both.");
      // Move first, so the new name is checked against the container it will
      // live in. Both land or neither does.
      return inSavepoint(db, "ws_patch_placement", () => {
        let placement;
        if (containerId !== undefined) placement = movePlacement(db, id, containerId);
        if (name !== undefined) placement = renamePlacement(db, id, name);
        return placement;
      });
    })
  );

  // Remove from here: the node lives on, unplaced if this was its last place.
  app.delete("/api/ws/placements/:id", guarded((request) => removePlacement(db, idOf(request))));

  // ---- the trash -------------------------------------------------------------
  app.post("/api/ws/trash/:id/restore", guarded((request) => restoreNode(db, idOf(request))));

  app.delete("/api/ws/trash/:id", guarded((request) => purgeNode(db, idOf(request))));
}

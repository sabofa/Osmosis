import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "../domain/errors.js";
import {
  KIND_TAGS,
  NODE_KINDS,
  appendContent,
  createNode,
  getNodeDetail,
  listChildren,
  listRoots,
  placeNode,
  readContent,
  saveContent,
  searchWorkspace,
} from "../domain/workspace/index.js";
import type { KindTag, NodeKind } from "../domain/workspace/index.js";

// ----------------------------------------------------------------------------
// The workspace over MCP: how the tutor and the planner read and write the
// files in Ben's workspace. Seven tools: read (ws_list, ws_read, ws_search),
// create (ws_create), write (ws_write, ws_append) and place (ws_place).
//
// There is no remove, move or destroy. Rearranging the tree is Ben's: an agent
// can add to it and fill it in, never tidy it away. Every write names who is
// writing (`as`), and that lands on the revision, so Ben can see which of his
// files the tutor or the planner touched, and each of them can see what the
// other wrote.
//
// Called from registerTools with its registerTool wrapper, so the presenter
// allowlist and readme()'s tool list apply to these like any other tool.
// ----------------------------------------------------------------------------

export interface ToolResultHelpers {
  ok(result: unknown): CallToolResult;
  fail(err: unknown): CallToolResult;
}

const writerShape = z
  .enum(["tutor", "planner"])
  .describe(
    "Who is writing. The tutor teaches Ben and writes its notes about him into the unit's USERNOTES file with specific examples; " +
      "the planner writes the plan. Recorded on the revision."
  );

const kindShape = z.enum(NODE_KINDS as unknown as [NodeKind, ...NodeKind[]]);
const kindTagShape = z.enum(KIND_TAGS as unknown as [KindTag, ...KindTag[]]);

export function registerWorkspaceTools(registerTool: McpServer["registerTool"], db: DatabaseSync, { ok, fail }: ToolResultHelpers): void {
  const attempt = (fn: () => unknown): CallToolResult => {
    try {
      return ok(fn());
    } catch (err) {
      return fail(err);
    }
  };

  registerTool(
    "ws_list",
    {
      description:
        "List Ben's workspace. With no container_id: the roots, meaning every track and course plus any files and folders not placed anywhere (unplaced). " +
        "With a container_id (a track, course or folder): its live children, each under the name it has in that container. " +
        "A node can sit in several containers (a file in two courses), so a child's placement_count says how many.",
      inputSchema: { container_id: z.string().optional().describe("A track, course or folder id. Omit it for the roots.") },
    },
    async ({ container_id }) =>
      attempt(() => {
        if (container_id === undefined) return listRoots(db);
        return { container: getNodeDetail(db, container_id).node, children: listChildren(db, container_id) };
      })
  );

  registerTool(
    "ws_read",
    {
      description:
        "Read one node: its summary, every container it appears in (appears_in), the tracks above it, and for a file its content " +
        "(type, body, revision, saved_at, saved_by). Pass the revision you read here back to ws_write. An uploaded document " +
        "(type asset) has no body here.",
      inputSchema: { node_id: z.string() },
    },
    async ({ node_id }) =>
      attempt(() => {
        const detail = getNodeDetail(db, node_id);
        return { ...detail, content: detail.node.kind === "file" ? readContent(db, node_id) : null };
      })
  );

  registerTool(
    "ws_search",
    {
      description:
        "Find nodes by text: a placement's name, a node's title, and for files their content. `scope` limits it to everything below one " +
        "container; `kind_tag` to source, resource, homework, test or flowchart files. One row per placement, so a file in two courses " +
        "is listed under each name it has. With no arguments it lists everything.",
      inputSchema: {
        q: z.string().optional().describe("Text to look for, case-insensitive. Omit it to filter by scope and tag alone."),
        scope: z.string().optional().describe("A container id: search only what is inside it, at any depth."),
        kind_tag: kindTagShape.optional(),
      },
    },
    async ({ q, scope, kind_tag }) => attempt(() => ({ results: searchWorkspace(db, { q, scope, kind_tag }) }))
  );

  registerTool(
    "ws_create",
    {
      description:
        "Create a track, course, folder or file, and with container_id place it there in the same call. What may hold what: a track holds " +
        "tracks, courses, folders and files; a course holds folders and files; a folder holds courses, folders and files; a file holds " +
        "nothing. For a file pass `type` (\"markdown\" for notes and documents, \"graph\" for a graph spec) and optionally `body`. " +
        "`name` is what the item is called inside that container (default: the title); names are unique among siblings. If the name is " +
        "taken (name_taken), that node probably already exists: ws_list the container and use it. For a unit's USERNOTES, ws_append to " +
        "the existing file. Never create a numbered copy. The unit's USERNOTES file is a markdown file in the unit's folder: create it " +
        "once, then ws_append to it.",
      inputSchema: {
        kind: kindShape,
        title: z.string().describe("The item's title, and its default name wherever it is placed. No \"/\"."),
        container_id: z.string().optional().describe("Place the new node in this track, course or folder."),
        name: z.string().optional().describe("Its name in that container, if not the title. Needs container_id."),
        type: z.string().optional().describe("File type. Required when kind is \"file\"; not for anything else."),
        body: z.string().optional().describe("A file's starting content. Files only."),
        kind_tag: kindTagShape.optional().describe("What a file is for: source, resource, homework, test or flowchart."),
        as: writerShape,
      },
    },
    async ({ kind, title, container_id, name, type, body, kind_tag, as }) =>
      attempt(() => {
        if (name !== undefined && container_id === undefined) {
          throw new DomainError("invalid_input", "name is what the item is called inside a container, so it needs container_id.");
        }
        if (kind === "file" && type === undefined) {
          throw new DomainError("invalid_input", 'A file needs a type: pass type ("markdown" for notes and documents, "graph" for a graph spec).');
        }
        // A type or body on anything but a file reaches createNode, which refuses it by name.
        const file = type !== undefined || body !== undefined ? { type: type ?? "", body } : undefined;
        return createNode(db, {
          kind,
          title,
          kind_tag,
          file,
          place_in: container_id !== undefined ? { container_id, name } : undefined,
          author: as,
        });
      })
  );

  registerTool(
    "ws_write",
    {
      description:
        "Replace a file's whole content. Read it first with ws_read and pass the revision you read as base_revision. If the file has been " +
        "saved since — Ben edits these files too — the write is refused as stale_revision: that means Ben (or the other agent) changed " +
        "it, so read it again, fold your change into what is there now, and write again. To add to a file without replacing it, use ws_append.",
      inputSchema: {
        node_id: z.string(),
        body: z.string().describe("The file's complete new content."),
        base_revision: z.number().int().describe("The revision ws_read showed you. Not the one you expect it to be now."),
        as: writerShape,
      },
    },
    async ({ node_id, body, base_revision, as }) => attempt(() => saveContent(db, node_id, { body, base_revision, author: as }))
  );

  registerTool(
    "ws_append",
    {
      description:
        "Add text to the end of a file that accepts it (markdown), after a blank line. It needs no revision: it lands on whatever is in the " +
        "file now. This is how notes go into USERNOTES without clobbering Ben's edits: append the new note, never rewrite the file. " +
        "Files that can't be appended to (graph, uploads) answer not_appendable.",
      inputSchema: {
        node_id: z.string(),
        text: z.string().describe("What to add. Kept exactly as written."),
        as: writerShape,
      },
    },
    async ({ node_id, text, as }) => attempt(() => appendContent(db, node_id, { text, author: as }))
  );

  registerTool(
    "ws_place",
    {
      description:
        "Make an existing node appear in another container as well, the way one file can sit in two courses. Nothing is copied or moved: " +
        "it is the same node under a name of its own there (default: its title). Refused if it is already there, if the name is taken, if " +
        "the container may not hold that kind, or if it would make a cycle.",
      inputSchema: {
        container_id: z.string().describe("The track, course or folder to place it in."),
        child_id: z.string().describe("The node to place."),
        name: z.string().optional().describe("Its name in that container, if not its title."),
      },
    },
    async ({ container_id, child_id, name }) => attempt(() => ({ placement: placeNode(db, { container_id, child_id, name }) }))
  );
}

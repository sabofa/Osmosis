import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "../domain/errors.js";
import * as ws from "../domain/workspace/index.js";

// ----------------------------------------------------------------------------
// The workspace over MCP: how the tutor and the planner read and write the
// files in Ben's workspace. Seven tools: read (ws_list, ws_read, ws_search),
// create (ws_create), write (ws_write, ws_append) and place (ws_place).
//
// There is no trash, delete, restore, purge, move or rename. Removing things and
// rearranging the tree are Ben's: an agent can add to it and fill it in, never
// tidy it away. Every write names who is writing (`as`), and that lands on the
// version, so Ben can see which of his files the tutor or the planner touched,
// and each of them can see what the other wrote.
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
      "the planner writes the plan. Recorded on the version."
  );

const kindShape = z.enum(ws.NODE_KINDS as unknown as [ws.NodeKind, ...ws.NodeKind[]]);

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
        "List Ben's workspace. With no container_id: the roots, meaning every trajectory, track and course (top_level is true for one that is " +
        "placed nowhere, which is normal for a container), plus `unplaced`, the files and folders that are not placed anywhere. " +
        "With a container_id (a trajectory, track, course or folder): its live children, containers first, each under the name it has in " +
        "that container. A node can sit in several containers (a file in two courses), so a child's placement_count says how many.",
      inputSchema: { container_id: z.string().optional().describe("A trajectory, track, course or folder id. Omit it for the roots.") },
    },
    async ({ container_id }) =>
      attempt(() => {
        if (container_id === undefined) return { ...ws.roots(db), unplaced: ws.unplaced(db) };
        return { container: ws.getNodeDetail(db, container_id).node, children: ws.children(db, container_id) };
      })
  );

  registerTool(
    "ws_read",
    {
      description:
        "Read one node: its summary, every container it appears in (appears_in), and for a file its content " +
        "(format, body, version, saved_at, author). Pass the version you read here back to ws_write. An uploaded document " +
        "(format upload) has no body here; its asset_id names the upload.",
      inputSchema: { node_id: z.string() },
    },
    async ({ node_id }) =>
      attempt(() => {
        const detail = ws.getNodeDetail(db, node_id);
        if (detail.node.kind !== "file") return detail;
        // The header getNodeDetail carries, plus the body. search_text is the layer's
        // own derived copy of the body, so it is left out.
        const { format, version, body, author, saved_at, asset_id } = ws.readContent(db, node_id);
        return { ...detail, content: { format, version, body, author, saved_at, asset_id } };
      })
  );

  registerTool(
    "ws_search",
    {
      description:
        "Find nodes by text: a placement's name, a node's title, and for files their content. `scope` limits it to everything below one " +
        "container; `kind_tag` to files carrying that tag (the usual ones are source, resource, homework, test and flowchart). One row per " +
        "placement, so a file in two courses is listed under each name it has. A node placed nowhere is never listed: ws_list shows those. " +
        "With no arguments it lists everything placed.",
      inputSchema: {
        q: z.string().optional().describe("Text to look for, case-insensitive. Omit it to filter by scope and tag alone."),
        scope: z.string().optional().describe("A container id: search only what is inside it, at any depth."),
        kind_tag: z.string().optional().describe("Only files with this kind tag, such as homework. Lowercase letters, digits, - and _."),
      },
    },
    async ({ q, scope, kind_tag }) => attempt(() => ({ results: ws.search(db, { q, scope, kind_tag }) }))
  );

  registerTool(
    "ws_create",
    {
      description:
        "Create a trajectory, track, course, folder or file, and with container_id place it there in the same call. What may hold what: a " +
        "trajectory holds tracks, courses, folders and files; a track holds courses, folders and files; a course holds folders and files; " +
        "a folder holds folders and files; a file holds nothing. A folder has no built-in meaning: a unit, research, attachments or notes " +
        "are all just folders. For a file pass `format` (\"markdown\" for notes and documents, \"graph\" for a graph spec) and optionally " +
        "`body`. `name` is what the item is called inside that container (default: the title); names are unique among siblings. " +
        "If the name is taken (name_taken), call ws_list on the container and use the existing node. For USERNOTES that means ws_append " +
        "to it. Never create a numbered copy. The unit's USERNOTES file is a markdown file in the unit's folder: create it once, then " +
        "ws_append to it.",
      inputSchema: {
        kind: kindShape,
        title: z.string().describe("The item's title, and its default name wherever it is placed. No \"/\"."),
        container_id: z.string().optional().describe("Place the new node in this trajectory, track, course or folder."),
        name: z.string().optional().describe("Its name in that container, if not the title. Needs container_id."),
        format: z.string().optional().describe('The file\'s format: "markdown" or "graph". Required when kind is "file"; not for anything else.'),
        body: z.string().optional().describe("A file's starting content. Files only."),
        kind_tag: z
          .string()
          .optional()
          .describe("What a file is for, such as source, resource, homework, test or flowchart. Lowercase letters, digits, - and _. Files only."),
        as: writerShape,
      },
    },
    async ({ kind, title, container_id, name, format, body, kind_tag, as }) =>
      attempt(() => {
        if (kind === "file" && format === undefined) {
          throw new DomainError("invalid_input", 'A file needs a format: pass format ("markdown" for notes and documents, "graph" for a graph spec).');
        }
        // A format or body on anything but a file, a name with no container, a tag on a
        // folder: createNode refuses each by name rather than dropping it.
        return ws.createNode(db, { kind, title, kind_tag, format, body, container_id, name, author: as });
      })
  );

  registerTool(
    "ws_write",
    {
      description:
        "Replace a file's whole content. Read it first with ws_read and pass the version you read as `version`. If the file has been " +
        "saved since — Ben edits these files too — the write is refused as stale_version: that means Ben (or the other agent) changed " +
        "it, so read it again, fold your change into what is there now, and write again. To add to a file without replacing it, use ws_append.",
      inputSchema: {
        node_id: z.string(),
        body: z.string().describe("The file's complete new content."),
        version: z.number().int().describe("The version ws_read showed you. Not the one you expect it to be now."),
        as: writerShape,
      },
    },
    async ({ node_id, body, version, as }) => attempt(() => ws.saveContent(db, node_id, { body, base_version: version, author: as }))
  );

  registerTool(
    "ws_append",
    {
      description:
        "Add text to the end of a file whose format accepts it (markdown), after a blank line. It needs no version: it lands on whatever is " +
        "in the file now. This is how notes go into USERNOTES without clobbering Ben's edits: append the new note, never rewrite the file. " +
        "Files that can't be appended to (graph, uploads) answer not_appendable.",
      inputSchema: {
        node_id: z.string(),
        text: z.string().describe("What to add. Kept exactly as written."),
        as: writerShape,
      },
    },
    async ({ node_id, text, as }) => attempt(() => ws.appendContent(db, node_id, { text, author: as }))
  );

  registerTool(
    "ws_place",
    {
      description:
        "Make an existing node appear in another container as well, the way one file can sit in two courses. Nothing is copied or moved: " +
        "it is the same node under a name of its own there (default: its title). Refused if it is already there, if the name is taken, if " +
        "the container may not hold that kind, or if it would make a cycle.",
      inputSchema: {
        container_id: z.string().describe("The trajectory, track, course or folder to place it in."),
        child_id: z.string().describe("The node to place."),
        name: z.string().optional().describe("Its name in that container, if not its title."),
      },
    },
    async ({ container_id, child_id, name }) => attempt(() => ({ placement: ws.place(db, { container_id, child_id, name }) }))
  );
}

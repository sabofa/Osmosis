import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "../domain/errors.js";
import { recordToolName } from "../protocol.js";
import { readme, type ToolScope } from "../domain/readme.js";
import { bootstrap } from "../domain/bootstrap.js";
import { listTags, createTag, mergeTags, countTags } from "../domain/tags.js";
import { createQuestions, editQuestion, retireQuestion, searchQuestions, getQuestionDetail } from "../domain/questions.js";
import { getConfig, setConfig } from "../domain/config.js";
import { listTemplates, countTemplates, createTemplate, editTemplate, retireTemplate } from "../domain/templates.js";
import { getResults } from "../domain/results.js";
import { createAsset, getAsset, searchAssets, listAssets, countAssets } from "../domain/assets.js";
import { presentItem, getItemOutcome, quickCheck, submitQuickCheck, getAttemptDetail, gradeResponseByTutor,
  listUngradedWritten } from "../domain/attempts.js";
import { createSession, endSession, listSessions, getSessionDetail } from "../domain/sessions.js";
import { presentShow, updateShow, getShowOutcome } from "../domain/shows.js";
import { setRetentionTarget, getDueItems } from "../domain/retention.js";
import { listThemes, saveTheme, patchTheme, getTheme, deleteTheme, setActiveTheme, getActiveThemeId, setActiveWorkspaceTheme, getActiveWorkspaceThemeId } from "../domain/themes.js";
import {
  BUILTINS, builtinById, isBuiltinId, ownerOf, DEFAULT_THEME_ID, FONT_STACKS, TOKENS, resolve as resolveTheme, validate as validateManifest,
  type ThemeManifest,
} from "theme-core";
import { registerWorkspaceTools } from "./workspaceTools.js";

const tagQueryShape = z
  .object({
    all: z.array(z.string()).optional(),
    any: z.array(z.string()).optional(),
    none: z.array(z.string()).optional(),
  })
  .optional();

// The tutor's breadcrumb for an item or a show (§5.1). Every field optional:
// whatever is named lands in the app's banner above the stream, and timer_s
// becomes a countdown there.
const contextShape = z
  .object({
    course: z.string().optional().describe("The course this moment belongs to, as the learner would name it."),
    unit: z.string().optional().describe("The unit or chapter within the course."),
    node: z.string().optional().describe("The one teachable idea — the same string the item's node_keys carry."),
    step: z.string().optional().describe("Where in the teaching loop this is, e.g. 'probe', 'worked example', 'check'."),
    timer_s: z.number().positive().optional().describe("How long the learner is meant to spend, in seconds. Shown as a countdown; nothing is enforced."),
  })
  .optional()
  .describe("Where in the course this comes from. Displayed verbatim in the app's banner and never interpreted.");

const choiceShape = z.object({
  body: z.string().describe("The choice's text."),
  is_correct: z.boolean().describe("True for exactly one choice. Multi-select is not supported; a second true is rejected."),
  misconception: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Optional, for a non-correct choice: which wrong model picking it represents. Omit it (or send null) " +
      "when you didn't record one — null reads as unknown, not as 'this distractor represents none'."
    ),
});

const questionInputShape = z.object({
  type: z.string(),
  prompt: z.string(),
  tags: z.array(z.string()),
  difficulty: z.number().optional(),
  calculator_policy: z.string().optional(),
  explanation: z.string().nullable().optional(),
  source_note: z.string().nullable().optional(),
  choices: z.array(choiceShape).optional().describe(
    "Required when type: \"mc\" (2+ choices, at least one is_correct: true). Not used for type: \"written\"."
  ),
  model_answer: z.string().nullable().optional(),
  rubric: z.unknown().optional(),
  graph_spec: z.string().nullable().optional(),
  desmos_allowed: z.boolean().optional().describe(
    "Per-question: does a graphing calculator meaningfully help THIS question, independent of calculator_policy. See readme's calculator_conventions."
  ),
  document_id: z.string().nullable().optional(),
  document_anchor_label: z.string().nullable().optional(),
  document_anchor_start: z.number().nullable().optional(),
  document_anchor_end: z.number().nullable().optional(),
  document_marker_offset: z.number().nullable().optional().describe(
    "Char offset into the linked document's extracted_text where this question's inline " +
      "reference marker sits (e.g. the '(A)' or '12.' in an ACT-English-style passage that " +
      "this question is about). Requires document_id. Clicking the rendered marker jumps " +
      "the test-taker to this question. Distinct from document_anchor_start/end, which " +
      "highlights a whole excerpt range rather than one inline marker."
  ),
  claim_rung: z.enum(["can_state", "can_apply", "can_discriminate", "can_explain_why", "can_transfer"]).nullable().optional()
    .describe("The highest rung on the claim ladder this item can support evidence for. Leave unset if this item doesn't map to a specific rung."),
  tests_error: z.string().nullable().optional()
    .describe("Free-text description of the specific wrong model this item is designed to catch, if any."),
  provenance: z.enum(["tutor_authored", "textbook_sourced"]).nullable().optional()
    .describe("Where this item's content came from — distinct from created_by (who wrote the JSON)."),
  node_key: z.string().nullable().optional()
    .describe("The primary node key: a stable string identifying the specific teachable idea this item targets, finer-grained than a tag. Shorthand for node_keys with one entry; if you pass both, it must equal node_keys[0] or the question is rejected as node_key_mismatch."),
  node_keys: z.array(z.string()).nullable().optional()
    .describe("Every teachable idea this item targets, the first being primary. Each must start with \"node:\" and follow the tag slug grammar (lowercase ascii segments joined by \":\", words joined by \"_\" or \".\"), e.g. \"node:ebbing11e:2.4:atomic_weight\" — anything else rejects that question as invalid_node_key."),
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ok(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

function fail(err: unknown) {
  if (err instanceof DomainError) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: JSON.stringify({ error: err.code, message: err.message }) }],
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: "internal_error", message }) }] };
}

// MCP-layer-only trim: drops retired_at/description when null (frequently/always the
// case in the non-include_retired listing), since the domain listTags() return shape
// stays fully populated for other callers (e.g. the /api/tags HTTP route).
export function trimListTagsForMcp(tags: ReturnType<typeof listTags>) {
  return tags.map(({ retired_at, description, ...rest }) => ({
    ...rest,
    ...(retired_at != null ? { retired_at } : {}),
    ...(description != null ? { description } : {}),
  }));
}

// The presenter surface: what the tutor server's own MCP connection can
// reach. It is the live teaching loop and nothing else — no bank maintenance,
// no template/theme/config/asset surface — so the token that server holds
// can't reshape the bank even if it is compromised. Task 8's show tools
// append here; nothing else about registration changes when they do.
//
// The ws_* tools are here because the tutor writes into Ben's workspace (its
// notes about him go into the unit's USERNOTES file) and the planner shares
// that connection. They read, create, write, append and place; none of them
// removes or moves anything, so the token still can't tidy the tree away.
export const PRESENTER_TOOLS: readonly string[] = [
  "readme",
  "create_session",
  "create_questions",
  "present_item",
  "await_item_outcome",
  "present_show",
  "update_show",
  "await_show_outcome",
  "get_attempt",
  "end_session",
  "grade_response",
  "list_ungraded_written",
  "ws_list",
  "ws_read",
  "ws_search",
  "ws_create",
  "ws_write",
  "ws_append",
  "ws_place",
];

export function registerTools(
  server: McpServer,
  db: DatabaseSync,
  uploadsDir: string,
  nodeId: string,
  scope: ToolScope = "full"
): void {
  const allowed = scope === "presenter" ? new Set(PRESENTER_TOOLS) : null;
  // The tools this particular registration actually registered. readme() is
  // handed this rather than the module-level set in protocol.ts, so a
  // presenter connection sees its own names and a full connection sees
  // all of them — in one process serving both, neither leaks into the other.
  const registered: string[] = [];

  // Every registration goes through here so readme()'s node.tools list is the
  // set of tools actually registered, not a hand-kept copy beside it.
  const registerTool = ((name: string, config: unknown, cb: unknown) => {
    if (allowed && !allowed.has(name)) return undefined;
    registered.push(name);
    // Only the full registration feeds protocol.ts's module-level set, which
    // is the answer to "what does this build expose", not "what did this
    // request reach".
    if (scope === "full") recordToolName(name);
    return (server.registerTool as (...args: unknown[]) => unknown)(name, config, cb);
  }) as unknown as McpServer["registerTool"];

  registerTool(
    "readme",
    {
      description:
        "Call once at the very start of a session, before bootstrap. Returns universal authoring conventions " +
        "(prompt style, the calculator_policy/desmos_allowed distinction, tag kinds, document anchoring, " +
        "duplicate-report workflow, batching guidance) that don't repeat per-subject the way bootstrap's " +
        "taxonomy does. `scope` names which tool surface you reached this node through — \"full\" is the " +
        "authoring connector, \"presenter\" is the reduced live-teaching surface — and node.tools lists " +
        "exactly the tools your scope has.",
    },
    async () => {
      try {
        return ok(readme(db, { scope, tools: registered }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "bootstrap",
    {
      description:
        "Call once per subject touched this session (after readme). Returns that subject's tag taxonomy, " +
        "results pointer, and — for math/science subjects — the graph_spec DSL reference. Also returns " +
        "`taxonomy: { seeded, seed_available, tag_count }`. If `taxonomy.tag_count` is 0 and " +
        "`seed_available`, call again with `seed: true` before minting tags — that creates the shipped " +
        "taxonomy for the subject (idempotent; it only creates what's missing) so you tag against the " +
        "standard slugs instead of inventing near-duplicates.",
      inputSchema: {
        subject: z.string().nullable().optional(),
        seed: z
          .boolean()
          .optional()
          .describe(
            "Create the subject's shipped taxonomy tags that don't exist yet. Idempotent: a second call " +
              "with seed: true creates nothing and reports seeded: false."
          ),
      },
    },
    async ({ subject, seed }) => {
      try {
        return ok(bootstrap(db, subject ?? null, { seed: seed === true }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "list_tags",
    {
      description:
        "List tags in the controlled vocabulary. Every row carries `kind` — \"node\" (one teachable idea, " +
        "the same string a question's node_keys carry), \"tech\" (a rendering/tooling requirement), " +
        "\"topic\" (a cross-subject theme) or \"subject\" (everything else: the subject trees themselves), " +
        "derived from the slug's leading segment. `prefix` and `kind` compose (both are applied). " +
        "Paginated: pass limit/offset to page past the default 50; response includes total and has_more.",
      inputSchema: {
        prefix: z.string().optional().describe("Limit to this slug and its descendants, e.g. \"chemistry\"."),
        kind: z
          .enum(["node", "tech", "topic", "subject"])
          .optional()
          .describe("Limit to one tag kind. Composes with prefix rather than replacing it."),
        include_retired: z.boolean().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      },
    },
    async ({ prefix, kind, include_retired, limit, offset }) => {
      try {
        const opts = { prefix, kind, includeRetired: include_retired, limit: limit ?? 50, offset: offset ?? 0 };
        const total = countTags(db, { prefix, kind, includeRetired: include_retired });
        const tags = listTags(db, opts);
        return ok({ total, tags: trimListTagsForMcp(tags), has_more: (offset ?? 0) + tags.length < total });
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "create_tag",
    {
      description: "Create one tag in the controlled vocabulary. One at a time by design.",
      inputSchema: {
        slug: z.string(),
        label: z.string(),
        parent_slug: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
      },
    },
    async ({ slug, label, parent_slug, description }) => {
      try {
        return ok(createTag(db, { slug, label, parent_slug, description }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "merge_tags",
    {
      description:
        "Maintenance op: repoint every question and child tag from from_slug to to_slug, then retire " +
        "from_slug. When both slugs are \"node:\" tags the node keys move too (question_node_key and the " +
        "question's primary node_key), reported as node_keys_updated, and so do the node's retention targets " +
        "and their draws (retention_targets_moved; a label to_slug already has stays to_slug's); a merge that " +
        "isn't node:-to-node: leaves node keys alone.",
      inputSchema: { from_slug: z.string(), to_slug: z.string() },
    },
    async ({ from_slug, to_slug }) => {
      try {
        return ok(mergeTags(db, from_slug, to_slug));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "search_questions",
    {
      description:
        "Search the question bank. Omits explanation/rubric to keep listings cheap. Every row carries node_keys " +
        "(primary first) and node_key (the primary). Ephemeral items are excluded unless include_ephemeral: true. " +
        "Paginated: pass limit/offset to page past the default 50; response includes has_more (and total).",
      inputSchema: {
        tag_query: tagQueryShape,
        text: z.string().optional(),
        type: z.enum(["mc", "written"]).optional(),
        difficulty_min: z.number().optional(),
        difficulty_max: z.number().optional(),
        calculator_policy: z.enum(["allowed", "forbidden", "n_a"]).optional(),
        include_retired: z.boolean().optional(),
        latest_version_only: z.boolean().optional(),
        node_key: z.string().optional().describe(
          "Match items by node key: exactly, or — when the value ends with ':' — by prefix, so " +
            "\"node:ebbing11e:2.4:\" matches every key under that section."
        ),
        session_id: z.string().optional().describe("Only questions written for this session (see create_questions' session_id)."),
        include_ephemeral: z.boolean().optional().describe(
          "Include session-only questions, which are otherwise excluded from every listing."
        ),
        limit: z.number().optional(),
        offset: z.number().optional(),
      },
    },
    async (params) => {
      try {
        const result = searchQuestions(db, params);
        const offset = params.offset ?? 0;
        return ok({ ...result, has_more: offset + result.questions.length < result.total });
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "get_question",
    {
      description:
        "Read one question in full, including explanation, rubric, graph_spec, node_keys (primary first) and " +
        "whether it is ephemeral (session-only) — search_questions omits or excludes these. Call this before " +
        "editing a question you don't already have the full content of in this session.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try {
        return ok(getQuestionDetail(db, id));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "create_questions",
    {
      description:
        "Batch-write questions into the bank. Rejections are per-question; valid siblings still commit. Flags possible " +
        "duplicates without rejecting them. Also flags (non-blocking) an mc question with other than 4 choices, per " +
        "readme()'s prompt_conventions. ephemeral: true (which requires session_id) writes items for this session " +
        "alone — they stay out of every draw, search, and bank count, are presentable by id while the session runs, " +
        "and end_session retires them. Pass idempotency_key to make a retry safe: a repeat of a key already seen " +
        "writes nothing and returns the first call's result verbatim with replayed: true.",
      inputSchema: {
        questions: z.array(questionInputShape),
        ephemeral: z.boolean().optional().describe(
          "Batch-level: these questions exist for this session only. Requires session_id; rejected as " +
            "ephemeral_requires_session without one."
        ),
        session_id: z.string().optional().describe(
          "The session from create_session these questions belong to. Required with ephemeral: true."
        ),
        idempotency_key: z.string().max(128).optional().describe(
          "Your own id for this batch, up to 128 characters. Repeating it replays the stored result instead of " +
            "writing the batch a second time."
        ),
      },
    },
    async ({ questions, ephemeral, session_id, idempotency_key }) => {
      try {
        return ok(createQuestions(db, questions, { ephemeral, session_id, idempotency_key }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "edit_question",
    {
      description: "Edit a question. Versions (new row, old retired) if the question has attempts; edits in place otherwise.",
      inputSchema: {
        id: z.string(),
        changes: z.object({
          prompt: z.string().optional(),
          explanation: z.string().nullable().optional(),
          tags: z.array(z.string()).optional(),
          difficulty: z.number().optional(),
          calculator_policy: z.string().optional(),
          model_answer: z.string().nullable().optional(),
          rubric: z.unknown().optional(),
          choices: z.array(choiceShape).optional(),
          source_note: z.string().nullable().optional(),
          graph_spec: z.string().nullable().optional(),
          desmos_allowed: z.boolean().optional().describe(
            "True only if this specific question meaningfully benefits from a graphing " +
              "calculator (e.g. graphing/algebra/pre-calc/calc/stats questions where plotting " +
              "or exploring a function helps). Do NOT set true just because a calculator would " +
              "be technically permitted in a real exam for this section — 'allowed' means " +
              "'useful here', not 'not forbidden'. Leave false/omitted for subjects or question " +
              "types where a graphing calculator adds nothing (English, reading, history, basic " +
              "arithmetic, etc.), even under calculator-allowed testing conditions."
          ),
          document_id: z.string().nullable().optional(),
          document_anchor_label: z.string().nullable().optional(),
          document_anchor_start: z.number().nullable().optional(),
          document_anchor_end: z.number().nullable().optional(),
          document_marker_offset: z.number().nullable().optional(),
          claim_rung: z.enum(["can_state", "can_apply", "can_discriminate", "can_explain_why", "can_transfer"]).nullable().optional()
            .describe("The highest rung on the claim ladder this item can support evidence for. Leave unset if this item doesn't map to a specific rung."),
          tests_error: z.string().nullable().optional()
            .describe("Free-text description of the specific wrong model this item is designed to catch, if any."),
          provenance: z.enum(["tutor_authored", "textbook_sourced"]).nullable().optional()
            .describe("Where this item's content came from — distinct from created_by (who wrote the JSON)."),
          node_key: z.string().nullable().optional()
            .describe("Replaces the whole node-key set with this one primary key. Pass node_keys instead to set several."),
          node_keys: z.array(z.string()).nullable().optional()
            .describe("Replaces the item's node keys, first being primary. Same grammar as create_questions; an invalid entry is rejected as invalid_node_key."),
        }),
      },
    },
    async ({ id, changes }) => {
      try {
        return ok(editQuestion(db, id, changes));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "retire_question",
    {
      description: "Soft-retire a question. Excluded from draws and future pulls; existing responses unaffected.",
      inputSchema: { id: z.string(), reason: z.string() },
    },
    async ({ id, reason }) => {
      try {
        return ok(retireQuestion(db, id, reason));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "list_templates",
    {
      description:
        "List saved draw templates, with live eligible_count, attempt_count, and mean_score. Paginated: pass limit/offset to page past the default 50; response includes total and has_more.",
      inputSchema: {
        include_retired: z.boolean().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      },
    },
    async ({ include_retired, limit, offset }) => {
      try {
        const opts = { includeRetired: include_retired, limit: limit ?? 50, offset: offset ?? 0 };
        const total = countTemplates(db, { includeRetired: include_retired });
        const templates = listTemplates(db, opts);
        return ok({ total, templates, has_more: (offset ?? 0) + templates.length < total });
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "create_template",
    {
      description:
        "Create a saved draw specification. frozen: true resolves and locks a draw immediately, for pre/post tests that must show the identical set twice.",
      inputSchema: {
        name: z.string(),
        tag_query: tagQueryShape,
        question_count: z.number(),
        description: z.string().nullable().optional(),
        mc_ratio: z.number().nullable().optional(),
        difficulty_min: z.number().nullable().optional(),
        difficulty_max: z.number().nullable().optional(),
        calculator_policy: z.enum(["allowed", "forbidden", "any"]).optional(),
        weighting: z.enum(["random", "weak_weighted"]).nullable().optional(),
        due_mode: z.enum(["off", "weight", "gate"]).optional().describe(
          "How due-ness shapes the draw. 'weight' (default): due items are likelier, nothing excluded. " +
            "'gate': only due items, most overdue first — an Osmosis-scheduled homework or SM2 review set; " +
            "nothing due draws nothing. 'off': due-ness ignored."
        ),
        frozen: z.boolean().optional(),
        time_limit_sec: z.number().nullable().optional(),
        session_id: z.string().optional().describe(
          "Attach this template to a tutoring session from create_session, so it shows up under that " +
            "session in the app instead of the general template list. Omit for ordinary homework/bank templates."
        ),
      },
    },
    async (params) => {
      try {
        return ok(createTemplate(db, { ...params, tag_query: params.tag_query ?? {} }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "edit_template",
    {
      description:
        "Edit a template. Editing a frozen template's tag_query or question_count re-resolves the frozen set and requires confirm_refreeze: true.",
      inputSchema: {
        id: z.string(),
        changes: z.object({
          name: z.string().optional(),
          description: z.string().nullable().optional(),
          tag_query: tagQueryShape,
          question_count: z.number().optional(),
          mc_ratio: z.number().nullable().optional(),
          difficulty_min: z.number().nullable().optional(),
          difficulty_max: z.number().nullable().optional(),
          calculator_policy: z.enum(["allowed", "forbidden", "any"]).optional(),
          weighting: z.enum(["random", "weak_weighted"]).nullable().optional(),
          due_mode: z.enum(["off", "weight", "gate"]).optional(),
          frozen: z.boolean().optional(),
          time_limit_sec: z.number().nullable().optional(),
          confirm_refreeze: z.boolean().optional(),
        }),
      },
    },
    async ({ id, changes }) => {
      try {
        return ok(editTemplate(db, id, changes));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "retire_template",
    {
      description: "Soft-retire a template.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try {
        return ok(retireTemplate(db, id));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "get_results",
    {
      description:
        "Read attempt results. scope 'question' is sorted worst-first and is the primary signal for what to write more of; it returns recent_responses for every item — mc and written alike — with the chosen option and its misconception, the best guess after an idk, response text, confidence (plus confidence_numeric), idk, misapplied_method, diagnosis, grader, the derived outcome and latency, plus graded/ungraded and graded_by (self/model/oracle/judge/auto_mc) counts. scope 'attempt' carries the same per-response records under responses. A null score (ungraded) is never averaged in as zero, and an idk is dont_know, never incorrect.",
      inputSchema: {
        scope: z.enum(["tag", "question", "attempt", "daily"]),
        tag_query: tagQueryShape,
        since: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      },
    },
    async (params) => {
      try {
        return ok(getResults(db, params, { viewer: "tutor" }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "get_config",
    { description: "Read the current app config." },
    async () => {
      try {
        return ok(getConfig(db));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "set_config",
    {
      description: "Set one config key. Refuses unknown keys and secrets (model grading API key is server-UI-only).",
      inputSchema: { key: z.string(), value: z.unknown() },
    },
    async ({ key, value }) => {
      try {
        return ok(setConfig(db, key, value));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "create_asset",
    {
      description:
        "Create a source-material asset (url, raw text, or file) that questions can anchor back to via document_id. File content is base64-encoded; text is extracted automatically where possible (pdf, plain text/markdown, images via vision model).",
      inputSchema: {
        title: z.string(),
        type: z.enum(["url", "text", "file"]),
        content: z.string().optional(),
        filename: z.string().optional(),
        mime: z.string().optional(),
      },
    },
    async ({ title, type, content, filename, mime }) => {
      try {
        const asset = await createAsset(db, uploadsDir, { title, type, content, filename, mime }, "claude");
        return ok({ id: asset.id, title: asset.title, type: asset.type, extracted_text: asset.extracted_text });
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "list_assets",
    {
      description:
        "List source-material assets (notes, PDFs, links). unlinked_only filters to assets no question currently references via document_id. Paginated: pass limit/offset to page past the default 50; response includes total and has_more.",
      inputSchema: {
        unlinked_only: z.boolean().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      },
    },
    async ({ unlinked_only, limit, offset }) => {
      try {
        const opts = { unlinkedOnly: unlinked_only, limit: limit ?? 50, offset: offset ?? 0 };
        const total = countAssets(db, { unlinkedOnly: unlinked_only });
        const assets = listAssets(db, opts);
        return ok({ total, assets, has_more: (offset ?? 0) + assets.length < total });
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "read_asset",
    {
      description: "Read a single asset in full, including its extracted_text.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try {
        return ok(getAsset(db, id));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "search_assets",
    {
      description:
        "Full-text search over asset titles and extracted text. Returns snippets, not full content -- don't guess offsets from a snippet, use read_asset for the full text. Paginated: pass limit/offset to page past the default 50; response includes total and has_more.",
      inputSchema: {
        query: z.string(),
        type: z.enum(["url", "text", "file"]).optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      },
    },
    async ({ query, type, limit, offset }) => {
      try {
        const result = searchAssets(db, query, { type, limit: limit ?? 50, offset: offset ?? 0 });
        return ok({ ...result, has_more: (offset ?? 0) + result.assets.length < result.total });
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "present_item",
    {
      description:
        "Create a live item for the learner to answer in the Osmosis app. The returned question snapshot carries node_keys/node_key. Returns immediately with an attempt/response id — the item is NOT rendered in this conversation. Call await_item_outcome afterward to learn what happened once the learner answers in the app. Either pass question_id for a specific item you authored, or tag_query to let Osmosis pick an eligible one " +
        "(due_mode decides how due-ness shapes that pick).",
      inputSchema: {
        question_id: z.string().optional(),
        tag_query: tagQueryShape,
        session_id: z.string().optional().describe(
          "The session id from create_session. Always call create_session first and pass its id here, so " +
            "the app's live screen for that session surfaces this item and everything groups under one entry."
        ),
        reveal: z.enum(["immediate", "deferred"]).optional().describe(
          "Overrides the session's reveal_default for this item: 'immediate' shows the learner the answer key on " +
            "submit, 'deferred' holds it back until end_session. Defaults to the session's setting, or immediate."
        ),
        context: contextShape,
        due_mode: z.enum(["off", "weight", "gate"]).optional().describe(
          "For a tag_query pick only. 'weight' (default): due items are likelier. 'gate': the most overdue " +
            "due item, or a nothing_due refusal. 'off': uniform, as before."
        ),
      },
    },
    async ({ question_id, tag_query, session_id, reveal, context, due_mode }) => {
      try {
        return ok(presentItem(db, { node_id: nodeId, question_id, tag_query, session_id, reveal, context, due_mode }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "await_item_outcome",
    {
      description:
        "Wait for the learner to answer the item from present_item, up to timeout_s seconds (default 25, clamped to 1..25). Returns the outcome once answered, status: 'abandoned' if the item timed out unanswered (stop waiting — it will never resolve), status: 'paused' with paused_at if the learner stepped away (it resumes when they answer), or status: 'pending' if they haven't answered yet in that window — call this again to keep waiting, or come back to it later in the conversation. The answered record carries outcome (correct|partial|incorrect|dont_know|ungraded), score with the grader that produced it, selected_choice_id with its chosen_misconception, best_guess_choice_id with best_guess_correct (an idk's guess is recorded, never scored), response_text, confidence with confidence_numeric (1/3/5), idk, misapplied_method, diagnosis, elapsed_ms and answered_at, plus node_keys (primary first) and node_key for the idea the item targets.",
      inputSchema: {
        response_id: z.string(),
        timeout_s: z
          .number()
          .optional()
          .describe("How long to wait, in seconds. Default 25; values outside 1..25 are clamped."),
      },
    },
    async ({ response_id, timeout_s }) => {
      try {
        const windowS = Math.min(25, Math.max(1, timeout_s ?? 25));
        const deadline = Date.now() + windowS * 1_000;
        let paused: { status: "paused"; paused_at: string } | null = null;
        while (Date.now() < deadline) {
          const outcome = getItemOutcome(db, response_id);
          // Abandoned never resolves, so stop waiting; paused still might
          // inside this window, so keep polling and report it at the deadline.
          if (outcome.status === "answered" || outcome.status === "abandoned") return ok(outcome);
          paused = outcome.status === "paused" ? outcome : null;
          await sleep(1_000);
        }
        return ok(paused ?? { status: "pending" });
      } catch (err) {
        return fail(err);
      }
    }
  );

  // --------------------------------------------------------------------------
  // Showing (§5.1–§5.2). The other half of the live loop: putting something
  // on the learner's screen that is not a question. Nothing here is answered,
  // graded, or kept — a show belongs to its session and dies with it.
  // --------------------------------------------------------------------------

  registerTool(
    "present_show",
    {
      description:
        "Put something on the learner's screen that is NOT a question: a line of text, a paragraph of markdown, " +
        "or a graph to talk over. It lands in the app's session stream beside the items, with an OK button. " +
        "Returns immediately with a show_id — nothing is rendered in this conversation. Call await_show_outcome " +
        "to learn when it was seen and acknowledged, and update_show to redraw a graph in place. A show is " +
        "ephemeral: it is never in the bank, never graded, and dies with its session.",
      inputSchema: {
        session_id: z.string().describe("The session id from create_session. A show always belongs to a session, and the session must still be open."),
        kind: z
          .enum(["text", "markdown", "graph"])
          .describe(
            "'text' and 'markdown' both go through the app's rich-text renderer — the one a question prompt " +
              "uses, which today renders LaTeX ($...$ and $$...$$) and line breaks but not markdown emphasis, " +
              "so write **bold** only where you'd accept seeing the asterisks. 'graph' is a graph-engine spec, " +
              "the same DSL as a question's graph_spec, parsed here so a spec that won't render is rejected " +
              "rather than shown as an empty canvas."
          ),
        payload: z.string().describe("The content itself: the text, the markdown, or the graph spec."),
        caption: z
          .string()
          .optional()
          .describe("A short label shown under the card, up to 500 characters. A label, not the content."),
        context: contextShape,
      },
    },
    async ({ session_id, kind, payload, caption, context }) => {
      try {
        return ok(presentShow(db, { session_id, kind, payload, caption, context }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "update_show",
    {
      description:
        "Redraw a graph show in place — the app keeps the same canvas and feeds it the new spec, so the frame " +
        "doesn't jump while you talk over it (set @bounds in the spec to hold the frame yourself). Graph shows " +
        "only: anything else is rejected as update_not_supported, because replacing prose means present_show. " +
        "The session must still be open, and the new spec is parsed exactly as present_show parses the first one.",
      inputSchema: {
        show_id: z.string().describe("The show_id returned by present_show."),
        payload: z.string().describe("The replacement graph spec."),
      },
    },
    async ({ show_id, payload }) => {
      try {
        return ok(updateShow(db, show_id, payload));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "await_show_outcome",
    {
      description:
        "Wait for the learner to work through a show from present_show, up to timeout_s seconds (default 25, " +
        "clamped to 1..25). Returns status 'acknowledged' once they pressed OK (or Space) — that is your cue to " +
        "move on — 'seen' if the card reached their screen but they haven't acknowledged it, or 'pending' if " +
        "nothing has happened yet in that window; call this again to keep waiting. Also carries seen_at, " +
        "acknowledged_at and dwell_ms, the time the card actually stood in front of them, which is worth more " +
        "than the acknowledgement on its own: an instant OK after 400ms is not reading.",
      inputSchema: {
        show_id: z.string(),
        timeout_s: z
          .number()
          .optional()
          .describe("How long to wait, in seconds. Default 25; values outside 1..25 are clamped."),
      },
    },
    async ({ show_id, timeout_s }) => {
      try {
        const windowS = Math.min(25, Math.max(1, timeout_s ?? 25));
        const deadline = Date.now() + windowS * 1_000;
        // Unlike an item, a show has no terminal failure to bail out on — it
        // is never abandoned — so this polls to the deadline and reports
        // whatever it last saw. 'acknowledged' is the only status that ends
        // the wait early, because it is the only one that means "move on".
        let last = getShowOutcome(db, show_id);
        while (last.status !== "acknowledged" && Date.now() < deadline) {
          await sleep(1_000);
          last = getShowOutcome(db, show_id);
        }
        return ok(last);
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "quick_check",
    {
      description:
        "A single free-response check, presented inline in this conversation, for the in-node comprehension " +
        "check immediately after teaching. Free-response only (rejects mc questions) — use present_item/" +
        "await_item_outcome instead for multiple-choice or anything that benefits from the app's graph/Desmos " +
        "rendering. Either pass question_id for a specific item you authored, or tag_query to let Osmosis pick " +
        "an eligible written one.",
      inputSchema: {
        question_id: z.string().optional(),
        tag_query: tagQueryShape,
        session_id: z.string().optional().describe(
          "The session id from create_session. Pass it so this check's history groups under that session, " +
            "same as present_item."
        ),
      },
    },
    async ({ question_id, tag_query, session_id }) => {
      try {
        return ok(quickCheck(db, { node_id: nodeId, question_id, tag_query, session_id }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "submit_quick_check",
    {
      description:
        "Record the learner's free-response answer to a quick_check. Returns the full outcome record (response_text, outcome, score with its grader, model_answer, explanation, confidence with confidence_numeric, idk, misapplied_method, diagnosis).",
      inputSchema: {
        response_id: z.string(),
        response_text: z.string(),
        confidence: z.enum(["unsure", "somewhat", "confident"]).optional(),
        idk: z.boolean().optional(),
        misapplied_method: z.string().optional(),
      },
    },
    async ({ response_id, response_text, confidence, idk, misapplied_method }) => {
      try {
        return ok(submitQuickCheck(db, { response_id, response_text, confidence, idk, misapplied_method }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "create_session",
    {
      description:
        "Start a new tutoring session. Everything you present live afterward, and any session-specific test you " +
        "create, should be tagged with the returned session id so it groups together in the app under one 'Live' entry. " +
        "`tag_slug` must already exist (create_tag first); an unknown slug is rejected with not_found.",
      inputSchema: {
        name: z.string(),
        tag_slug: z.string().optional(),
        reveal_default: z.enum(["immediate", "deferred"]).optional().describe(
          "What items in this session do with their answer key on the learner's screen: 'immediate' (default — " +
            "shown on submit, today's behaviour) or 'deferred' (held back until end_session, so an early item's " +
            "key can't teach the next one). Your own reads are never affected either way."
        ),
      },
    },
    async ({ name, tag_slug, reveal_default }) => {
      try {
        return ok(createSession(db, { name, tag_slug, reveal_default }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "end_session",
    {
      description:
        "Mark a tutoring session finished and return its summary — presented / answered / abandoned / dont_know " +
        "counts over the session's live items, plus paused_now. Anything still unanswered is marked abandoned " +
        "here, so the counts are final, and any ephemeral question written for this session is retired " +
        "(retired_ephemeral counts them). Pass `summary` with the same closing recap you just gave the learner: " +
        "it is stored on the session and shown at the top of that session in the app, so they can read it back " +
        "without the conversation. Its history stays readable via get_session afterward.",
      inputSchema: {
        session_id: z.string(),
        summary: z
          .string()
          .optional()
          .describe(
            "Your closing recap of this session, in markdown (headings, lists, bold and $LaTeX$ all render). " +
              "Write it for the learner reading it back weeks later — what was covered, what went well, what " +
              "to pick up next — not as a transcript. Returned as summary_text and shown above the session's " +
              "attempt history in the app."
          ),
      },
    },
    async ({ session_id, summary }) => {
      try {
        return ok(endSession(db, session_id, { summary }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "grade_response",
    {
      description:
        "Record your own verdict on an answered item: grader 'oracle' (you know the answer) or 'judge' (you " +
        "judged the written answer), an optional score 0..1, and an optional one-line diagnosis that every " +
        "outcome path reads back. The attempt must be submitted. On a written item the score supersedes any " +
        "self or model grade; on an mc item only the diagnosis is stored — the auto_mc grade against the " +
        "question's own key stands.",
      inputSchema: {
        response_id: z.string(),
        grader: z.enum(["oracle", "judge"]),
        score: z.number().optional().describe("0..1. Ignored on an mc item, whose key already scored it."),
        diagnosis: z.string().optional().describe("One line: what went wrong (or right), in your words."),
      },
    },
    async ({ response_id, grader, score, diagnosis }) => {
      try {
        return ok(gradeResponseByTutor(db, response_id, { grader, score, diagnosis }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "list_ungraded_written",
    {
      description:
        "Written answers waiting for a verdict, oldest first: each row carries the prompt, rubric, model answer, " +
        "explanation, tags and the learner's response_text (plus idk, confidence, misapplied_method, elapsed_ms), " +
        "and any self grade. Read each one against its rubric and record your verdict with grade_response " +
        "(grader 'judge', score 0..1, one-line diagnosis). There is no model grader on this node — this is how " +
        "written work gets graded. Pass session_id to grade only one session's items; include_self_graded " +
        "defaults to true (a learner's own mark is a claim worth checking), false lists only the never-graded.",
      inputSchema: {
        session_id: z.string().optional(),
        include_self_graded: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional().describe("Default 25."),
      },
    },
    async ({ session_id, include_self_graded, limit }) => {
      try {
        return ok(listUngradedWritten(db, { session_id, include_self_graded, limit }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "get_session",
    {
      description:
        "Read a past tutoring session — its name, tag, and attempt history — for calibration or review.",
      inputSchema: { session_id: z.string() },
    },
    async ({ session_id }) => {
      try {
        return ok(getSessionDetail(db, session_id, { viewer: "tutor" }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "get_attempt",
    {
      description:
        "Read one attempt in full: every response with its question snapshot (answer key included once submitted), " +
        "selected_choice_id with its chosen_misconception, best_guess_choice_id with best_guess_correct, " +
        "response_text, confidence with confidence_numeric, idk, misapplied_method, diagnosis, elapsed_ms, " +
        "answered_at, the derived outcome and the live grade with its grader. Correctness — chosen_misconception " +
        "and best_guess_correct — stays withheld until the attempt is submitted. The attempt itself carries " +
        "paused_at/paused_ms. This is the attempt-scope read; get_results stays aggregate. attempt_id comes from " +
        "present_item, quick_check, get_session, or get_results(scope: 'attempt'). You read as the tutor, not the " +
        "learner: a deferred-reveal attempt withholds its key from the app's screens, never from this tool.",
      inputSchema: { attempt_id: z.string() },
    },
    async ({ attempt_id }) => {
      try {
        return ok(getAttemptDetail(db, attempt_id, { viewer: "tutor" }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "list_sessions",
    {
      description:
        "List past tutoring sessions, most recent first. Paginated: pass limit/offset to page past the default 50; response includes total and has_more.",
      inputSchema: { limit: z.number().optional(), offset: z.number().optional() },
    },
    async ({ limit, offset }) => {
      try {
        const result = listSessions(db, { limit: limit ?? 50, offset: offset ?? 0 });
        return ok({ ...result, has_more: (offset ?? 0) + result.sessions.length < result.total });
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "set_retention_target",
    {
      description:
        "Tell Osmosis how long a node needs to be retained, and let Osmosis compute when to resurface it. You supply the target and reason; Osmosis owns scheduling — never call this expecting to control exact timing. " +
        "The target attaches to the node and every item carrying that node key inherits it. Gap 1 is a share of the time left " +
        "(Cepeda): at gap 1 Osmosis draws the node's first probe — its discriminating items (those filed with tests_error), " +
        "first k by authoring order (config retention_draw_k, default 3), plus one transfer item (one whose node_keys span " +
        "this node and another) — and holds the rest as reserve. A passing draw brings the reserve in at the node's gap-2 " +
        "interval; any miss brings it forward now as relearn material. From an item's first retention review on, SM2 sets " +
        "its gaps from oracle/judge/auto_mc grades (self grades never schedule), clamped so no gap steps past an open target. " +
        "Setting the same label again starts that target over. Returns due_at = gap 1.",
      inputSchema: {
        identity_key: z.string().describe(
          "The node key the target attaches to: node:<textbook_slug>:<section>:<node_key> for course material, " +
            "node:<topic_slug>:<subtopic>:<node_key> for self-directed. A tag slug that is not a node key is refused."
        ),
        retention_target: z.string().describe("A label for this specific target, e.g. 'chapter-8-test' or 'final-exam'. One identity can have several open targets."),
        target_source: z.enum(["engine", "tutor_direct"]).describe("'engine' if this came from a published assessment date; 'tutor_direct' if you set it yourself for a self-directed topic."),
        needs_last_until: z.string().describe("ISO date/datetime the material needs to be retained until."),
      },
    },
    async ({ identity_key, retention_target, target_source, needs_last_until }) => {
      try {
        return ok(setRetentionTarget(db, { identity_key, retention_target, target_source, needs_last_until }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  // ---- Themes: a theme is a manifest (seeds + dials + fonts + overrides). ----
  const themeResult = (saved: { theme: { id: string; name: string; updated_at: string }; report: unknown }, makeActive: boolean | undefined) => {
    if (makeActive) setActiveTheme(db, saved.theme.id);
    return ok({
      saved: true,
      theme: { id: saved.theme.id, name: saved.theme.name, updated_at: saved.theme.updated_at },
      report: saved.report,
      active: getActiveThemeId(db) === saved.theme.id,
    });
  };
  // An invalid manifest is an authoring result, not a crash: hand back the report so the author can fix it.
  const themeFail = (err: unknown) => {
    if (err instanceof DomainError && err.code === "invalid_theme" && err.detail) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: JSON.stringify({ saved: false, error: err.code, message: err.message, report: err.detail }) }],
      };
    }
    return fail(err);
  };
  const FONT_NAMES = Object.keys(FONT_STACKS).join(", ");

  registerTool(
    "list_themes",
    {
      description:
        "List themes: your saved custom themes plus the built-ins (builtin:osmosis, builtin:forest, builtin:ocean, builtin:ember, builtin:ws-clean), " +
        "with which are active. A theme has a layer: workspace (shape, type, space, material and component tokens plus chrome css), ambience " +
        "(colour, graph, ambience, sound), or null for a full theme that sets both. Two slots are active at once: ambience (active_theme_id) and " +
        "workspace (active_workspace_theme_id); each entry's slot says which it is in. Pass layer to list only themes usable in that slot " +
        "(that layer, or full). Custom themes live on the server and sync to every device. Use get_theme to read one.",
      inputSchema: { layer: z.enum(["workspace", "ambience"]).optional() },
    },
    async ({ layer }) => {
      try {
        const active = getActiveThemeId(db) ?? DEFAULT_THEME_ID;
        const activeWs = getActiveWorkspaceThemeId(db);
        const entry = (id: string, name: string, description: string, builtin: boolean, l: "workspace" | "ambience" | null) => ({
          id, name, description, builtin, layer: l, active: id === active,
          slot: [...(id === active ? ["ambience"] : []), ...(id === activeWs ? ["workspace"] : [])],
        });
        const all = [
          ...BUILTINS.map((m) => entry(m.id, m.name, m.description ?? "", true, m.layer ?? null)),
          ...listThemes(db).map((t) => entry(t.id, t.name, t.manifest.description ?? "", false, t.layer)),
        ];
        const themes = layer === undefined ? all : all.filter((t) => t.layer === null || t.layer === layer);
        return ok({ themes, active_theme_id: active, active_workspace_theme_id: activeWs });
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "get_theme",
    {
      description:
        "Read one theme (custom id or builtin:*): its layer (workspace, ambience, or null for a full theme), its manifest, and with resolved: true every token's final value for light and dark plus " +
        "provenance (default / seed / dial / override) so you can see what a seed or dial produced. Read a built-in to learn by example, " +
        "then save your own (built-ins are read-only).",
      inputSchema: { id: z.string(), resolved: z.boolean().optional() },
    },
    async ({ id, resolved }) => {
      try {
        const builtin = builtinById(id);
        const row = builtin ? null : getTheme(db, id);
        const manifest = builtin ?? (row && !row.deleted_at ? row.manifest : undefined);
        if (!manifest) throw new DomainError("not_found", `Theme "${id}" does not exist.`);
        const out: Record<string, unknown> = { id: manifest.id, name: manifest.name, builtin: builtin !== undefined, layer: manifest.layer ?? null, manifest };
        if (resolved) {
          const r = resolveTheme(manifest);
          out.resolved = { light: r.light, dark: r.dark, provenance: r.provenance };
        }
        return ok(out);
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "theme_tokens",
    {
      description:
        "The token reference for authoring: every themeable token with its name, tier, group, type, whether it differs by mode, allowed " +
        "values (enum tokens), and meaning. Names are what manifest overrides use (e.g. overrides.any['radius-md'], overrides.light['color-surface']). " +
        "Each token has an owner: workspace, ambience, or shared. Pass layer: 'workspace' to see only the tokens a workspace theme controls " +
        "(workspace + shared: shape, type, space, material, component) or layer: 'ambience' for ambience + shared (colour, graph, ambience). " +
        "Pass group to narrow: " + [...new Set(TOKENS.map((t) => t.group))].join(", ") + ". Call this before writing overrides.",
      inputSchema: { group: z.string().optional(), layer: z.enum(["workspace", "ambience"]).optional() },
    },
    async ({ group, layer }) => {
      try {
        const groups = [...new Set(TOKENS.map((t) => t.group as string))];
        if (group !== undefined && !groups.includes(group)) {
          throw new DomainError("unknown_group", `Unknown group "${group}". Valid groups: ${groups.join(", ")}.`);
        }
        const tokens = TOKENS.filter((t) => group === undefined || t.group === group)
          .filter((t) => layer === undefined || ownerOf(t.name) === "shared" || ownerOf(t.name) === layer)
          .map((t) => ({
          name: t.name, owner: ownerOf(t.name), tier: t.tier, group: t.group, type: t.type, modeDependent: t.modeDependent,
          ...(t.allowed ? { allowed: t.allowed } : {}), meaning: t.meaning,
        }));
        return ok({ count: tokens.length, tokens });
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "save_theme",
    {
      description:
        "Create or replace a theme from a manifest {id, name, layer?, seeds:{light?,dark?}, dials, fonts, overrides?, css?}. layer is 'workspace' " +
        "(shape/type/space/material/component tokens + chrome css), 'ambience' (colour/graph/ambience/sound), or omitted for a full theme; a " +
        "layered theme should only set what its layer owns (see theme_tokens layer). Start small: a few seeds " +
        "(canvas, surface, ink, accent, per mode) plus dials; everything else is derived. Give one mode and the other is derived. Call theme_tokens " +
        "for token names and override only what you must. Dials: contrast, warmth, saturation, roundness, density, elevation, borders, " +
        "translucency, texture, motion are 0..1; typeScale 1.125..1.333; baseSize 13..18px. Fonts are named stacks: " + FONT_NAMES + ". " +
        "ALWAYS read report.warnings[].suggestion (e.g. low contrast) and apply them with patch_theme. ambience, sounds, assets, graph.papers " +
        "are reserved: stored, no effect yet. Invalid manifests are not saved; the result carries report.errors. make_active switches to it.",
      inputSchema: { manifest: z.record(z.string(), z.unknown()), make_active: z.boolean().optional() },
    },
    async ({ manifest, make_active }) => {
      try {
        return themeResult(saveTheme(db, { manifest: manifest as unknown as ThemeManifest }), make_active);
      } catch (err) {
        return themeFail(err);
      }
    }
  );

  registerTool(
    "patch_theme",
    {
      description:
        "Edit a saved theme with a JSON merge patch: objects merge, null deletes a key, anything else replaces. E.g. {dials:{roundness:0.2}, " +
        "overrides:{any:{'radius-md':null}}}. Use it to apply report.warnings[].suggestion after save_theme. Same validation and result as " +
        "save_theme; built-ins and unknown ids fail. make_active switches to it.",
      inputSchema: { id: z.string(), patch: z.record(z.string(), z.unknown()), make_active: z.boolean().optional() },
    },
    async ({ id, patch, make_active }) => {
      try {
        return themeResult(patchTheme(db, id, patch), make_active);
      } catch (err) {
        return themeFail(err);
      }
    }
  );

  registerTool(
    "validate_theme",
    {
      description:
        "Dry-run a manifest: returns the report {ok, errors[], warnings[]} (each with path, message, suggestion) and stores nothing. " +
        "Use it to iterate before save_theme. Checks dial ranges, colours, font names, token names, contrast of ink on canvas and accent on surface.",
      inputSchema: { manifest: z.record(z.string(), z.unknown()) },
    },
    async ({ manifest }) => {
      try {
        return ok(validateManifest(manifest));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "delete_theme",
    {
      description: "Delete a custom theme on every device. If it was active, the app falls back to the default (builtin:osmosis). Built-ins can't be deleted.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try {
        if (isBuiltinId(id)) throw new DomainError("builtin_theme", "Built-in themes are read-only and cannot be deleted.");
        return ok(deleteTheme(db, id));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "set_active_theme",
    {
      description:
        "Make a theme active on every device. layer 'ambience' (default) sets the colour/ambience slot: a custom id or builtin:* id (workspace-layer " +
        "themes are refused); null means the default, builtin:osmosis. layer 'workspace' sets the workspace slot (shape/type/space/material/" +
        "component): ambience-layer themes are refused; null clears it (no workspace theme). Returns both pointers.",
      inputSchema: { id: z.string().nullable(), layer: z.enum(["ambience", "workspace"]).optional() },
    },
    async ({ id, layer }) => {
      try {
        if (layer === "workspace") setActiveWorkspaceTheme(db, id);
        else setActiveTheme(db, id ?? DEFAULT_THEME_ID);
        return ok({ active_theme_id: getActiveThemeId(db), active_workspace_theme_id: getActiveWorkspaceThemeId(db) });
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "get_due_items",
    {
      description:
        "List the items whose retention schedule is due now (or before a given time), most overdue first — overdue " +
        "measured against the gap the item was meant to survive (overdue_ratio). Paginated. One row per item (id = its " +
        "lineage_id; question_id = its live version), with node_key/node_keys, its targets (role draw|reserve and the " +
        "draw's probe state), SM2 state (easiness, repetitions, interval_days, last_quality) and reason: " +
        "never_demonstrated (no retention review yet — a draw awaiting its first probe, or reserve a passing draw " +
        "brought in), relearn (not yet retained: reserve a failed draw brought forward, or never passed — go teach it), " +
        "lapsed (failed after passing before — resurface sooner), or decayed (last review passed, interval elapsed). " +
        "node_key filters to a node or anything under it (segment-aware: node:x:2 is not node:x:2.4).",
      inputSchema: {
        before: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
        node_key: z.string().optional(),
      },
    },
    async ({ before, limit, offset, node_key }) => {
      try {
        return ok(getDueItems(db, { before, limit, offset, node_key }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  // The workspace tools go through the same wrapper, so the presenter
  // allowlist above decides which of them a scope sees.
  registerWorkspaceTools(registerTool, db, { ok, fail });
}

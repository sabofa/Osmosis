import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "../domain/errors.js";
import { recordToolName } from "../protocol.js";
import { readme } from "../domain/readme.js";
import { bootstrap } from "../domain/bootstrap.js";
import { listTags, createTag, mergeTags, countTags } from "../domain/tags.js";
import { createQuestions, editQuestion, retireQuestion, searchQuestions, getQuestionDetail } from "../domain/questions.js";
import { getConfig, setConfig } from "../domain/config.js";
import { listTemplates, countTemplates, createTemplate, editTemplate, retireTemplate } from "../domain/templates.js";
import { getResults } from "../domain/results.js";
import { createAsset, getAsset, searchAssets, listAssets, countAssets } from "../domain/assets.js";
import { presentItem, getItemOutcome, quickCheck, submitQuickCheck, getAttemptDetail, gradeResponseByTutor } from "../domain/attempts.js";
import { createSession, endSession, listSessions, getSessionDetail } from "../domain/sessions.js";
import { setRetentionTarget, getDueItems } from "../domain/retention.js";
import { listThemes, saveTheme, deleteTheme, setActiveTheme, getActiveThemeId } from "../domain/themes.js";

// Mirrors web/src/lib/themeTokens.ts TOKEN_FIELDS — the only custom properties
// a theme's token sets may name. Anything else belongs in custom_css.
const THEME_TOKEN_KEYS = ["--accent", "--accent-wash", "--bg", "--surface", "--ink", "--muted", "--line", "--line-strong"] as const;
const themeTokenSetShape = z
  .record(z.enum(THEME_TOKEN_KEYS), z.string().regex(/^#[0-9a-fA-F]{6}$/, "hex colour like #c65d22"))
  .describe("Map of CSS custom property → hex colour. Omitted keys fall back to the app's defaults for that mode.");

const tagQueryShape = z
  .object({
    all: z.array(z.string()).optional(),
    any: z.array(z.string()).optional(),
    none: z.array(z.string()).optional(),
  })
  .optional();

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
    .describe("A stable string identifying the specific teachable idea this item targets, finer-grained than a tag. You mint and own these — Osmosis stores them but doesn't interpret their structure."),
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

export function registerTools(server: McpServer, db: DatabaseSync, uploadsDir: string, nodeId: string): void {
  // Every registration goes through here so readme()'s node.tools list is the
  // set of tools actually registered, not a hand-kept copy beside it.
  const registerTool = ((name: string, config: unknown, cb: unknown) => {
    recordToolName(name);
    return (server.registerTool as (...args: unknown[]) => unknown)(name, config, cb);
  }) as unknown as McpServer["registerTool"];

  registerTool(
    "readme",
    {
      description:
        "Call once at the very start of a session, before bootstrap. Returns universal authoring conventions " +
        "(prompt style, the calculator_policy/desmos_allowed distinction, document anchoring, duplicate-report " +
        "workflow, batching guidance) that don't repeat per-subject the way bootstrap's taxonomy does.",
    },
    async () => {
      try {
        return ok(readme(db));
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
        "results pointer, and — for math/science subjects — the graph_spec DSL reference.",
      inputSchema: { subject: z.string().nullable().optional() },
    },
    async ({ subject }) => {
      try {
        return ok(bootstrap(db, subject ?? null));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "list_tags",
    {
      description:
        "List tags in the controlled vocabulary. Paginated: pass limit/offset to page past the default 50; response includes total and has_more.",
      inputSchema: {
        prefix: z.string().optional(),
        include_retired: z.boolean().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      },
    },
    async ({ prefix, include_retired, limit, offset }) => {
      try {
        const opts = { prefix, includeRetired: include_retired, limit: limit ?? 50, offset: offset ?? 0 };
        const total = countTags(db, { prefix, includeRetired: include_retired });
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
      description: "Maintenance op: repoint every question and child tag from from_slug to to_slug, then retire from_slug.",
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
        "Search the question bank. Omits explanation/rubric to keep listings cheap. Paginated: pass limit/offset to page past the default 50; response includes has_more (and total).",
      inputSchema: {
        tag_query: tagQueryShape,
        text: z.string().optional(),
        type: z.enum(["mc", "written"]).optional(),
        difficulty_min: z.number().optional(),
        difficulty_max: z.number().optional(),
        calculator_policy: z.enum(["allowed", "forbidden", "n_a"]).optional(),
        include_retired: z.boolean().optional(),
        latest_version_only: z.boolean().optional(),
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
        "Read one question in full, including explanation, rubric, and graph_spec — search_questions omits these to stay cheap. Call this before editing a question you don't already have the full content of in this session.",
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
      description: "Batch-write questions into the bank. Rejections are per-question; valid siblings still commit. Flags possible duplicates without rejecting them. Also flags (non-blocking) an mc question with other than 4 choices, per readme()'s prompt_conventions.",
      inputSchema: { questions: z.array(questionInputShape) },
    },
    async ({ questions }) => {
      try {
        return ok(createQuestions(db, questions));
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
            .describe("A stable string identifying the specific teachable idea this item targets, finer-grained than a tag. You mint and own these — Osmosis stores them but doesn't interpret their structure."),
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
        return ok(getResults(db, params));
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
        "Create a live item for the learner to answer in the Osmosis app. Returns immediately with an attempt/response id — the item is NOT rendered in this conversation. Call await_item_outcome afterward to learn what happened once the learner answers in the app. Either pass question_id for a specific item you authored, or tag_query to let Osmosis pick an eligible one.",
      inputSchema: {
        question_id: z.string().optional(),
        tag_query: tagQueryShape,
        session_id: z.string().optional().describe(
          "The session id from create_session. Always call create_session first and pass its id here, so " +
            "the app's live screen for that session surfaces this item and everything groups under one entry."
        ),
      },
    },
    async ({ question_id, tag_query, session_id }) => {
      try {
        return ok(presentItem(db, { node_id: nodeId, question_id, tag_query, session_id }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "await_item_outcome",
    {
      description:
        "Wait for the learner to answer the item from present_item, up to timeout_s seconds (default 25, clamped to 1..25). Returns the outcome once answered, status: 'abandoned' if the item timed out unanswered (stop waiting — it will never resolve), status: 'paused' with paused_at if the learner stepped away (it resumes when they answer), or status: 'pending' if they haven't answered yet in that window — call this again to keep waiting, or come back to it later in the conversation. The answered record carries outcome (correct|partial|incorrect|dont_know|ungraded), score with the grader that produced it, selected_choice_id with its chosen_misconception, best_guess_choice_id with best_guess_correct (an idk's guess is recorded, never scored), response_text, confidence with confidence_numeric (1/3/5), idk, misapplied_method, diagnosis, elapsed_ms and answered_at.",
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
      inputSchema: { name: z.string(), tag_slug: z.string().optional() },
    },
    async ({ name, tag_slug }) => {
      try {
        return ok(createSession(db, { name, tag_slug }));
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
        "here, so the counts are final. Its history stays readable via get_session afterward.",
      inputSchema: { session_id: z.string() },
    },
    async ({ session_id }) => {
      try {
        return ok(endSession(db, session_id));
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
    "get_session",
    {
      description:
        "Read a past tutoring session — its name, tag, and attempt history — for calibration or review.",
      inputSchema: { session_id: z.string() },
    },
    async ({ session_id }) => {
      try {
        return ok(getSessionDetail(db, session_id));
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
        "present_item, quick_check, get_session, or get_results(scope: 'attempt').",
      inputSchema: { attempt_id: z.string() },
    },
    async ({ attempt_id }) => {
      try {
        return ok(getAttemptDetail(db, attempt_id));
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
        "Tell Osmosis how long a piece of content needs to be retained, and let Osmosis compute when to resurface it. You supply the target and reason; Osmosis owns scheduling — never call this expecting to control exact timing.",
      inputSchema: {
        identity_key: z.string().describe("A tag slug or node_key — whatever identity this retention target applies to."),
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

  registerTool(
    "list_themes",
    {
      description:
        "List the app's colour themes and which one is active. Custom themes live on the server and sync to every device. " +
        "Built-in themes (ids builtin:slate, builtin:forest, builtin:ember, builtin:plum) are not listed here but can be made active.",
    },
    async () => {
      try {
        return ok({ themes: listThemes(db), active_theme_id: getActiveThemeId(db), builtin_ids: ["builtin:slate", "builtin:forest", "builtin:ember", "builtin:plum"] });
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "save_theme",
    {
      description:
        "Create or replace a colour theme (same id = replace). tokens.light and tokens.dark each map any of " +
        THEME_TOKEN_KEYS.join(", ") +
        " to a hex colour; omitted keys keep the app default for that mode. custom_css is optional CSS applied in both " +
        "modes on top of the tokens — use it for things tokens don't cover (e.g. `:root:not([data-theme=\"light\"]), " +
        ":root[data-theme=\"light\"] { --heat-4: #3b6ea8; --good: #3f7d5a; --bad: #b0473f; }` for the heatmap ramp and " +
        "good/bad colours, or `.panel { ... }` for cards). Pass make_active: true to switch to it immediately.",
      inputSchema: {
        id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "lowercase letters, digits, _ or -").describe("Stable slug, e.g. 'midnight'."),
        name: z.string(),
        tokens: z.object({ light: themeTokenSetShape, dark: themeTokenSetShape }),
        custom_css: z.string().optional(),
        make_active: z.boolean().optional(),
      },
    },
    async ({ id, name, tokens, custom_css, make_active }) => {
      try {
        const saved = saveTheme(db, { id, name, tokens: { light: tokens.light ?? {}, dark: tokens.dark ?? {} }, custom_css });
        if (make_active) setActiveTheme(db, id);
        return ok({ ...saved, active: make_active === true || getActiveThemeId(db) === id });
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "delete_theme",
    {
      description: "Delete a custom theme on every device. If it was active, the app falls back to 'mode only'. Built-ins can't be deleted.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try {
        return ok(deleteTheme(db, id));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "set_active_theme",
    {
      description: "Make a theme active on every device: a custom theme id, a builtin:* id, or null for 'mode only'.",
      inputSchema: { id: z.string().nullable() },
    },
    async ({ id }) => {
      try {
        return ok(setActiveTheme(db, id));
      } catch (err) {
        return fail(err);
      }
    }
  );

  registerTool(
    "get_due_items",
    {
      description:
        "List identities whose retention schedule is due now (or before a given time), most-overdue first. Paginated. Each item carries reason: never_demonstrated (no probe recorded yet), decayed (last probe passed, interval elapsed), or lapsed (last probe failed).",
      inputSchema: {
        before: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      },
    },
    async ({ before, limit, offset }) => {
      try {
        return ok(getDueItems(db, { before, limit, offset }));
      } catch (err) {
        return fail(err);
      }
    }
  );
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "../domain/errors.js";
import { readme } from "../domain/readme.js";
import { bootstrap } from "../domain/bootstrap.js";
import { listTags, createTag, mergeTags, countTags } from "../domain/tags.js";
import { createQuestions, editQuestion, retireQuestion, searchQuestions, getQuestionDetail } from "../domain/questions.js";
import { getConfig, setConfig } from "../domain/config.js";
import { listTemplates, countTemplates, createTemplate, editTemplate, retireTemplate } from "../domain/templates.js";
import { getResults } from "../domain/results.js";
import { createAsset, getAsset, searchAssets, listAssets, countAssets } from "../domain/assets.js";

const tagQueryShape = z
  .object({
    all: z.array(z.string()).optional(),
    any: z.array(z.string()).optional(),
    none: z.array(z.string()).optional(),
  })
  .optional();

const choiceShape = z.object({
  body: z.string().describe("The choice's text."),
  is_correct: z.boolean().describe("True for exactly one choice, unless testing a multi-select concept."),
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
});

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

export function registerTools(server: McpServer, db: DatabaseSync, uploadsDir: string): void {
  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    "list_tags",
    {
      description: "List tags in the controlled vocabulary. Paginated: pass limit/offset to page past the default 50.",
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    "search_questions",
    {
      description: "Search the question bank. Omits explanation/rubric to keep listings cheap.",
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    "list_templates",
    {
      description:
        "List saved draw templates, with live eligible_count, attempt_count, and mean_score. Paginated: pass limit/offset to page past the default 50.",
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    "get_results",
    {
      description:
        "Read attempt results. scope 'question' is sorted worst-first and is the primary signal for what to write more of; written responses include response_text so you can see how an answer was wrong.",
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    "list_assets",
    {
      description: "List source-material assets (notes, PDFs, links). Paginated: pass limit/offset to page past the default 50.",
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

  server.registerTool(
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

  server.registerTool(
    "search_assets",
    {
      description: "Full-text search over source-material assets. Paginated: pass limit/offset to page past the default 50.",
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
}

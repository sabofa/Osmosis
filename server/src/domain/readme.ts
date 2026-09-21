import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_VERSION, TOOLS_VERSION, listToolNames } from "../protocol.js";
import { CONFIDENCE_NUMERIC } from "./attempts.js";

export type ToolScope = "full" | "presenter";

export interface ReadmeResult {
  // Which tool surface the caller reached this node through. "full" is the
  // authoring connector; "presenter" is the tutor server's reduced surface
  // (the live teaching loop only) — node.tools is the caller's own set.
  scope: ToolScope;
  node: {
    protocol_version: number;
    tools_version: number;
    tools: string[];
    // Whether this node pushes session events to the app (SSE on
    // GET /api/sessions/:id/events) instead of making it poll.
    push: boolean;
    bank_size: number;
    last_write_at: string | null;
  };
  workflow: string;
  prompt_conventions: {
    prompt_style: string;
    explanation_style: string;
    difficulty_scale: string;
    mc_choice_count: string;
    confidence_scale: { labels: string[]; numeric: Record<string, number> };
    written_length_target: string;
    misconception: string;
  };
  calculator_conventions: string;
  tag_conventions: string;
  document_conventions: string;
  duplicate_workflow: string;
  batching_guidance: string;
}

// Everything true regardless of subject — called once per session, before
// bootstrap(subject). bootstrap stays subject-scoped (tags, results_pointer,
// skill_level, graph_dsl_reference) and gets called again for each new
// subject touched in the session; this doesn't, so a session spanning
// biology and chemistry reads this exactly once instead of twice.
export function readme(
  db: DatabaseSync,
  opts: { scope?: ToolScope; tools?: string[] } = {}
): ReadmeResult {
  const bankSize = (
    db.prepare("SELECT COUNT(*) AS n FROM question WHERE retired_at IS NULL AND ephemeral = 0").get() as {
      n: number;
    }
  ).n;
  const lastWrite = db
    .prepare(
      `SELECT MAX(t) AS last_write_at FROM (
         SELECT MAX(created_at) AS t FROM question
         UNION ALL
         SELECT MAX(created_at) AS t FROM tag
       )`
    )
    .get() as { last_write_at: string | null };

  return {
    scope: opts.scope ?? "full",
    node: {
      protocol_version: PROTOCOL_VERSION,
      tools_version: TOOLS_VERSION,
      tools: opts.tools ? [...opts.tools].sort() : listToolNames(),
      push: true,
      bank_size: bankSize,
      last_write_at: lastWrite.last_write_at,
    },
    workflow:
      "Call this once at the start of a session. Then call bootstrap(subject) once per subject you touch " +
      "this session — e.g. once for 'math', once separately for 'biology' if both come up. bootstrap returns " +
      "that subject's tag taxonomy, weak/stale-tag pointers, and (math/science subjects only) the graph_spec " +
      "DSL reference. Don't re-call bootstrap for a subject already bootstrapped this session — its taxonomy " +
      "doesn't change mid-session.",
    prompt_conventions: {
      prompt_style: "Direct, single-question prompts. No multi-part questions inside one prompt.",
      explanation_style: "2-4 sentences, explain why the correct answer is correct.",
      difficulty_scale: "1 = intro/recall, 3 = standard practice, 5 = exam-level synthesis.",
      mc_choice_count: "4 choices, exactly one correct. Multi-select is not supported (the app is single-select): a second is_correct choice is rejected as mc_multiple_correct — split into separate questions or write it as a written item.",
      // The same map the outcome paths compute confidence_numeric from, so
      // the documented scale can't drift from the one Osmosis reports.
      confidence_scale: { labels: Object.keys(CONFIDENCE_NUMERIC), numeric: CONFIDENCE_NUMERIC },
      written_length_target: "1-3 sentences or a short derivation; not an essay.",
      misconception:
        "Optional on every mc choice. On a distractor it names which wrong model picking it represents — " +
        "write one when you know it, omit it when you don't. Null means unknown (nobody recorded one), not " +
        "'this distractor represents no misconception'. A question is never rejected for a missing one.",
    },
    calculator_conventions:
      "Two independent axes, don't conflate them. calculator_policy ('allowed'|'forbidden'|'n_a', default " +
      "'n_a') is a DRAW-TIME gate templates filter on — 'forbidden' means do it by hand, 'allowed' means tool " +
      "use doesn't change what's tested, 'n_a' (default) means the axis doesn't apply at all (history, " +
      "reading, most arithmetic) and renders nothing, not a struck-through symbol. desmos_allowed (boolean, " +
      "default false) is a separate PER-QUESTION signal for whether a graphing calculator specifically would " +
      "meaningfully help THIS question — set true only when plotting or exploring a function actually helps " +
      "(graphing/algebra/precalc/calc/stats), not just because one would be technically permitted under " +
      "calculator_policy. A question can be calculator_policy:'allowed' and desmos_allowed:false at the same " +
      "time — e.g. an allowed-calculator arithmetic question a graphing tool adds nothing to.",
    tag_conventions:
      "Tag slugs follow a strict grammar, enforced by create_tag — lowercase ascii segments separated by " +
      "\":\" (segment path mirrors the tag's ancestry — a child's slug is its parent's slug plus one more " +
      "\":segment\"), with \"_\" separating words within a segment and \".\" allowed inside a segment for " +
      "textbook section numbers (e.g. \"node:ebbing11e:2.4:atomic_weight\"). Both separators sit between " +
      "alphanumerics — never leading, trailing or doubled, so \"a..b\", \".a\" and \"a.\" are rejected. No " +
      "hyphens, no other punctuation, no uppercase. Example: \"math:functions:quadratic\". A root tag is a " +
      "single segment with no colon, e.g. \"math\". Three leading segments are reserved and give a tag its " +
      "kind, reported as `kind` on every list_tags row and filterable with list_tags(kind:): \"node:\" is one " +
      "teachable idea, finer-grained than a topic and the same string a question's node_keys carry " +
      "(\"node:ebbing11e:2.4:atomic_weight\"); \"tech:\" is a rendering or tooling requirement an item has " +
      "(\"tech:mhchem\", \"tech:calculator\"); \"topic:\" is a cross-subject theme that doesn't belong under " +
      "one subject tree. Everything else is kind \"subject\" — the subject tree itself, e.g. " +
      "\"chemistry:stoichiometry\".",
    document_conventions:
      "document_id anchors a question to an uploaded asset — use list_assets/search_assets/read_asset to find " +
      "or inspect one. document_anchor_start/end highlights an excerpt range in the asset's extracted_text " +
      "(both required together, checked against the asset's actual text length). document_marker_offset " +
      "places one inline clickable marker at a char offset — it must land on an actual token, not whitespace, " +
      "and requires document_id. url-type assets have no extracted_text, so anchors/markers against them are " +
      "rejected outright — anchor only to text/file assets.",
    duplicate_workflow:
      "create_questions's possible_duplicates is a report, not a rejection — the new question is still " +
      "created alongside the report. Review it and call retire_question on whichever side loses (usually the " +
      "older or worse-written one); don't just ignore the report.",
    batching_guidance:
      "Batch writes through create_questions — one call with many questions, not one call per question. " +
      "Prefer batches of roughly 25-30 questions; a much larger single batch risks a slow response over the " +
      "connector with no partial-progress visibility if it times out.",
  };
}

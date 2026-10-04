// The workspace graph's row shapes and its containment matrix (Learn spec/
// osmosis/workspace/02-data-layer.md §2 and §3). The matrix lives here, in
// code, because "may a course hold a track" is a rule about kinds, not a
// database constraint; domain/workspace/graph.ts enforces it on every
// placement.

export type NodeKind = "trajectory" | "track" | "course" | "folder" | "file";
// Who wrote a version: Ben, the tutor, or the planner.
export type Author = "ben" | "tutor" | "planner";

export const NODE_KINDS: readonly NodeKind[] = ["trajectory", "track", "course", "folder", "file"];
export const AUTHORS: readonly Author[] = ["ben", "tutor", "planner"];

// The kinds that can hold children. A file never does.
export const CONTAINER_KINDS: readonly NodeKind[] = ["trajectory", "track", "course", "folder"];

// What each kind may hold directly. The kinds run in one direction, so tracks
// don't nest (that is the trajectory's job) and a folder holds no course. A
// folder has no built-in meaning: it can be a unit, research, attachments,
// whatever Ben makes it, and nothing in the layer treats it as anything else.
export const MAY_HOLD: Record<NodeKind, readonly NodeKind[]> = {
  trajectory: ["track", "course", "folder", "file"],
  track: ["course", "folder", "file"],
  course: ["folder", "file"],
  folder: ["folder", "file"],
  file: [],
};

// The kind tag is an open vocabulary (names.ts, normalizeKindTag); these are
// only what the UI suggests.
export const SUGGESTED_KIND_TAGS = ["source", "resource", "homework", "test", "flowchart"] as const;

export interface NodeRow {
  id: string;
  kind: NodeKind;
  title: string;
  kind_tag: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archive_batch: string | null;
}

export interface PlacementRow {
  id: string;
  container_id: string;
  child_id: string;
  name: string;
  created_at: string;
  archived_at: string | null;
}

export interface ContentRow {
  node_id: string;
  version: number;
  format: string;
  body: string | null;
  asset_id: string | null;
  search_text: string | null;
  author: Author;
  saved_at: string;
}

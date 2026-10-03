// The workspace graph's row shapes and its containment matrix (Learn spec/
// osmosis/workspace/01-shell.md §2 and §4). The matrix lives here, in code,
// because "may a course hold a track" is a rule about kinds, not a database
// constraint; domain/workspace/graph.ts enforces it on every placement.

export type NodeKind = "track" | "course" | "folder" | "file";
export type KindTag = "source" | "resource" | "homework" | "test" | "flowchart";
// Who wrote a revision: Ben, the tutor, or the planner.
export type Author = "ben" | "tutor" | "planner";

export const NODE_KINDS: readonly NodeKind[] = ["track", "course", "folder", "file"];
export const KIND_TAGS: readonly KindTag[] = ["source", "resource", "homework", "test", "flowchart"];
export const AUTHORS: readonly Author[] = ["ben", "tutor", "planner"];

// The kinds that can hold children. A file never does.
export const CONTAINER_KINDS: readonly NodeKind[] = ["track", "course", "folder"];

// What each kind may hold directly. A course holds no course or track (it is
// a leaf of the curriculum tree); a folder may hold a course so a track can
// group courses under a folder.
export const MAY_HOLD: Record<NodeKind, readonly NodeKind[]> = {
  track: ["track", "course", "folder", "file"],
  course: ["folder", "file"],
  folder: ["course", "folder", "file"],
  file: [],
};

export interface NodeRow {
  id: string;
  kind: NodeKind;
  title: string;
  kind_tag: KindTag | null;
  created_at: string;
  updated_at: string;
  trashed_at: string | null;
}

export interface PlacementRow {
  id: string;
  container_id: string;
  child_id: string;
  name: string;
  created_at: string;
}

export interface FileRow {
  node_id: string;
  type: string;
  body: string | null;
  asset_id: string | null;
  revision: number;
  saved_at: string;
  saved_by: Author;
}

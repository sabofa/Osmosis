import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import type { EnvConfig } from "./env.js";
import { PROTOCOL_VERSION } from "./protocol.js";

export interface NodeRow {
  id: string;
  label: string;
  canonical: 0 | 1;
  remote_url: string | null;
  protocol_version: number;
  created_at: string;
}

export function bootstrapNode(db: DatabaseSync, env: EnvConfig): NodeRow {
  const existing = db.prepare("SELECT * FROM node LIMIT 1").get() as NodeRow | undefined;
  if (existing) return existing;

  const insertParams = {
    id: uuidv4(),
    label: env.label,
    canonical: (env.role === "canonical" ? 1 : 0) as 0 | 1,
    remote_url: env.remoteUrl,
    protocol_version: PROTOCOL_VERSION,
  };

  db.prepare(
    `INSERT INTO node (id, label, canonical, remote_url, protocol_version)
     VALUES (@id, @label, @canonical, @remote_url, @protocol_version)`
  ).run(insertParams);

  return db.prepare("SELECT * FROM node LIMIT 1").get() as unknown as NodeRow;
}

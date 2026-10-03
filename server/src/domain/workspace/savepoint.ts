import type { DatabaseSync } from "node:sqlite";

// SAVEPOINT / RELEASE / ROLLBACK TO rather than BEGIN: a caller may already be
// inside a transaction, and a nested BEGIN is an error. Every workspace write
// (graph, content, asset files) runs in one so it is all-or-nothing and nests.
export function inSavepoint<T>(db: DatabaseSync, name: string, fn: () => T): T {
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw err;
  }
}

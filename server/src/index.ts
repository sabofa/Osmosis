import { loadEnvConfig } from "./env.js";
import { openDb } from "./db/connection.js";
import { migrate } from "./db/migrate.js";
import { syncUploads } from "./domain/workspace/uploads.js";
import { bootstrapNode } from "./node.js";
import { buildApp } from "./http/app.js";
import { createSyncRuntime, startSyncBackground } from "./sync/client.js";

const env = loadEnvConfig();
const db = openDb(env.dbPath);

const { applied } = migrate(db);
if (applied.length > 0) {
  console.log(`Applied migrations: ${applied.join(", ")}`);
}

// Every upload gets a file in the workspace when it is created; this gives one
// to the uploads that were made before the workspace existed. It is a backfill,
// so a failure is logged and does not keep the server from starting.
try {
  syncUploads(db);
} catch (err) {
  console.error("Could not give existing uploads a workspace file:", err);
}

const node = bootstrapNode(db, env);
console.log(`Node ${node.id} (${node.label}), role=${env.role}`);

const runtime = createSyncRuntime();
const app = buildApp({ db, env, node, runtime });

app
  .listen({ port: env.port, host: "0.0.0.0" })
  .then(() => {
    startSyncBackground({ db, env, node, runtime }, runtime); // no-op on canonical
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

import { loadEnvConfig } from "./env.js";
import { openDb } from "./db/connection.js";
import { migrate } from "./db/migrate.js";
import { bootstrapNode } from "./node.js";
import { buildApp } from "./http/app.js";
import { createSyncRuntime, startSyncBackground } from "./sync/client.js";

const env = loadEnvConfig();
const db = openDb(env.dbPath);

const { applied } = migrate(db);
if (applied.length > 0) {
  console.log(`Applied migrations: ${applied.join(", ")}`);
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

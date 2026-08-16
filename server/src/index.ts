import { loadEnvConfig } from "./env.js";
import { openDb } from "./db/connection.js";
import { migrate } from "./db/migrate.js";
import { bootstrapNode } from "./node.js";
import { buildApp } from "./http/app.js";

const env = loadEnvConfig();
const db = openDb(env.dbPath);

const { applied } = migrate(db);
if (applied.length > 0) {
  console.log(`Applied migrations: ${applied.join(", ")}`);
}

const node = bootstrapNode(db, env);
console.log(`Node ${node.id} (${node.label}), role=${env.role}`);

const app = buildApp({ db, env, node });

app.listen({ port: env.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

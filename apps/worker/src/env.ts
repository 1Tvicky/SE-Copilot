import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

/**
 * MUST be the first import in index.ts (and have no local imports of its
 * own). ES modules evaluate the whole import graph before the importing
 * file's own statements run, so a loadEnv() call placed inline in index.ts
 * — even textually before other imports — would still run AFTER modules
 * like the Graph/Recall/AI clients, which read process.env at import time.
 * Only being the first *import* (not just the first statement) guarantees
 * this runs before anything else in the graph.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

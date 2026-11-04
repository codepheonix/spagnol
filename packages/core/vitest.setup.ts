import { config } from "dotenv";
import { resolve } from "node:path";
// Load repo-root .env (local dev DB) so the Postgres integration tests can run.
config({ path: resolve(__dirname, "../../.env") });
config({ path: resolve(__dirname, ".env") });

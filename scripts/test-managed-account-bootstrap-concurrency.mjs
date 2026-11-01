import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const databaseUrl = process.env.SUPABASE_TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("SUPABASE_TEST_DATABASE_URL must point to the disposable local Postgres database.");
}

function runPsql(args) {
  return new Promise((resolvePromise, reject) => {
    const process = spawn("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", ...args], { stdio: "inherit" });
    process.on("error", reject);
    process.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`psql exited with status ${code ?? "unknown"}`));
    });
  });
}

const verificationDirectory = resolve(repositoryRoot, "supabase/verification");
await runPsql(["-f", resolve(verificationDirectory, "managed-account-concurrency-setup.sql")]);

const ownerId = "35000000-0000-4000-8000-000000000003";
const authenticatedBootstrap = [
  `select set_config('request.jwt.claim.sub', '${ownerId}', false)`,
  "set role authenticated",
  "select public.ensure_managed_accounts()",
  "reset role",
].join("; ");

await Promise.all([
  runPsql(["-c", authenticatedBootstrap]),
  runPsql(["-c", authenticatedBootstrap]),
]);

await runPsql(["-f", resolve(verificationDirectory, "managed-account-concurrency-assert.sql")]);

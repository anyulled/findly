import { spawn } from "node:child_process";

const url = process.env.SUPABASE_TEST_DATABASE_URL;
if (!url) throw new Error("SUPABASE_TEST_DATABASE_URL must identify a disposable local Postgres database.");
const owner = "90000000-0000-4000-8000-000000000001";
const account = "90000000-0000-4000-8000-000000000002";
const event = "90000000-0000-4000-8000-000000000003";
const post = "90000000-0000-4000-8000-000000000004";
function psql(sql) {
  const child = spawn("psql", [url, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  child.stderr.on("data", (chunk) => { err += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
  });
  child.stdin.end(sql);
  return { child, done };
}
async function run(sql) {
  const result = await psql(sql).done;
  if (result.code !== 0) throw new Error(`SQL test failed: ${result.err}`);
  return result.out;
}
const auth = `select set_config('request.jwt.claim.sub','${owner}',false); set role authenticated;`;
async function race(first, second, expectedSecond, expectedStatus) {
  const winner = psql(`begin; ${auth} ${first};\n\\echo LOCKED\nselect pg_sleep(0.5); commit;`);
  await new Promise((resolve, reject) => {
    let output = "";
    winner.child.stdout.on("data", (chunk) => { output += chunk; if (output.includes("LOCKED")) resolve(); });
    winner.child.on("close", () => { if (!output.includes("LOCKED")) reject(new Error("First transaction did not lock the post")); });
    winner.child.on("error", reject);
  });
  const loser = await psql(`begin; ${auth} ${second}; commit;`).done;
  const completed = await winner.done;
  if (completed.code !== 0) throw new Error(`Winning transaction failed: ${completed.err}`);
  if (expectedSecond === "rejected" && (loser.code === 0 || !loser.err.includes("no longer awaiting review"))) throw new Error("Approval unexpectedly succeeded after discard");
  if (expectedSecond === "false" && (loser.code !== 0 || !loser.out.trim().endsWith("f"))) throw new Error("Discard unexpectedly succeeded after approval");
  const state = await run(`select status from public.posts where id='${post}';`);
  if (state.trim() !== expectedStatus) throw new Error(`Unexpected final status: ${state}`);
}
try {
  await run(`insert into auth.users (id,email) values ('${owner}','discard-race@example.invalid');
    insert into public.accounts (id,owner_id,name) values ('${account}','${owner}','Personal');
    insert into public.events (id,owner_id,title,starts_at,detected_language) values ('${event}','${owner}','Race','2099-01-01','en');
    insert into public.posts (id,owner_id,event_id,account_id,network,lead_days,due_at,language,content,status) values ('${post}','${owner}','${event}','${account}','LinkedIn',14,'2098-12-18','en','Draft','review');`);
  await race(`select public.discard_review_post('${post}')`, `select public.approve_post('${post}','Approved')`, "rejected", "discarded");
  await run(`update public.posts set status='review',content='Draft',approved_at=null where id='${post}';`);
  await race(`select public.approve_post('${post}','Approved')`, `select public.discard_review_post('${post}')`, "false", "approved");
  console.log("Discard and approval races passed in both orders.");
} finally {
  await run(`delete from auth.users where id='${owner}';`);
}

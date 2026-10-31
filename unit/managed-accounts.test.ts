import assert from "node:assert/strict";
import test from "node:test";
import { bufferCredentialForAccount } from "../src/lib/buffer-account-credentials";
import { MANAGED_ACCOUNTS, managedAccount } from "../src/lib/managed-accounts";

test("the three managed profiles recognize their old persisted account names", () => {
  assert.equal(MANAGED_ACCOUNTS.length, 3);
  assert.equal(managedAccount("Alex · personal")?.key, "personal");
  assert.equal(managedAccount("BarcelonaJS")?.key, "barcelona_jug");
  assert.equal(managedAccount("DevBcn")?.key, "software_crafters_barcelona");
  assert.equal(managedAccount(" unknown "), undefined);
});

test("Buffer credentials are selected by canonical profile name and trimmed", () => {
  assert.deepEqual(bufferCredentialForAccount("Barcelona JUG", { BUFFER_API_KEY_BARCELONA_JUG: " secret " }), {
    apiKey: "secret", environmentVariable: "BUFFER_API_KEY_BARCELONA_JUG",
  });
  assert.deepEqual(bufferCredentialForAccount("Personal", {}), {
    apiKey: null, environmentVariable: "BUFFER_API_KEY_PERSONAL",
  });
  assert.deepEqual(bufferCredentialForAccount("not managed", {}), { apiKey: null, environmentVariable: null });
});

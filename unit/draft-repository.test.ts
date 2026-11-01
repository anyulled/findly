import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSupabaseDraftRepository,
  type SupabaseClientLike,
  type SupabaseTableBuilder,
} from "../src/lib/draft-repository";

function mockTable<T>(tableDef: unknown): SupabaseTableBuilder<T> {
  return tableDef as SupabaseTableBuilder<T>;
}

describe("draft-repository", () => {
  it("getPublishingMode queries app_settings and maps mode", async () => {
    const supabase: SupabaseClientLike = {
      from<T>(table: string): SupabaseTableBuilder<T> {
        assert.equal(table, "app_settings");
        return mockTable<T>({
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      async maybeSingle() {
                        return { data: { value: { mode: "automatic" } }, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        });
      },
    };

    const repo = createSupabaseDraftRepository(supabase, "owner-1");
    const mode = await repo.getPublishingMode?.("owner-1");
    assert.equal(mode, "automatic");
  });

  it("listLinkedAccounts queries accounts and source links", async () => {
    const supabase: SupabaseClientLike = {
      from<T>(table: string): SupabaseTableBuilder<T> {
        if (table === "source_accounts") {
          return mockTable<T>({
            select() {
              return {
                eq() {
                  return {
                    eq() {
                      return { data: [{ account_id: "acc-1" }], error: null };
                    },
                  };
                },
              };
            },
          });
        }
        if (table === "accounts") {
          return mockTable<T>({
            select() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        order() {
                          return {
                            data: [
                              { id: "acc-1", name: "Personal", voice_prompt: "Direct", networks: ["LinkedIn", "X"], enabled: true },
                              { id: "acc-2", name: "JUG", voice_prompt: "Tech", networks: ["LinkedIn"], enabled: true },
                            ],
                            error: null,
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          });
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };

    const repo = createSupabaseDraftRepository(supabase, "owner-1");
    const linked = await repo.listLinkedAccounts("owner-1", "src-1");
    assert.equal(linked.length, 1);
    assert.equal(linked[0].id, "acc-1");
    assert.deepEqual(linked[0].networks, ["LinkedIn", "X"]);
  });

  it("listExistingReminders queries posts for event", async () => {
    const supabase: SupabaseClientLike = {
      from<T>(table: string): SupabaseTableBuilder<T> {
        assert.equal(table, "posts");
        return mockTable<T>({
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      data: [
                        { account_id: "acc-1", network: "LinkedIn", lead_days: 14 },
                        { account_id: "acc-1", network: "UnknownNet", lead_days: 7 },
                      ],
                      error: null,
                    };
                  },
                };
              },
            };
          },
        });
      },
    };

    const repo = createSupabaseDraftRepository(supabase, "owner-1");
    const reminders = await repo.listExistingReminders("owner-1", "evt-1");
    assert.equal(reminders.length, 1);
    assert.deepEqual(reminders[0], { accountId: "acc-1", network: "LinkedIn", leadDays: 14 });
  });

  it("listApprovedExamples filters by valid networks and languages", async () => {
    const supabase: SupabaseClientLike = {
      from<T>(table: string): SupabaseTableBuilder<T> {
        assert.equal(table, "style_examples");
        return mockTable<T>({
          select() {
            return {
              eq() {
                return {
                  in() {
                    return {
                      order() {
                        return {
                          limit() {
                            return {
                              data: [
                                { content: "Example 1", account_id: "acc-1", network: "X", language: "es" },
                                { content: "Example 2", account_id: "acc-1", network: "TikTok", language: "es" },
                                { content: "Example 3", account_id: "acc-1", network: "X", language: "de" },
                              ],
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        });
      },
    };

    const repo = createSupabaseDraftRepository(supabase, "owner-1");
    const examples = await repo.listApprovedExamples("owner-1", ["acc-1"]);
    assert.equal(examples.length, 1);
    assert.deepEqual(examples[0], { text: "Example 1", accountId: "acc-1", network: "X", language: "es" });

    const empty = await repo.listApprovedExamples("owner-1", []);
    assert.deepEqual(empty, []);
  });

  it("insertDrafts upserts into posts table", async () => {
    let upsertCalled = false;
    const supabase: SupabaseClientLike = {
      from<T>(table: string): SupabaseTableBuilder<T> {
        assert.equal(table, "posts");
        return mockTable<T>({
          upsert(rows: unknown) {
            upsertCalled = true;
            assert.equal(Array.isArray(rows), true);
            assert.equal((rows as unknown[]).length, 2);
            return {
              select() {
                return { data: [{ id: "p1" }, { id: "p2" }], error: null };
              },
            };
          },
        });
      },
    };

    const repo = createSupabaseDraftRepository(supabase, "owner-1");
    const count = await repo.insertDrafts([
      { owner_id: "owner-1", event_id: "evt-1", account_id: "acc-1", network: "X", lead_days: 14, due_at: "2026-11-02T13:00:00Z", timezone: "Europe/Madrid", content: "Post 1", status: "review", language: "es" },
      { owner_id: "owner-1", event_id: "evt-1", account_id: "acc-1", network: "X", lead_days: 7, due_at: "2026-11-09T13:00:00Z", timezone: "Europe/Madrid", content: "Post 2", status: "review", language: "es" },
    ]);
    assert.equal(upsertCalled, true);
    assert.equal(count, 2);
  });
});

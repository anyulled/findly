import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStyleExampleSegments,
  DEFAULT_STYLE_EXAMPLES_PER_SEGMENT,
  fetchApprovedStyleExamples,
  segmentStyleExamples,
  toApprovedStyleExample,
  type RawStyleExampleInput,
  type StyleExampleRow,
  type StyleExampleSegment,
  type SupabaseStyleExamplesClient,
} from "../src/lib/style-examples";

test("buildStyleExampleSegments constructs combinations of accounts, valid networks, and languages", () => {
  const accounts = [
    { id: "acc-1", networks: ["LinkedIn", "X", "InvalidNetwork"] },
    { id: "acc-2", networks: ["Bluesky"] },
    { id: "", networks: ["LinkedIn"] }, // missing id ignored
  ];

  const segments = buildStyleExampleSegments(accounts, ["en", "es"]);

  assert.deepEqual(segments, [
    { accountId: "acc-1", network: "LinkedIn", language: "en" },
    { accountId: "acc-1", network: "LinkedIn", language: "es" },
    { accountId: "acc-1", network: "X", language: "en" },
    { accountId: "acc-1", network: "X", language: "es" },
    { accountId: "acc-2", network: "Bluesky", language: "en" },
    { accountId: "acc-2", network: "Bluesky", language: "es" },
  ]);
});

test("buildStyleExampleSegments deduplicates identical segments and ignores unsupported languages", () => {
  const accounts = [
    { id: "acc-1", networks: ["LinkedIn", "LinkedIn"] },
  ];

  // @ts-expect-error testing invalid language filter
  const segments = buildStyleExampleSegments(accounts, ["es", "fr", "es"]);

  assert.deepEqual(segments, [
    { accountId: "acc-1", network: "LinkedIn", language: "es" },
  ]);
});

test("toApprovedStyleExample normalizes both DB column names and domain property names", () => {
  const fromDb: RawStyleExampleInput = {
    account_id: "acc-1",
    network: "LinkedIn",
    language: "es",
    content: "DB content",
    created_at: "2026-10-20T10:00:00Z",
  };
  const fromDomain: RawStyleExampleInput = {
    accountId: "acc-2",
    network: "X",
    language: "en",
    text: "Domain text",
  };

  assert.deepEqual(toApprovedStyleExample(fromDb), {
    accountId: "acc-1",
    network: "LinkedIn",
    language: "es",
    text: "DB content",
    createdAt: "2026-10-20T10:00:00Z",
  });

  assert.deepEqual(toApprovedStyleExample(fromDomain), {
    accountId: "acc-2",
    network: "X",
    language: "en",
    text: "Domain text",
  });

  // Invalid cases return null
  assert.equal(toApprovedStyleExample({ account_id: "acc-1", network: "unknown", language: "es", content: "text" }), null);
  assert.equal(toApprovedStyleExample({ account_id: "acc-1", network: "LinkedIn", language: "de", content: "text" }), null);
  assert.equal(toApprovedStyleExample({ network: "LinkedIn", language: "es", content: "text" }), null);
  // Testing missing content/text
  assert.equal(toApprovedStyleExample({ account_id: "acc-1", network: "LinkedIn", language: "es" }), null);
});

test("segmentStyleExamples preserves quota independence: a high-activity segment does not displace another account", () => {
  const examples: RawStyleExampleInput[] = [];

  // Account A has 100 recent approved examples in LinkedIn / es
  for (let i = 1; i <= 100; i++) {
    examples.push({
      accountId: "account-a",
      network: "LinkedIn",
      language: "es",
      text: `Account A recent post #${i}`,
      createdAt: new Date(Date.UTC(2026, 9, 25, 12, 0, i)).toISOString(),
    });
  }

  // Account B has only 2 older approved examples in LinkedIn / es
  examples.push({
    accountId: "account-b",
    network: "LinkedIn",
    language: "es",
    text: "Account B older post #1",
    createdAt: "2026-09-01T10:00:00Z",
  });
  examples.push({
    accountId: "account-b",
    network: "LinkedIn",
    language: "es",
    text: "Account B older post #2",
    createdAt: "2026-09-02T10:00:00Z",
  });

  // Segmenting applies the limit AFTER grouping into segments
  const selected = segmentStyleExamples(examples, DEFAULT_STYLE_EXAMPLES_PER_SEGMENT);

  const accountASelected = selected.filter((ex) => ex.accountId === "account-a");
  const accountBSelected = selected.filter((ex) => ex.accountId === "account-b");

  // Account A gets its top 3 most recent
  assert.equal(accountASelected.length, 3);
  assert.deepEqual(accountASelected.map((ex) => ex.text), [
    "Account A recent post #100",
    "Account A recent post #99",
    "Account A recent post #98",
  ]);

  // Account B is NOT displaced by Account A's 100 recent posts
  assert.equal(accountBSelected.length, 2);
  assert.deepEqual(accountBSelected.map((ex) => ex.text), [
    "Account B older post #2",
    "Account B older post #1",
  ]);
});

test("segmentStyleExamples preserves independence across networks and languages within the same account", () => {
  const examples: RawStyleExampleInput[] = [];

  // 10 posts for LinkedIn / es
  for (let i = 1; i <= 10; i++) {
    examples.push({
      accountId: "account-a",
      network: "LinkedIn",
      language: "es",
      text: `Account A LinkedIn es #${i}`,
      createdAt: `2026-10-20T10:${String(i).padStart(2, "0")}:00Z`,
    });
  }

  // 1 post for X / es
  examples.push({
    accountId: "account-a",
    network: "X",
    language: "es",
    text: "Account A X es #1",
    createdAt: "2026-10-01T10:00:00Z",
  });

  // 1 post for LinkedIn / en
  examples.push({
    accountId: "account-a",
    network: "LinkedIn",
    language: "en",
    text: "Account A LinkedIn en #1",
    createdAt: "2026-10-01T10:00:00Z",
  });

  const selected = segmentStyleExamples(examples, 3);

  const linkedInEs = selected.filter((e) => e.network === "LinkedIn" && e.language === "es");
  const xEs = selected.filter((e) => e.network === "X" && e.language === "es");
  const linkedInEn = selected.filter((e) => e.network === "LinkedIn" && e.language === "en");

  assert.equal(linkedInEs.length, 3);
  assert.equal(xEs.length, 1);
  assert.equal(xEs[0].text, "Account A X es #1");
  assert.equal(linkedInEn.length, 1);
  assert.equal(linkedInEn[0].text, "Account A LinkedIn en #1");
});

test("segmentStyleExamples handles edge cases: empty list, zero quota, invalid entries", () => {
  assert.deepEqual(segmentStyleExamples([], 3), []);
  assert.deepEqual(segmentStyleExamples([{ accountId: "a", network: "LinkedIn", language: "es", text: "hi" }], 0), []);
  assert.deepEqual(segmentStyleExamples([{ accountId: "a", network: "LinkedIn", language: "es", text: "hi" }], -1), []);

  const invalidEntries: RawStyleExampleInput[] = [
    { accountId: "a", network: "UnknownNet", language: "es", text: "hi" },
    { accountId: "a", network: "LinkedIn", language: "fr", text: "bonjour" },
    { network: "LinkedIn", language: "es", text: "missing account" },
  ];
  assert.deepEqual(segmentStyleExamples(invalidEntries, 3), []);
});

test("fetchApprovedStyleExamples queries database filtering by segment before applying limit", async () => {
  type QueryRecord = {
    filters: Record<string, string>;
    orderBy: { column: string; ascending: boolean };
    limitCount: number;
  };
  const executedQueries: QueryRecord[] = [];

  const mockDbData: StyleExampleRow[] = [
    { account_id: "acc-1", network: "LinkedIn", language: "es", content: "Post 1", created_at: "2026-10-28T10:00:00Z" },
    { account_id: "acc-1", network: "LinkedIn", language: "es", content: "Post 2", created_at: "2026-10-27T10:00:00Z" },
    { account_id: "acc-2", network: "LinkedIn", language: "es", content: "Acc 2 Post 1", created_at: "2026-09-01T10:00:00Z" },
  ];

  const fakeSupabase: SupabaseStyleExamplesClient = {
    from(table: string) {
      assert.equal(table, "style_examples");
      const filters: Record<string, string> = {};
      let orderBy = { column: "", ascending: false };

      const builder = {
        select(columns: string) {
          assert.equal(columns, "content,account_id,network,language");
          return builder;
        },
        eq(col: string, val: string) {
          filters[col] = val;
          return builder;
        },
        order(col: string, options: { ascending: boolean }) {
          orderBy = { column: col, ascending: options.ascending };
          return builder;
        },
        async limit(count: number) {
          executedQueries.push({ filters: { ...filters }, orderBy, limitCount: count });
          const matches = mockDbData.filter((row) =>
            (!filters.account_id || row.account_id === filters.account_id) &&
            (!filters.network || row.network === filters.network) &&
            (!filters.language || row.language === filters.language),
          ).slice(0, count);
          return { data: matches, error: null };
        },
      };
      return builder;
    },
  };

  const segments: StyleExampleSegment[] = [
    { accountId: "acc-1", network: "LinkedIn", language: "es" },
    { accountId: "acc-2", network: "LinkedIn", language: "es" },
  ];

  const result = await fetchApprovedStyleExamples(fakeSupabase, {
    ownerId: "owner-123",
    accountIds: ["acc-1", "acc-2"],
    segments,
    languages: ["es"],
  });

  // Verify that two segment-specific queries were executed
  assert.equal(executedQueries.length, 2);

  // Each query filtered by owner_id, account_id, network, and language before limit
  for (const query of executedQueries) {
    assert.equal(query.filters.owner_id, "owner-123");
    assert.ok(query.filters.account_id === "acc-1" || query.filters.account_id === "acc-2");
    assert.equal(query.filters.network, "LinkedIn");
    assert.equal(query.filters.language, "es");
    assert.deepEqual(query.orderBy, { column: "created_at", ascending: false });
    assert.equal(query.limitCount, DEFAULT_STYLE_EXAMPLES_PER_SEGMENT);
  }

  // Result contains examples for both accounts without displacement
  assert.equal(result.length, 3);
  assert.equal(result.filter((r) => r.accountId === "acc-1").length, 2);
  assert.equal(result.filter((r) => r.accountId === "acc-2").length, 1);
});

test("fetchApprovedStyleExamples propagates custom error message when a query fails", async () => {
  const failingSupabase: SupabaseStyleExamplesClient = {
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order() { return builder; },
        async limit() {
          return { data: null, error: { message: "database offline" } };
        },
      };
      return builder;
    },
  };

  await assert.rejects(
    async () => {
      await fetchApprovedStyleExamples(failingSupabase, {
        ownerId: "owner-1",
        accountIds: ["acc-1"],
        segments: [{ accountId: "acc-1", network: "LinkedIn", language: "es" }],
        errorMessage: "No se pudieron cargar los ejemplos de estilo aprobados.",
      });
    },
    { message: "No se pudieron cargar los ejemplos de estilo aprobados." },
  );
});

test("fetchApprovedStyleExamples returns empty array immediately when accountIds or segments are empty", async () => {
  let called = false;
  const unusedSupabase: SupabaseStyleExamplesClient = {
    from() {
      called = true;
      throw new Error("Should not be called");
    },
  };

  const res1 = await fetchApprovedStyleExamples(unusedSupabase, {
    ownerId: "owner-1",
    accountIds: [],
  });
  assert.deepEqual(res1, []);
  assert.equal(called, false);

  const res2 = await fetchApprovedStyleExamples(unusedSupabase, {
    ownerId: "owner-1",
    segments: [],
  });
  assert.deepEqual(res2, []);
  assert.equal(called, false);
});

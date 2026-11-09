import type { LumaDraftRepository, LumaDraftRow, LLMLogRow } from "./luma-drafts";
import type { GenerationAccount, ExistingReminder } from "./groq-workflow";
import type { ApprovedStyleExample } from "./groq";
import { NETWORKS, type SocialNetwork } from "./social-validation";
import { selectEventAccounts } from "./event-targets";
import { managedAccount } from "./managed-accounts";
import { dispatchApprovedPostsWithSupabase, type DispatchBudget } from "./approved-dispatch";
import { logger } from "./logger";
import { fetchApprovedStyleExamples, type StyleExampleQueryContext } from "./style-examples";

export interface SupabaseDraftRepositoryOptions {
  deliveryBudget?: DispatchBudget;
}

export type SupabaseQueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

export type SupabaseFilterBuilder<T = unknown> = {
  select(columns?: string): SupabaseFilterBuilder<T>;
  eq(column: string, value: unknown): SupabaseFilterBuilder<T>;
  in(column: string, values: unknown[]): SupabaseFilterBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): SupabaseFilterBuilder<T>;
  limit(count: number): SupabaseFilterBuilder<T>;
  single(): PromiseLike<SupabaseQueryResult<T>>;
  maybeSingle(): PromiseLike<SupabaseQueryResult<T>>;
  then<TResult1 = SupabaseQueryResult<T>, TResult2 = never>(
    onfulfilled?: ((value: SupabaseQueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
};

export type SupabaseTableBuilder<T = unknown> = {
  select(columns?: string): SupabaseFilterBuilder<T>;
  insert(rows: unknown): SupabaseFilterBuilder<T>;
  upsert(rows: unknown, options?: unknown): SupabaseFilterBuilder<T>;
  update(values: unknown): SupabaseFilterBuilder<T>;
  delete(): SupabaseFilterBuilder<T>;
};

export type SupabaseClientLike = {
  from<T = unknown>(table: string): SupabaseTableBuilder<T>;
  rpc?(fn: string, args?: Record<string, unknown>): unknown;
};

export function createSupabaseDraftRepository(
  supabase: unknown,
  ownerId: string,
  options: SupabaseDraftRepositoryOptions = {},
): LumaDraftRepository {
  const client = supabase as SupabaseClientLike;
  return {
    async getPublishingMode(): Promise<"review" | "automatic"> {
      const { data, error } = await client
        .from<{ value: { mode?: string } }>("app_settings")
        .select("value")
        .eq("owner_id", ownerId)
        .eq("key", "publishing_mode")
        .maybeSingle();
      if (error) throw new Error("Unable to read publishing mode");
      return (data?.value as { mode?: string } | null)?.mode === "automatic" ? "automatic" : "review";
    },

    async listLinkedAccounts(_ownerId: string, sourceId?: string | null, selectedAccountIds?: string[] | null): Promise<GenerationAccount[]> {
      let sourceLinks: { sourceId: string; accountId: string; networks?: string[] | null }[] = [];
      if (sourceId && selectedAccountIds == null) {
        const { data: links, error: linkError } = await client
          .from<{ account_id: string; networks?: string[] | null }[]>("source_accounts")
          .select("account_id,networks")
          .eq("owner_id", ownerId)
          .eq("source_id", sourceId);
        if (linkError) throw new Error("Unable to read source account links");
        sourceLinks = (links ?? []).map((link) => ({ sourceId, accountId: link.account_id, networks: link.networks }));
      }

      const { data, error } = await client
        .from<{ id: string; name: string; voice_prompt: string; networks: string[] }[]>("accounts")
        .select("id,name,voice_prompt,networks")
        .eq("owner_id", ownerId)
        .eq("enabled", true)
        .order("created_at");
      if (error) throw new Error("Unable to read linked accounts");

      return selectEventAccounts(data ?? [], sourceId, sourceLinks, selectedAccountIds).map((account) => ({
        id: account.id,
        name: account.name,
        voice: account.voice_prompt,
        networks: account.networks.filter((n): n is SocialNetwork => NETWORKS.includes(n as SocialNetwork)),
        kind: managedAccount(account.name)?.kind ?? "Asociación",
      }));
    },

    async listExistingReminders(_ownerId: string, eventId: string): Promise<ExistingReminder[]> {
      const { data, error } = await client
        .from<{ account_id: string; network: string; lead_days: number }[]>("posts")
        .select("account_id,network,lead_days")
        .eq("owner_id", ownerId)
        .eq("event_id", eventId);
      if (error) throw new Error("Unable to read existing reminders");
      return (data ?? []).flatMap((post) =>
        NETWORKS.includes(post.network as SocialNetwork)
          ? [{ accountId: post.account_id, network: post.network as SocialNetwork, leadDays: post.lead_days }]
          : [],
      );
    },

    async listApprovedExamples(
      _ownerId: string,
      accountIds: string[],
      context?: StyleExampleQueryContext,
    ): Promise<ApprovedStyleExample[]> {
      if (accountIds.length === 0) return [];
      return fetchApprovedStyleExamples(client, {
        ownerId,
        accountIds,
        segments: context?.segments,
        languages: context?.language ? [context.language] : undefined,
      });
    },

    async insertDrafts(rows: LumaDraftRow[]): Promise<number> {
      const { data, error } = await client
        .from<{ id: string }[]>("posts")
        .upsert(rows, { onConflict: "event_id,account_id,network,lead_days", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error("Unable to persist generated drafts");
      return data?.length ?? 0;
    },

    async insertLLMLogs(rows: LLMLogRow[]): Promise<void> {
      if (rows.length === 0) return;
      try {
        await client.from("llm_generation_logs").insert(rows);
      } catch (err) {
        logger.warn("Unable to persist LLM generation logs", {}, err);
      }
    },

    async scheduleAutomaticPosts(_ownerId: string, eventId: string, accountIds: string[]): Promise<void> {
      if (accountIds.length === 0) return;
      await dispatchApprovedPostsWithSupabase(
        supabase as Parameters<typeof dispatchApprovedPostsWithSupabase>[0],
        ownerId,
        eventId,
        undefined,
        options.deliveryBudget ? { budget: options.deliveryBudget } : undefined,
      );
    },
  };
}

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { fetchLumaFeed, syncLumaSources, type DraftGenerator, type SyncRepository } from "@/lib/luma-sync";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { generateSocialPost } from "@/lib/groq";
import { generateLumaEventDrafts, type LumaDraftRepository } from "@/lib/luma-drafts";
import type { PostLanguage } from "@/lib/language";
import type { SocialNetwork } from "@/lib/social-validation";
import { schedulePostWithSupabase } from "@/lib/post-publishing";

const NETWORKS: SocialNetwork[] = ["LinkedIn", "X", "Bluesky"];

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "sync_not_configured" }, { status: 503 });
  if (!isAuthorizedCronRequest(request, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!url || !key || !ownerEmail) return Response.json({ error: "sync_not_configured" }, { status: 503 });

  const supabase = createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: userData, error: userError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (userError) return Response.json({ error: "sync_unavailable" }, { status: 503 });
  const owner = userData.users.find((user) => user.email?.toLowerCase() === ownerEmail);
  if (!owner) return Response.json({ error: "sync_not_configured" }, { status: 503 });

  const draftRepository: LumaDraftRepository = {
    async getPublishingMode(ownerId) {
      const { data, error } = await supabase.from("app_settings").select("value")
        .eq("owner_id", ownerId).eq("key", "publishing_mode").maybeSingle();
      if (error) throw new Error("Unable to read publishing mode");
      return (data?.value as { mode?: string } | null)?.mode === "automatic" ? "automatic" : "review";
    },
    async listLinkedAccounts(ownerId, sourceId) {
      const { data: links, error: linkError } = await supabase.from("source_accounts")
        .select("account_id").eq("owner_id", ownerId).eq("source_id", sourceId);
      if (linkError) throw new Error("Unable to read source account links");
      const accountIds = [...new Set((links ?? []).map((link) => link.account_id))];
      if (accountIds.length === 0) return [];
      const { data, error } = await supabase.from("accounts")
        .select("id,name,voice_prompt,networks").eq("owner_id", ownerId).eq("enabled", true)
        .in("id", accountIds).order("created_at");
      if (error) throw new Error("Unable to read linked accounts");
      return (data ?? []).map((account) => ({
        id: account.id,
        name: account.name,
        voice: account.voice_prompt,
        networks: account.networks.filter((network: string): network is SocialNetwork => NETWORKS.includes(network as SocialNetwork)),
      }));
    },
    async listExistingReminders(ownerId, eventId) {
      const { data, error } = await supabase.from("posts").select("account_id,network,lead_days")
        .eq("owner_id", ownerId).eq("event_id", eventId);
      if (error) throw new Error("Unable to read existing reminders");
      return (data ?? []).flatMap((post) => NETWORKS.includes(post.network as SocialNetwork)
        ? [{ accountId: post.account_id, network: post.network as SocialNetwork, leadDays: post.lead_days }]
        : []);
    },
    async listApprovedExamples(ownerId, accountIds) {
      const { data, error } = await supabase.from("style_examples")
        .select("content,account_id,network,language").eq("owner_id", ownerId)
        .in("account_id", accountIds).order("created_at", { ascending: false }).limit(72);
      if (error) throw new Error("Unable to read approved style examples");
      return (data ?? []).flatMap((example) => {
        if (!NETWORKS.includes(example.network as SocialNetwork) || !["en", "es", "ca"].includes(example.language)) return [];
        return [{
          text: example.content,
          accountId: example.account_id,
          network: example.network as SocialNetwork,
          language: example.language as PostLanguage,
        }];
      });
    },
    async insertDrafts(rows) {
      const { data, error } = await supabase.from("posts").upsert(rows, {
        onConflict: "event_id,account_id,network,lead_days", ignoreDuplicates: true,
      }).select("id");
      if (error) throw new Error("Unable to persist generated drafts");
      return data?.length ?? 0;
    },
    async scheduleAutomaticPosts(ownerId, eventId) {
      const { data, error } = await supabase.from("posts").select("id")
        .eq("owner_id", ownerId).eq("event_id", eventId).eq("status", "approved");
      if (error) throw new Error("Unable to read generated posts ready for Buffer");
      for (const row of data ?? []) {
        await schedulePostWithSupabase(row.id, supabase, ownerId, process.env.BUFFER_API_KEY ?? "");
      }
    },
  };

  const repository: SyncRepository = {
    async listEnabledLumaSources() {
      const { data, error } = await supabase.from("sources").select("id,owner_id,name,feed_url")
        .eq("owner_id", owner.id).eq("source_type", "luma_ical").eq("enabled", true);
      if (error) throw new Error("Unable to read configured sources");
      return (data ?? []).filter((source) => typeof source.feed_url === "string" && source.feed_url.length > 0)
        .map((source) => ({ id: source.id, ownerId: source.owner_id, name: source.name, feedUrl: source.feed_url! }));
    },
    async upsertEvents(events) {
      const eventColumns = "id,owner_id,source_id,external_id,title,starts_at,location,description,event_url,detected_language";
      const { data: inserted, error: insertError } = await supabase.from("events").upsert(events, {
        onConflict: "owner_id,source_id,external_id", ignoreDuplicates: true,
      }).select(eventColumns);
      if (insertError) throw new Error("Unable to save imported events");
      const { data: available, error: selectError } = await supabase.from("events").select(eventColumns)
        .eq("owner_id", events[0].owner_id).eq("source_id", events[0].source_id)
        .in("external_id", events.map((event) => event.external_id));
      if (selectError) throw new Error("Unable to load persisted source events");
      return { inserted: inserted ?? [], available: available ?? [] };
    },
  };

  try {
    const groqConfigured = Boolean(process.env.GROQ_API_KEY?.trim() && process.env.GROQ_MODEL?.trim());
    const generateDrafts: DraftGenerator | undefined = groqConfigured
      ? (_source, event) => generateLumaEventDrafts(event, draftRepository, generateSocialPost)
      : undefined;
    const result = await syncLumaSources(repository, fetchLumaFeed, generateDrafts);
    return Response.json(result, { status: 200 });
  } catch {
    return Response.json({ error: "sync_unavailable" }, { status: 503 });
  }
}

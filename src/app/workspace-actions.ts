"use server";

import { createClient } from "@/lib/supabase/server";
import { formatMadridDateTime, madridDateTimeToIso } from "@/lib/madrid-time";
import { validatePost, NETWORKS, type SocialNetwork } from "@/lib/social-validation";
import { detectTitleLanguage, type PostLanguage } from "@/lib/language";
import { generateSocialPostOrFallback } from "@/lib/groq";
import { generateLumaEventDrafts } from "@/lib/luma-drafts";
import { createSupabaseDraftRepository } from "@/lib/draft-repository";
import { approveAndSchedulePost, schedulePostWithSupabase, type PostPublishingOutcome } from "@/lib/post-publishing";
import { MANAGED_ACCOUNTS, managedAccount } from "@/lib/managed-accounts";
import { bufferCredentialForAccount } from "@/lib/buffer-account-credentials";
import { sourceForEventUrl } from "@/lib/event-source";
import { extractUserProfile, type UserProfile } from "@/lib/user-profile";
import { validateSource, type SourceInput, type SourceType } from "@/lib/source-validation";
import { invalidateBufferSyncCache, syncBufferScheduledPosts } from "@/lib/buffer-sync";
import { isOwnerEmailAuthorized } from "@/lib/sync-request-auth";
import { isSubstackUrl, packLocationAndImage, unpackLocationAndImage } from "@/lib/substack";
import { fetchOpenGraphImage } from "@/lib/opengraph";
import { runAction, runVoidAction, UserFacingError, type ActionResult, type ActionVoidResult } from "@/lib/action-result";
import { logger } from "@/lib/logger";
import { fetchLumaFeed, extractSourceEvents, filterUpcomingEvents, type PersistableEvent } from "@/lib/luma-sync";
import { parseSubstackFeed, sortSubstackPostsReverseChronological } from "@/lib/substack";
import { dispatchApprovedPostsWithSupabase } from "@/lib/approved-dispatch";
import { toAttemptLogRow, type LumaDraftRepository, type ImportedLumaEvent, type LLMLogRow } from "@/lib/luma-drafts";
import { buildRegeneratedPostUpdate, regeneratePostContent } from "@/lib/post-regeneration";
import type { LLMAttemptHandler } from "@/lib/llm-provider";

export type { UserProfile } from "@/lib/user-profile";
export type { SourceInput, SourceType } from "@/lib/source-validation";

export type AccountView = {
  id?: string;
  enabled?: boolean;
  name: string;
  kind: string;
  initials: string;
  color: string;
  logo: string;
  bufferApiKeyEnv: string;
  bufferApiKeyConfigured: boolean;
  prompt: string;
  networks: SocialNetwork[];
  bufferChannels: Partial<Record<SocialNetwork, string>>;
  styleExampleCount: number;
};

export type EventView = {
  id: string;
  title: string;
  date: string;
  time: string;
  place: string;
  description: string;
  source: string;
  sourceId?: string | null;
  accountIds?: string[] | null;
  url?: string;
  imageUrl?: string;
  language?: PostLanguage;
};

export type PostView = {
  id: string;
  eventId: string;
  date: string;
  time: string;
  account: string;
  accountId?: string;
  network: SocialNetwork;
  text: string;
  status: "review" | "approved" | "scheduling" | "scheduled" | "published" | "failed" | "needs_reconciliation" | "discarded";
  lastError?: string | null;
  bufferPostId?: string | null;
  generationOrigin?: "groq" | "openai" | "fallback" | null;
  generationErrorCode?: string | null;
  leadDays?: 14 | 7 | 1;
  language?: PostLanguage;
};

export type LLMLogView = {
  id: string;
  provider: "groq" | "openai" | "fallback";
  model: string;
  status: "success" | "error";
  errorCode?: string | null;
  latencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  createdAt: string;
};

export type WorkspaceStats = {
  postsSummary: {
    total: number;
    groq: number;
    openai: number;
    fallback: number;
  };
  callsSummary: {
    total: number;
    groq: { total: number; success: number; error: number; avgLatencyMs: number; totalTokens: number };
    openai: { total: number; success: number; error: number; avgLatencyMs: number; totalTokens: number };
    fallback: { total: number };
  };
  recentLogs: LLMLogView[];
};

export type SourceView = {
  id: string;
  name: string;
  type: SourceType;
  url: string;
  enabled: boolean;
  accountIds: string[];
  accountNetworks?: Record<string, SocialNetwork[]>;
  /** Imported events still linked to this source; a non-zero count blocks physical deletion. */
  eventCount?: number;
};

export type WorkspaceSnapshot = {
  accounts: AccountView[];
  events: EventView[];
  posts: PostView[];
  sources: SourceView[];
  mode: "review" | "automatic";
  profile: UserProfile;
  error?: string;
};

const DEFAULT_ACCOUNTS = [
  { name: "Personal", account_type: "personal", voice_prompt: "Cercano, curioso y directo. Primera persona. Evita sonar promocional.", networks: ["LinkedIn", "X", "Bluesky"] },
  { name: "Barcelona JUG", account_type: "association", voice_prompt: "Comunidad tecnológica abierta. Entusiasta, inclusiva y concreta.", networks: ["LinkedIn", "X"] },
  { name: "Software Crafters Barcelona", account_type: "association", voice_prompt: "Tono profesional y acogedor. Destaca la comunidad y el aprendizaje.", networks: ["LinkedIn", "Bluesky"] },
] as const;

async function authorizedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user || !isOwnerEmailAuthorized(user.email, process.env.OWNER_EMAIL)) {
    throw new UserFacingError("No tienes acceso a este espacio.");
  }
  return { supabase, ownerId: user.id, user };
}

function accountView(row: { id: string; name: string; account_type: string; voice_prompt: string; networks: string[]; enabled: boolean }, index: number, bufferChannels: Partial<Record<SocialNetwork, string>> = {}, styleExampleCount = 0): AccountView {
  const managed = managedAccount(row.name) ?? MANAGED_ACCOUNTS[index % MANAGED_ACCOUNTS.length];
  if (!managedAccount(row.name)) throw new Error(`La cuenta «${row.name}» no pertenece a las tres cuentas configuradas.`);
  const credential = bufferCredentialForAccount(managed.name);
  const networks = row.networks.filter((network): network is SocialNetwork => NETWORKS.includes(network as SocialNetwork));
  return {
    id: row.id,
    enabled: row.enabled,
    name: managed.name,
    kind: managed.kind,
    initials: managed.initials,
    color: managed.color,
    logo: managed.logo,
    bufferApiKeyEnv: managed.apiKeyEnv,
    bufferApiKeyConfigured: Boolean(credential.apiKey),
    prompt: row.voice_prompt,
    networks,
    bufferChannels,
    styleExampleCount,
  };
}

function mapPostRowToView(
  row: {
    id: string;
    event_id: string;
    account_id: string;
    network: string;
    lead_days: number;
    due_at: string;
    content: string;
    status: string;
    language: string;
    last_error?: string | null;
    buffer_post_id?: string | null;
    generation_origin?: "groq" | "openai" | "fallback" | null;
    generation_error_code?: string | null;
  },
  accountNames: Map<string, string>,
): PostView | null {
  const network = NETWORKS.find((value) => value === row.network);
  if (!network) return null;
  const scheduled = formatMadridDateTime(row.due_at);
  return {
    id: row.id,
    eventId: row.event_id,
    date: scheduled.date,
    time: scheduled.time,
    account: accountNames.get(row.account_id) ?? "Cuenta",
    accountId: row.account_id,
    network,
    text: row.content,
    status: row.status as PostView["status"],
    lastError: row.last_error,
    bufferPostId: row.buffer_post_id,
    generationOrigin: row.generation_origin,
    generationErrorCode: row.generation_error_code,
    leadDays: row.lead_days as PostView["leadDays"],
    language: row.language as PostLanguage,
  };
}

function sourceForUrl(value: string | null): string {
  return sourceForEventUrl(value);
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  try {
    const { supabase, ownerId, user } = await authorizedClient();
    const bootstrapResult = await supabase.rpc("ensure_managed_accounts");
    if (bootstrapResult.error && bootstrapResult.error.code !== "PGRST202") {
      throw new Error("No se pudieron preparar las cuentas iniciales.");
    }
    let accountResult = await supabase.from("accounts").select("id,name,account_type,voice_prompt,networks,enabled").order("created_at");
    if (accountResult.error) throw new Error("No se pudieron cargar las cuentas.");
    const existingNames = new Set((accountResult.data ?? []).map((row) => row.name));
    const missingAccounts = DEFAULT_ACCOUNTS.filter((acc) => !existingNames.has(acc.name));
    if (missingAccounts.length > 0) {
      const insertResult = await supabase.from("accounts").insert(
        missingAccounts.map((account) => ({
          owner_id: ownerId,
          name: account.name,
          account_type: account.account_type,
          voice_prompt: account.voice_prompt,
          networks: [...account.networks],
        })),
      );
      if (insertResult.error) throw new Error("No se pudieron preparar las cuentas iniciales.");
      accountResult = await supabase.from("accounts").select("id,name,account_type,voice_prompt,networks,enabled").order("created_at");
      if (accountResult.error) throw new Error("No se pudieron cargar las cuentas.");
    }
    const defaultOrder = new Map(DEFAULT_ACCOUNTS.map((acc, index) => [acc.name, index]));
    const seenNames = new Set<string>();
    const rows = [...(accountResult.data ?? [])]
      .filter((row) => {
        if (seenNames.has(row.name)) return false;
        seenNames.add(row.name);
        return true;
      })
      .sort((a, b) => {
        const orderA = defaultOrder.get(a.name) ?? 999;
        const orderB = defaultOrder.get(b.name) ?? 999;
        return orderA - orderB;
      });
    const accounts = rows.map((row, index) => accountView(row, index));
    const accountNames = new Map<string, string>();
    for (const account of accounts) if (account.id) accountNames.set(account.id, account.name);

    const [eventsResult, postsResult, settingsResult, sourcesResult, sourceAccountsResult, channelResult, examplesResult] = await Promise.all([
      supabase.from("events").select("id,title,starts_at,location,description,event_url,detected_language,source_id,target_account_ids").order("starts_at", { ascending: false }),
      supabase.from("posts").select("id,event_id,account_id,network,lead_days,due_at,content,status,language,last_error,buffer_post_id,generation_origin,generation_error_code").order("due_at"),
      supabase.from("app_settings").select("value").eq("key", "publishing_mode").maybeSingle(),
      supabase.from("sources").select("id,name,source_type,feed_url,enabled").is("archived_at", null).order("created_at"),
      supabase.from("source_accounts").select("source_id,account_id,networks"),
      supabase.from("account_buffer_channels").select("account_id,network,buffer_channel_id"),
      supabase.from("style_examples").select("account_id"),
    ]);
    if (eventsResult.error || postsResult.error || settingsResult.error || sourcesResult.error || sourceAccountsResult.error || channelResult.error || examplesResult.error) {
      throw new Error("No se pudo cargar el calendario desde Supabase. Comprueba que has aplicado las migraciones.");
    }

    const events: EventView[] = (eventsResult.data ?? []).map((row) => {
      const scheduled = formatMadridDateTime(row.starts_at);
      const unpacked = unpackLocationAndImage(row.location);
      return {
        id: row.id,
        title: row.title,
        date: scheduled.date,
        time: scheduled.time,
        place: unpacked.place,
        description: row.description,
        source: sourceForUrl(row.event_url),
        sourceId: row.source_id,
        accountIds: row.target_account_ids,
        url: row.event_url ?? undefined,
        imageUrl: unpacked.imageUrl,
        language: row.detected_language as PostLanguage,
      };
    });
    const channelIdsByAccount = new Map<string, Partial<Record<SocialNetwork, string>>>();
    for (const channel of channelResult.data ?? []) {
      if (!NETWORKS.includes(channel.network as SocialNetwork)) continue;
      const channels = channelIdsByAccount.get(channel.account_id) ?? {};
      channels[channel.network as SocialNetwork] = channel.buffer_channel_id;
      channelIdsByAccount.set(channel.account_id, channels);
    }
    const exampleCounts = new Map<string, number>();
    for (const example of examplesResult.data ?? []) exampleCounts.set(example.account_id, (exampleCounts.get(example.account_id) ?? 0) + 1);
    const accountsWithChannels = rows.map((row, index) => accountView(row, index, channelIdsByAccount.get(row.id), exampleCounts.get(row.id) ?? 0));
    const posts: PostView[] = (postsResult.data ?? []).flatMap((row) => {
      const view = mapPostRowToView(row, accountNames);
      return view ? [view] : [];
    });
    const settings = settingsResult.data?.value as { mode?: string } | null;
    const accountIdsBySource = new Map<string, string[]>();
    const accountNetworksBySource = new Map<string, Record<string, SocialNetwork[]>>();
    for (const link of (sourceAccountsResult.data ?? []) as { source_id: string; account_id: string; networks?: SocialNetwork[] | null }[]) {
      const accountIds = accountIdsBySource.get(link.source_id) ?? [];
      accountIds.push(link.account_id);
      accountIdsBySource.set(link.source_id, accountIds);
      if (link.networks && link.networks.length > 0) {
        const nets = accountNetworksBySource.get(link.source_id) ?? {};
        nets[link.account_id] = link.networks;
        accountNetworksBySource.set(link.source_id, nets);
      }
    }
    // Count per source with head queries: the calendar list above is capped by the API row limit and would undercount.
    const eventCountsBySource = new Map<string, number>();
    const countResults = await Promise.all((sourcesResult.data ?? []).map(async (row) => ({
      id: row.id,
      ...(await supabase.from("events").select("id", { count: "exact", head: true }).eq("source_id", row.id)),
    })));
    for (const result of countResults) {
      if (result.error) throw new Error("No se pudo cargar el calendario desde Supabase. Comprueba que has aplicado las migraciones.");
      eventCountsBySource.set(result.id, result.count ?? 0);
    }
    const sources: SourceView[] = (sourcesResult.data ?? []).flatMap((row) => {
      if (row.source_type !== "luma_ical" && row.source_type !== "meetup" && row.source_type !== "substack") return [];
      const resolvedType: SourceType = isSubstackUrl(row.feed_url) || row.source_type === "substack"
        ? "substack"
        : row.source_type;
      return [{
        id: row.id,
        name: row.name,
        type: resolvedType,
        url: row.feed_url ?? "",
        enabled: row.enabled,
        accountIds: accountIdsBySource.get(row.id) ?? [],
        accountNetworks: accountNetworksBySource.get(row.id) ?? {},
        eventCount: eventCountsBySource.get(row.id) ?? 0,
      }];
    });

    const existingBufferPostIds = new Set(
      posts.map((p) => p.bufferPostId).filter((id): id is string => Boolean(id)),
    );
    const syncAccounts = accountsWithChannels.map((acc) => ({
      id: acc.id ?? "",
      name: acc.name,
      apiKey: bufferCredentialForAccount(acc.name).apiKey,
      bufferChannels: acc.bufferChannels,
    }));
    const bufferScheduledPosts = await syncBufferScheduledPosts(
      syncAccounts,
      events,
      existingBufferPostIds,
      async (accountId, network, channelId) => {
        await supabase.from("account_buffer_channels").upsert({
          owner_id: ownerId,
          account_id: accountId,
          network,
          buffer_channel_id: channelId,
        }, { onConflict: "owner_id,account_id,network" });
      },
    );

    return { accounts: accountsWithChannels, events, posts: [...posts, ...bufferScheduledPosts], sources, mode: settings?.mode === "automatic" ? "automatic" : "review", profile: extractUserProfile(user) };
  } catch (caught) {
    logger.error("Failed to load workspace data from Supabase", {}, caught);
    return {
      accounts: [],
      events: [],
      posts: [],
      sources: [],
      mode: "review",
      profile: { name: "Administrador", email: "", initials: "A" },
      error: caught instanceof UserFacingError ? caught.message : caught instanceof Error ? caught.message : "No se pudieron cargar los datos.",
    };
  }
}

export type SaveSourceResult =
  | { success: true; source: SourceView }
  | { success: false; error: string };

export type ActionOutcome = ActionVoidResult;

export async function saveSource(input: SourceInput, sourceId?: string): Promise<SaveSourceResult> {
  const result = await runAction("saveSource", async () => {
    const { supabase } = await authorizedClient();
    const source = validateSource(input);
    if (sourceId && !/^[0-9a-f-]{36}$/i.test(sourceId)) {
      throw new UserFacingError("La fuente no es válida.");
    }
    const dbSourceType = source.type === "substack" ? "luma_ical" : source.type;
    const { data: resultData, error } = await supabase.rpc("save_source", {
      p_source_id: sourceId ?? null,
      p_name: source.name,
      p_source_type: dbSourceType,
      p_feed_url: source.url,
      p_enabled: source.enabled,
      p_account_ids: source.accountIds,
      p_account_networks: source.accountNetworks ?? null,
    }).single();
    if (error) {
      throw new UserFacingError(error.message || "No se pudo guardar la fuente en Supabase.");
    }
    const data = resultData as { id: string; name: string; source_type: SourceType; feed_url: string; enabled: boolean; account_ids: string[]; account_networks?: Record<string, SocialNetwork[]> } | null;
    if (!data) {
      throw new UserFacingError("No se pudieron obtener los datos de la fuente guardada.");
    }
    const resolvedType: SourceType = source.type === "substack" || isSubstackUrl(data.feed_url)
      ? "substack"
      : data.source_type;
    return {
      id: data.id,
      name: data.name,
      type: resolvedType,
      url: data.feed_url,
      enabled: data.enabled,
      accountIds: data.account_ids ?? [],
      accountNetworks: data.account_networks ?? source.accountNetworks ?? {},
    };
  }, { defaultErrorMessage: "Error inesperado al guardar la fuente." });

  if (result.success) return { success: true, source: result.data };
  return { success: false, error: result.error };
}

export async function setSourceEnabled(sourceId: string, enabled: boolean): Promise<ActionOutcome> {
  return runVoidAction("setSourceEnabled", async () => {
    const { supabase } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(sourceId) || typeof enabled !== "boolean") {
      throw new UserFacingError("La fuente no es válida.");
    }
    const { data, error } = await supabase.from("sources").update({ enabled }).eq("id", sourceId).select("id").single();
    if (error || !data) throw new UserFacingError("No se pudo actualizar la fuente.");
  }, { defaultErrorMessage: "No se pudo actualizar la fuente." });
}

export async function retireSource(sourceId: string): Promise<ActionOutcome> {
  return runVoidAction("retireSource", async () => {
    const { supabase } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(sourceId)) {
      throw new UserFacingError("La fuente no es válida.");
    }
    const { data, error } = await supabase.rpc("retire_source", { p_source_id: sourceId });
    if (error || data !== true) throw new UserFacingError("No se pudo retirar la fuente.");
  }, { defaultErrorMessage: "No se pudo retirar la fuente." });
}

export async function deleteSource(sourceId: string): Promise<ActionOutcome> {
  return runVoidAction("deleteSource", async () => {
    const { supabase } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(sourceId)) {
      throw new UserFacingError("La fuente no es válida.");
    }
    const { count, error: countError } = await supabase.from("events").select("id", { count: "exact", head: true }).eq("source_id", sourceId);
    if (countError) throw new UserFacingError("No se pudo eliminar la fuente.");
    if ((count ?? 0) > 0) throw new UserFacingError("La fuente tiene eventos importados. Retírala para conservarlos.");
    const { data, error } = await supabase.from("sources").delete().eq("id", sourceId).select("id").single();
    if (error || !data) throw new UserFacingError("No se pudo eliminar la fuente.");
  }, { defaultErrorMessage: "No se pudo eliminar la fuente." });
}

export type CreateEventResult =
  | { success: true; event: EventView }
  | { success: false; error: string };

export type GenerateReviewPostsResult =
  | { success: true; posts: PostView[]; warning?: string }
  | { success: false; posts: PostView[]; error: string };

export async function deleteEvent(eventId: string): Promise<ActionOutcome> {
  return runVoidAction("deleteEvent", async () => {
    const { supabase, ownerId } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) throw new UserFacingError("El evento no es válido.");
    const { data, error } = await supabase.from("events").delete().eq("id", eventId).eq("owner_id", ownerId).select("id").single();
    if (error || !data) throw new UserFacingError("No se pudo eliminar el evento.");
  }, { defaultErrorMessage: "No se pudo eliminar el evento." });
}

export async function createEvent(input: Omit<EventView, "id">): Promise<CreateEventResult> {
  const result = await runAction("createEvent", async () => {
    const { supabase, ownerId } = await authorizedClient();
    const title = input.title.trim();
    const substack = isSubstackUrl(input.url) || input.source === "Substack";
    if (!title || title.length > 200 || (!substack && (!input.date || !input.time))) {
      throw new UserFacingError("Completa título, fecha y hora del evento.");
    }
    if (!Array.isArray(input.accountIds) || input.accountIds.length === 0 || input.accountIds.length > 3 || input.accountIds.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) || new Set(input.accountIds).size !== input.accountIds.length) {
      throw new UserFacingError("Selecciona al menos una cuenta válida.");
    }
    const accountResult = await supabase.from("accounts").select("id").eq("owner_id", ownerId).eq("enabled", true).in("id", input.accountIds);
    if (accountResult.error || accountResult.data?.length !== input.accountIds.length) throw new UserFacingError("Una de las cuentas seleccionadas no está disponible.");
    let url: string | null = null;
    if (input.url) {
      try {
        const parsed = new URL(input.url);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
        url = parsed.toString();
      } catch { throw new UserFacingError("El enlace del evento debe ser una URL HTTP o HTTPS válida."); }
    }
    const fallbackNow = formatMadridDateTime(new Date().toISOString());
    const eventDate = input.date || fallbackNow.date;
    const eventTime = input.time || fallbackNow.time;
    const startsAt = madridDateTimeToIso(eventDate, eventTime);
    const resolvedImageUrl = input.imageUrl?.trim() || (url ? await fetchOpenGraphImage(url) : null);
    const { data, error } = await supabase.from("events").insert({
      owner_id: ownerId,
      target_account_ids: input.accountIds,
      title,
      starts_at: startsAt,
      timezone: "Europe/Madrid",
      location: packLocationAndImage(input.place.trim(), resolvedImageUrl),
      description: input.description.trim(),
      event_url: url,
      detected_language: detectTitleLanguage(title),
    }).select("id,title,starts_at,location,description,event_url,detected_language,source_id,target_account_ids").single();
    if (error || !data) {
      if (error) {
        logger.error("Failed to insert event into Supabase", {
          code: error.code,
          details: error.details,
          hint: error.hint,
        }, new Error(error.message));
      }
      throw new UserFacingError("No se pudo guardar el evento en Supabase.");
    }
    const scheduled = formatMadridDateTime(data.starts_at);
    const unpacked = unpackLocationAndImage(data.location);
    return {
      id: data.id,
      title: data.title,
      date: scheduled.date,
      time: scheduled.time,
      place: unpacked.place,
      description: data.description,
      source: sourceForUrl(data.event_url),
      sourceId: data.source_id,
      accountIds: data.target_account_ids,
      url: data.event_url ?? undefined,
      imageUrl: unpacked.imageUrl,
      language: data.detected_language as PostLanguage,
    };
  }, { defaultErrorMessage: "No se pudo guardar el evento en Supabase." });

  if (result.success) return { success: true, event: result.data };
  return { success: false, error: result.error };
}

export async function generateReviewPosts(eventId: string): Promise<GenerateReviewPostsResult> {
  const result = await runAction("generateReviewPosts", async () => {
    const { supabase, ownerId } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) throw new UserFacingError("Solicitud de publicaciones no válida.");

    const eventResult = await supabase
      .from("events")
      .select("id,owner_id,source_id,target_account_ids,title,starts_at,location,description,event_url,detected_language")
      .eq("id", eventId)
      .eq("owner_id", ownerId)
      .single();

    if (eventResult.error || !eventResult.data) throw new UserFacingError("No se encontró el evento en este espacio.");

    const draftRepo = createSupabaseDraftRepository(supabase, ownerId);
    await generateLumaEventDrafts(eventResult.data, draftRepo, generateSocialPostOrFallback);

    const [accountResult, postsResult] = await Promise.all([
      supabase.from("accounts").select("id,name").eq("owner_id", ownerId),
      supabase.from("posts").select("id,event_id,account_id,network,lead_days,due_at,content,status,language,last_error,buffer_post_id,generation_origin,generation_error_code")
        .eq("owner_id", ownerId).eq("event_id", eventId).order("due_at"),
    ]);

    if (postsResult.error || !postsResult.data) throw new UserFacingError("No se pudieron recuperar las publicaciones pendientes.");
    const accountNames = new Map((accountResult.data ?? []).map((account: { id: string; name: string }) => [account.id, account.name]));
    const posts: PostView[] = (postsResult.data ?? []).flatMap((row: Parameters<typeof mapPostRowToView>[0]) => {
      const view = mapPostRowToView(row, accountNames);
      return view ? [view] : [];
    });
    return posts;
  }, { defaultErrorMessage: "No se pudieron crear los borradores." });

  if (result.success) {
    const hasFallback = result.data.some((p) => p.lastError?.includes("plantilla de respaldo"));
    return {
      success: true,
      posts: result.data,
      warning: hasFallback
        ? "No se pudo generar el texto con IA; se ha utilizado la plantilla de respaldo."
        : undefined,
    };
  }
  return { success: false, posts: [], error: result.error };
}

export async function discardDraft(postId: string): Promise<ActionOutcome> {
  return runVoidAction("discardDraft", async () => {
    const { supabase } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(postId)) throw new UserFacingError("La publicación no es válida.");
    const { data, error } = await supabase.rpc("discard_review_post", { p_post_id: postId });
    if (error) throw new UserFacingError("No se pudo eliminar el borrador.");
    if (data !== true) throw new UserFacingError("El borrador ya no está disponible para eliminar. Actualiza el espacio y revisa su estado.");
  }, { defaultErrorMessage: "No se pudo eliminar el borrador." });
}

export async function updatePostContent(
  postId: string,
  content: string,
  schedule?: { date?: string; time?: string },
): Promise<ActionOutcome> {
  return runVoidAction("updatePostContent", async () => {
    const { supabase, ownerId } = await authorizedClient();
    if (!content.trim()) throw new UserFacingError("El texto de la publicación no puede estar vacío.");
    const current = await supabase.from("posts").select("network").eq("id", postId).eq("owner_id", ownerId).single();
    if (current.error || !NETWORKS.includes(current.data.network as SocialNetwork)) {
      throw new UserFacingError("No se pudo comprobar la red de la publicación.");
    }
    const validation = validatePost(current.data.network as SocialNetwork, content);
    if (!validation.valid) throw new UserFacingError(validation.message);

    let dueAt: string | null = null;
    if (schedule?.date && schedule?.time) {
      dueAt = madridDateTimeToIso(schedule.date, schedule.time);
    }

    const rpcResult = dueAt
      ? await supabase.rpc("update_post_details", { p_post_id: postId, p_content: content, p_due_at: dueAt })
      : await supabase.rpc("update_post_details", { p_post_id: postId, p_content: content });

    if (rpcResult.error) {
      const fallback = await supabase.rpc("update_post_content", { p_post_id: postId, p_content: content });
      if (fallback.error) {
        throw new UserFacingError("No se pudo guardar la publicación. Comprueba que has aplicado las migraciones.");
      }
      if (dueAt) {
        const updateDue = await supabase.from("posts").update({ due_at: dueAt, custom_scheduled: true }).eq("id", postId).eq("owner_id", ownerId);
        if (updateDue.error) {
          throw new UserFacingError("No se pudo guardar la fecha de publicación.");
        }
      }
    }
  }, { defaultErrorMessage: "No se pudo guardar la publicación." });
}

export type ApprovePostResult = PostPublishingOutcome | { kind: "error"; message: string };

export async function approvePost(
  postId: string,
  content: string,
  schedule?: { date?: string; time?: string },
): Promise<ApprovePostResult> {
  try {
    const { supabase, ownerId } = await authorizedClient();
    const validationNetwork = await supabase.from("posts").select("network").eq("id", postId).single();
    if (validationNetwork.error || !NETWORKS.includes(validationNetwork.data.network as SocialNetwork)) {
      return { kind: "error", message: "No se pudo comprobar la red de la publicación." };
    }
    const validation = validatePost(validationNetwork.data.network as SocialNetwork, content);
    if (!validation.valid) return { kind: "error", message: validation.message };
    if (schedule?.date && schedule?.time) {
      const dueAt = madridDateTimeToIso(schedule.date, schedule.time);
      const scheduleUpdate = await supabase.from("posts").update({ due_at: dueAt, custom_scheduled: true }).eq("id", postId).eq("owner_id", ownerId);
      if (scheduleUpdate.error) {
        return { kind: "error", message: "No se pudo guardar la fecha de publicación." };
      }
    }
    const outcome = await approveAndSchedulePost(postId, content, supabase, ownerId);
    invalidateBufferSyncCache();
    return outcome;
  } catch (caught) {
    logger.error("Failed to approve post", { postId }, caught);
    return { kind: "error", message: caught instanceof Error ? caught.message : "No se pudo aprobar la publicación." };
  }
}

export type RegeneratePostData = {
  text: string;
  generationOrigin: "groq" | "openai" | "fallback";
  generationErrorCode: string | null;
  lastError: string | null;
};

export async function regeneratePostAction(postId: string): Promise<ActionResult<RegeneratePostData>> {
  return runAction("regeneratePostAction", async () => {
    const { supabase, ownerId } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(postId)) throw new UserFacingError("Solicitud de publicación no válida.");

    const { data: post, error: postErr } = await supabase
      .from("posts")
      .select("id, event_id, account_id, network, lead_days, language, status")
      .eq("id", postId)
      .eq("owner_id", ownerId)
      .single();

    if (postErr || !post) throw new UserFacingError("No se encontró la publicación.");
    if (post.status !== "review" && post.status !== "failed") {
      throw new UserFacingError("Solo se pueden regenerar publicaciones en revisión o fallidas.");
    }

    const { data: event, error: eventErr } = await supabase
      .from("events")
      .select("id, title, starts_at, location, description, event_url")
      .eq("id", post.event_id)
      .eq("owner_id", ownerId)
      .single();
    if (eventErr || !event) throw new UserFacingError("No se encontró el evento asociado.");

    const { data: account, error: accErr } = await supabase
      .from("accounts")
      .select("id, name, voice_prompt, account_type")
      .eq("id", post.account_id)
      .eq("owner_id", ownerId)
      .single();
    if (accErr || !account) throw new UserFacingError("No se encontró la cuenta asociada.");

    const { data: examples } = await supabase
      .from("style_examples")
      .select("content, language, network, account_id")
      .eq("owner_id", ownerId)
      .eq("account_id", post.account_id)
      .eq("network", post.network)
      .eq("language", post.language)
      .limit(3);

    const attemptLogs: LLMLogRow[] = [];
    const trackingHandler: LLMAttemptHandler = (attempt) => {
      attemptLogs.push(toAttemptLogRow(ownerId, event.id, attempt));
    };

    const result = await regeneratePostContent(
      {
        post: {
          id: post.id,
          network: post.network as SocialNetwork,
          language: post.language as PostLanguage,
          leadDays: post.lead_days as 14 | 7 | 1,
        },
        event: {
          title: event.title,
          startsAt: event.starts_at,
          location: event.location,
          description: event.description,
          eventUrl: event.event_url,
        },
        account: {
          id: account.id,
          name: account.name,
          voicePrompt: account.voice_prompt,
          accountType: account.account_type,
        },
        approvedExamples: (examples ?? []).map((ex) => ({
          text: ex.content,
          accountId: ex.account_id,
          network: ex.network as SocialNetwork,
          language: ex.language as PostLanguage,
        })),
      },
      generateSocialPostOrFallback,
      trackingHandler,
    );

    if (attemptLogs.length > 0) {
      try {
        await supabase.from("llm_generation_logs").insert(attemptLogs);
      } catch (err) {
        logger.warn("Unable to persist LLM generation logs during post regeneration", { postId }, err);
      }
    }

    const { data: updatedRows, error: updateErr } = await supabase
      .from("posts")
      .update(buildRegeneratedPostUpdate(result))
      .eq("id", postId)
      .eq("owner_id", ownerId)
      .in("status", ["review", "failed"])
      .select("id");

    if (updateErr || !updatedRows?.length) {
      throw new UserFacingError("No se pudo actualizar la publicación en la base de datos.");
    }

    try {
      await supabase
        .from("style_examples")
        .delete()
        .eq("post_id", postId)
        .eq("owner_id", ownerId);
    } catch (err) {
      logger.warn("Unable to remove prior style example during post regeneration", { postId }, err);
    }

    return {
      text: result.text,
      generationOrigin: result.generationOrigin,
      generationErrorCode: result.generationErrorCode,
      lastError: result.lastError,
    };
  }, { defaultErrorMessage: "No se pudo regenerar el texto con IA." });
}

export async function retryFailedPost(postId: string): Promise<ApprovePostResult> {
  try {
    const { supabase, ownerId } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(postId)) return { kind: "error", message: "Solicitud de publicación no válida." };
    const outcome = await schedulePostWithSupabase(postId, supabase, ownerId);
    invalidateBufferSyncCache();
    return outcome;
  } catch (caught) {
    logger.error("Failed to retry post", { postId }, caught);
    return { kind: "error", message: caught instanceof Error ? caught.message : "No se pudo reintentar la publicación." };
  }
}

export async function reconcileScheduledPost(postId: string, bufferPostId: string): Promise<ActionOutcome> {
  return runVoidAction("reconcileScheduledPost", async () => {
    const { supabase, ownerId } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(postId)) throw new UserFacingError("Solicitud de publicación no válida.");
    const normalizedId = bufferPostId.trim();
    if (!normalizedId || normalizedId.length > 200) throw new UserFacingError("Introduce el ID del post confirmado en Buffer.");
    const { error } = await supabase.rpc("reconcile_post_scheduled", {
      p_post_id: postId,
      p_buffer_post_id: normalizedId,
      p_owner_id: ownerId,
    });
    if (error) throw new UserFacingError("No se pudo confirmar la programación conciliada.");
  }, { defaultErrorMessage: "No se pudo confirmar la programación conciliada." });
}

export async function confirmPostMissingFromBuffer(postId: string): Promise<ActionOutcome> {
  return runVoidAction("confirmPostMissingFromBuffer", async () => {
    const { supabase, ownerId } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(postId)) throw new UserFacingError("Solicitud de publicación no válida.");
    const { error } = await supabase.rpc("reconcile_post_missing", {
      p_post_id: postId,
      p_owner_id: ownerId,
    });
    if (error) throw new UserFacingError("No se pudo guardar la conciliación de ausencia.");
  }, { defaultErrorMessage: "No se pudo guardar la conciliación de ausencia." });
}

export async function saveBufferChannel(accountId: string, network: SocialNetwork, bufferChannelId: string): Promise<ActionOutcome> {
  return runVoidAction("saveBufferChannel", async () => {
    const { supabase, ownerId } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(accountId) || !NETWORKS.includes(network)) throw new UserFacingError("La cuenta o red no es válida.");
    const channelId = bufferChannelId.trim();
    if (channelId.length > 200) throw new UserFacingError("El ID del canal de Buffer no puede superar 200 caracteres.");
    if (!channelId) {
      const { error } = await supabase.from("account_buffer_channels").delete()
        .eq("owner_id", ownerId).eq("account_id", accountId).eq("network", network);
      if (error) throw new UserFacingError("No se pudo eliminar el ID del canal de Buffer.");
      invalidateBufferSyncCache();
      return;
    }
    const { error } = await supabase.from("account_buffer_channels").upsert({
      owner_id: ownerId,
      account_id: accountId,
      network,
      buffer_channel_id: channelId,
    }, { onConflict: "owner_id,account_id,network" });
    if (error) throw new UserFacingError("No se pudo guardar el ID del canal de Buffer.");
    invalidateBufferSyncCache();
  }, { defaultErrorMessage: "No se pudo guardar el ID del canal de Buffer." });
}

export async function updateAccountVoice(accountId: string, prompt: string): Promise<ActionOutcome> {
  return runVoidAction("updateAccountVoice", async () => {
    const { supabase } = await authorizedClient();
    if (prompt.length > 2000) throw new UserFacingError("El prompt de estilo no puede superar los 2.000 caracteres.");
    const { error } = await supabase.from("accounts").update({ voice_prompt: prompt }).eq("id", accountId);
    if (error) throw new UserFacingError("No se pudo guardar la voz de la cuenta.");
  }, { defaultErrorMessage: "No se pudo guardar la voz de la cuenta." });
}

export async function updatePublishingMode(mode: "review" | "automatic"): Promise<ActionOutcome> {
  return runVoidAction("updatePublishingMode", async () => {
    const { supabase, ownerId } = await authorizedClient();
    const { error } = await supabase.from("app_settings").upsert({
      owner_id: ownerId,
      key: "publishing_mode",
      value: { mode },
    }, { onConflict: "owner_id,key" });
    if (error) throw new UserFacingError("No se pudo guardar el modo de publicación.");
  }, { defaultErrorMessage: "No se pudo guardar el modo de publicación." });
}

function aggregatePostSummary(posts: Array<{ generation_origin?: string | null }>) {
  const summary = { total: posts.length, groq: 0, openai: 0, fallback: 0 };
  for (const post of posts) {
    if (post.generation_origin === "groq") summary.groq++;
    else if (post.generation_origin === "openai") summary.openai++;
    else if (post.generation_origin === "fallback") summary.fallback++;
  }
  return summary;
}

type ProviderStatsAccumulator = {
  success: number;
  error: number;
  latencySum: number;
  latencyCount: number;
  tokens: number;
};

function recordLogMetrics(acc: ProviderStatsAccumulator, log: LLMLogView) {
  if (log.status === "success") acc.success++;
  else acc.error++;
  if (typeof log.latencyMs === "number") {
    acc.latencySum += log.latencyMs;
    acc.latencyCount++;
  }
  if (typeof log.totalTokens === "number") {
    acc.tokens += log.totalTokens;
  }
}

function summarizeProvider(acc: ProviderStatsAccumulator) {
  return {
    total: acc.success + acc.error,
    success: acc.success,
    error: acc.error,
    avgLatencyMs: acc.latencyCount > 0 ? Math.round(acc.latencySum / acc.latencyCount) : 0,
    totalTokens: acc.tokens,
  };
}

function aggregateCallsSummary(logs: LLMLogView[]) {
  const groq: ProviderStatsAccumulator = { success: 0, error: 0, latencySum: 0, latencyCount: 0, tokens: 0 };
  const openai: ProviderStatsAccumulator = { success: 0, error: 0, latencySum: 0, latencyCount: 0, tokens: 0 };
  let fallbackCalls = 0;

  for (const log of logs) {
    if (log.provider === "groq") recordLogMetrics(groq, log);
    else if (log.provider === "openai") recordLogMetrics(openai, log);
    else fallbackCalls++;
  }

  return {
    total: logs.length,
    groq: summarizeProvider(groq),
    openai: summarizeProvider(openai),
    fallback: { total: fallbackCalls },
  };
}

function mapLogRows(rows: Array<{
  id: string;
  provider: string;
  model: string;
  status: string;
  error_code: string | null;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  created_at: string;
}>): LLMLogView[] {
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider as "groq" | "openai" | "fallback",
    model: row.model,
    status: row.status as "success" | "error",
    errorCode: row.error_code,
    latencyMs: row.latency_ms,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    createdAt: row.created_at,
  }));
}

export async function loadWorkspaceStats(): Promise<ActionResult<WorkspaceStats>> {
  return runAction("loadWorkspaceStats", async () => {
    const { supabase, ownerId } = await authorizedClient();

    const postsResult = await supabase
      .from("posts")
      .select("generation_origin")
      .eq("owner_id", ownerId);

    if (postsResult.error) {
      throw new Error("No se pudieron cargar los datos de publicaciones.");
    }

    const logsResult = await supabase
      .from("llm_generation_logs")
      .select("id,provider,model,status,error_code,latency_ms,prompt_tokens,completion_tokens,total_tokens,created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(200);

    const logs = mapLogRows(logsResult.data ?? []);

    return {
      postsSummary: aggregatePostSummary(postsResult.data ?? []),
      callsSummary: aggregateCallsSummary(logs),
      recentLogs: logs,
    };
  });
}

export type UpcomingSourceEvent = {
  sourceId: string;
  sourceName: string;
  sourceType: SourceType;
  externalId: string;
  title: string;
  startsAt: string;
  date: string;
  time: string;
  location: string;
  url: string | null;
  description: string;
  alreadyImported: boolean;
};

export type PreviewUpcomingResult =
  | { success: true; events: UpcomingSourceEvent[] }
  | { success: false; error: string };

export async function previewUpcomingSourceEvents(): Promise<PreviewUpcomingResult> {
  const result = await runAction("previewUpcomingSourceEvents", async () => {
    const { supabase, ownerId } = await authorizedClient();
    const { data: sources, error } = await supabase
      .from("sources")
      .select("id,owner_id,name,source_type,feed_url")
      .eq("owner_id", ownerId)
      .eq("enabled", true)
      .is("archived_at", null);
    if (error) throw new UserFacingError("No se pudieron consultar las fuentes activas.");
    if (!sources || sources.length === 0) return [];

    const todayInMadrid = formatMadridDateTime(new Date().toISOString()).date;
    const allUpcoming: UpcomingSourceEvent[] = [];

    for (const source of sources) {
      if (!source.feed_url) continue;
      try {
        const raw = await fetchLumaFeed(source.feed_url);
        const { rows } = extractSourceEvents(
          { id: source.id, ownerId: source.owner_id, name: source.name, feedUrl: source.feed_url },
          raw,
        );
        const upcoming = filterUpcomingEvents(rows, todayInMadrid);
        if (upcoming.length === 0) continue;

        const { data: existingEvents } = await supabase
          .from("events")
          .select("external_id")
          .eq("owner_id", ownerId)
          .eq("source_id", source.id)
          .in("external_id", upcoming.map((e) => e.external_id));

        const existingSet = new Set((existingEvents ?? []).map((e) => e.external_id));
        const resolvedType: SourceType = isSubstackUrl(source.feed_url) || source.source_type === "substack"
          ? "substack"
          : (source.source_type as SourceType);

        for (const ev of upcoming) {
          const dt = formatMadridDateTime(ev.starts_at);
          const unpacked = unpackLocationAndImage(ev.location);
          allUpcoming.push({
            sourceId: source.id,
            sourceName: source.name,
            sourceType: resolvedType,
            externalId: ev.external_id,
            title: ev.title,
            startsAt: ev.starts_at,
            date: dt.date,
            time: dt.time,
            location: unpacked.place,
            url: ev.event_url,
            description: ev.description,
            alreadyImported: existingSet.has(ev.external_id),
          });
        }
      } catch (feedError) {
        logger.warn("Failed to fetch feed during upcoming events preview", { sourceId: source.id }, feedError);
      }
    }

    return allUpcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, { defaultErrorMessage: "No se pudieron obtener los eventos futuros de las fuentes." });

  if (result.success) return { success: true, events: result.data };
  return { success: false, error: result.error };
}

type SupabaseAuthorizedClient = Awaited<ReturnType<typeof authorizedClient>>["supabase"];

function createAutomaticDraftRepository(supabase: SupabaseAuthorizedClient, ownerId: string): LumaDraftRepository {
  const base = createSupabaseDraftRepository(supabase, ownerId);
  return {
    ...base,
    async scheduleAutomaticPosts(oId, evId, accIds) {
      if (accIds.length === 0) return;
      await dispatchApprovedPostsWithSupabase(supabase, oId, evId);
    },
  };
}

async function upsertSingleEvent(supabase: SupabaseAuthorizedClient, persistable: PersistableEvent): Promise<ImportedLumaEvent | null> {
  const cols = "id,owner_id,source_id,external_id,title,starts_at,location,description,event_url,detected_language";
  const { data, error } = await supabase
    .from("events")
    .upsert([persistable], { onConflict: "owner_id,source_id,external_id" })
    .select(cols)
    .single();
  if (error || !data) return null;
  return data as ImportedLumaEvent;
}

export async function syncSelectedUpcomingEvents(events: UpcomingSourceEvent[]): Promise<ActionResult<{ scheduled: number }>> {
  return runAction("syncSelectedUpcomingEvents", async () => {
    if (!Array.isArray(events) || events.length === 0) {
      throw new UserFacingError("Selecciona al menos un evento para programar.");
    }
    const { supabase, ownerId } = await authorizedClient();

    let totalScheduled = 0;
    const draftRepository = createAutomaticDraftRepository(supabase, ownerId);

    for (const ev of events) {
      const persistable: PersistableEvent = {
        owner_id: ownerId,
        source_id: ev.sourceId,
        external_id: ev.externalId,
        title: ev.title,
        starts_at: ev.startsAt,
        timezone: "Europe/Madrid",
        location: ev.location,
        description: ev.description,
        event_url: ev.url,
        detected_language: detectTitleLanguage(ev.title),
      };

      const upserted = await upsertSingleEvent(supabase, persistable);
      if (!upserted) {
        logger.warn("Failed to upsert event during selective sync", { eventId: ev.externalId });
        continue;
      }

      try {
        await generateLumaEventDrafts(upserted, draftRepository, generateSocialPostOrFallback);
        totalScheduled += 1;
      } catch (genError) {
        logger.error("Failed to generate drafts for selective sync event", { eventId: upserted.id }, genError);
      }
    }

    return { scheduled: totalScheduled };
  }, { defaultErrorMessage: "No se pudieron programar los eventos seleccionados." });
}

export type SubstackPostItemView = {
  uid: string;
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  formattedDate: string;
  coverImage: string | null;
  alreadyImported: boolean;
};

export type FetchSubstackResult =
  | { success: true; posts: SubstackPostItemView[] }
  | { success: false; error: string };

export async function fetchSubstackPostsForSource(sourceId: string): Promise<FetchSubstackResult> {
  const result = await runAction("fetchSubstackPostsForSource", async () => {
    const { supabase, ownerId } = await authorizedClient();
    const { data: source, error } = await supabase
      .from("sources")
      .select("id,feed_url,name,source_type")
      .eq("id", sourceId)
      .eq("owner_id", ownerId)
      .single();
    if (error || !source || !source.feed_url) {
      throw new UserFacingError("Fuente de Substack no encontrada.");
    }

    const raw = await fetchLumaFeed(source.feed_url);
    const parsed = parseSubstackFeed(raw, source.feed_url);
    const sorted = sortSubstackPostsReverseChronological(parsed);

    const { data: existingEvents } = await supabase
      .from("events")
      .select("external_id")
      .eq("owner_id", ownerId)
      .eq("source_id", sourceId)
      .in("external_id", sorted.map((p) => p.uid));

    const existingSet = new Set((existingEvents ?? []).map((e) => e.external_id));

    return sorted.map((item): SubstackPostItemView => {
      const dt = formatMadridDateTime(item.publishedAt);
      return {
        uid: item.uid,
        title: item.title,
        description: item.description,
        url: item.url,
        publishedAt: item.publishedAt,
        formattedDate: `${dt.date} ${dt.time}`,
        coverImage: item.coverImage,
        alreadyImported: existingSet.has(item.uid),
      };
    });
  }, { defaultErrorMessage: "No se pudieron obtener las publicaciones de Substack." });

  if (result.success) return { success: true, posts: result.data };
  return { success: false, error: result.error };
}

export async function generateDraftsForSubstackArticle(sourceId: string, postUid: string): Promise<ActionResult<{ draftsCreated: number }>> {
  return runAction("generateDraftsForSubstackArticle", async () => {
    const { supabase, ownerId } = await authorizedClient();
    const { data: source, error } = await supabase
      .from("sources")
      .select("id,feed_url,name")
      .eq("id", sourceId)
      .eq("owner_id", ownerId)
      .single();
    if (error || !source || !source.feed_url) {
      throw new UserFacingError("Fuente no encontrada.");
    }

    const raw = await fetchLumaFeed(source.feed_url);
    const posts = parseSubstackFeed(raw, source.feed_url);
    const post = posts.find((p) => p.uid === postUid);
    if (!post) throw new UserFacingError("No se encontró la publicación en el feed de Substack.");

    const persistable: PersistableEvent = {
      owner_id: ownerId,
      source_id: sourceId,
      external_id: post.uid,
      title: post.title,
      starts_at: post.publishedAt,
      timezone: "Europe/Madrid",
      location: packLocationAndImage("", post.coverImage),
      description: post.description,
      event_url: post.url,
      detected_language: detectTitleLanguage(post.title),
    };

    const upserted = await upsertSingleEvent(supabase, persistable);
    if (!upserted) {
      throw new UserFacingError("No se pudo guardar la publicación.");
    }

    const draftRepository = createAutomaticDraftRepository(supabase, ownerId);
    const draftsCreated = await generateLumaEventDrafts(
      upserted,
      draftRepository,
      generateSocialPostOrFallback,
    );

    return { draftsCreated };
  }, { defaultErrorMessage: "No se pudieron generar los borradores para la publicación." });
}

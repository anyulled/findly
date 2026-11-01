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
import { runAction, runVoidAction, UserFacingError, type ActionVoidResult } from "@/lib/action-result";
import { logger } from "@/lib/logger";

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
  status: "review" | "approved" | "scheduling" | "scheduled" | "published" | "failed" | "needs_reconciliation";
  lastError?: string | null;
  bufferPostId?: string | null;
  leadDays?: 14 | 7 | 1;
  language?: PostLanguage;
};

export type SourceView = {
  id: string;
  name: string;
  type: SourceType;
  url: string;
  enabled: boolean;
  accountIds: string[];
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
      supabase.from("events").select("id,title,starts_at,location,description,event_url,detected_language,source_id,target_account_ids").order("starts_at"),
      supabase.from("posts").select("id,event_id,account_id,network,lead_days,due_at,content,status,language,last_error,buffer_post_id").order("due_at"),
      supabase.from("app_settings").select("value").eq("key", "publishing_mode").maybeSingle(),
      supabase.from("sources").select("id,name,source_type,feed_url,enabled").order("created_at"),
      supabase.from("source_accounts").select("source_id,account_id"),
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
    for (const link of sourceAccountsResult.data ?? []) {
      const accountIds = accountIdsBySource.get(link.source_id) ?? [];
      accountIds.push(link.account_id);
      accountIdsBySource.set(link.source_id, accountIds);
    }
    const sources: SourceView[] = (sourcesResult.data ?? []).flatMap((row) => {
      if (row.source_type !== "luma_ical" && row.source_type !== "meetup" && row.source_type !== "substack") return [];
      const resolvedType: SourceType = isSubstackUrl(row.feed_url) || row.source_type === "substack"
        ? "substack"
        : row.source_type;
      return [{ id: row.id, name: row.name, type: resolvedType, url: row.feed_url ?? "", enabled: row.enabled, accountIds: accountIdsBySource.get(row.id) ?? [] }];
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
    }).single();
    if (error) {
      throw new UserFacingError(error.message || "No se pudo guardar la fuente en Supabase.");
    }
    const data = resultData as { id: string; name: string; source_type: SourceType; feed_url: string; enabled: boolean; account_ids: string[] } | null;
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

export async function deleteSource(sourceId: string): Promise<ActionOutcome> {
  return runVoidAction("deleteSource", async () => {
    const { supabase } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(sourceId)) {
      throw new UserFacingError("La fuente no es válida.");
    }
    const { data, error } = await supabase.from("sources").delete().eq("id", sourceId).select("id").single();
    if (error || !data) throw new UserFacingError("No se pudo eliminar la fuente.");
  }, { defaultErrorMessage: "No se pudo eliminar la fuente." });
}

export type CreateEventResult =
  | { success: true; event: EventView }
  | { success: false; error: string };

export type GenerateReviewPostsResult =
  | { success: true; posts: PostView[] }
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
      supabase.from("posts").select("id,event_id,account_id,network,lead_days,due_at,content,status,language,last_error,buffer_post_id")
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

  if (result.success) return { success: true, posts: result.data };
  return { success: false, posts: [], error: result.error };
}

export async function updatePostContent(postId: string, content: string): Promise<ActionOutcome> {
  return runVoidAction("updatePostContent", async () => {
    const { supabase } = await authorizedClient();
    if (!content.trim()) throw new UserFacingError("El texto de la publicación no puede estar vacío.");
    const current = await supabase.from("posts").select("network").eq("id", postId).single();
    if (current.error || !NETWORKS.includes(current.data.network as SocialNetwork)) {
      throw new UserFacingError("No se pudo comprobar la red de la publicación.");
    }
    const validation = validatePost(current.data.network as SocialNetwork, content);
    if (!validation.valid) throw new UserFacingError(validation.message);
    const { error } = await supabase.rpc("update_post_content", { p_post_id: postId, p_content: content });
    if (error) throw new UserFacingError("No se pudo guardar la publicación. Comprueba que has aplicado las migraciones.");
  }, { defaultErrorMessage: "No se pudo guardar la publicación." });
}

export type ApprovePostResult = PostPublishingOutcome | { kind: "error"; message: string };

export async function approvePost(postId: string, content: string): Promise<ApprovePostResult> {
  try {
    const { supabase, ownerId } = await authorizedClient();
    const validationNetwork = await supabase.from("posts").select("network").eq("id", postId).single();
    if (validationNetwork.error || !NETWORKS.includes(validationNetwork.data.network as SocialNetwork)) {
      return { kind: "error", message: "No se pudo comprobar la red de la publicación." };
    }
    const validation = validatePost(validationNetwork.data.network as SocialNetwork, content);
    if (!validation.valid) return { kind: "error", message: validation.message };
    const outcome = await approveAndSchedulePost(postId, content, supabase, ownerId);
    invalidateBufferSyncCache();
    return outcome;
  } catch (caught) {
    logger.error("Failed to approve post", { postId }, caught);
    return { kind: "error", message: caught instanceof Error ? caught.message : "No se pudo aprobar la publicación." };
  }
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

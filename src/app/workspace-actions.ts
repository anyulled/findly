"use server";

import { createClient } from "@/lib/supabase/server";
import { formatMadridDateTime, madridDateTimeToIso } from "@/lib/madrid-time";
import { validatePost, type SocialNetwork } from "@/lib/social-validation";
import { detectTitleLanguage, type PostLanguage } from "@/lib/language";
import { generateSocialPostOrFallback } from "@/lib/groq";
import { generateEventDrafts } from "@/lib/groq-workflow";
import { dispatchApprovedPostsWithSupabase } from "@/lib/approved-dispatch";
import { approveAndSchedulePost, schedulePostWithSupabase, type PostPublishingOutcome } from "@/lib/post-publishing";
import { MANAGED_ACCOUNTS, managedAccount } from "@/lib/managed-accounts";
import { bufferCredentialForAccount } from "@/lib/buffer-account-credentials";
import { sourceForEventUrl } from "@/lib/event-source";
import { selectEventAccounts } from "@/lib/event-targets";
import { extractUserProfile, type UserProfile } from "@/lib/user-profile";
import { validateSource, type SourceInput, type SourceType } from "@/lib/source-validation";
import { fetchNextChannelSlotsForAccount, invalidateBufferSyncCache, syncBufferScheduledPosts } from "@/lib/buffer-sync";
import { isSubstackUrl, packLocationAndImage, unpackLocationAndImage } from "@/lib/substack";
import { fetchOpenGraphImage } from "@/lib/opengraph";

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
const NETWORKS: SocialNetwork[] = ["LinkedIn", "X", "Bluesky"];

async function authorizedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (error || !user || !ownerEmail || user.email?.toLowerCase() !== ownerEmail) {
    throw new Error("No tienes acceso a este espacio.");
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
    const accountNames = new Map(accounts.map((account) => [account.id, account.name]));

    const [eventsResult, postsResult, settingsResult, sourcesResult, sourceAccountsResult, channelResult, examplesResult] = await Promise.all([
      supabase.from("events").select("id,title,starts_at,location,description,event_url,detected_language,source_id").order("starts_at"),
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
      const network = NETWORKS.find((value) => value === row.network);
      if (!network) return [];
      const scheduled = formatMadridDateTime(row.due_at);
      return [{
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
      }];
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
    return {
      accounts: [],
      events: [],
      posts: [],
      sources: [],
      mode: "review",
      profile: { name: "Administrador", email: "", initials: "A" },
      error: caught instanceof Error ? caught.message : "No se pudieron cargar los datos.",
    };
  }
}

export type SaveSourceResult =
  | { success: true; source: SourceView }
  | { success: false; error: string };

export type ActionOutcome =
  | { success: true }
  | { success: false; error: string };

export async function saveSource(input: SourceInput, sourceId?: string): Promise<SaveSourceResult> {
  try {
    const { supabase } = await authorizedClient();
    const source = validateSource(input);
    if (sourceId && !/^[0-9a-f-]{36}$/i.test(sourceId)) {
      return { success: false, error: "La fuente no es válida." };
    }
    const dbSourceType = source.type === "substack" ? "luma_ical" : source.type;
    const { data: result, error } = await supabase.rpc("save_source", {
      p_source_id: sourceId ?? null,
      p_name: source.name,
      p_source_type: dbSourceType,
      p_feed_url: source.url,
      p_enabled: source.enabled,
      p_account_ids: source.accountIds,
    }).single();
    if (error) {
      return { success: false, error: error.message || "No se pudo guardar la fuente en Supabase." };
    }
    const data = result as { id: string; name: string; source_type: SourceType; feed_url: string; enabled: boolean; account_ids: string[] } | null;
    if (!data) {
      return { success: false, error: "No se pudieron obtener los datos de la fuente guardada." };
    }
    const resolvedType: SourceType = source.type === "substack" || isSubstackUrl(data.feed_url)
      ? "substack"
      : data.source_type;
    return {
      success: true,
      source: {
        id: data.id,
        name: data.name,
        type: resolvedType,
        url: data.feed_url,
        enabled: data.enabled,
        accountIds: data.account_ids ?? [],
      },
    };
  } catch (caught) {
    return {
      success: false,
      error: caught instanceof Error ? caught.message : "Error inesperado al guardar la fuente.",
    };
  }
}

export async function setSourceEnabled(sourceId: string, enabled: boolean): Promise<ActionOutcome> {
  try {
    const { supabase } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(sourceId) || typeof enabled !== "boolean") {
      return { success: false, error: "La fuente no es válida." };
    }
    const { data, error } = await supabase.from("sources").update({ enabled }).eq("id", sourceId).select("id").single();
    if (error || !data) return { success: false, error: "No se pudo actualizar la fuente." };
    return { success: true };
  } catch (caught) {
    return { success: false, error: caught instanceof Error ? caught.message : "No se pudo actualizar la fuente." };
  }
}

export async function deleteSource(sourceId: string): Promise<ActionOutcome> {
  try {
    const { supabase } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(sourceId)) {
      return { success: false, error: "La fuente no es válida." };
    }
    const { data, error } = await supabase.from("sources").delete().eq("id", sourceId).select("id").single();
    if (error || !data) return { success: false, error: "No se pudo eliminar la fuente." };
    return { success: true };
  } catch (caught) {
    return { success: false, error: caught instanceof Error ? caught.message : "No se pudo eliminar la fuente." };
  }
}

export type CreateEventResult =
  | { success: true; event: EventView }
  | { success: false; error: string };

export type GenerateReviewPostsResult =
  | { success: true; posts: PostView[] }
  | { success: false; posts: PostView[]; error: string };

export async function deleteEvent(eventId: string): Promise<ActionOutcome> {
  try {
    const { supabase, ownerId } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) return { success: false, error: "El evento no es válido." };
    const { data, error } = await supabase.from("events").delete().eq("id", eventId).eq("owner_id", ownerId).select("id").single();
    if (error || !data) return { success: false, error: "No se pudo eliminar el evento." };
    return { success: true };
  } catch (caught) {
    return { success: false, error: caught instanceof Error ? caught.message : "No se pudo eliminar el evento." };
  }
}

export async function createEvent(input: Omit<EventView, "id">): Promise<CreateEventResult> {
  try {
    const { supabase, ownerId } = await authorizedClient();
    const title = input.title.trim();
    const substack = isSubstackUrl(input.url) || input.source === "Substack";
    if (!title || title.length > 200 || (!substack && (!input.date || !input.time))) {
      return { success: false, error: "Completa título, fecha y hora del evento." };
    }
    let url: string | null = null;
    if (input.url) {
      try {
        const parsed = new URL(input.url);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
        url = parsed.toString();
      } catch { return { success: false, error: "El enlace del evento debe ser una URL HTTP o HTTPS válida." }; }
    }
    const fallbackNow = formatMadridDateTime(new Date().toISOString());
    const eventDate = input.date || fallbackNow.date;
    const eventTime = input.time || fallbackNow.time;
    const startsAt = madridDateTimeToIso(eventDate, eventTime);
    const resolvedImageUrl = input.imageUrl?.trim() || (url ? await fetchOpenGraphImage(url) : null);
    const { data, error } = await supabase.from("events").insert({
      owner_id: ownerId,
      title,
      starts_at: startsAt,
      timezone: "Europe/Madrid",
      location: packLocationAndImage(input.place.trim(), resolvedImageUrl),
      description: input.description.trim(),
      event_url: url,
      detected_language: detectTitleLanguage(title),
    }).select("id,title,starts_at,location,description,event_url,detected_language,source_id").single();
    if (error || !data) return { success: false, error: "No se pudo guardar el evento en Supabase." };
    const scheduled = formatMadridDateTime(data.starts_at);
    const unpacked = unpackLocationAndImage(data.location);
    return {
      success: true,
      event: {
        id: data.id,
        title: data.title,
        date: scheduled.date,
        time: scheduled.time,
        place: unpacked.place,
        description: data.description,
        source: sourceForUrl(data.event_url),
        sourceId: data.source_id,
        url: data.event_url ?? undefined,
        imageUrl: unpacked.imageUrl,
        language: data.detected_language as PostLanguage,
      },
    };
  } catch (caught) {
    return { success: false, error: caught instanceof Error ? caught.message : "No se pudo guardar el evento en Supabase." };
  }
}

export async function generateReviewPosts(eventId: string): Promise<GenerateReviewPostsResult> {
  try {
    const { supabase, ownerId } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) return { success: false, posts: [], error: "Solicitud de publicaciones no válida." };

    const [eventResult, accountResult, existingResult, settingsResult] = await Promise.all([
      supabase.from("events").select("id,title,starts_at,location,description,event_url,detected_language,source_id")
        .eq("id", eventId).eq("owner_id", ownerId).single(),
      supabase.from("accounts").select("id,name,voice_prompt,networks").eq("owner_id", ownerId).eq("enabled", true).order("created_at"),
      supabase.from("posts").select("account_id,network,lead_days").eq("owner_id", ownerId).eq("event_id", eventId),
      supabase.from("app_settings").select("value").eq("owner_id", ownerId).eq("key", "publishing_mode").maybeSingle(),
    ]);
    if (eventResult.error || !eventResult.data) return { success: false, posts: [], error: "No se encontró el evento en este espacio." };
    if (accountResult.error || !accountResult.data) return { success: false, posts: [], error: "No se pudieron cargar las cuentas." };
    if (existingResult.error || !existingResult.data) return { success: false, posts: [], error: "No se pudo comprobar si ya existen recordatorios." };
    if (settingsResult.error) return { success: false, posts: [], error: "No se pudo cargar el modo de publicación." };

    let sourceLinks: { sourceId: string; accountId: string }[] = [];
    if (eventResult.data.source_id) {
      const { data, error } = await supabase.from("source_accounts").select("source_id,account_id")
        .eq("owner_id", ownerId).eq("source_id", eventResult.data.source_id);
      if (error) return { success: false, posts: [], error: "No se pudieron cargar las cuentas asociadas a la fuente." };
      sourceLinks = (data ?? []).map((link) => ({ sourceId: link.source_id, accountId: link.account_id }));
    }
    const eligibleAccounts = selectEventAccounts(accountResult.data, eventResult.data.source_id, sourceLinks);
    const accountIds = eligibleAccounts.map((account) => account.id);
    const exampleResult = accountIds.length === 0
      ? { data: [], error: null }
      : await supabase.from("style_examples").select("content,account_id,network,language")
        .eq("owner_id", ownerId).in("account_id", accountIds).order("created_at", { ascending: false }).limit(72);
    if (exampleResult.error || !exampleResult.data) return { success: false, posts: [], error: "No se pudieron cargar los ejemplos de estilo aprobados." };

    const eventTime = formatMadridDateTime(eventResult.data.starts_at);
    const unpacked = unpackLocationAndImage(eventResult.data.location);
    const mappedAccounts = eligibleAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      voice: account.voice_prompt,
      networks: (account.networks as string[]).filter((network): network is SocialNetwork => NETWORKS.includes(network as SocialNetwork)),
    }));
    const slotByAccountNetwork: Record<string, { date: string; time: string }> = {};
    if (isSubstackUrl(eventResult.data.event_url)) {
      for (const account of mappedAccounts) {
        const apiKey = bufferCredentialForAccount(account.name).apiKey;
        const slots = await fetchNextChannelSlotsForAccount(apiKey, account.networks);
        for (const network of account.networks) {
          const slot = slots[network];
          if (slot) slotByAccountNetwork[`${account.id}:${network}`] = slot;
        }
      }
    }
    const drafts = await generateEventDrafts({
      event: {
        id: eventResult.data.id,
        title: eventResult.data.title,
        date: eventTime.date,
        time: eventTime.time,
        place: unpacked.place,
        description: eventResult.data.description,
        url: eventResult.data.event_url ?? undefined,
        language: eventResult.data.detected_language as PostLanguage,
      },
      accounts: mappedAccounts,
      approvedExamples: exampleResult.data.flatMap((example) => {
        if (!NETWORKS.includes(example.network as SocialNetwork) || !["en", "es", "ca"].includes(example.language)) return [];
        return [{ accountId: example.account_id, network: example.network as SocialNetwork, language: example.language as PostLanguage, text: example.content }];
      }),
      existing: existingResult.data.flatMap((post) => {
        if (!NETWORKS.includes(post.network as SocialNetwork)) return [];
        return [{ accountId: post.account_id, network: post.network as SocialNetwork, leadDays: post.lead_days }];
      }),
      slotByAccountNetwork,
      generate: generateSocialPostOrFallback,
    });

    const automatic = (settingsResult.data?.value as { mode?: string } | null)?.mode === "automatic";
    const rows = drafts.map((post) => {
      const validation = validatePost(post.network, post.text);
      if (!validation.valid) throw new Error(validation.message);
      return {
        owner_id: ownerId,
        event_id: eventId,
        account_id: post.accountId,
        network: post.network,
        lead_days: post.leadDays,
        due_at: madridDateTimeToIso(post.date, post.time),
        timezone: "Europe/Madrid",
        content: post.text,
        status: automatic && !post.isFallback ? "approved" : "review",
        language: post.language,
      };
    });
    if (rows.length > 0) {
      const { error: upsertError } = await supabase.from("posts").upsert(rows, {
        onConflict: "event_id,account_id,network,lead_days",
        ignoreDuplicates: true,
      });
      if (upsertError) return { success: false, posts: [], error: "No se pudieron guardar las publicaciones pendientes." };
    }
    if (automatic) {
      await dispatchApprovedPostsWithSupabase(supabase, ownerId, eventId);
    }

    const { data, error } = await supabase.from("posts").select("id,event_id,account_id,network,lead_days,due_at,content,status,language,last_error,buffer_post_id")
      .eq("owner_id", ownerId).eq("event_id", eventId).order("due_at");
    if (error || !data) return { success: false, posts: [], error: "No se pudieron recuperar las publicaciones pendientes." };
    const accountNames = new Map(accountResult.data.map((account) => [account.id, account.name]));
    const posts = data.flatMap((row) => {
      const network = NETWORKS.find((value) => value === row.network);
      if (!network) return [];
      const scheduled = formatMadridDateTime(row.due_at);
      return [{
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
      }];
    });
    return { success: true, posts };
  } catch (caught) {
    return { success: false, posts: [], error: caught instanceof Error ? caught.message : "No se pudieron crear los borradores." };
  }
}

export async function updatePostContent(postId: string, content: string): Promise<ActionOutcome> {
  try {
    const { supabase } = await authorizedClient();
    if (!content.trim()) return { success: false, error: "El texto de la publicación no puede estar vacío." };
    const current = await supabase.from("posts").select("network").eq("id", postId).single();
    if (current.error || !NETWORKS.includes(current.data.network as SocialNetwork)) return { success: false, error: "No se pudo comprobar la red de la publicación." };
    const validation = validatePost(current.data.network as SocialNetwork, content);
    if (!validation.valid) return { success: false, error: validation.message };
    const { error } = await supabase.rpc("update_post_content", { p_post_id: postId, p_content: content });
    if (error) return { success: false, error: "No se pudo guardar la publicación. Comprueba que has aplicado las migraciones." };
    return { success: true };
  } catch (caught) {
    return { success: false, error: caught instanceof Error ? caught.message : "No se pudo guardar la publicación." };
  }
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
    return { kind: "error", message: caught instanceof Error ? caught.message : "No se pudo reintentar la publicación." };
  }
}

export async function reconcileScheduledPost(postId: string, bufferPostId: string): Promise<ActionOutcome> {
  try {
    const { supabase, ownerId } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(postId)) return { success: false, error: "Solicitud de publicación no válida." };
    const normalizedId = bufferPostId.trim();
    if (!normalizedId || normalizedId.length > 200) return { success: false, error: "Introduce el ID del post confirmado en Buffer." };
    const { error } = await supabase.rpc("reconcile_post_scheduled", {
      p_post_id: postId,
      p_buffer_post_id: normalizedId,
      p_owner_id: ownerId,
    });
    if (error) return { success: false, error: "No se pudo confirmar la programación conciliada." };
    return { success: true };
  } catch (caught) {
    return { success: false, error: caught instanceof Error ? caught.message : "No se pudo confirmar la programación conciliada." };
  }
}

export async function confirmPostMissingFromBuffer(postId: string): Promise<ActionOutcome> {
  try {
    const { supabase, ownerId } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(postId)) return { success: false, error: "Solicitud de publicación no válida." };
    const { error } = await supabase.rpc("reconcile_post_missing", {
      p_post_id: postId,
      p_owner_id: ownerId,
    });
    if (error) return { success: false, error: "No se pudo guardar la conciliación de ausencia." };
    return { success: true };
  } catch (caught) {
    return { success: false, error: caught instanceof Error ? caught.message : "No se pudo guardar la conciliación de ausencia." };
  }
}

export async function saveBufferChannel(accountId: string, network: SocialNetwork, bufferChannelId: string): Promise<ActionOutcome> {
  try {
    const { supabase, ownerId } = await authorizedClient();
    if (!/^[0-9a-f-]{36}$/i.test(accountId) || !NETWORKS.includes(network)) return { success: false, error: "La cuenta o red no es válida." };
    const channelId = bufferChannelId.trim();
    if (channelId.length > 200) return { success: false, error: "El ID del canal de Buffer no puede superar 200 caracteres." };
    if (!channelId) {
      const { error } = await supabase.from("account_buffer_channels").delete()
        .eq("owner_id", ownerId).eq("account_id", accountId).eq("network", network);
      if (error) return { success: false, error: "No se pudo eliminar el ID del canal de Buffer." };
      invalidateBufferSyncCache();
      return { success: true };
    }
    const { error } = await supabase.from("account_buffer_channels").upsert({
      owner_id: ownerId,
      account_id: accountId,
      network,
      buffer_channel_id: channelId,
    }, { onConflict: "owner_id,account_id,network" });
    if (error) return { success: false, error: "No se pudo guardar el ID del canal de Buffer." };
    invalidateBufferSyncCache();
    return { success: true };
  } catch (caught) {
    return { success: false, error: caught instanceof Error ? caught.message : "No se pudo guardar el ID del canal de Buffer." };
  }
}

export async function updateAccountVoice(accountId: string, prompt: string): Promise<ActionOutcome> {
  try {
    const { supabase } = await authorizedClient();
    if (prompt.length > 2000) return { success: false, error: "El prompt de estilo no puede superar los 2.000 caracteres." };
    const { error } = await supabase.from("accounts").update({ voice_prompt: prompt }).eq("id", accountId);
    if (error) return { success: false, error: "No se pudo guardar la voz de la cuenta." };
    return { success: true };
  } catch (caught) {
    return { success: false, error: caught instanceof Error ? caught.message : "No se pudo guardar la voz de la cuenta." };
  }
}

export async function updatePublishingMode(mode: "review" | "automatic"): Promise<ActionOutcome> {
  try {
    const { supabase, ownerId } = await authorizedClient();
    const { error } = await supabase.from("app_settings").upsert({
      owner_id: ownerId,
      key: "publishing_mode",
      value: { mode },
    }, { onConflict: "owner_id,key" });
    if (error) return { success: false, error: "No se pudo guardar el modo de publicación." };
    return { success: true };
  } catch (caught) {
    return { success: false, error: caught instanceof Error ? caught.message : "No se pudo guardar el modo de publicación." };
  }
}

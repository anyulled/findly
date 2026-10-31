"use server";

import { createClient } from "@/lib/supabase/server";
import { formatMadridDateTime, madridDateTimeToIso } from "@/lib/madrid-time";
import { validatePost, type SocialNetwork } from "@/lib/social-validation";
import { detectTitleLanguage, type PostLanguage } from "@/lib/language";
import { generateSocialPost } from "@/lib/groq";
import { generateEventDrafts } from "@/lib/groq-workflow";
import { approveAndSchedulePost, schedulePostWithSupabase, type PostPublishingOutcome } from "@/lib/post-publishing";
import { MANAGED_ACCOUNTS, managedAccount } from "@/lib/managed-accounts";
import { bufferCredentialForAccount } from "@/lib/buffer-account-credentials";
import { sourceForEventUrl } from "@/lib/event-source";
import { selectEventAccounts } from "@/lib/event-targets";

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

export type SourceType = "luma_ical" | "meetup";

export type SourceView = {
  id: string;
  name: string;
  type: SourceType;
  url: string;
  enabled: boolean;
  accountIds: string[];
};

export type SourceInput = Omit<SourceView, "id">;

export type WorkspaceSnapshot = {
  accounts: AccountView[];
  events: EventView[];
  posts: PostView[];
  sources: SourceView[];
  mode: "review" | "automatic";
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
  return { supabase, ownerId: user.id };
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
  const { supabase, ownerId } = await authorizedClient();
  let accountResult = await supabase.from("accounts").select("id,name,account_type,voice_prompt,networks,enabled").order("created_at");
  if (accountResult.error) throw new Error("No se pudieron cargar las cuentas.");
  if ((accountResult.data ?? []).length === 0) {
    accountResult = await supabase.from("accounts").insert(DEFAULT_ACCOUNTS.map((account) => ({ ...account, owner_id: ownerId })))
      .select("id,name,account_type,voice_prompt,networks,enabled").order("created_at");
    if (accountResult.error) throw new Error("No se pudieron crear las cuentas iniciales.");
  }
  const rows = accountResult.data ?? [];
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
    return {
      id: row.id,
      title: row.title,
      date: scheduled.date,
      time: scheduled.time,
      place: row.location,
      description: row.description,
      source: sourceForUrl(row.event_url),
      sourceId: row.source_id,
      url: row.event_url ?? undefined,
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
    if (row.source_type !== "luma_ical" && row.source_type !== "meetup") return [];
    return [{ id: row.id, name: row.name, type: row.source_type, url: row.feed_url ?? "", enabled: row.enabled, accountIds: accountIdsBySource.get(row.id) ?? [] }];
  });
  return { accounts: accountsWithChannels, events, posts, sources, mode: settings?.mode === "automatic" ? "automatic" : "review" };
}

function validateSource(input: SourceInput): SourceInput {
  if (!input || typeof input.name !== "string" || typeof input.url !== "string" || !Array.isArray(input.accountIds)) {
    throw new Error("Los datos de la fuente no son válidos.");
  }
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error("El nombre de la fuente debe tener entre 1 y 120 caracteres.");
  if (input.type !== "luma_ical" && input.type !== "meetup") throw new Error("El tipo de fuente no es válido.");
  let parsed: URL;
  try { parsed = new URL(input.url.trim()); }
  catch { throw new Error("Introduce una URL válida para la fuente."); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("La URL debe usar HTTP o HTTPS.");
  if (input.type === "meetup" && parsed.hostname !== "meetup.com" && !parsed.hostname.endsWith(".meetup.com")) {
    throw new Error("La URL de Meetup debe pertenecer a meetup.com.");
  }
  const accountIds = [...new Set(input.accountIds)];
  if (accountIds.length === 0 || accountIds.length > 20 || accountIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
    throw new Error("Asocia la fuente al menos con una cuenta válida.");
  }
  return { ...input, name, url: parsed.toString(), accountIds };
}

export async function saveSource(input: SourceInput, sourceId?: string): Promise<SourceView> {
  const { supabase } = await authorizedClient();
  const source = validateSource(input);
  if (sourceId && !/^[0-9a-f-]{36}$/i.test(sourceId)) throw new Error("La fuente no es válida.");
  const { data: result, error } = await supabase.rpc("save_source", {
    p_source_id: sourceId ?? null,
    p_name: source.name,
    p_source_type: source.type,
    p_feed_url: source.url,
    p_enabled: source.enabled,
    p_account_ids: source.accountIds,
  }).single();
  const data = result as { id: string; name: string; source_type: SourceType; feed_url: string; enabled: boolean; account_ids: string[] } | null;
  if (error || !data) throw new Error("No se pudo guardar la fuente y sus cuentas asociadas. Comprueba que has aplicado las migraciones.");
  return {
    id: data.id,
    name: data.name,
    type: data.source_type,
    url: data.feed_url,
    enabled: data.enabled,
    accountIds: data.account_ids ?? [],
  };
}

export async function setSourceEnabled(sourceId: string, enabled: boolean): Promise<void> {
  const { supabase } = await authorizedClient();
  if (!/^[0-9a-f-]{36}$/i.test(sourceId) || typeof enabled !== "boolean") throw new Error("La fuente no es válida.");
  const { data, error } = await supabase.from("sources").update({ enabled }).eq("id", sourceId).select("id").single();
  if (error || !data) throw new Error("No se pudo actualizar la fuente.");
}

export async function deleteSource(sourceId: string): Promise<void> {
  const { supabase } = await authorizedClient();
  if (!/^[0-9a-f-]{36}$/i.test(sourceId)) throw new Error("La fuente no es válida.");
  const { data, error } = await supabase.from("sources").delete().eq("id", sourceId).select("id").single();
  if (error || !data) throw new Error("No se pudo eliminar la fuente.");
}

export async function createEvent(input: Omit<EventView, "id">): Promise<EventView> {
  const { supabase, ownerId } = await authorizedClient();
  const title = input.title.trim();
  if (!title || title.length > 200 || !input.date || !input.time) throw new Error("Completa título, fecha y hora del evento.");
  let url: string | null = null;
  if (input.url) {
    try {
      const parsed = new URL(input.url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
      url = parsed.toString();
    } catch { throw new Error("El enlace del evento debe ser una URL HTTP o HTTPS válida."); }
  }
  const startsAt = madridDateTimeToIso(input.date, input.time);
  const { data, error } = await supabase.from("events").insert({
    owner_id: ownerId,
    title,
    starts_at: startsAt,
    timezone: "Europe/Madrid",
    location: input.place.trim(),
    description: input.description.trim(),
    event_url: url,
    detected_language: detectTitleLanguage(title),
  }).select("id,title,starts_at,location,description,event_url,detected_language,source_id").single();
  if (error || !data) throw new Error("No se pudo guardar el evento en Supabase.");
  const scheduled = formatMadridDateTime(data.starts_at);
  return {
    id: data.id,
    title: data.title,
    date: scheduled.date,
    time: scheduled.time,
    place: data.location,
    description: data.description,
    source: sourceForUrl(data.event_url),
    sourceId: data.source_id,
    url: data.event_url ?? undefined,
    language: data.detected_language as PostLanguage,
  };
}

export async function generateReviewPosts(eventId: string): Promise<PostView[]> {
  const { supabase, ownerId } = await authorizedClient();
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) throw new Error("Solicitud de publicaciones no válida.");

  const [eventResult, accountResult, existingResult, settingsResult] = await Promise.all([
    supabase.from("events").select("id,title,starts_at,location,description,event_url,detected_language,source_id")
      .eq("id", eventId).eq("owner_id", ownerId).single(),
    supabase.from("accounts").select("id,name,voice_prompt,networks").eq("owner_id", ownerId).eq("enabled", true).order("created_at"),
    supabase.from("posts").select("account_id,network,lead_days").eq("owner_id", ownerId).eq("event_id", eventId),
    supabase.from("app_settings").select("value").eq("owner_id", ownerId).eq("key", "publishing_mode").maybeSingle(),
  ]);
  if (eventResult.error || !eventResult.data) throw new Error("No se encontró el evento en este espacio.");
  if (accountResult.error || !accountResult.data) throw new Error("No se pudieron cargar las cuentas.");
  if (existingResult.error || !existingResult.data) throw new Error("No se pudo comprobar si ya existen recordatorios.");
  if (settingsResult.error) throw new Error("No se pudo cargar el modo de publicación.");

  let sourceLinks: { sourceId: string; accountId: string }[] = [];
  if (eventResult.data.source_id) {
    const { data, error } = await supabase.from("source_accounts").select("source_id,account_id")
      .eq("owner_id", ownerId).eq("source_id", eventResult.data.source_id);
    if (error) throw new Error("No se pudieron cargar las cuentas asociadas a la fuente.");
    sourceLinks = (data ?? []).map((link) => ({ sourceId: link.source_id, accountId: link.account_id }));
  }
  const eligibleAccounts = selectEventAccounts(accountResult.data, eventResult.data.source_id, sourceLinks);
  const accountIds = eligibleAccounts.map((account) => account.id);
  const exampleResult = accountIds.length === 0
    ? { data: [], error: null }
    : await supabase.from("style_examples").select("content,account_id,network,language")
      .eq("owner_id", ownerId).in("account_id", accountIds).order("created_at", { ascending: false }).limit(72);
  if (exampleResult.error || !exampleResult.data) throw new Error("No se pudieron cargar los ejemplos de estilo aprobados.");

  const eventTime = formatMadridDateTime(eventResult.data.starts_at);
  const drafts = await generateEventDrafts({
    event: {
      id: eventResult.data.id,
      title: eventResult.data.title,
      date: eventTime.date,
      time: eventTime.time,
      place: eventResult.data.location,
      description: eventResult.data.description,
      url: eventResult.data.event_url ?? undefined,
      language: eventResult.data.detected_language as PostLanguage,
    },
    accounts: eligibleAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      voice: account.voice_prompt,
      networks: account.networks.filter((network: string): network is SocialNetwork => NETWORKS.includes(network as SocialNetwork)),
    })),
    approvedExamples: exampleResult.data.flatMap((example) => {
      if (!NETWORKS.includes(example.network as SocialNetwork) || !["en", "es", "ca"].includes(example.language)) return [];
      return [{ accountId: example.account_id, network: example.network as SocialNetwork, language: example.language as PostLanguage, text: example.content }];
    }),
    existing: existingResult.data.flatMap((post) => {
      if (!NETWORKS.includes(post.network as SocialNetwork)) return [];
      return [{ accountId: post.account_id, network: post.network as SocialNetwork, leadDays: post.lead_days }];
    }),
    generate: generateSocialPost,
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
      status: automatic ? "approved" : "review",
      language: post.language,
    };
  });
  let insertedIds: string[] = [];
  if (rows.length > 0) {
    const { data: inserted, error: upsertError } = await supabase.from("posts").upsert(rows, {
      onConflict: "event_id,account_id,network,lead_days",
      ignoreDuplicates: true,
    }).select("id");
    if (upsertError) throw new Error("No se pudieron guardar las publicaciones pendientes.");
    insertedIds = (inserted ?? []).map((row) => row.id);
  }
  if (automatic) {
    for (const postId of insertedIds) {
      await schedulePostWithSupabase(postId, supabase, ownerId);
    }
  }

  const { data, error } = await supabase.from("posts").select("id,event_id,account_id,network,lead_days,due_at,content,status,language,last_error,buffer_post_id")
    .eq("owner_id", ownerId).eq("event_id", eventId).order("due_at");
  if (error || !data) throw new Error("No se pudieron recuperar las publicaciones pendientes.");
  const accountNames = new Map(accountResult.data.map((account) => [account.id, account.name]));
  return data.flatMap((row) => {
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
}

export async function updatePostContent(postId: string, content: string): Promise<void> {
  const { supabase } = await authorizedClient();
  if (!content.trim()) throw new Error("El texto de la publicación no puede estar vacío.");
  const current = await supabase.from("posts").select("network").eq("id", postId).single();
  if (current.error || !NETWORKS.includes(current.data.network as SocialNetwork)) throw new Error("No se pudo comprobar la red de la publicación.");
  const validation = validatePost(current.data.network as SocialNetwork, content);
  if (!validation.valid) throw new Error(validation.message);
  const { error } = await supabase.rpc("update_post_content", { p_post_id: postId, p_content: content });
  if (error) throw new Error("No se pudo guardar la publicación. Comprueba que has aplicado las migraciones.");
}

export async function approvePost(postId: string, content: string): Promise<PostPublishingOutcome> {
  const { supabase, ownerId } = await authorizedClient();
  const validationNetwork = await supabase.from("posts").select("network").eq("id", postId).single();
  if (validationNetwork.error || !NETWORKS.includes(validationNetwork.data.network as SocialNetwork)) {
    throw new Error("No se pudo comprobar la red de la publicación.");
  }
  const validation = validatePost(validationNetwork.data.network as SocialNetwork, content);
  if (!validation.valid) throw new Error(validation.message);
  return approveAndSchedulePost(postId, content, supabase, ownerId);
}

export async function retryFailedPost(postId: string): Promise<PostPublishingOutcome> {
  const { supabase, ownerId } = await authorizedClient();
  if (!/^[0-9a-f-]{36}$/i.test(postId)) throw new Error("Solicitud de publicación no válida.");
  return schedulePostWithSupabase(postId, supabase, ownerId);
}

export async function reconcileScheduledPost(postId: string, bufferPostId: string): Promise<void> {
  const { supabase, ownerId } = await authorizedClient();
  if (!/^[0-9a-f-]{36}$/i.test(postId)) throw new Error("Solicitud de publicación no válida.");
  const normalizedId = bufferPostId.trim();
  if (!normalizedId || normalizedId.length > 200) throw new Error("Introduce el ID del post confirmado en Buffer.");
  const { error } = await supabase.rpc("reconcile_post_scheduled", {
    p_post_id: postId,
    p_buffer_post_id: normalizedId,
    p_owner_id: ownerId,
  });
  if (error) throw new Error("No se pudo confirmar la programación conciliada.");
}

export async function confirmPostMissingFromBuffer(postId: string): Promise<void> {
  const { supabase, ownerId } = await authorizedClient();
  if (!/^[0-9a-f-]{36}$/i.test(postId)) throw new Error("Solicitud de publicación no válida.");
  const { error } = await supabase.rpc("reconcile_post_missing", {
    p_post_id: postId,
    p_owner_id: ownerId,
  });
  if (error) throw new Error("No se pudo guardar la conciliación de ausencia.");
}

export async function saveBufferChannel(accountId: string, network: SocialNetwork, bufferChannelId: string): Promise<void> {
  const { supabase, ownerId } = await authorizedClient();
  if (!/^[0-9a-f-]{36}$/i.test(accountId) || !NETWORKS.includes(network)) throw new Error("La cuenta o red no es válida.");
  const channelId = bufferChannelId.trim();
  if (channelId.length > 200) throw new Error("El ID del canal de Buffer no puede superar 200 caracteres.");
  if (!channelId) {
    const { error } = await supabase.from("account_buffer_channels").delete()
      .eq("owner_id", ownerId).eq("account_id", accountId).eq("network", network);
    if (error) throw new Error("No se pudo eliminar el ID del canal de Buffer.");
    return;
  }
  const { error } = await supabase.from("account_buffer_channels").upsert({
    owner_id: ownerId,
    account_id: accountId,
    network,
    buffer_channel_id: channelId,
  }, { onConflict: "owner_id,account_id,network" });
  if (error) throw new Error("No se pudo guardar el ID del canal de Buffer.");
}

export async function updateAccountVoice(accountId: string, prompt: string): Promise<void> {
  const { supabase } = await authorizedClient();
  if (prompt.length > 2000) throw new Error("El prompt de estilo no puede superar los 2.000 caracteres.");
  const { error } = await supabase.from("accounts").update({ voice_prompt: prompt }).eq("id", accountId);
  if (error) throw new Error("No se pudo guardar la voz de la cuenta.");
}

export async function updatePublishingMode(mode: "review" | "automatic"): Promise<void> {
  const { supabase, ownerId } = await authorizedClient();
  const { error } = await supabase.from("app_settings").upsert({
    owner_id: ownerId,
    key: "publishing_mode",
    value: { mode },
  }, { onConflict: "owner_id,key" });
  if (error) throw new Error("No se pudo guardar el modo de publicación.");
}

"use server";

import { createClient } from "@/lib/supabase/server";
import { formatMadridDateTime, madridDateTimeToIso } from "@/lib/madrid-time";
import { validatePost, type SocialNetwork } from "@/lib/social-validation";
import { detectTitleLanguage, type PostLanguage } from "@/lib/language";

export type AccountView = {
  id?: string;
  name: string;
  kind: string;
  initials: string;
  color: string;
  prompt: string;
  networks: SocialNetwork[];
};

export type EventView = {
  id: string;
  title: string;
  date: string;
  time: string;
  place: string;
  description: string;
  source: string;
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
  status: "review" | "approved" | "scheduled";
  leadDays?: 14 | 7 | 1;
  language?: PostLanguage;
};

export type WorkspaceSnapshot = {
  accounts: AccountView[];
  events: EventView[];
  posts: PostView[];
  mode: "review" | "automatic";
};

const DEFAULT_ACCOUNTS = [
  { name: "Alex · personal", account_type: "personal", voice_prompt: "Cercano, curioso y directo. Primera persona. Evita sonar promocional.", networks: ["LinkedIn", "X", "Bluesky"] },
  { name: "BarcelonaJS", account_type: "association", voice_prompt: "Comunidad tecnológica abierta. Entusiasta, inclusiva y concreta.", networks: ["LinkedIn", "X"] },
  { name: "DevBcn", account_type: "association", voice_prompt: "Tono profesional y acogedor. Destaca la comunidad y el aprendizaje.", networks: ["LinkedIn", "Bluesky"] },
] as const;
const ACCOUNT_COLORS = ["violet", "orange", "green"];
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

function accountView(row: { id: string; name: string; account_type: string; voice_prompt: string; networks: string[] }, index: number): AccountView {
  const networks = row.networks.filter((network): network is SocialNetwork => NETWORKS.includes(network as SocialNetwork));
  return {
    id: row.id,
    name: row.name,
    kind: row.account_type === "personal" ? "Cuenta personal" : "Asociación",
    initials: row.name.trim().slice(0, 1).toUpperCase(),
    color: ACCOUNT_COLORS[index % ACCOUNT_COLORS.length],
    prompt: row.voice_prompt,
    networks,
  };
}

function sourceForUrl(value: string | null): string {
  if (!value) return "Manual";
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (hostname === "lu.ma" || hostname.endsWith(".lu.ma")) return "Luma";
    if (hostname === "meetup.com" || hostname.endsWith(".meetup.com")) return "Meetup";
  } catch { /* Invalid URLs are not used as external source identities. */ }
  return "Manual";
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  const { supabase, ownerId } = await authorizedClient();
  let accountResult = await supabase.from("accounts").select("id,name,account_type,voice_prompt,networks").order("created_at");
  if (accountResult.error) throw new Error("No se pudieron cargar las cuentas.");
  if ((accountResult.data ?? []).length === 0) {
    accountResult = await supabase.from("accounts").insert(DEFAULT_ACCOUNTS.map((account) => ({ ...account, owner_id: ownerId })))
      .select("id,name,account_type,voice_prompt,networks").order("created_at");
    if (accountResult.error) throw new Error("No se pudieron crear las cuentas iniciales.");
  }
  const rows = accountResult.data ?? [];
  const accounts = rows.map((row, index) => accountView(row, index));
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));

  const [eventsResult, postsResult, settingsResult] = await Promise.all([
    supabase.from("events").select("id,title,starts_at,location,description,event_url,detected_language").order("starts_at"),
    supabase.from("posts").select("id,event_id,account_id,network,lead_days,due_at,content,status,language").order("due_at"),
    supabase.from("app_settings").select("value").eq("key", "publishing_mode").maybeSingle(),
  ]);
  if (eventsResult.error || postsResult.error || settingsResult.error) {
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
      url: row.event_url ?? undefined,
      language: row.detected_language as PostLanguage,
    };
  });
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
      leadDays: row.lead_days as PostView["leadDays"],
      language: row.language as PostLanguage,
    }];
  });
  const settings = settingsResult.data?.value as { mode?: string } | null;
  return { accounts, events, posts, mode: settings?.mode === "automatic" ? "automatic" : "review" };
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
  }).select("id,title,starts_at,location,description,event_url,detected_language").single();
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
    url: data.event_url ?? undefined,
    language: data.detected_language as PostLanguage,
  };
}

export async function createReviewPosts(eventId: string, posts: PostView[]): Promise<PostView[]> {
  const { supabase, ownerId } = await authorizedClient();
  if (!/^[0-9a-f-]{36}$/i.test(eventId) || posts.length > 24) throw new Error("Solicitud de publicaciones no válida.");
  const rows = posts.map((post) => {
    if (!post.accountId || !NETWORKS.includes(post.network) || ![14, 7, 1].includes(post.leadDays ?? 0)) {
      throw new Error("Faltan datos de cuenta, red o fecha para una publicación.");
    }
    if (post.time !== "13:00") throw new Error("Las publicaciones deben programarse a las 13:00 de Madrid.");
    const validation = validatePost(post.network, post.text);
    if (!validation.valid) throw new Error(validation.message);
    const dueAt = madridDateTimeToIso(post.date, post.time);
    if (Date.parse(dueAt) <= Date.now()) throw new Error("No se guardan recordatorios cuya hora de publicación ya ha pasado.");
    return {
      owner_id: ownerId,
      event_id: eventId,
      account_id: post.accountId,
      network: post.network,
      lead_days: post.leadDays,
      due_at: dueAt,
      timezone: "Europe/Madrid",
      content: post.text,
      status: "review",
      language: post.language ?? "en",
    };
  });
  if (rows.length === 0) return [];
  const { error: upsertError } = await supabase.from("posts").upsert(rows, {
    onConflict: "event_id,account_id,network,lead_days",
    ignoreDuplicates: true,
  });
  if (upsertError) throw new Error("No se pudieron guardar las publicaciones pendientes.");
  const { data, error } = await supabase.from("posts").select("id,event_id,account_id,network,lead_days,due_at,content,status,language")
    .eq("event_id", eventId).order("due_at");
  if (error || !data) throw new Error("No se pudieron recuperar las publicaciones pendientes.");
  const accountNames = new Map(posts.map((post) => [post.accountId, post.account]));
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

export async function approvePost(postId: string, content: string): Promise<void> {
  const { supabase } = await authorizedClient();
  const validationNetwork = await supabase.from("posts").select("network").eq("id", postId).single();
  if (validationNetwork.error || !NETWORKS.includes(validationNetwork.data.network as SocialNetwork)) {
    throw new Error("No se pudo comprobar la red de la publicación.");
  }
  const validation = validatePost(validationNetwork.data.network as SocialNetwork, content);
  if (!validation.valid) throw new Error(validation.message);
  const { error } = await supabase.rpc("approve_post", { p_post_id: postId, p_content: content });
  if (error) throw new Error("No se pudo aprobar la publicación y guardar su ejemplo de estilo.");
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

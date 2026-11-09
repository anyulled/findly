import { generateSocialPost, type ApprovedStyleExample, type GeneratedPost, type LLMAttemptRecord } from "./groq";
import { generateEventDrafts, type ExistingReminder, type GenerationAccount } from "./groq-workflow";
import { formatMadridDateTime, madridDateTimeToIso } from "./madrid-time";
import { validatePost, NETWORKS, type SocialNetwork } from "./social-validation";
import type { PostLanguage } from "./language";
import { buildStyleExampleSegments, type StyleExampleQueryContext } from "./style-examples";
import { isSubstackUrl, unpackLocationAndImage } from "./substack";
import { fetchNextChannelSlotsForAccount } from "./buffer-sync";
import { bufferCredentialForAccount } from "./buffer-account-credentials";

export type ImportedLumaEvent = {
  id: string;
  owner_id: string;
  source_id?: string | null;
  target_account_ids?: string[] | null;
  external_id?: string;
  title: string;
  starts_at: string;
  location: string;
  description: string;
  event_url: string | null;
  detected_language: PostLanguage;
};

export type LLMLogRow = {
  owner_id: string;
  event_id?: string | null;
  provider: "groq" | "openai" | "fallback";
  model: string;
  status: "success" | "error";
  error_code?: string | null;
  latency_ms?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
};

export type LumaDraftRow = {
  owner_id: string;
  event_id: string;
  account_id: string;
  network: SocialNetwork;
  lead_days: 14 | 7 | 1;
  due_at: string;
  timezone: "Europe/Madrid";
  content: string;
  status: "review" | "approved";
  language: PostLanguage;
  generation_origin?: "groq" | "openai" | "fallback";
  generation_error_code?: GeneratedPost["generationError"];
  last_error?: string | null;
};

export type LumaDraftRepository = {
  listLinkedAccounts(ownerId: string, sourceId?: string | null, selectedAccountIds?: string[] | null): Promise<GenerationAccount[]>;
  listExistingReminders(ownerId: string, eventId: string): Promise<ExistingReminder[]>;
  listApprovedExamples(
    ownerId: string,
    accountIds: string[],
    context?: StyleExampleQueryContext,
  ): Promise<ApprovedStyleExample[]>;
  insertDrafts(rows: LumaDraftRow[]): Promise<number>;
  insertLLMLogs?(rows: LLMLogRow[]): Promise<void>;
  getPublishingMode?(ownerId: string): Promise<"review" | "automatic">;
  scheduleAutomaticPosts?(ownerId: string, eventId: string, accountIds: string[]): Promise<void>;
};

export type SocialPostGenerator = (
  input: Parameters<typeof generateSocialPost>[0],
  config?: { onAttempt?: (attempt: LLMAttemptRecord) => void | Promise<void> },
) => Promise<GeneratedPost | { text: string }>;

export function toAttemptLogRow(ownerId: string, eventId: string, attempt: LLMAttemptRecord): LLMLogRow {
  return {
    owner_id: ownerId,
    event_id: eventId,
    provider: attempt.provider,
    model: attempt.model,
    status: attempt.status,
    error_code: attempt.errorCode || null,
    latency_ms: attempt.latencyMs || null,
    prompt_tokens: attempt.promptTokens || null,
    completion_tokens: attempt.completionTokens || null,
    total_tokens: attempt.totalTokens || null,
  };
}

function resolvePostProvider(res: GeneratedPost | { text: string }): "groq" | "openai" | "fallback" {
  if ("provider" in res && res.provider) return res.provider;
  if ("model" in res && res.model === "fallback") return "fallback";
  return "groq";
}

function toDirectLogRow(ownerId: string, eventId: string, res: GeneratedPost | { text: string }): LLMLogRow | null {
  if (!("model" in res)) return null;
  const post = res as GeneratedPost;
  return {
    owner_id: ownerId,
    event_id: eventId,
    provider: resolvePostProvider(res),
    model: post.model,
    status: "success",
    error_code: post.generationError || null,
    latency_ms: post.latencyMs || null,
  };
}

export function createTrackingGenerator(
  generate: SocialPostGenerator,
  ownerId: string,
  eventId: string,
  logs: LLMLogRow[],
): SocialPostGenerator {
  return async (genInput) => {
    let capturedDuringCall = false;
    const res = await generate(genInput, {
      onAttempt: (attempt) => {
        capturedDuringCall = true;
        logs.push(toAttemptLogRow(ownerId, eventId, attempt));
      },
    });
    if (!capturedDuringCall) {
      const fallbackLog = toDirectLogRow(ownerId, eventId, res);
      if (fallbackLog) logs.push(fallbackLog);
    }
    return res;
  };
}

async function resolveSubstackSlots(
  accounts: GenerationAccount[],
  now: Date,
): Promise<Record<string, { date: string; time: string }>> {
  const slotByAccountNetwork: Record<string, { date: string; time: string }> = {};
  for (const account of accounts) {
    const networks = account.networks.filter((network): network is SocialNetwork => NETWORKS.includes(network));
    const apiKey = bufferCredentialForAccount(account.name).apiKey;
    const slots = await fetchNextChannelSlotsForAccount(apiKey, networks, {}, fetch, now);
    for (const network of networks) {
      slotByAccountNetwork[`${account.id}:${network}`] = slots[network];
    }
  }
  return slotByAccountNetwork;
}

/** Generate and persist review drafts for one newly inserted Luma event. */
export async function generateLumaEventDrafts(
  event: ImportedLumaEvent,
  repository: LumaDraftRepository,
  generate: SocialPostGenerator = generateSocialPost,
  now = new Date(),
): Promise<number> {
  const accounts = await repository.listLinkedAccounts(event.owner_id, event.source_id, event.target_account_ids);
  if (accounts.length === 0) return 0;
  const accountIds = accounts.map((account) => account.id);
  const segments = buildStyleExampleSegments(
    accounts.map((account) => ({
      id: account.id,
      networks: account.networks.filter((network): network is SocialNetwork => NETWORKS.includes(network)),
    })),
    [event.detected_language],
  );
  const [existing, approvedExamples] = await Promise.all([
    repository.listExistingReminders(event.owner_id, event.id),
    repository.listApprovedExamples(event.owner_id, accountIds, {
      language: event.detected_language,
      segments,
    }),
  ]);
  const publishingMode = await repository.getPublishingMode?.(event.owner_id) ?? "review";
  const eventTime = formatMadridDateTime(event.starts_at);
  const { place } = unpackLocationAndImage(event.location);
  const slotByAccountNetwork = isSubstackUrl(event.event_url)
    ? await resolveSubstackSlots(accounts, now)
    : {};
  const attemptLogs: LLMLogRow[] = [];
  const trackingGenerate = createTrackingGenerator(generate, event.owner_id, event.id, attemptLogs);

  const drafts = await generateEventDrafts({
    event: {
      id: event.id,
      title: event.title,
      date: eventTime.date,
      time: eventTime.time,
      place,
      description: event.description,
      url: event.event_url ?? undefined,
      language: event.detected_language,
    },
    accounts: accounts.map((account) => ({
      ...account,
      networks: account.networks.filter((network): network is SocialNetwork => NETWORKS.includes(network)),
    })),
    approvedExamples,
    existing,
    now,
    slotByAccountNetwork,
    generate: trackingGenerate,
  });

  if (attemptLogs.length > 0 && repository.insertLLMLogs) {
    await repository.insertLLMLogs(attemptLogs);
  }

  const rows = drafts.map((draft): LumaDraftRow => {
    const validation = validatePost(draft.network, draft.text);
    if (!validation.valid) throw new Error("Generated draft failed deterministic validation.");
    return {
      owner_id: event.owner_id,
      event_id: event.id,
      account_id: draft.accountId,
      network: draft.network,
      lead_days: draft.leadDays,
      due_at: madridDateTimeToIso(draft.date, draft.time),
      timezone: "Europe/Madrid",
      content: draft.text,
      status: publishingMode === "automatic" && !draft.isFallback ? "approved" : "review",
      language: draft.language,
      ...(draft.generationOrigin ? { generation_origin: draft.generationOrigin } : {}),
      ...(draft.generationError ? { generation_error_code: draft.generationError } : {}),
      last_error: draft.isFallback
        ? "Generado con plantilla de respaldo (la generación con IA no estuvo disponible o no superó la validación)."
        : null,
    };
  });
  const inserted = rows.length > 0 ? await repository.insertDrafts(rows) : 0;
  if (publishingMode === "automatic") {
    await repository.scheduleAutomaticPosts?.(event.owner_id, event.id, accountIds);
  }
  return inserted;
}

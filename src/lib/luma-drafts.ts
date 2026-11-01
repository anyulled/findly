import { generateSocialPost, type ApprovedStyleExample, type GeneratedPost } from "./groq";
import { generateEventDrafts, type ExistingReminder, type GenerationAccount } from "./groq-workflow";
import { formatMadridDateTime, madridDateTimeToIso } from "./madrid-time";
import { validatePost, NETWORKS, type SocialNetwork } from "./social-validation";
import type { PostLanguage } from "./language";
import { isSubstackUrl, unpackLocationAndImage } from "./substack";
import { fetchNextChannelSlotsForAccount } from "./buffer-sync";
import { bufferCredentialForAccount } from "./buffer-account-credentials";

export type ImportedLumaEvent = {
  id: string;
  owner_id: string;
  source_id?: string | null;
  external_id?: string;
  title: string;
  starts_at: string;
  location: string;
  description: string;
  event_url: string | null;
  detected_language: PostLanguage;
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
};

export type LumaDraftRepository = {
  listLinkedAccounts(ownerId: string, sourceId?: string | null): Promise<GenerationAccount[]>;
  listExistingReminders(ownerId: string, eventId: string): Promise<ExistingReminder[]>;
  listApprovedExamples(ownerId: string, accountIds: string[]): Promise<ApprovedStyleExample[]>;
  insertDrafts(rows: LumaDraftRow[]): Promise<number>;
  getPublishingMode?(ownerId: string): Promise<"review" | "automatic">;
  scheduleAutomaticPosts?(ownerId: string, eventId: string, accountIds: string[]): Promise<void>;
};

export type SocialPostGenerator = (input: Parameters<typeof generateSocialPost>[0]) => Promise<GeneratedPost | { text: string }>;

/** Generate and persist review drafts for one newly inserted Luma event. */
export async function generateLumaEventDrafts(
  event: ImportedLumaEvent,
  repository: LumaDraftRepository,
  generate: SocialPostGenerator = generateSocialPost,
  now = new Date(),
): Promise<number> {
  const accounts = await repository.listLinkedAccounts(event.owner_id, event.source_id);
  if (accounts.length === 0) return 0;
  const accountIds = accounts.map((account) => account.id);
  const [existing, approvedExamples] = await Promise.all([
    repository.listExistingReminders(event.owner_id, event.id),
    repository.listApprovedExamples(event.owner_id, accountIds),
  ]);
  const publishingMode = await repository.getPublishingMode?.(event.owner_id) ?? "review";
  const eventTime = formatMadridDateTime(event.starts_at);
  const { place } = unpackLocationAndImage(event.location);
  const slotByAccountNetwork: Record<string, { date: string; time: string }> = {};
  if (isSubstackUrl(event.event_url)) {
    for (const account of accounts) {
      const networks = account.networks.filter((network): network is SocialNetwork => NETWORKS.includes(network));
      const apiKey = bufferCredentialForAccount(account.name).apiKey;
      const slots = await fetchNextChannelSlotsForAccount(apiKey, networks, {}, fetch, now);
      for (const network of networks) {
        slotByAccountNetwork[`${account.id}:${network}`] = slots[network];
      }
    }
  }
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
    generate,
  });

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
    };
  });
  const inserted = rows.length > 0 ? await repository.insertDrafts(rows) : 0;
  if (publishingMode === "automatic") {
    await repository.scheduleAutomaticPosts?.(event.owner_id, event.id, accountIds);
  }
  return inserted;
}

import { detectTitleLanguage, type PostLanguage } from "./language";
import { madridDateTimeToIso } from "./madrid-time";
import { computeNextSlotFromSchedule } from "./buffer-sync";
import { isSubstackUrl } from "./substack";
import type { ApprovedStyleExample, GeneratedPost, PostGenerationInput } from "./groq";
import type { SocialNetwork } from "./social-validation";

const REMINDER_DAYS = [14, 7, 1] as const;
// The configured maximum is 3 accounts × 3 networks × 3 reminder offsets.
const MAX_GENERATED_POSTS = 27;
const GENERATION_CONCURRENCY = 4;

export type GenerationAccount = {
  id: string;
  name: string;
  voice: string;
  networks: SocialNetwork[];
  kind?: string;
};

export type GenerationEvent = {
  id: string;
  title: string;
  date: string;
  time: string;
  place: string;
  description: string;
  url?: string;
  language?: PostLanguage;
};

export type GeneratedReviewDraft = {
  id: string;
  eventId: string;
  date: string;
  time: string;
  account: string;
  accountId: string;
  network: SocialNetwork;
  text: string;
  status: "review";
  leadDays: 14 | 7 | 1;
  language: PostLanguage;
  isFallback?: boolean;
  generationOrigin?: "groq" | "fallback";
  generationError?: GeneratedPost["generationError"];
};

export type ExistingReminder = {
  accountId: string;
  network: SocialNetwork;
  leadDays: number;
};

type GenerateEventDraftsInput = {
  event: GenerationEvent;
  accounts: GenerationAccount[];
  approvedExamples: ApprovedStyleExample[];
  existing: ExistingReminder[];
  now?: Date;
  slotByAccountNetwork?: Record<string, { date: string; time: string }>;
  generate: (input: PostGenerationInput) => Promise<GeneratedPost | { text: string; model?: string }>;
};

function dateMinusDays(date: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error("Event date must use YYYY-MM-DD.");
  const value = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value.getTime())) throw new Error("Event date is invalid.");
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function reminderKey(accountId: string, network: SocialNetwork, leadDays: number): string {
  return `${accountId}:${network}:${leadDays}`;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let stopped = false;
  let failure: unknown;
  async function worker() {
    while (!stopped) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = await run(items[index]);
      } catch (error) {
        failure ??= error;
        stopped = true;
        return;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failure) throw failure;
  return results;
}

/** Generate future, missing reminders from trusted event/account data. */
export async function generateEventDrafts({
  event,
  accounts,
  approvedExamples,
  existing,
  now = new Date(),
  slotByAccountNetwork,
  generate,
}: GenerateEventDraftsInput): Promise<GeneratedReviewDraft[]> {
  const language = event.language ?? detectTitleLanguage(event.title);
  const existingKeys = new Set(existing.map(({ accountId, network, leadDays }) => reminderKey(accountId, network, leadDays)));
  const isSubstack = isSubstackUrl(event.url);
  const candidates = isSubstack
    ? accounts.flatMap((account) => account.networks.flatMap((network) => {
        const leadDays = 1 as const;
        if (existingKeys.has(reminderKey(account.id, network, leadDays))) return [];
        const slot = slotByAccountNetwork?.[`${account.id}:${network}`]
          ?? computeNextSlotFromSchedule(network, undefined, new Set(), now);
        const matchingExamples = approvedExamples
          .filter((example) => example.accountId === account.id && example.network === network && example.language === language)
          .slice(0, 3);
        return [{ account, network, leadDays, date: slot.date, time: slot.time, matchingExamples }];
      }))
    : REMINDER_DAYS.flatMap((leadDays) => {
        const date = dateMinusDays(event.date, leadDays);
        const dueAt = madridDateTimeToIso(date, "13:00");
        if (Date.parse(dueAt) <= now.getTime()) return [];
        return accounts.flatMap((account) => account.networks.flatMap((network) => {
          if (existingKeys.has(reminderKey(account.id, network, leadDays))) return [];
          const matchingExamples = approvedExamples
            .filter((example) => example.accountId === account.id && example.network === network && example.language === language)
            .slice(0, 3);
          return [{ account, network, leadDays, date, time: "13:00", matchingExamples }];
        }));
      });

  if (candidates.length > MAX_GENERATED_POSTS) {
    throw new Error(`This event would create too many posts (maximum ${MAX_GENERATED_POSTS} per request).`);
  }

  return mapWithConcurrency(candidates, GENERATION_CONCURRENCY, async ({ account, network, leadDays, date, time, matchingExamples }) => {
    const generated = await generate({
      accountId: account.id,
      accountName: account.name,
      accountVoice: account.voice,
      accountKind: account.kind,
      network,
      language,
      event: {
        title: event.title,
        date: event.date,
        time: event.time,
        place: event.place,
        description: event.description,
        url: event.url,
      },
      reminderDays: leadDays,
      approvedExamples: matchingExamples,
    });
    return {
      id: `${event.id}-${date}-${account.id}-${network}`,
      eventId: event.id,
      date,
      time,
      account: account.name,
      accountId: account.id,
      network,
      text: generated.text,
      status: "review" as const,
      leadDays,
      language,
      ...("model" in generated && generated.model ? { generationOrigin: generated.model === "fallback" ? "fallback" as const : "groq" as const } : {}),
      ...("model" in generated && generated.model === "fallback" ? { isFallback: true } : {}),
      ...("generationError" in generated && generated.generationError ? { generationError: generated.generationError } : {}),
    };
  });
}

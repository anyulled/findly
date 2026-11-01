import { detectTitleLanguage } from "@/lib/language";
import { isSubstackUrl } from "@/lib/substack";
import { computeNextSlotFromSchedule } from "@/lib/buffer-sync";
import type { Range, EventItem, Account, Post, Status } from "./workspace-types";
import { defaultAccounts } from "./workspace-types";

export function dateAt(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function dayKey(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

export function monday(d: Date): Date {
  const n = new Date(d);
  n.setDate(n.getDate() - ((n.getDay() + 6) % 7));
  n.setHours(0, 0, 0, 0);
  return n;
}

export function makeDates(anchor: Date, range: Range): Date[] {
  const start =
    range === "Mes"
      ? new Date(anchor.getFullYear(), anchor.getMonth(), 1)
      : monday(anchor);
  if (range === "Mes") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  }
  const count = range === "Semana" ? 7 : range === "Quincena" ? 14 : 42;
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

export function madridClock(): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  return Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  ) as Record<string, string>;
}

export function scheduleDates(eventDate: string): { date: Date; leadDays: 14 | 7 | 1 }[] {
  const event = dateAt(eventDate);
  const madrid = madridClock();
  const today = `${madrid.year}-${madrid.month}-${madrid.day}`;
  const nowMinutes = Number(madrid.hour) * 60 + Number(madrid.minute);
  return ([14, 7, 1] as const)
    .map((leadDays) => {
      const date = new Date(event);
      date.setDate(date.getDate() - leadDays);
      return { date, leadDays };
    })
    .filter(
      ({ date }) =>
        dayKey(date) > today ||
        (dayKey(date) === today && nowMinutes < 13 * 60),
    );
}

function reminderText(title: string, place: string, url: string | undefined, language: string, leadDays: 14 | 7 | 1): string {
  const until =
    language === "en"
      ? leadDays === 14 ? "in two weeks" : leadDays === 7 ? "next week" : "tomorrow"
      : language === "es"
        ? leadDays === 14 ? "dentro de dos semanas" : leadDays === 7 ? "dentro de una semana" : "mañana"
        : leadDays === 14 ? "d’aquí a dues setmanes" : leadDays === 7 ? "d’aquí a una setmana" : "demà";

  const cleanUrl = url ?? "";
  if (language === "en") return `Join us ${until} for ${title} in ${place}. See you there! ${cleanUrl}`.trim();
  if (language === "es") return `¡Nos vemos ${until} en ${title}! Te esperamos en ${place}. ${cleanUrl}`.trim();
  return `Ens veiem ${until} a ${title}! T’hi esperem a ${place}. ${cleanUrl}`.trim();
}

export function sortEventsReverseChronological<T extends { date: string; time?: string; id?: string }>(
  events: T[],
): T[] {
  return [...events].sort((a, b) => {
    const dateDiff = (b.date || "").localeCompare(a.date || "");
    if (dateDiff !== 0) return dateDiff;
    const timeDiff = (b.time || "").localeCompare(a.time || "");
    if (timeDiff !== 0) return timeDiff;
    return (b.id || "").localeCompare(a.id || "");
  });
}

export function starterPosts(
  events: EventItem[],
  targetAccounts: Account[] = defaultAccounts,
): Post[] {
  return events.flatMap((event) => {
    const language = event.language ?? detectTitleLanguage(event.title);
    if (event.source === "Substack" || isSubstackUrl(event.url)) {
      return targetAccounts.flatMap((account) =>
        account.networks.map((network) => {
          const slot = computeNextSlotFromSchedule(network, [], new Set());
          const summary = event.description ? ` — ${event.description.slice(0, 120)}` : "";
          const text = `${event.title}${summary} ${event.url ?? ""}`.trim();
          return {
            id: `${event.id}-${slot.date}-${account.initials}-${network}`,
            eventId: event.id,
            date: slot.date,
            time: slot.time,
            account: account.name,
            accountId: account.id,
            network,
            leadDays: 1 as const,
            language,
            text,
            status: "review" as Status,
          };
        }),
      );
    }
    return scheduleDates(event.date).flatMap(({ date, leadDays }) =>
      targetAccounts.flatMap((account) =>
        account.networks.map((network) => ({
          id: `${event.id}-${dayKey(date)}-${account.initials}-${network}`,
          eventId: event.id,
          date: dayKey(date),
          time: "13:00",
          account: account.name,
          accountId: account.id,
          network,
          leadDays,
          language,
          text: reminderText(event.title, event.place, event.url, language, leadDays),
          status: "review" as Status,
        })),
      ),
    );
  });
}

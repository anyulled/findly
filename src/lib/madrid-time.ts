export type MadridDateTime = { date: string; time: string };

const MADRID = "Europe/Madrid";

export function formatMadridDateTime(instant: string | Date): MadridDateTime {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant instanceof Date ? instant : new Date(instant));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function madridOffsetMinutes(instant: Date): number {
  const value = new Intl.DateTimeFormat("en", {
    timeZone: MADRID,
    timeZoneName: "shortOffset",
  }).formatToParts(instant).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(value);
  if (!match) throw new Error(`Unable to read Madrid timezone offset: ${value}`);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (hours * 60 + minutes);
}

/** Convert a Madrid wall-clock date/time to an ISO instant, including DST. */
export function madridDateTimeToIso(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error("Invalid date or time");
  }
  const wallClock = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(wallClock)) throw new Error("Invalid date or time");

  // The reminders always run at 13:00, away from DST gaps and overlaps. The
  // iteration also handles ordinary event start times around the offset change.
  let instant = new Date(wallClock);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const corrected = new Date(wallClock - madridOffsetMinutes(instant) * 60_000);
    if (corrected.getTime() === instant.getTime()) break;
    instant = corrected;
  }
  return instant.toISOString();
}

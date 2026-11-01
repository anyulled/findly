import ICAL from "ical.js";
import { formatMadridDateTime } from "./madrid-time";

const MADRID_TIME_ZONE = "Europe/Madrid";

export type LumaCalendarEvent = {
  uid: string;
  title: string;
  description: string;
  location: string;
  url: string | null;
  startsAt: string;
  date: string;
  time: string;
  allDay: boolean;
};

export type CalendarParseIssue = {
  uid: string | null;
  message: string;
};

export type LumaCalendarParseResult = {
  events: LumaCalendarEvent[];
  issues: CalendarParseIssue[];
};

export class IcalParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IcalParseError";
  }
}

type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function dateTimeParts(time: ICAL.Time): LocalDateTime {
  return {
    year: time.year,
    month: time.month,
    day: time.day,
    hour: time.isDate ? 0 : time.hour,
    minute: time.isDate ? 0 : time.minute,
    second: time.isDate ? 0 : time.second,
  };
}

function utcValue(parts: LocalDateTime): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new IcalParseError(`No se reconoce la zona horaria "${timeZone}".`);
  }
}

function partsInZone(instant: number, format: Intl.DateTimeFormat): LocalDateTime {
  const values = Object.fromEntries(format.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function sameDateTime(left: LocalDateTime, right: LocalDateTime): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day
    && left.hour === right.hour && left.minute === right.minute && left.second === right.second;
}

/** Convert an iCalendar wall-clock time into an instant using an IANA time zone. */
function localTimeToInstant(parts: LocalDateTime, timeZone: string): Date {
  const wallClock = utcValue(parts);
  const format = formatter(timeZone);
  const offsets = new Set<number>();

  // Sample around the target date so both sides of a daylight-saving change
  // are available when resolving ambiguous and nonexistent wall-clock times.
  for (let hours = -72; hours <= 72; hours += 6) {
    const instant = wallClock + hours * 60 * 60 * 1000;
    const local = partsInZone(instant, format);
    offsets.add(utcValue(local) - instant);
  }

  const candidates = [...offsets].map((offset) => {
    const instant = wallClock - offset;
    const local = partsInZone(instant, format);
    return { instant, local, wallDelta: utcValue(local) - wallClock };
  });
  const exact = candidates.filter(({ local }) => sameDateTime(local, parts)).sort((a, b) => a.instant - b.instant);

  // RFC 5545 resolves a repeated wall time to its first occurrence. During a
  // daylight-saving gap, use the pre-gap offset, which maps to the first valid
  // local time after the gap.
  if (exact.length > 0) return new Date(exact[0].instant);
  const afterGap = candidates.filter(({ wallDelta }) => wallDelta > 0).sort((a, b) => a.wallDelta - b.wallDelta);
  if (afterGap.length > 0) return new Date(afterGap[0].instant);

  throw new IcalParseError(`No se pudo interpretar la fecha local en "${timeZone}".`);
}

function eventInstant(calendar: ICAL.Component, property: ICAL.Property, start: ICAL.Time): Date {
  const parts = dateTimeParts(start);
  if (!validDateTime(parts)) throw new IcalParseError("DTSTART contiene una fecha u hora no válida.");
  if (start.isDate) return localTimeToInstant(parts, MADRID_TIME_ZONE);

  const rawTzid = property.getParameter("tzid");
  const tzid = Array.isArray(rawTzid) ? rawTzid[0] : rawTzid;
  if (!tzid && start.zone.tzid.toUpperCase() === "UTC") return start.toJSDate();
  if (!tzid) {
    // RFC 5545 calls a date-time without Z or TZID "floating". Findly treats
    // these as Madrid wall-clock times, matching the application's convention.
    return localTimeToInstant(parts, MADRID_TIME_ZONE);
  }
  if (tzid.toUpperCase() === "UTC") return start.toJSDate();

  const timezone = calendar.getTimeZoneByID(tzid);
  if (timezone) {
    start.zone = timezone;
    return start.toJSDate();
  }

  // Some feeds reference an IANA TZID without embedding VTIMEZONE. Intl has
  // the host's IANA database, so convert the local wall clock directly.
  try {
    return localTimeToInstant(parts, tzid);
  } catch (error) {
    if (error instanceof IcalParseError) throw error;
    throw new IcalParseError(`No se pudo interpretar DTSTART con TZID="${tzid}".`);
  }
}

function validDateTime(parts: LocalDateTime): boolean {
  const date = new Date(utcValue(parts));
  return date.getUTCFullYear() === parts.year && date.getUTCMonth() === parts.month - 1
    && date.getUTCDate() === parts.day && parts.hour >= 0 && parts.hour <= 23
    && parts.minute >= 0 && parts.minute <= 59 && parts.second >= 0 && parts.second <= 59;
}

function validateRawStart(value: unknown): void {
  if (typeof value !== "string") throw new IcalParseError("DTSTART contiene una fecha u hora no válida.");
  const dateTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z?$/i.exec(value);
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const match = dateTime ?? date;
  if (!match) throw new IcalParseError("DTSTART contiene una fecha u hora no válida.");
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  if (!validDateTime({ year: Number(year), month: Number(month), day: Number(day), hour: Number(hour), minute: Number(minute), second: Number(second) })) {
    throw new IcalParseError("DTSTART contiene una fecha u hora no válida.");
  }
}

function textValue(event: ICAL.Component, propertyName: string): string {
  const value = event.getFirstPropertyValue(propertyName);
  return typeof value === "string" ? value.trim() : "";
}

function urlValue(event: ICAL.Component): string | null {
  const value = event.getFirstPropertyValue("url");
  return typeof value === "string" ? value.trim() || null : null;
}

/** Parse VEVENT records into Findly's fields without fetching the feed. */
export function parseLumaIcal(input: string): LumaCalendarParseResult {
  let calendar: ICAL.Component;
  try {
    calendar = ICAL.Component.fromString(input);
  } catch (error) {
    throw new IcalParseError(error instanceof Error ? `iCalendar no válido: ${error.message}` : "iCalendar no válido.");
  }
  if (calendar.name.toLowerCase() !== "vcalendar") {
    throw new IcalParseError("El contenido no contiene un calendario VCALENDAR.");
  }

  const events: LumaCalendarEvent[] = [];
  const issues: CalendarParseIssue[] = [];
  const components = calendar.getAllSubcomponents("vevent");
  for (const component of components) {
    let uid: string | null = null;
    try {
      uid = textValue(component, "uid") || null;
      const title = textValue(component, "summary");
      const startProperty = component.getFirstProperty("dtstart");
      if (!uid || !title || !startProperty) {
        issues.push({ uid, message: "Se omite el evento porque falta UID, SUMMARY o DTSTART." });
        continue;
      }
      validateRawStart(startProperty.toJSON()[3]);
      const start = component.getFirstPropertyValue("dtstart");
      if (!(start instanceof ICAL.Time)) {
        issues.push({ uid, message: "Se omite el evento porque falta UID, SUMMARY o DTSTART." });
        continue;
      }
      const instant = eventInstant(calendar, startProperty!, start);
      const madrid = formatMadridDateTime(instant);
      events.push({
        uid,
        title,
        description: textValue(component, "description"),
        location: textValue(component, "location"),
        url: urlValue(component),
        startsAt: instant.toISOString(),
        date: madrid.date,
        time: madrid.time,
        allDay: start.isDate,
      });
    } catch (error) {
      issues.push({ uid, message: error instanceof Error ? error.message : "No se pudo interpretar el evento." });
    }
  }

  return { events, issues };
}

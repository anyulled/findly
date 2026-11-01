import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IcalParseError, parseLumaIcal } from "../src/lib/luma-ical";

const sample = readFileSync(new URL("./fixtures/luma-sample.ics", import.meta.url), "utf8");

describe("Luma iCalendar parsing", () => {
  it("parses required event fields and unescapes iCalendar text", () => {
    const result = parseLumaIcal(sample);
    const event = result.events[0];
    assert.deepEqual(result.issues, []);
    assert.deepEqual(event, {
      uid: "utc-event@example.test",
      title: "AI Builders, Madrid",
      description: "Join us; talks, demos\\fun\nSecond line.",
      location: "Barcelona, Spain",
      url: "https://lu.ma/builders",
      startsAt: "2026-12-05T18:00:00.000Z",
      date: "2026-12-05",
      time: "19:00",
      allDay: false,
    });
  });

  it("unfolds content lines and converts an IANA TZID into Madrid time", () => {
    const result = parseLumaIcal(sample);
    assert.equal(result.events[1]?.title, "Folded event with a long title that continues on the next line");
    assert.equal(result.events[1]?.description, "A description folded over two lines.");
    assert.equal(result.events[1]?.startsAt, "2026-07-12T18:30:00.000Z");
    assert.equal(result.events[1]?.date, "2026-07-12");
    assert.equal(result.events[1]?.time, "20:30");
  });

  it("interprets date-only events as all-day events in Madrid", () => {
    const result = parseLumaIcal(sample);
    assert.equal(result.events[2]?.uid, "all-day-event@example.test");
    assert.equal(result.events[2]?.date, "2026-11-19");
    assert.equal(result.events[2]?.time, "00:00");
    assert.equal(result.events[2]?.startsAt, "2026-11-18T23:00:00.000Z");
    assert.equal(result.events[2]?.allDay, true);
  });

  it("uses an embedded VTIMEZONE definition when present", () => {
    const result = parseLumaIcal(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTIMEZONE\r\nTZID:Custom/UTC+02\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0200\r\nTZNAME:CST\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:custom-zone\r\nDTSTART;TZID=Custom/UTC+02:20261105T190000\r\nSUMMARY:Custom timezone event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
    assert.equal(result.events[0]?.startsAt, "2026-11-05T17:00:00.000Z");
    assert.equal(result.events[0]?.date, "2026-11-05");
    assert.equal(result.events[0]?.time, "18:00");
    assert.deepEqual(result.issues, []);
  });

  it("validates DTSTART from its first property when quoted parameters contain colons", () => {
    const result = parseLumaIcal(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTIMEZONE\r\nTZID:Custom:Zone\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0200\r\nTZNAME:CST\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:quoted-zone\r\nDTSTART;TZID="Custom:Zone":20261105T190000\r\nSUMMARY:Quoted timezone event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
    assert.deepEqual(result.issues, []);
    assert.equal(result.events[0]?.startsAt, "2026-11-05T17:00:00.000Z");
  });

  for (const [start, expected] of [
    ["20260329T023000", "2026-03-29T01:30:00.000Z"],
    ["20261025T023000", "2026-10-25T00:30:00.000Z"],
  ] as const) {
    it(`resolves the Europe/Madrid daylight-saving boundary ${start} per RFC 5545`, () => {
      const result = parseLumaIcal(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:dst-${start}\r\nDTSTART;TZID=Europe/Madrid:${start}\r\nSUMMARY:Daylight-saving event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
      assert.equal(result.events[0]?.startsAt, expected);
      assert.deepEqual(result.issues, []);
    });
  }

  it("reports an unsupported timezone without dropping other events", () => {
    const result = parseLumaIcal(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:unknown-zone\r\nDTSTART;TZID=Unknown/Place:20261205T180000\r\nSUMMARY:Unknown timezone event\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:known-zone\r\nDTSTART:20261205T180000Z\r\nSUMMARY:Known timezone event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
    assert.deepEqual(result.events.map(({ uid }) => uid), ["known-zone"]);
    assert.deepEqual(result.issues, [{ uid: "unknown-zone", message: 'No se reconoce la zona horaria "Unknown/Place".' }]);
  });

  it("returns per-event issues while keeping valid events from the feed", () => {
    const result = parseLumaIcal(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:valid\r\nDTSTART:20261205T180000Z\r\nSUMMARY:Good event\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:missing-start\r\nSUMMARY:Incomplete event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
    assert.equal(result.events.length, 1);
    assert.deepEqual(result.issues, [{ uid: "missing-start", message: "Se omite el evento porque falta UID, SUMMARY o DTSTART." }]);
  });

  it("isolates malformed and impossible DTSTART values without losing valid events", () => {
    const result = parseLumaIcal(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:valid\r\nDTSTART:20261205T180000Z\r\nSUMMARY:Good event\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:garbage\r\nDTSTART:garbage\r\nSUMMARY:Bad event\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:impossible-day\r\nDTSTART:20260231T180000Z\r\nSUMMARY:Bad date\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:impossible-time\r\nDTSTART:20261399T999999Z\r\nSUMMARY:Bad time\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
    assert.deepEqual(result.events.map(({ uid }) => uid), ["valid"]);
    assert.deepEqual(result.issues.map(({ uid }) => uid), ["garbage", "impossible-day", "impossible-time"]);
    assert.ok(result.issues.every(({ message }) => message === "DTSTART contiene una fecha u hora no válida."));
  });

  it("isolates a DTSTART decoding error when the feed contains other events", () => {
    const result = parseLumaIcal(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:broken\r\nDTSTART:garbage\r\nSUMMARY:Broken start\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:valid\r\nDTSTART:20261205T180000Z\r\nSUMMARY:Good event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
    assert.deepEqual(result.events.map(({ uid }) => uid), ["valid"]);
    assert.deepEqual(result.issues.map(({ uid }) => uid), ["broken"]);
  });

  it("validates the first direct DTSTART and ignores nested or duplicate properties", () => {
    const duplicate = parseLumaIcal(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:duplicate-start\r\nDTSTART:20260231T180000Z\r\nDTSTART:20261205T180000Z\r\nSUMMARY:Duplicate start\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
    assert.deepEqual(duplicate.events, []);
    assert.deepEqual(duplicate.issues.map(({ uid }) => uid), ["duplicate-start"]);

    const nested = parseLumaIcal(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:nested-property\r\nDTSTART:20261205T180000Z\r\nSUMMARY:Nested property\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDTSTART:20260231T180000Z\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
    assert.deepEqual(nested.events.map(({ uid }) => uid), ["nested-property"]);
    assert.deepEqual(nested.issues, []);
  });

  it("rejects data that is not an iCalendar VCALENDAR", () => {
    assert.throws(() => parseLumaIcal("BEGIN:VCARD\r\nVERSION:4.0\r\nEND:VCARD\r\n"), IcalParseError);
  });

  it("extracts the Luma event URL from DESCRIPTION when URL property is omitted", () => {
    const result = parseLumaIcal(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:desc-url-event\r\nDTSTART:20261205T180000Z\r\nSUMMARY:Java 27 Event\r\nDESCRIPTION:Get up-to-date information at: https://luma.com/24y588h8\\n\\nJoin us!\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
    assert.equal(result.events[0]?.url, "https://luma.com/24y588h8");
  });
});

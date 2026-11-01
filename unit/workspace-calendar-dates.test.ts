import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dateAt,
  dayKey,
  monday,
  makeDates,
  madridClock,
  scheduleDates,
  starterPosts,
} from "../src/app/workspace/workspace-calendar-dates";
import type { EventItem, Account } from "../src/app/workspace/workspace-types";

describe("workspace-calendar-dates", () => {
  it("dateAt parses YYYY-MM-DD correctly", () => {
    const d = dateAt("2026-11-15");
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 10);
    assert.equal(d.getDate(), 15);
  });

  it("dayKey formats dates as YYYY-MM-DD", () => {
    const d = new Date(2026, 3, 5);
    assert.equal(dayKey(d), "2026-04-05");
  });

  it("monday returns the preceding Monday", () => {
    // 2026-11-01 is a Sunday
    const sunday = new Date(2026, 10, 1);
    const m = monday(sunday);
    assert.equal(m.getDay(), 1); // Monday
    assert.equal(dayKey(m), "2026-10-26");
  });

  it("makeDates generates 7 days for Semana", () => {
    const anchor = new Date(2026, 10, 4);
    const dates = makeDates(anchor, "Semana");
    assert.equal(dates.length, 7);
  });

  it("makeDates generates 14 days for Quincena", () => {
    const anchor = new Date(2026, 10, 4);
    const dates = makeDates(anchor, "Quincena");
    assert.equal(dates.length, 14);
  });

  it("makeDates generates 42 days for Mes starting from first Monday", () => {
    const anchor = new Date(2026, 10, 15);
    const dates = makeDates(anchor, "Mes");
    assert.equal(dates.length, 42);
    assert.equal(dates[0].getDay(), 1); // starts on Monday
  });

  it("madridClock returns clock object with numeric string parts", () => {
    const clock = madridClock();
    assert.ok(clock.year);
    assert.ok(clock.month);
    assert.ok(clock.day);
    assert.ok(clock.hour);
    assert.ok(clock.minute);
  });

  it("scheduleDates computes 14, 7, 1 lead days for a future event", () => {
    const futureDate = "2030-05-20";
    const dates = scheduleDates(futureDate);
    assert.equal(dates.length, 3);
    assert.deepEqual(
      dates.map((d) => d.leadDays),
      [14, 7, 1],
    );
  });

  it("starterPosts generates posts for Substack articles", () => {
    const events: EventItem[] = [
      {
        id: "evt-sub",
        title: "Weekly Newsletter",
        date: "2030-05-20",
        time: "10:00",
        place: "",
        description: "News description",
        source: "Substack",
        url: "https://example.substack.com/p/newsletter",
      },
    ];
    const accounts: Account[] = [
      {
        id: "acc-1",
        name: "Personal",
        kind: "Personal",
        initials: "P",
        color: "blue",
        logo: "/logo.png",
        bufferApiKeyEnv: "ENV",
        bufferApiKeyConfigured: true,
        prompt: "Tone",
        networks: ["LinkedIn"],
        bufferChannels: {},
        styleExampleCount: 0,
      },
    ];

    const posts = starterPosts(events, accounts);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].network, "LinkedIn");
    assert.equal(posts[0].status, "review");
    assert.ok(posts[0].text.includes("Weekly Newsletter"));
  });

  it("starterPosts generates posts for in-person events across lead days and networks", () => {
    const events: EventItem[] = [
      {
        id: "evt-meetup",
        title: "Meetup Talk",
        date: "2030-05-20",
        time: "18:00",
        place: "Barcelona",
        description: "Talk details",
        source: "Meetup",
        url: "https://meetup.com/event-1",
      },
    ];
    const accounts: Account[] = [
      {
        id: "acc-1",
        name: "Personal",
        kind: "Personal",
        initials: "P",
        color: "blue",
        logo: "/logo.png",
        bufferApiKeyEnv: "ENV",
        bufferApiKeyConfigured: true,
        prompt: "Tone",
        networks: ["LinkedIn", "X"],
        bufferChannels: {},
        styleExampleCount: 0,
      },
    ];

    const posts = starterPosts(events, accounts);
    // 3 lead days * 2 networks = 6 posts
    assert.equal(posts.length, 6);
    assert.ok(posts.every((p) => p.status === "review"));
  });
});

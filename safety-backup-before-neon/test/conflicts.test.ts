import { describe, expect, it } from "vitest";
import { eventsOverlap, findScheduleConflicts, findTaskDuplicates, timeToMinutes } from "../src/domain/conflicts.js";
import type { ScheduleEvent, Task } from "../src/domain/types.js";

const event = (partial: Partial<ScheduleEvent>): ScheduleEvent => ({
  id: partial.id ?? "evt_1",
  title: partial.title ?? "Event",
  date: partial.date ?? "2026-10-24",
  startTime: partial.startTime ?? null,
  endTime: partial.endTime ?? null,
  location: null,
  notes: null,
  source: "user",
  planId: null,
  createdAt: "2026-10-20T10:00:00.000Z",
});

describe("schedule conflict detection", () => {
  it("parses 24h times", () => {
    expect(timeToMinutes("07:05")).toBe(425);
    expect(timeToMinutes("23:59")).toBe(1439);
    expect(timeToMinutes("24:00")).toBeNull();
    expect(timeToMinutes(null)).toBeNull();
  });

  it("detects overlapping ranges", () => {
    expect(eventsOverlap({ startTime: "14:00", endTime: "15:30" }, { startTime: "15:00", endTime: "16:00" })).toBe(true);
    expect(eventsOverlap({ startTime: "14:00", endTime: "15:00" }, { startTime: "15:00", endTime: "16:00" })).toBe(false);
    expect(eventsOverlap({ startTime: "14:00", endTime: null }, { startTime: "14:30", endTime: "15:00" })).toBe(true);
    expect(eventsOverlap({ startTime: null, endTime: null }, { startTime: "14:30", endTime: "15:00" })).toBe(false);
  });

  it("flags a candidate that overlaps an existing event on the same day", () => {
    const existing = [event({ title: "Dinner with the Hendersons", startTime: "19:00", endTime: "21:00" })];
    const conflicts = findScheduleConflicts(existing, [
      { title: "Cleaning session", date: "2026-10-24", startTime: "20:00", endTime: "21:00" },
    ]);
    expect(conflicts.some((c) => c.kind === "event_overlap" && c.eventIds.length === 1)).toBe(true);
  });

  it("ignores overlaps on different days", () => {
    const existing = [event({ title: "Dinner", startTime: "19:00", endTime: "21:00" })];
    const conflicts = findScheduleConflicts(existing, [
      { title: "Cleaning", date: "2026-10-25", startTime: "20:00", endTime: "21:00" },
    ]);
    expect(conflicts.filter((c) => c.kind === "event_overlap")).toHaveLength(0);
  });

  it("warns when a candidate has no end time", () => {
    const conflicts = findScheduleConflicts([], [
      { title: "Yoga", date: "2026-10-24", startTime: "08:00", endTime: null },
    ]);
    expect(conflicts.some((c) => c.kind === "missing_detail")).toBe(true);
  });

  it("detects duplicate tasks with the same title and date", () => {
    const tasks: Task[] = [
      {
        id: "tsk_1",
        title: "Water the plants",
        notes: null,
        dueDate: "2026-10-24",
        dueTime: null,
        assignee: null,
        category: null,
        priority: "low",
        status: "open",
        source: "user",
        planId: null,
        createdAt: "2026-10-20T10:00:00.000Z",
        completedAt: null,
      },
    ];
    const duplicates = findTaskDuplicates(tasks, [
      { title: "Water the plants", dueDate: "2026-10-24" },
      { title: "Water the lawn", dueDate: "2026-10-24" },
    ]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].message).toMatch(/Water the plants/);
  });
});

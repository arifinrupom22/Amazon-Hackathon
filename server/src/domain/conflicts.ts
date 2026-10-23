import type { Conflict, ScheduleEvent, Task } from "./types.js";

/** "18:30" -> 1110. Returns null for null/invalid input. */
export function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** True when two same-day events overlap in time. Events without times never overlap. */
export function eventsOverlap(
  a: { startTime?: string | null; endTime?: string | null },
  b: { startTime?: string | null; endTime?: string | null },
): boolean {
  const aStart = timeToMinutes(a.startTime);
  const bStart = timeToMinutes(b.startTime);
  if (aStart === null || bStart === null) return false;
  const aEnd = timeToMinutes(a.endTime) ?? aStart + 60;
  const bEnd = timeToMinutes(b.endTime) ?? bStart + 60;
  return aStart < bEnd && bStart < aEnd;
}

export interface CandidateEvent {
  title: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
}

/**
 * Compare candidate events against each other and against the stored schedule.
 * Used by `check_schedule_conflicts` and by the planner before a plan is shown.
 */
export function findScheduleConflicts(
  existing: ScheduleEvent[],
  candidates: CandidateEvent[],
): Conflict[] {
  const conflicts: Conflict[] = [];

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      if (a.date !== b.date) continue;
      if (eventsOverlap(a, b)) {
        conflicts.push({
          kind: "event_overlap",
          severity: "warning",
          message: `"${a.title}" (${formatRange(a)}) overlaps "${b.title}" (${formatRange(b)}) on ${a.date}.`,
          eventIds: [],
        });
      }
      if (a.title.trim().toLowerCase() === b.title.trim().toLowerCase()) {
        conflicts.push({
          kind: "duplicate",
          severity: "info",
          message: `The plan proposes "${a.title}" twice on ${a.date}.`,
          eventIds: [],
        });
      }
    }
  }

  for (const candidate of candidates) {
    const dayEvents = existing.filter((event) => event.date === candidate.date);
    for (const event of dayEvents) {
      if (eventsOverlap(event, candidate)) {
        conflicts.push({
          kind: "event_overlap",
          severity: "warning",
          message: `"${candidate.title}" (${formatRange(candidate)}) overlaps the existing event "${event.title}" (${formatRange(event)}) on ${candidate.date}.`,
          eventIds: [event.id],
        });
      }
      if (event.title.trim().toLowerCase() === candidate.title.trim().toLowerCase()) {
        conflicts.push({
          kind: "duplicate",
          severity: "info",
          message: `"${candidate.title}" already exists in the schedule on ${candidate.date}.`,
          eventIds: [event.id],
        });
      }
    }
  }

  for (const candidate of candidates) {
    if (!candidate.startTime) {
      conflicts.push({
        kind: "missing_detail",
        severity: "info",
        message: `"${candidate.title}" has no start time yet — it will be added as an all-day item.`,
        eventIds: [],
      });
    } else if (!candidate.endTime) {
      conflicts.push({
        kind: "missing_detail",
        severity: "info",
        message: `"${candidate.title}" has no end time — a 1 hour duration is assumed.`,
        eventIds: [],
      });
    }
  }

  return conflicts;
}

/** Duplicate open tasks: same title on the same due date. */
export function findTaskDuplicates(existing: Task[], candidates: CandidateTask[]): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const candidate of candidates) {
    const clash = existing.find(
      (task) =>
        task.status === "open" &&
        task.title.trim().toLowerCase() === candidate.title.trim().toLowerCase() &&
        (task.dueDate ?? null) === (candidate.dueDate ?? null),
    );
    if (clash) {
      conflicts.push({
        kind: "duplicate",
        severity: "info",
        message: `Task "${candidate.title}" already exists on ${candidate.dueDate ?? "no date"} — approving will skip it unless you re-enable it.`,
        eventIds: [],
      });
    }
  }
  return conflicts;
}

export interface CandidateTask {
  title: string;
  dueDate?: string | null;
}

function formatRange(event: CandidateEvent): string {
  if (event.startTime && event.endTime) return `${event.startTime}–${event.endTime}`;
  if (event.startTime) return `${event.startTime}`;
  return "no time set";
}

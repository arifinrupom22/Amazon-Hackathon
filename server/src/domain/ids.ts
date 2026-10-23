import { randomUUID } from "node:crypto";

/** Short, readable, collision-resistant ids: `tsk_9f2a1c4b`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

import { useState } from "react";
import { Activity as ActivityIcon, Terminal, Zap } from "lucide-react";
import { useAppState } from "../state/store";
import { relativeTime, titleCase } from "../lib/format";
import { EmptyState, LoadingRows, SectionHeader } from "./ui";
import type { TraceEntry } from "../lib/types";

export function ActivityFeed({ limit = 8 }: { limit?: number }) {
  const { activity, loading } = useAppState();
  const entries = activity.slice(0, limit);

  return (
    <div className="card p-4">
      <SectionHeader title="Agent activity" subtitle="Real operations recorded by the server" />
      <div className="mt-3">
        {loading ? (
          <LoadingRows rows={3} label="Loading activity" />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<ActivityIcon size={18} />}
            title="No activity yet"
            description="Tool calls, plan approvals and resets show up here as soon as they happen."
          />
        ) : (
          <ul className="space-y-3">
            {entries.map((entry) => (
              <li key={entry.id} className="flex gap-3">
                <span
                  className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                    entry.status === "error" ? "bg-error-soft text-error" : "bg-accent-soft text-accent-strong"
                  }`}
                >
                  {entry.kind === "plan" ? (
                    <Zap size={12} aria-hidden="true" />
                  ) : (
                    <Terminal size={12} aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-5 text-ink">{entry.summary}</p>
                  <p className="mt-0.5 text-[11.5px] text-muted">
                    {relativeTime(entry.ts)} · {titleCase(entry.origin)}
                    {entry.tool ? ` · ${entry.tool}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function McpTracePanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const { trace, mcp } = useAppState();
  const [open, setOpen] = useState(defaultOpen);
  const recent = trace.slice(0, 12);

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div>
          <SectionHeader title="MCP traffic" subtitle="JSON-RPC exchanged with /mcp from this browser" />
        </div>
        <span className={`chip ${mcp.connected ? "chip-accent" : "chip-error"}`}>{recent.length} calls</span>
      </button>

      <div className="border-t border-line bg-surface-2">
        <div className="flex flex-wrap gap-1.5 px-4 py-2.5">
          {recent
            .slice()
            .reverse()
            .map((entry) => (
              <span
                key={entry.id}
                title={entry.summary}
                className={`chip ${entry.ok ? "chip-accent" : "chip-error"}`}
                style={{ height: 22, fontSize: 11 }}
              >
                {entry.method === "initialize" ? "initialize" : entry.method === "tools/list" ? "tools/list" : entry.tool}
                <span className="tnum text-[10px] opacity-70">{entry.durationMs}ms</span>
              </span>
            ))}
        </div>

        {open ? (
          <div className="max-h-72 overflow-y-auto border-t border-line">
            {recent.length === 0 ? (
              <p className="px-4 py-4 text-[12.5px] text-muted">
                No MCP traffic yet — interact with the app and every JSON-RPC exchange appears here.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {recent.map((entry) => (
                  <li key={entry.id} className="px-4 py-2.5">
                    <TraceRow entry={entry} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TraceRow({ entry }: { entry: TraceEntry }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11.5px] text-ink">
          {entry.method === "tools/call" ? `tools/call ${entry.tool}` : entry.method}
        </p>
        <span className={`tnum text-[11px] ${entry.ok ? "text-success" : "text-error"}`}>
          {entry.ok ? "ok" : "error"} · {entry.durationMs}ms
        </span>
      </div>
      {entry.args ? (
        <pre className="mt-1 overflow-x-auto rounded-[8px] bg-canvas-deep p-2 font-mono text-[10.5px] leading-4 text-ink-soft">
          {JSON.stringify(entry.args)}
        </pre>
      ) : null}
      <p className="mt-1 text-[11.5px] leading-4 text-muted">{entry.summary}</p>
    </div>
  );
}

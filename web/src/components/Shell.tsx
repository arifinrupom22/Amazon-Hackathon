import { useState, type ReactNode } from "react";
import {
  CalendarDays,
  CheckSquare,
  ChevronRight,
  Home,
  Menu,
  RefreshCw,
  Settings2,
  ShoppingBasket,
  Sparkles,
  X,
} from "lucide-react";
import { useAppState, type View } from "../state/store";
import { ProviderNoticeBanner, Toasts } from "./ui";

const NAV: Array<{ id: View; label: string; icon: typeof Home; badge?: "tasks" | "events" | "groceries" }> = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "assistant", label: "AI Assistant", icon: Sparkles },
  { id: "tasks", label: "My Tasks", icon: CheckSquare, badge: "tasks" },
  { id: "schedule", label: "Schedule", icon: CalendarDays, badge: "events" },
  { id: "groceries", label: "Grocery List", icon: ShoppingBasket, badge: "groceries" },
  { id: "household", label: "Household & Memory", icon: Settings2 },
];

const VIEW_TITLES: Record<View, string> = {
  overview: "Overview",
  assistant: "AI Assistant",
  review: "Plan Review",
  tasks: "My Tasks",
  schedule: "Schedule",
  groceries: "Grocery List",
  household: "Household & Memory",
};

export function Shell({ children }: { children: ReactNode }) {
  const { view, setView, status, tasks, events, groceries, mcp, activePlan, refreshing, refreshAll } =
    useAppState();
  const [navOpen, setNavOpen] = useState(false);

  const badges: Record<string, number> = {
    tasks: tasks.filter((task) => task.status === "open").length,
    events: events.length,
    groceries: groceries.filter((item) => !item.purchased).length,
  };

  const householdName = status?.household.name ?? "Household";
  const members = status?.household.members ?? [];

  const nav = (
    <nav className="flex flex-col gap-1" aria-label="Primary">
      {NAV.map((item) => {
        const active = view === item.id || (view === "review" && item.id === "assistant");
        const Icon = item.icon;
        const badge = item.badge ? badges[item.badge] : undefined;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setView(item.id);
              setNavOpen(false);
            }}
            className={`group flex items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[14px] transition ${
              active
                ? "bg-accent-soft font-semibold text-accent-deep"
                : "font-medium text-ink-soft hover:bg-surface-2"
            }`}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={17} className={active ? "text-accent-strong" : "text-muted"} aria-hidden="true" />
            <span className="flex-1">{item.label}</span>
            {badge !== undefined && badge > 0 ? (
              <span
                className={`tnum rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                  active ? "bg-surface text-accent-strong" : "bg-canvas-deep text-muted"
                }`}
              >
                {badge}
              </span>
            ) : null}
          </button>
        );
      })}
      {activePlan && activePlan.status === "proposed" ? (
        <button
          type="button"
          onClick={() => {
            setView("review");
            setNavOpen(false);
          }}
          className="mt-1 flex items-center gap-3 rounded-[10px] border border-accent/25 bg-accent-soft px-3 py-2 text-left text-[14px] font-semibold text-accent-deep"
        >
          <Sparkles size={17} aria-hidden="true" />
          <span className="flex-1">Plan Review</span>
          <span className="tnum rounded-full bg-surface px-1.5 py-0.5 text-[11px] text-accent-strong">
            {activePlan.actions.length}
          </span>
        </button>
      ) : null}
    </nav>
  );

  const connectionChip = (
    <div
      className={`chip ${mcp.connected ? "chip-accent" : mcp.error ? "chip-error" : ""}`}
      title={
        mcp.connected
          ? "Browser MCP client connected to /mcp via the official SDK"
          : (mcp.error ?? "Connecting…")
      }
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          mcp.connected ? "bg-accent" : mcp.error ? "bg-error" : "bg-muted"
        }`}
      />
      {mcp.connected ? `MCP connected · ${mcp.toolCount} tools` : mcp.error ? "MCP offline" : "Connecting…"}
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent text-white">
            <Home size={16} aria-hidden="true" />
          </span>
          <div className="leading-tight">
            <p className="text-[15px] font-semibold tracking-[-0.01em] text-ink">HomePilot AI</p>
            <p className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">MCP household OS</p>
          </div>
        </div>

        <div className="mx-4 mb-4 rounded-[10px] border border-line bg-surface-2 px-3 py-2.5">
          <p className="eyebrow">My household</p>
          <p className="mt-1 text-[13.5px] font-semibold text-ink">
            {householdName} · {members.length}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {members.map((member) => (
              <span
                key={member.id}
                className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-muted ring-1 ring-line"
                title={`${member.name} — ${member.presence ?? member.role}`}
              >
                {member.name.split(" ")[0]}
              </span>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4">{nav}</div>

        <div className="border-t border-line px-4 py-4">
          <p className="eyebrow mb-2">MCP server</p>
          {connectionChip}
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 lg:px-8">
            <button
              type="button"
              className="btn btn-secondary btn-sm lg:hidden"
              onClick={() => setNavOpen((open) => !open)}
              aria-label="Toggle navigation"
            >
              {navOpen ? <X size={16} /> : <Menu size={16} />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
                <span>Household workspace</span>
                <ChevronRight size={13} aria-hidden="true" />
                <span className="truncate text-ink">{VIEW_TITLES[view]}</span>
              </div>
              <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">
                {VIEW_TITLES[view]}
              </h1>
            </div>
            <span className="hidden sm:block">{connectionChip}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void refreshAll()}
              disabled={refreshing}
              title="Reload data from the MCP server"
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
          {navOpen ? (
            <div className="border-t border-line bg-surface px-4 py-3 lg:hidden">{nav}</div>
          ) : null}
        </header>

        <ProviderNoticeBanner />

        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>

      <Toasts />
    </div>
  );
}


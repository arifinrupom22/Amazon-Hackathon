import { useMemo, useState } from "react";
import {
  CalendarClock,
  CalendarDays,
  CheckSquare,
  ChevronRight,
  CircleUser,
  ListTodo,
  ShoppingBasket,
  Sparkles,
} from "lucide-react";
import { useAppState } from "../state/store";
import { dayRelation, prettyDate, prettyTime, timeRange, todayKey } from "../lib/format";
import { ActivityFeed, McpTracePanel } from "../components/Activity";
import { PromptBar } from "../components/PromptBar";
import { EmptyState, LoadingRows, StatCard, WarningBanner } from "../components/ui";

const QUICK_PROMPTS = [
  "Plan a relaxed Saturday for two. Add grocery items for dinner, schedule a cleaning session in the afternoon, and remind me to prepare dinner before 7 PM.",
  "We have guests on Saturday at 7 PM. We're out of rice, the living room needs cleaning, and Marcus can't help until 6 PM.",
  "Add oat milk and sourdough bread to the grocery list and remind me to call the plumber at 5 PM tomorrow.",
];

export function Overview() {
  const { status, tasks, events, groceries, loading, mcp, setView, proposePlan, notify } = useAppState();
  const [planning, setPlanning] = useState(false);

  const today = todayKey();
  const openTasks = tasks.filter((task) => task.status === "open");
  const todayTasks = openTasks.filter((task) => task.dueDate === today);
  const todayEvents = events.filter((event) => event.date === today);
  const upcoming = events.filter((event) => event.date > today).slice(0, 4);
  const toBuy = groceries.filter((item) => !item.purchased);

  const timeline = useMemo(() => {
    const rows: Array<{ key: string; time: string; title: string; meta: string; kind: "task" | "event"; done: boolean }> = [];
    for (const event of todayEvents) {
      rows.push({
        key: `evt_${event.id}`,
        time: timeRange(event.startTime, event.endTime),
        title: event.title,
        meta: event.location ?? "Household",
        kind: "event",
        done: false,
      });
    }
    for (const task of todayTasks) {
      rows.push({
        key: `tsk_${task.id}`,
        time: task.dueTime ? prettyTime(task.dueTime) : "Anytime",
        title: task.title,
        meta: [task.assignee, task.category].filter(Boolean).join(" · ") || "Unassigned",
        kind: "task",
        done: task.status === "completed",
      });
    }
    return rows;
  }, [todayEvents, todayTasks]);

  const submit = async (text: string) => {
    setPlanning(true);
    try {
      await proposePlan(text);
      setView("review");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setPlanning(false);
    }
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="mx-auto grid max-w-[1180px] gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        {/* Hero */}
        <div>
          <p className="eyebrow">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })} ·{" "}
            {greeting}, {status?.household.members[0]?.name.split(" ")[0] ?? "there"}
          </p>
          <h2 className="mt-1.5 max-w-xl text-[30px] font-semibold leading-[36px] tracking-[-0.03em] text-ink">
            Let's get your home in sync.
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="chip chip-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {status?.counts.openTasks ?? 0} open tasks
            </span>
            <span className="chip">
              <CalendarDays size={12} aria-hidden="true" />
              {todayEvents.length} event{todayEvents.length === 1 ? "" : "s"} today
            </span>
            <span className="chip">
              <ShoppingBasket size={12} aria-hidden="true" />
              {toBuy.length} to buy
            </span>
            <span className="chip">
              <Sparkles size={12} aria-hidden="true" />
              {mcp.toolCount} MCP tools
            </span>
          </div>
        </div>

        {/* Prompt */}
        <section className="card-raised p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              <Sparkles size={16} className="text-accent" aria-hidden="true" />
              What needs to happen at home?
            </h3>
            <span className="text-[12px] text-muted">Plan first · nothing runs until you approve</span>
          </div>
          <PromptBar onSubmit={(text) => void submit(text)} busy={planning} autoFocus />
          <div className="mt-3 flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => void submit(prompt)}
                disabled={planning}
                className="chip transition hover:border-accent/40 hover:bg-accent-soft hover:text-accent-strong"
              >
                <Sparkles size={11} aria-hidden="true" />
                {prompt.length > 58 ? `${prompt.slice(0, 58)}…` : prompt}
              </button>
            ))}
          </div>
        </section>

        {mcp.error ? <WarningBanner tone="error">{mcp.error}</WarningBanner> : null}

        {/* Today timeline */}
        <section className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-[15px] font-semibold text-ink">Today's plan</h3>
              <p className="mt-0.5 text-[13px] text-muted">
                {timeline.length} milestone{timeline.length === 1 ? "" : "s"} across the household
              </p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setView("tasks")}>
              <CheckSquare size={14} aria-hidden="true" />
              Manage tasks
            </button>
          </div>

          {loading ? (
            <LoadingRows rows={4} label="Loading today's plan" />
          ) : timeline.length === 0 ? (
            <EmptyState
              icon={<CalendarClock size={18} />}
              title="Nothing scheduled today"
              description="Ask the assistant to plan the day, or add a task to get the household moving."
              action={
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setView("assistant")}>
                  Open AI Assistant
                </button>
              }
            />
          ) : (
            <ul className="relative space-y-3 border-l border-line pl-5">
              {timeline.map((row) => (
                <li key={row.key} className="relative">
                  <span
                    className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${
                      row.done ? "bg-success" : row.kind === "event" ? "bg-accent" : "bg-line-strong"
                    }`}
                    aria-hidden="true"
                  />
                  <div className="flex items-start justify-between gap-3 rounded-[10px] border border-line bg-surface-2/70 px-3.5 py-3">
                    <div className="min-w-0">
                      <p className={`text-[14px] font-semibold ${row.done ? "text-muted line-through" : "text-ink"}`}>
                        {row.title}
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-muted">{row.meta}</p>
                    </div>
                    <span className="tnum shrink-0 text-[12.5px] font-medium text-ink-soft">{row.time}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Right rail */}
      <div className="min-w-0 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Open tasks"
            value={status?.counts.openTasks ?? "–"}
            hint={`${status?.counts.completedTasks ?? 0} completed`}
            icon={<ListTodo size={15} />}
          />
          <StatCard
            label="To buy"
            value={status?.counts.groceriesToBuy ?? "–"}
            hint={`${status?.counts.groceriesPurchased ?? 0} in cart`}
            icon={<ShoppingBasket size={15} />}
          />
        </div>

        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-semibold text-ink">Grocery checklist</h3>
            <button
              type="button"
              className="text-[12.5px] font-medium text-accent-strong hover:underline"
              onClick={() => setView("groceries")}
            >
              View all
            </button>
          </div>
          <ul className="mt-3 space-y-2">
            {toBuy.slice(0, 4).map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="truncate text-ink">
                  {item.name}
                  <span className="tnum text-muted"> · {item.quantity}{item.unit ? ` ${item.unit}` : ""}</span>
                </span>
                <span className="chip" style={{ height: 20, fontSize: 11 }}>
                  {item.category ?? "General"}
                </span>
              </li>
            ))}
            {toBuy.length === 0 ? (
              <li className="text-[12.5px] text-muted">Everything on the list is bought.</li>
            ) : null}
          </ul>
        </section>

        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-semibold text-ink">Upcoming</h3>
            <button
              type="button"
              className="text-[12.5px] font-medium text-accent-strong hover:underline"
              onClick={() => setView("schedule")}
            >
              Schedule
            </button>
          </div>
          <ul className="mt-3 space-y-2.5">
            {upcoming.map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-ink">{event.title}</p>
                  <p className="text-[11.5px] text-muted">
                    {dayRelation(event.date) || prettyDate(event.date)}
                    {event.startTime ? ` · ${prettyTime(event.startTime)}` : ""}
                  </p>
                </div>
                <ChevronRight size={14} className="mt-1 shrink-0 text-faint" aria-hidden="true" />
              </li>
            ))}
            {upcoming.length === 0 ? <li className="text-[12.5px] text-muted">Nothing scheduled ahead.</li> : null}
          </ul>
        </section>

        <McpTracePanel />
        <ActivityFeed limit={6} />

        <section className="card p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
              <CircleUser size={17} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-ink">
                {status?.household.members[0]?.name ?? "Household"}
              </p>
              <p className="text-[12px] text-muted">{status?.household.members[0]?.role ?? "Member"}</p>
            </div>
            <button
              type="button"
              className="ml-auto text-[12.5px] font-medium text-accent-strong hover:underline"
              onClick={() => setView("household")}
            >
              Settings
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

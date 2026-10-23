import { useMemo, useState } from "react";
import { CalendarDays, CalendarPlus, Clock, MapPin, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useAppState } from "../state/store";
import { addDaysKey, dayRelation, longDate, prettyDate, timeRange, todayKey } from "../lib/format";
import { ConfirmButton, EmptyState, LoadingRows, WarningBanner } from "../components/ui";
import type { ScheduleEvent } from "../lib/types";

function toMinutes(time: string | null): number | null {
  if (!time) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function overlaps(a: ScheduleEvent, b: ScheduleEvent): boolean {
  if (a.date !== b.date) return false;
  const aStart = toMinutes(a.startTime);
  const bStart = toMinutes(b.startTime);
  if (aStart === null || bStart === null) return false;
  const aEnd = toMinutes(a.endTime) ?? aStart + 60;
  const bEnd = toMinutes(b.endTime) ?? bStart + 60;
  return aStart < bEnd && bStart < aEnd;
}

export function Schedule() {
  const { events, loading, addEvent, deleteEvent } = useAppState();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayKey());
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("11:00");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, ScheduleEvent[]>();
    for (const event of [...events].sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""))) {
      const list = map.get(event.date) ?? [];
      list.push(event);
      map.set(event.date, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  const conflictPairs = useMemo(() => {
    const pairs = new Set<string>();
    for (let i = 0; i < events.length; i += 1) {
      for (let j = i + 1; j < events.length; j += 1) {
        if (overlaps(events[i], events[j])) {
          pairs.add(events[i].id);
          pairs.add(events[j].id);
        }
      }
    }
    return pairs;
  }, [events]);

  const submit = async () => {
    if (!title.trim()) return;
    if (startTime && endTime && endTime <= startTime) {
      setError("The end time must be after the start time.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addEvent({
        title: title.trim(),
        date,
        startTime: startTime || null,
        endTime: endTime || null,
        location: location.trim() || null,
      });
      setTitle("");
      setLocation("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-[1080px] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">Schedule</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              {events.length} upcoming event{events.length === 1 ? "" : "s"} · overlaps highlighted
            </p>
          </div>
          <div className="flex gap-2">
            <span className="chip">
              <Clock size={12} aria-hidden="true" />
              {longDate(todayKey())}
            </span>
          </div>
        </header>

        {conflictPairs.size > 0 ? (
          <WarningBanner tone="warning">
            <p>
              <span className="font-semibold">Scheduling conflict detected.</span> {conflictPairs.size} events overlap
              in time — check the flagged rows below.
            </p>
          </WarningBanner>
        ) : null}

        {loading ? (
          <LoadingRows rows={4} label="Loading schedule" />
        ) : grouped.length === 0 ? (
          <EmptyState
            icon={<CalendarDays size={18} />}
            title="No upcoming events"
            description="Add an event, or ask the assistant to plan a cleaning session or guest visit."
          />
        ) : (
          <div className="space-y-4">
            {grouped.map(([day, dayEvents]) => (
              <section key={day} className="card overflow-hidden">
                <div className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2.5">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-[13.5px] font-semibold text-ink">{dayRelation(day) || prettyDate(day)}</h3>
                    <span className="text-[12px] text-muted">{longDate(day)}</span>
                  </div>
                  <span className="chip" style={{ height: 20, fontSize: 11 }}>
                    {dayEvents.length} event{dayEvents.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="divide-y divide-line">
                  {dayEvents.map((event) => {
                    const conflict = conflictPairs.has(event.id);
                    return (
                      <li
                        key={event.id}
                        className={`group flex items-start gap-3 px-4 py-3 ${conflict ? "bg-warning-soft/40" : ""}`}
                      >
                        <div className="w-[104px] shrink-0">
                          <p className="tnum text-[12.5px] font-semibold text-ink">{timeRange(event.startTime, event.endTime)}</p>
                          {event.source === "plan" ? (
                            <span className="chip chip-accent mt-1" style={{ height: 19, fontSize: 10 }}>
                              from plan
                            </span>
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[13.5px] font-semibold text-ink">{event.title}</p>
                            {conflict ? (
                              <span className="chip chip-warning" style={{ height: 20, fontSize: 11 }}>
                                <TriangleAlert size={11} aria-hidden="true" />
                                overlaps
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                            {event.location ? (
                              <span className="inline-flex items-center gap-1">
                                <MapPin size={12} aria-hidden="true" />
                                {event.location}
                              </span>
                            ) : null}
                            {event.notes ? <span>{event.notes}</span> : null}
                          </p>
                        </div>
                        <ConfirmButton
                          onConfirm={() => deleteEvent(event.id)}
                          confirmTitle="Delete event?"
                          confirmBody={`“${event.title}” on ${prettyDate(event.date)} will be removed. This calls delete_schedule_event with confirm: true.`}
                          confirmLabel="Delete event"
                          className="btn btn-ghost btn-sm shrink-0 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </ConfirmButton>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <aside className="min-w-0 space-y-4">
        <form
          className="card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <CalendarPlus size={15} className="text-accent" aria-hidden="true" />
            Add an event
          </h3>
          <p className="mt-0.5 text-[12px] text-muted">Runs create_schedule_event over MCP</p>

          <div className="mt-3 space-y-2.5">
            <input
              className="field"
              placeholder="Event title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="Event title"
            />
            <input
              type="date"
              className="field tnum"
              value={date}
              min={addDaysKey(todayKey(), -30)}
              onChange={(event) => setDate(event.target.value)}
              aria-label="Event date"
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[12px] text-muted">
                Start
                <input
                  type="time"
                  className="field tnum mt-1"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                />
              </label>
              <label className="text-[12px] text-muted">
                End
                <input
                  type="time"
                  className="field tnum mt-1"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                />
              </label>
            </div>
            <input
              className="field"
              placeholder="Location (optional)"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              aria-label="Location"
            />
            {error ? <p className="text-[12.5px] text-error">{error}</p> : null}
            <button type="submit" className="btn btn-primary w-full" disabled={!title.trim() || busy}>
              <Plus size={15} aria-hidden="true" />
              Add event
            </button>
          </div>
        </form>

        <div className="card p-4">
          <h3 className="text-[14px] font-semibold text-ink">How conflicts work</h3>
          <p className="mt-1 text-[12.5px] leading-5 text-muted">
            Overlaps are computed from stored start/end times on the same day. The same check also runs server-side
            before a plan is shown, and the <span className="font-mono text-[11.5px]">check_schedule_conflicts</span>{" "}
            tool can be called directly by any MCP client.
          </p>
        </div>
      </aside>
    </div>
  );
}

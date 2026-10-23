import { useMemo, useState } from "react";
import { Check, CheckSquare, Plus, Trash2 } from "lucide-react";
import { useAppState } from "../state/store";
import { dayRelation, prettyDate, prettyTime, todayKey } from "../lib/format";
import { ConfirmButton, EmptyState, LoadingRows, WarningBanner } from "../components/ui";
import type { Task } from "../lib/types";

type Filter = "open" | "completed" | "all";

const PRIORITY_STYLES: Record<Task["priority"], string> = {
  high: "chip-error",
  medium: "chip-warning",
  low: "chip",
};

export function Tasks() {
  const { tasks, loading, addTask, completeTask, deleteTask, status } = useAppState();
  const [filter, setFilter] = useState<Filter>("open");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(todayKey());
  const [dueTime, setDueTime] = useState("");
  const [assignee, setAssignee] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  const [busy, setBusy] = useState(false);

  const members = status?.household.members ?? [];

  const filtered = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
    });
    return sorted.filter((task) => (filter === "all" ? true : task.status === filter));
  }, [tasks, filter]);

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await addTask({
        title: title.trim(),
        dueDate: dueDate || null,
        dueTime: dueTime || null,
        assignee: assignee || null,
        category: category.trim() || null,
        priority,
      });
      setTitle("");
      setDueTime("");
      setCategory("");
    } catch (error) {
      void error;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-[1080px] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">My Tasks</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              {tasks.filter((task) => task.status === "open").length} open · created by you or by an approved plan
            </p>
          </div>
          <div className="flex gap-1 rounded-[10px] border border-line bg-surface p-1">
            {(["open", "completed", "all"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium capitalize transition ${
                  filter === value ? "bg-accent-soft text-accent-deep" : "text-muted hover:text-ink"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </header>

        {loading ? (
          <LoadingRows rows={5} label="Loading tasks" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<CheckSquare size={18} />}
            title={filter === "completed" ? "Nothing completed yet" : "No tasks here"}
            description={
              filter === "completed"
                ? "Completed tasks move here with their completion time."
                : "Add a task below, or ask the assistant to plan a day and approve the result."
            }
          />
        ) : (
          <ul className="card divide-y divide-line">
            {filtered.map((task) => (
              <li key={task.id} className="group flex items-start gap-3 px-4 py-3 transition hover:bg-surface-2/60">
                <button
                  type="button"
                  onClick={() => void completeTask(task.id)}
                  disabled={task.status === "completed"}
                  aria-label={task.status === "completed" ? "Completed" : `Complete ${task.title}`}
                  className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition ${
                    task.status === "completed"
                      ? "border-accent bg-accent text-white"
                      : "border-muted bg-surface hover:border-accent"
                  }`}
                >
                  {task.status === "completed" ? <Check size={12} aria-hidden="true" /> : null}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className={`text-[13.5px] font-semibold ${
                        task.status === "completed" ? "text-muted line-through" : "text-ink"
                      }`}
                    >
                      {task.title}
                    </p>
                    <span className={`chip ${PRIORITY_STYLES[task.priority]}`} style={{ height: 20, fontSize: 11 }}>
                      {task.priority}
                    </span>
                    {task.source === "plan" ? (
                      <span className="chip chip-accent" style={{ height: 20, fontSize: 11 }}>
                        from plan
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    {task.dueDate
                      ? `${dayRelation(task.dueDate) || prettyDate(task.dueDate)}${task.dueTime ? ` · ${prettyTime(task.dueTime)}` : ""}`
                      : "No due date"}
                    {task.assignee ? ` · ${task.assignee}` : ""}
                    {task.category ? ` · ${task.category}` : ""}
                  </p>
                  {task.notes ? <p className="mt-1 text-[12px] text-faint">{task.notes}</p> : null}
                </div>

                <ConfirmButton
                  onConfirm={() => deleteTask(task.id)}
                  confirmTitle="Delete task?"
                  confirmBody={`“${task.title}” will be removed permanently. This runs the delete_task MCP tool with an explicit confirmation.`}
                  confirmLabel="Delete task"
                  className="btn btn-ghost btn-sm shrink-0 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </ConfirmButton>
              </li>
            ))}
          </ul>
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
          <h3 className="text-[14px] font-semibold text-ink">Add a task</h3>
          <p className="mt-0.5 text-[12px] text-muted">Runs create_task on the MCP server</p>

          <div className="mt-3 space-y-2.5">
            <input
              className="field"
              placeholder="What needs doing?"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="Task title"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                className="field tnum"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                aria-label="Due date"
              />
              <input
                type="time"
                className="field tnum"
                value={dueTime}
                onChange={(event) => setDueTime(event.target.value)}
                aria-label="Due time"
              />
            </div>
            <select className="field" value={assignee} onChange={(event) => setAssignee(event.target.value)} aria-label="Assignee">
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.name}>
                  {member.name}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input
                className="field"
                placeholder="Category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                aria-label="Category"
              />
              <select
                className="field"
                value={priority}
                onChange={(event) => setPriority(event.target.value as Task["priority"])}
                aria-label="Priority"
              >
                <option value="low">Low priority</option>
                <option value="medium">Medium priority</option>
                <option value="high">High priority</option>
              </select>
            </div>
            <button type="submit" className="btn btn-primary w-full" disabled={!title.trim() || busy}>
              <Plus size={15} aria-hidden="true" />
              Add task
            </button>
          </div>
        </form>

        <WarningBanner tone="info">
          <p>
            Destructive actions always ask for confirmation first, then call <span className="font-mono">delete_task</span>{" "}
            with <span className="font-mono">confirm: true</span>.
          </p>
        </WarningBanner>
      </aside>
    </div>
  );
}

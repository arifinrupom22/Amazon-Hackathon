import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ListTodo,
  Loader2,
  Lock,
  Pencil,
  ShoppingBasket,
  Sparkles,
  Undo2,
  X,
  XCircle,
} from "lucide-react";
import { useAppState } from "../state/store";
import { dateKeyFromIso, prettyDate, prettyTime } from "../lib/format";
import { EmptyState, WarningBanner } from "../components/ui";
import type { ExecutionResult, Plan, PlanAction } from "../lib/types";

const DOMAIN_META = {
  tasks: { label: "Tasks", icon: ListTodo },
  schedule: { label: "Schedule", icon: CalendarDays },
  groceries: { label: "Groceries", icon: ShoppingBasket },
} as const;

export function PlanReview() {
  const { activePlan, setActivePlan, setView, patchPlanActions, approvePlan, cancelPlan, notify } =
    useAppState();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [result, setResult] = useState<ExecutionResult | null>(null);

  if (!activePlan) {
    return (
      <div className="mx-auto max-w-[900px]">
        <EmptyState
          icon={<Sparkles size={18} />}
          title="No plan to review"
          description="Ask the assistant for something concrete — like planning Saturday — and the proposed actions will wait here for your approval."
          action={
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setView("assistant")}>
              Open AI Assistant
            </button>
          }
        />
      </div>
    );
  }

  const plan = activePlan;

  const grouped = useMemo(
    () => ({
      tasks: plan.actions.filter((action) => action.domain === "tasks"),
      schedule: plan.actions.filter((action) => action.domain === "schedule"),
      groceries: plan.actions.filter((action) => action.domain === "groceries"),
    }),
    [plan.actions],
  );

  const enabledCount = plan.actions.filter((action) => action.apply && action.status !== "invalid").length;
  const blockingWarnings = plan.warnings.filter((warning) => warning.severity === "error");

  const updateAction = async (actionId: string, patch: { apply?: boolean; args?: Record<string, unknown> }) => {
    try {
      await patchPlanActions(plan.id, [{ id: actionId, ...patch }]);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const approve = async () => {
    setBusy(true);
    try {
      const execution = await approvePlan(plan.id);
      setResult(execution);
      if (execution.failedCount > 0) {
        notify(`${execution.appliedCount} applied, ${execution.failedCount} failed`, "error");
      } else {
        notify(`Plan applied — ${execution.appliedCount} action(s) executed`, "success");
      }
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await cancelPlan(plan.id);
      setActivePlan(null);
      setView("assistant");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (result) return <ExecutionView result={result} onDone={() => setView("overview")} />;

  const applied = plan.status === "applied" || plan.status === "partially_applied";

  return (
    <div className="mx-auto max-w-[980px] space-y-5">
      <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={() => setView("assistant")}>
        <ArrowLeft size={14} aria-hidden="true" />
        Back to assistant
      </button>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">{plan.title}</h2>
            <span className={`chip ${applied ? "chip-success" : "chip-warning"}`}>{statusLabel(plan)}</span>
          </div>
          <p className="mt-1.5 max-w-2xl text-[14px] leading-6 text-ink-soft">{plan.summary}</p>
          <p className="mt-2 text-[12.5px] text-muted">
            <span className="font-medium text-ink-soft">Your request:</span> “{plan.requestText}”
          </p>
        </div>
        {!applied ? (
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => void cancel()} disabled={busy}>
              <X size={15} aria-hidden="true" />
              Discard
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void approve()}
              disabled={busy || enabledCount === 0 || blockingWarnings.length > 0}
              title={
                blockingWarnings.length > 0
                  ? "Fix the blocking issue before approving"
                  : "Execute the enabled actions through MCP tools"
              }
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              {busy ? "Applying…" : `Approve & apply ${enabledCount} action${enabledCount === 1 ? "" : "s"}`}
            </button>
          </div>
        ) : null}
      </header>

      <div className="flex items-start gap-2.5 rounded-[10px] border border-accent/20 bg-accent-soft px-4 py-3">
        <Lock size={15} className="mt-0.5 shrink-0 text-accent-strong" aria-hidden="true" />
        <p className="text-[13px] leading-5 text-accent-ink">
          <span className="font-semibold">Staging mode.</span> Nothing has been written yet. Every action below
          runs through a real MCP tool only after you approve — and the server re-validates the stored plan first,
          so client-side edits can never skip validation.
        </p>
      </div>

      {plan.clarification ? (
        <WarningBanner tone="info">
          <p className="font-semibold">One thing I need from you</p>
          <p>{plan.clarification}</p>
        </WarningBanner>
      ) : null}

      {plan.warnings.length > 0 ? (
        <section className="card p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle size={15} className="text-warning" aria-hidden="true" />
            <h3 className="text-[14px] font-semibold text-ink">Conflict & sanity checks</h3>
            <span className="chip" style={{ height: 20, fontSize: 11 }}>
              {plan.warnings.length}
            </span>
          </div>
          <ul className="space-y-2">
            {plan.warnings.map((warning, index) => (
              <li key={`${warning.code}_${index}`}>
                <WarningBanner tone={warning.severity === "error" ? "error" : warning.severity === "info" ? "info" : "warning"}>
                  <p>{warning.message}</p>
                </WarningBanner>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {plan.assumptions.length > 0 ? (
        <section className="card p-4">
          <h3 className="text-[14px] font-semibold text-ink">Assumptions made</h3>
          <ul className="mt-2 space-y-1.5">
            {plan.assumptions.map((assumption) => (
              <li key={assumption} className="flex gap-2 text-[13px] leading-5 text-ink-soft">
                <ChevronRight size={14} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
                {assumption}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(["schedule", "tasks", "groceries"] as const).map((domain) => {
        const actions = grouped[domain];
        if (actions.length === 0) return null;
        const meta = DOMAIN_META[domain];
        const Icon = meta.icon;
        return (
          <section key={domain} className="card p-4">
            <div className="mb-3 flex items-center gap-2">
              <Icon size={15} className="text-accent" aria-hidden="true" />
              <h3 className="text-[14px] font-semibold text-ink">{meta.label}</h3>
              <span className="chip" style={{ height: 20, fontSize: 11 }}>
                {actions.filter((action) => action.apply).length} of {actions.length} enabled
              </span>
            </div>
            <ul className="space-y-2.5">
              {actions.map((action) => (
                <ActionRow
                  key={action.id}
                  action={action}
                  editing={editing === action.id}
                  onEditToggle={() => setEditing((current) => (current === action.id ? null : action.id))}
                  onToggle={(apply) => void updateAction(action.id, { apply })}
                  onPatch={(args) => void updateAction(action.id, { args })}
                  disabled={applied}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {!applied ? (
        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-surface px-4 py-3"
          style={{ boxShadow: "var(--shadow-raised)" }}
        >
          <p className="text-[13px] text-muted">
            {enabledCount} action{enabledCount === 1 ? "" : "s"} will run through MCP tools on approval.
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => void cancel()} disabled={busy}>
              Discard plan
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void approve()}
              disabled={busy || enabledCount === 0 || blockingWarnings.length > 0}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              {busy ? "Applying…" : "Approve & apply"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function statusLabel(plan: Plan): string {
  switch (plan.status) {
    case "proposed":
      return "Awaiting confirmation";
    case "approved":
      return "Approved";
    case "applied":
      return "Applied successfully";
    case "partially_applied":
      return "Partially applied";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return plan.status;
  }
}

function ActionRow({
  action,
  editing,
  onEditToggle,
  onToggle,
  onPatch,
  disabled,
}: {
  action: PlanAction;
  editing: boolean;
  onEditToggle: () => void;
  onToggle: (apply: boolean) => void;
  onPatch: (args: Record<string, unknown>) => void;
  disabled: boolean;
}) {
  const invalid = action.status === "invalid";
  const args = action.args as Record<string, string | number | null | undefined>;

  return (
    <li
      className={`rounded-[10px] border px-3.5 py-3 transition ${
        invalid
          ? "border-error/30 bg-error-soft/40"
          : action.apply
            ? "border-line bg-surface"
            : "border-line bg-surface-2/60 opacity-70"
      }`}
    >
      <div className="flex items-start gap-3">
        <label className="mt-0.5 inline-flex cursor-pointer items-center" title={action.apply ? "Enabled" : "Disabled"}>
          <input
            type="checkbox"
            className="peer sr-only"
            checked={action.apply}
            disabled={disabled || invalid}
            onChange={(event) => onToggle(event.target.checked)}
            aria-label={`Include ${action.label}`}
          />
          <span
            className={`flex h-4 w-4 items-center justify-center rounded-[4px] border-[1.5px] transition ${
              action.apply ? "border-accent bg-accent text-white" : "border-muted bg-surface"
            }`}
          >
            {action.apply ? <CheckCircle2 size={11} aria-hidden="true" /> : null}
          </span>
        </label>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`text-[13.5px] font-semibold ${action.apply ? "text-ink" : "text-muted"}`}>
              {action.label}
            </p>
            <span className="chip font-mono" style={{ height: 20, fontSize: 11 }}>
              {action.tool}
            </span>
            {invalid ? <span className="chip chip-error" style={{ height: 20, fontSize: 11 }}>invalid</span> : null}
            {action.status === "skipped" && !invalid ? (
              <span className="chip chip-warning" style={{ height: 20, fontSize: 11 }}>skipped</span>
            ) : null}
          </div>
          <p className="mt-1 text-[12.5px] leading-5 text-muted">{action.detail}</p>
          {action.result ? (
            <p className={`mt-1 text-[12.5px] ${action.result.ok ? "text-success" : "text-error"}`}>
              {action.result.message}
            </p>
          ) : null}

          {editing ? (
            <div className="mt-3 grid gap-2 rounded-[8px] border border-line bg-surface-2 p-3 sm:grid-cols-2">
              {typeof args.title === "string" ? (
                <label className="text-[12px] text-muted">
                  Title
                  <input
                    className="field mt-1"
                    value={args.title}
                    onChange={(event) => onPatch({ title: event.target.value })}
                  />
                </label>
              ) : null}
              {typeof args.name === "string" ? (
                <label className="text-[12px] text-muted">
                  Item
                  <input
                    className="field mt-1"
                    value={args.name}
                    onChange={(event) => onPatch({ name: event.target.value })}
                  />
                </label>
              ) : null}
              {typeof args.quantity === "number" ? (
                <label className="text-[12px] text-muted">
                  Quantity
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    className="field tnum mt-1"
                    value={args.quantity}
                    onChange={(event) => onPatch({ quantity: Number(event.target.value) })}
                  />
                </label>
              ) : null}
              {typeof args.date === "string" || typeof args.due_date === "string" ? (
                <label className="text-[12px] text-muted">
                  Date
                  <input
                    type="date"
                    className="field tnum mt-1"
                    value={(args.date ?? args.due_date) as string}
                    onChange={(event) =>
                      onPatch(args.date !== undefined ? { date: event.target.value } : { due_date: event.target.value })
                    }
                  />
                </label>
              ) : null}
              {args.start_time !== undefined || args.due_time !== undefined ? (
                <label className="text-[12px] text-muted">
                  {args.start_time !== undefined ? "Start" : "Due time"}
                  <input
                    type="time"
                    className="field tnum mt-1"
                    value={(args.start_time ?? args.due_time ?? "") as string}
                    onChange={(event) =>
                      onPatch(args.start_time !== undefined ? { start_time: event.target.value } : { due_time: event.target.value })
                    }
                  />
                </label>
              ) : null}
              {args.end_time !== undefined ? (
                <label className="text-[12px] text-muted">
                  End
                  <input
                    type="time"
                    className="field tnum mt-1"
                    value={(args.end_time ?? "") as string}
                    onChange={(event) => onPatch({ end_time: event.target.value })}
                  />
                </label>
              ) : null}
            </div>
          ) : null}
        </div>

        {!disabled ? (
          <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={onEditToggle}>
            {editing ? <Undo2 size={14} aria-hidden="true" /> : <Pencil size={14} aria-hidden="true" />}
            {editing ? "Done" : "Edit"}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function ExecutionView({ result, onDone }: { result: ExecutionResult; onDone: () => void }) {
  const tone =
    result.failedCount > 0
      ? result.appliedCount > 0
        ? "warning"
        : "error"
      : "success";

  return (
    <div className="mx-auto max-w-[820px] space-y-5">
      <header>
        <span
          className={`chip ${tone === "success" ? "chip-success" : tone === "warning" ? "chip-warning" : "chip-error"}`}
        >
          {result.status === "applied" ? "Applied successfully" : result.status === "partially_applied" ? "Partially applied" : "Failed"}
        </span>
        <h2 className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-ink">
          {result.appliedCount} action{result.appliedCount === 1 ? "" : "s"} executed
          {result.skippedCount > 0 ? `, ${result.skippedCount} skipped` : ""}
          {result.failedCount > 0 ? `, ${result.failedCount} failed` : ""}
        </h2>
        <p className="mt-1 text-[13.5px] text-muted">
          Every line below is the server's own report from the MCP tool that ran it.
        </p>
      </header>

      <section className="card divide-y divide-line">
        {result.results.map((entry) => (
          <div key={entry.actionId} className="flex items-start gap-3 px-4 py-3">
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                entry.status === "applied"
                  ? "bg-success-soft text-success"
                  : entry.status === "skipped"
                    ? "bg-warning-soft text-warning"
                    : "bg-error-soft text-error"
              }`}
            >
              {entry.status === "applied" ? (
                <CheckCircle2 size={13} aria-hidden="true" />
              ) : entry.status === "skipped" ? (
                <Undo2 size={13} aria-hidden="true" />
              ) : (
                <XCircle size={13} aria-hidden="true" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-ink">{entry.label}</p>
              <p className="mt-0.5 text-[12.5px] leading-5 text-muted">{entry.message}</p>
            </div>
            <span className="chip shrink-0 font-mono" style={{ height: 20, fontSize: 11 }}>
              {entry.tool}
            </span>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={onDone}>
          Back to overview
        </button>
      </div>

      <p className="text-[12.5px] text-muted">
        Plan {result.plan.id} · created {prettyDate(dateKeyFromIso(result.plan.createdAt))}{" "}
        {prettyTime(new Date(result.plan.createdAt).toTimeString().slice(0, 5))}
      </p>
    </div>
  );
}

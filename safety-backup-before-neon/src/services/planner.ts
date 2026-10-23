import { findScheduleConflicts, findTaskDuplicates } from "../domain/conflicts.js";
import { newId, nowIso } from "../domain/ids.js";
import { toDateKey } from "../domain/dates.js";
import type {
  Conflict,
  Plan,
  PlanAction,
  PlanStatus,
  PlanWarning,
} from "../domain/types.js";
import { toolDefByName } from "../mcp/tooldefs.js";
import type { ProposalFallback, RawPlanAction } from "./ai/types.js";
import type { AiProvider, ProviderInfo } from "./ai/types.js";
import type { Store } from "./store.js";
import { NotFoundError } from "./store.js";

/**
 * The planner is the safety layer between a natural-language request and the
 * database. It turns provider output into a *proposed* plan, validates every
 * action against the real MCP tool schemas, shows conflicts, and only ever
 * applies actions after explicit approval — always by running them through the
 * same tool implementations the MCP endpoint exposes.
 */

export interface ProposeResult {
  plan: Plan;
  provider: ProviderInfo;
  fallbackReason?: string;
  /** Present when the configured model failed and the local planner answered. */
  fallback?: ProposalFallback;
  latencyMs: number;
}

export interface ExecutionActionResult {
  actionId: string;
  tool: string;
  label: string;
  ok: boolean;
  status: PlanAction["status"];
  message: string;
  entityId: string | null;
}

export interface ExecutionResult {
  plan: Plan;
  status: PlanStatus;
  results: ExecutionActionResult[];
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
}

export interface ValidationResult {
  valid: boolean;
  plan: Plan;
  warnings: PlanWarning[];
  actionChecks: Array<{ id: string; label: string; tool: string; valid: boolean; message?: string }>;
}

const DOMAIN_BY_TOOL_GROUP: Record<string, PlanAction["domain"]> = {
  tasks: "tasks",
  household: "tasks",
  schedule: "schedule",
  groceries: "groceries",
  planning: "tasks",
};

export class Planner {
  constructor(
    private readonly store: Store,
    private readonly provider: AiProvider,
  ) {}

  providerInfo(): ProviderInfo {
    return this.provider.info();
  }

  async health(): Promise<{ available: boolean; detail: string }> {
    return this.provider.health();
  }

  /** Controlled test hook used by POST /api/provider/simulate-quota. */
  simulateQuotaExhausted(): void {
    this.provider.simulateQuotaExhausted?.();
  }

  /* ------------------------------- propose -------------------------------- */

  async propose(input: { request: string; referenceDate?: string }): Promise<ProposeResult> {
    const request = input.request.trim();
    if (request.length < 5) {
      throw new Error("The request is too short to plan from. Describe what should happen.");
    }
    const referenceDate = input.referenceDate ?? toDateKey();
    const household = await this.store.getHousehold();
    const output = await this.provider.propose({
      request,
      referenceDate,
      household,
      tasks: await this.store.listTasks(),
      events: await this.store.listEvents({ from: referenceDate }),
      groceries: await this.store.listGroceries(),
    });

    const actions = normalizeActions(output.extraction.actions);
    const warnings = await this.computeWarnings(actions);
    const plan: Plan = {
      id: newId("plan"),
      title: output.extraction.title,
      requestText: request,
      summary: output.extraction.summary,
      assumptions: output.extraction.assumptions,
      clarification: output.extraction.clarification,
      warnings,
      actions,
      status: "proposed",
      provider: this.provider.info().name,
      // A fallback plan was produced locally, not by the live model.
      providerMode: output.fallback ? "demo" : this.provider.info().mode,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.store.savePlan(plan);
    await this.store.logActivity({
      kind: "plan",
      tool: "generate_household_plan",
      summary: `Proposed plan "${plan.title}" (${actions.length} actions)`,
      detail: {
        planId: plan.id,
        provider: this.provider.info(),
        fallbackReason: output.fallbackReason ?? null,
        fallbackKind: output.fallback?.kind ?? null,
        simulated: output.fallback?.simulated ?? false,
        warnings: warnings.length,
      },
      status: "ok",
      origin: "server",
    });

    return {
      plan,
      provider: this.provider.info(),
      fallbackReason: output.fallbackReason,
      fallback: output.fallback,
      latencyMs: output.latencyMs,
    };
  }

  /* -------------------------------- edit ---------------------------------- */

  async updateAction(
    planId: string,
    actionId: string,
    patch: { apply?: boolean; label?: string; args?: Record<string, unknown> },
  ): Promise<Plan> {
    const plan = await this.requireOpenPlan(planId);
    const actions = plan.actions.map((action) => {
      if (action.id !== actionId) return action;
      const nextArgs = patch.args ? { ...action.args, ...patch.args } : action.args;
      const def = toolDefByName.get(action.tool);
      const parsed = def ? def.schema.safeParse(nextArgs) : null;
      const invalid = Boolean(parsed && !parsed.success);
      return {
        ...action,
        args: nextArgs,
        label: patch.label?.trim() || action.label,
        // An action with invalid arguments can never run, so it is disabled too.
        apply: invalid ? false : (patch.apply ?? action.apply),
        ...(parsed && !parsed.success
          ? {
              status: "invalid" as const,
              result: {
                ok: false,
                entityId: null,
                message: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
              },
            }
          : parsed?.success
            ? { status: "pending" as const, result: null }
            : {}),
      };
    });
    const updated = await this.store.updatePlan(planId, { actions, warnings: await this.computeWarnings(actions) });
    return updated;
  }

  /* ------------------------------- validate ------------------------------- */

  async validate(planId: string): Promise<ValidationResult> {
    const plan = await this.store.getPlan(planId);
    if (!plan) throw new NotFoundError("Plan", planId);

    const revalidated = plan.actions.map((action) => {
      const def = toolDefByName.get(action.tool);
      if (!def) {
        return {
          ...action,
          apply: false,
          status: "invalid" as const,
          result: { ok: false, entityId: null, message: `Unknown MCP tool "${action.tool}".` },
        };
      }
      const parsed = def.schema.safeParse(action.args);
      if (!parsed.success) {
        return {
          ...action,
          apply: false,
          status: "invalid" as const,
          result: {
            ok: false,
            entityId: null,
            message: parsed.error.issues
              .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
              .join("; "),
          },
        };
      }
      return { ...action, status: "pending" as const, result: null, args: parsed.data as Record<string, unknown> };
    });

    const warnings = await this.computeWarnings(revalidated);
    // Applied plans are immutable: report the checks, but never rewrite history.
    const isApplied = plan.status === "applied" || plan.status === "partially_applied";
    if (!isApplied) {
      await this.store.updatePlan(planId, { actions: revalidated, warnings });
    }
    const refreshed = (await this.store.getPlan(planId))!;

    return {
      valid: !revalidated.some((action) => action.status === "invalid") && !warnings.some((w) => w.severity === "error"),
      plan: refreshed,
      warnings,
      actionChecks: revalidated.map((action) => ({
        id: action.id,
        label: action.label,
        tool: action.tool,
        valid: action.status !== "invalid",
        message: action.result?.message ?? undefined,
      })),
    };
  }

  /* -------------------------------- approve ------------------------------- */

  async approve(planId: string): Promise<ExecutionResult> {
    const plan = await this.requireOpenPlan(planId);
    if (plan.status === "cancelled") {
      throw new Error(`Plan ${planId} was cancelled and cannot be approved.`);
    }
    if (plan.status === "applied" || plan.status === "partially_applied") {
      throw new Error(`Plan ${planId} has already been applied. Refresh to see the results.`);
    }
    // Re-validate on the server from the *stored* plan — never from the client payload.
    await this.validate(planId);
    await this.store.updatePlan(planId, { status: "approved" });
    return this.execute(planId);
  }

  async cancel(planId: string): Promise<Plan> {
    const plan = await this.store.getPlan(planId);
    if (!plan) throw new NotFoundError("Plan", planId);
    if (plan.status === "applied" || plan.status === "partially_applied") {
      throw new Error("This plan has already been applied and cannot be cancelled. Use the task, schedule or grocery tools to undo individual actions.");
    }
    const updated = await this.store.updatePlan(planId, { status: "cancelled" });
    await this.store.logActivity({
      kind: "plan",
      tool: null,
      summary: `Cancelled plan "${plan.title}"`,
      detail: { planId },
      status: "ok",
      origin: "server",
    });
    return updated;
  }

  /* -------------------------------- execute ------------------------------- */

  async execute(planId: string): Promise<ExecutionResult> {
    const plan = await this.store.getPlan(planId);
    if (!plan) throw new NotFoundError("Plan", planId);
    if (plan.status === "applied" || plan.status === "partially_applied") {
      throw new Error(`Plan ${planId} has already been applied. Refresh to see the results.`);
    }
    if (plan.status === "cancelled") {
      throw new Error(`Plan ${planId} was cancelled and cannot be applied.`);
    }

    const results: ExecutionActionResult[] = [];
    const actions: PlanAction[] = [];

    for (const action of plan.actions) {
      if (!action.apply) {
        actions.push({ ...action, status: "skipped", result: { ok: true, entityId: null, message: "Disabled by the user." } });
        results.push({
          actionId: action.id,
          tool: action.tool,
          label: action.label,
          ok: true,
          status: "skipped",
          message: "Disabled by the user.",
          entityId: null,
        });
        continue;
      }

      const def = toolDefByName.get(action.tool);
      if (!def) {
        actions.push({ ...action, status: "invalid", result: { ok: false, entityId: null, message: `Unknown MCP tool "${action.tool}".` } });
        results.push({
          actionId: action.id,
          tool: action.tool,
          label: action.label,
          ok: false,
          status: "invalid",
          message: `Unknown MCP tool "${action.tool}".`,
          entityId: null,
        });
        continue;
      }

      try {
        // Stamp provenance so created records can be traced back to this plan.
        const args =
          action.tool === "create_task" || action.tool === "create_schedule_event" || action.tool === "add_grocery_item"
            ? { ...action.args, plan_id: plan.id }
            : action.args;
        const payload = (await def.run(args, {
          store: this.store,
          getPlanner: () => this,
        })) as Record<string, unknown>;
        const message = typeof payload.message === "string" ? payload.message : `${action.tool} completed`;
        const entityId =
          ((payload.task as { id?: string } | undefined)?.id ??
            (payload.item as { id?: string } | undefined)?.id ??
            (payload.event as { id?: string } | undefined)?.id ??
            null) as string | null;
        const skippedDuplicate = payload.duplicate === true || payload.alreadyCompleted === true;
        const status: PlanAction["status"] = skippedDuplicate ? "skipped" : "applied";
        actions.push({ ...action, status, result: { ok: true, entityId, message } });
        results.push({
          actionId: action.id,
          tool: action.tool,
          label: action.label,
          ok: true,
          status,
          message,
          entityId,
        });
        await this.store.logActivity({
          kind: "mcp_tool",
          tool: action.tool,
          summary: message,
          detail: { args: action.args, result: payload, planId: plan.id, actionId: action.id },
          status: "ok",
          origin: "plan-executor",
        });
      } catch (error) {
        const message = (error as Error).message;
        actions.push({ ...action, status: "failed", result: { ok: false, entityId: null, message } });
        results.push({
          actionId: action.id,
          tool: action.tool,
          label: action.label,
          ok: false,
          status: "failed",
          message,
          entityId: null,
        });
        await this.store.logActivity({
          kind: "mcp_tool",
          tool: action.tool,
          summary: `Plan action failed: ${message}`,
          detail: { args: action.args, error: message, planId: plan.id, actionId: action.id },
          status: "error",
          origin: "plan-executor",
        });
      }
    }

    const appliedCount = results.filter((r) => r.status === "applied").length;
    const skippedCount = results.filter((r) => r.status === "skipped").length;
    const failedCount = results.filter((r) => r.status === "failed" || r.status === "invalid").length;
    const enabled = appliedCount + failedCount;
    const status: PlanStatus =
      enabled === 0
        ? plan.status === "approved"
          ? "applied"
          : plan.status
        : failedCount === 0
          ? "applied"
          : appliedCount === 0
            ? "failed"
            : "partially_applied";

    const updated = await this.store.updatePlan(planId, { actions, status });
    await this.store.logActivity({
      kind: "plan",
      tool: "apply_approved_plan",
      summary:
        status === "applied"
          ? `Plan "${plan.title}" applied — ${appliedCount} action(s) executed${skippedCount ? `, ${skippedCount} skipped` : ""}`
          : status === "partially_applied"
            ? `Plan "${plan.title}" partially applied — ${appliedCount} ok, ${failedCount} failed`
            : `Plan "${plan.title}" failed — ${failedCount} action(s) failed`,
      detail: { planId, status, results },
      status: failedCount > 0 ? "error" : "ok",
      origin: "plan-executor",
    });

    return { plan: updated, status, results, appliedCount, skippedCount, failedCount };
  }

  /* -------------------------------- helpers ------------------------------- */

  private async requireOpenPlan(planId: string): Promise<Plan> {
    const plan = await this.store.getPlan(planId);
    if (!plan) throw new NotFoundError("Plan", planId);
    return plan;
  }

  private async computeWarnings(actions: PlanAction[]): Promise<PlanWarning[]> {
    const warnings: PlanWarning[] = [];

    const candidates = actions
      .filter((action) => action.apply && action.tool === "create_schedule_event" && action.status !== "invalid")
      .map((action) => ({
        actionId: action.id,
        title: String(action.args.title ?? "Untitled event"),
        date: String(action.args.date ?? ""),
        startTime: (action.args.start_time as string | undefined) ?? null,
        endTime: (action.args.end_time as string | undefined) ?? null,
      }));

    const conflicts: Array<Conflict & { actionIds: string[] }> = candidates.length
      ? findScheduleConflicts(
          await this.store.listEvents({ from: "1970-01-01" }),
          candidates.map(({ title, date, startTime, endTime }) => ({ title, date, startTime, endTime })),
        ).map((conflict) => ({
          ...conflict,
          actionIds: candidates
            .filter((candidate) => conflict.message.includes(`"${candidate.title}"`))
            .map((candidate) => candidate.actionId),
        }))
      : [];

    const taskCandidates = actions
      .filter((action) => action.apply && action.tool === "create_task" && action.status !== "invalid")
      .map((action) => ({
        actionId: action.id,
        title: String(action.args.title ?? "Untitled task"),
        dueDate: (action.args.due_date as string | undefined) ?? null,
      }));
    const duplicates = findTaskDuplicates(
      await this.store.listTasks(),
      taskCandidates.map(({ title, dueDate }) => ({ title, dueDate })),
    ).map((conflict) => ({
      ...conflict,
      actionIds: taskCandidates
        .filter((candidate) => conflict.message.includes(`"${candidate.title}"`))
        .map((candidate) => candidate.actionId),
    }));

    for (const conflict of [...conflicts, ...duplicates]) {
      warnings.push({
        code: conflict.kind,
        message: conflict.message,
        severity: conflict.severity === "info" ? "info" : "warning",
        actionIds: conflict.actionIds,
      });
    }

    const invalid = actions.filter((action) => action.status === "invalid");
    for (const action of invalid) {
      warnings.push({
        code: "invalid_action",
        message: `"${action.label}" cannot run: ${action.result?.message ?? "invalid arguments"}`,
        severity: "error",
        actionIds: [action.id],
      });
    }

    if (actions.every((action) => !action.apply)) {
      warnings.push({
        code: "all_disabled",
        message: "Every action is currently disabled — approving will not change any data.",
        severity: "warning",
        actionIds: [],
      });
    }

    return warnings;
  }
}

/** Validate raw provider actions against the real MCP tool schemas. */
export function normalizeActions(raw: RawPlanAction[]): PlanAction[] {
  return raw.map((action, index) => {
    const id = newId("act");
    const def = toolDefByName.get(action.tool);
    if (!def) {
      return {
        id,
        tool: action.tool,
        args: action.args ?? {},
        label: action.label ?? action.tool,
        detail: action.detail ?? null,
        domain: "tasks" as const,
        apply: false,
        status: "invalid" as const,
        result: {
          ok: false,
          entityId: null,
          message: `"${action.tool}" is not an MCP tool this server exposes. The action was blocked.`,
        },
      };
    }
    const parsed = def.schema.safeParse(action.args ?? {});
    const label =
      action.label?.trim() ||
      (typeof (parsed.success ? parsed.data.title : undefined) === "string"
        ? String((parsed.data as { title: string }).title)
        : `${def.name} #${index + 1}`);
    if (!parsed.success) {
      return {
        id,
        tool: def.name,
        args: action.args ?? {},
        label,
        detail: action.detail ?? null,
        domain: DOMAIN_BY_TOOL_GROUP[def.domain] ?? "tasks",
        apply: false,
        status: "invalid" as const,
        result: {
          ok: false,
          entityId: null,
          message: parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
            .join("; "),
        },
      };
    }
    return {
      id,
      tool: def.name,
      args: parsed.data as Record<string, unknown>,
      label,
      detail: action.detail ?? null,
      domain: DOMAIN_BY_TOOL_GROUP[def.domain] ?? "tasks",
      apply: true,
      status: "pending",
      result: null,
    };
  });
}

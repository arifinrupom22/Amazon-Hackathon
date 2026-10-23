import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "../lib/api";
import { callTool, getMcpClient, getTraceHistory, listTools, resetMcpClient, subscribeTrace } from "../lib/mcp";
import { todayKey } from "../lib/format";
import { loadVoicePreferences, normalizeVoicePreferences, saveVoicePreferences } from "../lib/voice/preferences";
import type { VoicePreferences } from "../lib/voice/types";
import type {
  ActivityEntry,
  ExecutionResult,
  GroceryItem,
  Plan,
  PlanAction,
  ProposeResponse,
  ProviderFallback,
  ScheduleEvent,
  StatusResponse,
  Task,
  TraceEntry,
} from "../lib/types";

export type View =
  | "overview"
  | "assistant"
  | "review"
  | "tasks"
  | "schedule"
  | "groceries"
  | "household";

interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
}

interface AppStateShape {
  view: View;
  setView: (view: View) => void;
  status: StatusResponse | null;
  tasks: Task[];
  events: ScheduleEvent[];
  groceries: GroceryItem[];
  activity: ActivityEntry[];
  trace: TraceEntry[];
  plans: Plan[];
  activePlan: Plan | null;
  setActivePlan: (plan: Plan | null) => void;
  loading: boolean;
  refreshing: boolean;
  mcp: { connecting: boolean; connected: boolean; error: string | null; toolCount: number };
  /** Voice language, spoken replies and playback settings (localStorage). */
  voice: VoicePreferences;
  updateVoice: (patch: Partial<VoicePreferences>) => void;
  /** Transient notice shown after a live provider degraded to the local planner. */
  providerNotice: ProviderFallback | null;
  dismissProviderNotice: () => void;
  toasts: Toast[];
  notify: (message: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
  refreshAll: (options?: { silent?: boolean }) => Promise<void>;
  runTool: <T = Record<string, unknown>>(name: string, args?: Record<string, unknown>) => Promise<T>;
  addTask: (input: { title: string; dueDate?: string | null; dueTime?: string | null; assignee?: string | null; category?: string | null; priority?: string }) => Promise<void>;
  completeTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  addGrocery: (input: { name: string; quantity?: number; unit?: string | null; category?: string | null }) => Promise<void>;
  togglePurchased: (item: GroceryItem) => Promise<void>;
  deleteGrocery: (id: string) => Promise<void>;
  addEvent: (input: { title: string; date: string; startTime?: string | null; endTime?: string | null; location?: string | null }) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  proposePlan: (request: string) => Promise<Plan>;
  runQuotaFallbackTest: () => Promise<Plan>;
  patchPlanActions: (planId: string, updates: Array<{ id: string; apply?: boolean; args?: Record<string, unknown>; label?: string }>) => Promise<void>;
  approvePlan: (planId: string) => Promise<ExecutionResult>;
  cancelPlan: (planId: string) => Promise<void>;
  resetDemo: () => Promise<void>;
}

const AppState = createContext<AppStateShape | null>(null);

export function useAppState(): AppStateShape {
  const ctx = useContext(AppState);
  if (!ctx) throw new Error("useAppState must be used inside <AppStateProvider>");
  return ctx;
}

let toastSeq = 0;

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>("overview");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [groceries, setGroceries] = useState<GroceryItem[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [trace, setTrace] = useState<TraceEntry[]>(() => getTraceHistory());
  const [plans, setPlans] = useState<Plan[]>([]);
  const [activePlan, setActivePlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mcp, setMcp] = useState<{ connecting: boolean; connected: boolean; error: string | null; toolCount: number }>({
    connecting: true,
    connected: false,
    error: null,
    toolCount: 0,
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [providerNotice, setProviderNotice] = useState<ProviderFallback | null>(null);
  const [voice, setVoice] = useState<VoicePreferences>(() => loadVoicePreferences());
  const booted = useRef(false);

  const notify = useCallback((message: string, kind: Toast["kind"] = "info") => {
    const id = ++toastSeq;
    setToasts((current) => [...current, { id, kind, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 6000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => subscribeTrace((entry) => setTrace((current) => [entry, ...current].slice(0, 120))), []);

  const runTool = useCallback(async <T,>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    return callTool<T>(name, args);
  }, []);

  const refreshAll = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!options.silent) setRefreshing(true);
      try {
        const [summary, taskList, schedule, groceryList, activityFeed, planList, statusPayload] =
          await Promise.all([
            callTool<{ today: { date: string } }>("get_household_summary", {}),
            callTool<{ tasks: Task[] }>("list_tasks", {}),
            callTool<{ events: ScheduleEvent[] }>("list_schedule", { from: todayKey() }),
            callTool<{ items: GroceryItem[] }>("list_grocery_items", { include_purchased: true }),
            api.activity(40),
            api.plans(),
            api.status(),
          ]);
        void summary;
        setTasks(taskList.tasks);
        setEvents(schedule.events);
        setGroceries(groceryList.items);
        setActivity(activityFeed.activity);
        setPlans(planList.plans);
        setStatus(statusPayload);
        setMcp((current) => ({ ...current, connected: true, error: null }));
      } catch (error) {
        setMcp((current) => ({ ...current, error: (error as Error).message }));
      } finally {
        setLoading(false);
        if (!options.silent) setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      try {
        await getMcpClient();
        const tools = await listTools();
        setMcp((current) => ({ ...current, connecting: false, connected: true, toolCount: tools.length }));
      } catch (error) {
        setMcp((current) => ({
          ...current,
          connecting: false,
          connected: false,
          error: `Cannot reach the MCP server at /mcp — ${(error as Error).message}`,
        }));
      }
      await refreshAll({ silent: true });
    })();
  }, [refreshAll]);

  const afterMutation = useCallback(async () => {
    await refreshAll({ silent: true });
  }, [refreshAll]);

  const addTask = useCallback<AppStateShape["addTask"]>(
    async (input) => {
      await callTool("create_task", {
        title: input.title,
        due_date: input.dueDate ?? undefined,
        due_time: input.dueTime ?? undefined,
        assignee: input.assignee ?? undefined,
        category: input.category ?? undefined,
        priority: input.priority ?? "medium",
      });
      notify("Task created via create_task", "success");
      await afterMutation();
    },
    [afterMutation, notify],
  );

  const completeTask = useCallback<AppStateShape["completeTask"]>(
    async (id) => {
      await callTool("complete_task", { id });
      notify("Task completed via complete_task", "success");
      await afterMutation();
    },
    [afterMutation, notify],
  );

  const deleteTask = useCallback<AppStateShape["deleteTask"]>(
    async (id) => {
      await callTool("delete_task", { id, confirm: true });
      notify("Task deleted via delete_task", "info");
      await afterMutation();
    },
    [afterMutation, notify],
  );

  const addGrocery = useCallback<AppStateShape["addGrocery"]>(
    async (input) => {
      await callTool("add_grocery_item", {
        name: input.name,
        quantity: input.quantity ?? 1,
        unit: input.unit ?? undefined,
        category: input.category ?? undefined,
      });
      notify("Grocery item added via add_grocery_item", "success");
      await afterMutation();
    },
    [afterMutation, notify],
  );

  const togglePurchased = useCallback<AppStateShape["togglePurchased"]>(
    async (item) => {
      await callTool("mark_grocery_item_purchased", { id: item.id, purchased: !item.purchased });
      await afterMutation();
    },
    [afterMutation],
  );

  const deleteGrocery = useCallback<AppStateShape["deleteGrocery"]>(
    async (id) => {
      await callTool("remove_grocery_item", { id, confirm: true });
      notify("Grocery item removed via remove_grocery_item", "info");
      await afterMutation();
    },
    [afterMutation, notify],
  );

  const addEvent = useCallback<AppStateShape["addEvent"]>(
    async (input) => {
      await callTool("create_schedule_event", {
        title: input.title,
        date: input.date,
        start_time: input.startTime ?? undefined,
        end_time: input.endTime ?? undefined,
        location: input.location ?? undefined,
      });
      notify("Event created via create_schedule_event", "success");
      await afterMutation();
    },
    [afterMutation, notify],
  );

  const deleteEvent = useCallback<AppStateShape["deleteEvent"]>(
    async (id) => {
      await callTool("delete_schedule_event", { id, confirm: true });
      notify("Event removed via delete_schedule_event", "info");
      await afterMutation();
    },
    [afterMutation, notify],
  );

  const applyProposal = useCallback((result: ProposeResponse): Plan => {
    setPlans((current) => [result.plan, ...current.filter((plan) => plan.id !== result.plan.id)]);
    setActivePlan(result.plan);
    // A successful model answer clears an older fallback notice; a fallback
    // (real or simulated) shows the notice the server returned.
    setProviderNotice(result.fallback ?? null);
    return result.plan;
  }, []);

  const proposePlan = useCallback<AppStateShape["proposePlan"]>(
    async (request) => applyProposal(await api.propose(request)),
    [applyProposal],
  );

  const runQuotaFallbackTest = useCallback<AppStateShape["runQuotaFallbackTest"]>(async () => {
    // Arm the server for exactly one simulated quota-exhausted response, then
    // send a normal request so the fallback path runs for real.
    await api.simulateQuota();
    return applyProposal(
      await api.propose("Add oat milk, lemons and sourdough bread to the grocery list for Saturday."),
    );
  }, [applyProposal]);

  const dismissProviderNotice = useCallback(() => setProviderNotice(null), []);

  const updateVoice = useCallback((patch: Partial<VoicePreferences>) => {
    setVoice((current) => normalizeVoicePreferences({ ...current, ...patch }));
  }, []);

  useEffect(() => {
    saveVoicePreferences(voice);
  }, [voice]);

  const patchPlanActions = useCallback<AppStateShape["patchPlanActions"]>(
    async (planId, updates) => {
      const result = await api.patchPlan(planId, { actions: updates });
      setPlans((current) => current.map((plan) => (plan.id === result.plan.id ? result.plan : plan)));
      setActivePlan((current) => (current && current.id === result.plan.id ? result.plan : current));
    },
    [],
  );

  const approvePlan = useCallback<AppStateShape["approvePlan"]>(
    async (planId) => {
      const result = await api.approvePlan(planId);
      setPlans((current) => current.map((plan) => (plan.id === result.plan.id ? result.plan : plan)));
      setActivePlan(result.plan);
      await afterMutation();
      return result;
    },
    [afterMutation],
  );

  const cancelPlan = useCallback<AppStateShape["cancelPlan"]>(
    async (planId) => {
      const result = await api.cancelPlan(planId);
      setPlans((current) => current.map((plan) => (plan.id === result.plan.id ? result.plan : plan)));
      setActivePlan(null);
      notify("Plan cancelled — nothing was changed", "info");
    },
    [notify],
  );

  const resetDemo = useCallback(async () => {
    await api.resetDemo();
    await resetMcpClient();
    setActivePlan(null);
    await refreshAll({ silent: true });
    notify("Sample household data restored", "success");
  }, [notify, refreshAll]);

  const value = useMemo<AppStateShape>(
    () => ({
      view,
      setView,
      status,
      tasks,
      events,
      groceries,
      activity,
      trace,
      plans,
      activePlan,
      setActivePlan,
      loading,
      refreshing,
      mcp,
      voice,
      updateVoice,
      providerNotice,
      dismissProviderNotice,
      toasts,
      notify,
      dismissToast,
      refreshAll,
      runTool,
      addTask,
      completeTask,
      deleteTask,
      addGrocery,
      togglePurchased,
      deleteGrocery,
      addEvent,
      deleteEvent,
      proposePlan,
      runQuotaFallbackTest,
      patchPlanActions,
      approvePlan,
      cancelPlan,
      resetDemo,
    }),
    [
      view,
      status,
      tasks,
      events,
      groceries,
      activity,
      trace,
      plans,
      activePlan,
      loading,
      refreshing,
      mcp,
      toasts,
      notify,
      dismissToast,
      refreshAll,
      runTool,
      addTask,
      completeTask,
      deleteTask,
      addGrocery,
      togglePurchased,
      deleteGrocery,
      addEvent,
      deleteEvent,
      proposePlan,
      runQuotaFallbackTest,
      patchPlanActions,
      approvePlan,
      cancelPlan,
      resetDemo,
      providerNotice,
      dismissProviderNotice,
      voice,
      updateVoice,
    ],
  );

  return <AppState.Provider value={value}>{children}</AppState.Provider>;
}

export type { PlanAction };

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  ExternalLink,
  PlayCircle,
  RotateCcw,
  Server,
  Users,
} from "lucide-react";
import { useAppState } from "../state/store";
import { getProtocolVersion, getServerInfo, listTools, MCP_ENDPOINT } from "../lib/mcp";
import { ConfirmButton, SectionHeader } from "../components/ui";

export function Household() {
  const { status, resetDemo, runTool, notify, setView, runQuotaFallbackTest } = useAppState();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [fallbackBusy, setFallbackBusy] = useState(false);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);

  const tools = status?.tools ?? [];
  const byDomain = tools.reduce<Record<string, typeof tools>>((acc, tool) => {
    acc[tool.domain] = [...(acc[tool.domain] ?? []), tool];
    return acc;
  }, {});
  const serverInfo = getServerInfo();

  const runSelfTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const started = performance.now();
      const toolList = await listTools();
      const summary = await runTool<{ household: { name: string }; counts: { openTasks: number } }>(
        "get_household_summary",
        {},
      );
      const elapsed = Math.round(performance.now() - started);
      setTestResult(
        `tools/list returned ${toolList.length} tools · get_household_summary answered for "${summary.household.name}" (${summary.counts.openTasks} open tasks) in ${elapsed}ms.`,
      );
    } catch (error) {
      setTestResult(`Self-test failed: ${(error as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const runFallbackTest = async () => {
    setFallbackBusy(true);
    setFallbackNote(null);
    try {
      await runQuotaFallbackTest();
      setFallbackNote(
        "A simulated quota-exhausted response was returned for one request. The app answered with the local planner, showed the notice, and stayed fully usable. No provider was called and no credits were used.",
      );
      notify("Simulated quota response handled — review the draft plan", "info");
      setView("review");
    } catch (error) {
      setFallbackNote(`Fallback test failed: ${(error as Error).message}`);
    } finally {
      setFallbackBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1040px] space-y-5">
      <header>
        <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">Household &amp; Memory</h2>
        <p className="mt-0.5 max-w-2xl text-[13px] leading-5 text-muted">
          Persistent context the assistant plans against, plus an honest view of which model and MCP server are
          actually running right now.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <SectionHeader title="Household" subtitle="Stored in PostgreSQL, read through MCP tools" />
          <div className="mt-4 flex items-center gap-3 rounded-[10px] border border-line bg-surface-2 px-3.5 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
              <Users size={16} aria-hidden="true" />
            </span>
            <div>
              <p className="text-[14px] font-semibold text-ink">{status?.household.name ?? "—"}</p>
              <p className="text-[12px] text-muted">{status?.household.timezone ?? "—"}</p>
            </div>
          </div>
          <ul className="mt-3 space-y-2">
            {(status?.household.members ?? []).map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="font-medium text-ink">{member.name}</span>
                <span className="text-[12px] text-muted">
                  {member.role}
                  {member.presence ? ` · ${member.presence}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-5">
          <SectionHeader title="Preferences" subtitle="Seeded sample context (read-only in this MVP)" />
          <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Object.entries(status?.household.preferences ?? {}).map(([key, value]) => (
              <div key={key}>
                <dt className="eyebrow">{key.replace(/([A-Z])/g, " $1")}</dt>
                <dd className="mt-0.5 text-[13px] leading-5 text-ink-soft">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[12px] leading-5 text-muted">
            These values are injected into the planner prompt and exposed to MCP clients through{" "}
            <span className="font-mono text-[11.5px]">get_household_preferences</span>. Editing them is not wired to
            the UI yet — reset restores the seeded values.
          </p>
        </section>

        <section className="card p-5">
          <SectionHeader title="Planning model" subtitle="What actually generates plans" />
          <div className="mt-4 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-muted">Provider</span>
              <span className="text-[13px] font-medium text-ink">{status?.provider.label ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-muted">Model</span>
              <span className="font-mono text-[12px] text-ink">{status?.provider.model ?? "none (no model)"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-muted">Endpoint</span>
              <span className="max-w-[55%] truncate font-mono text-[11.5px] text-ink">
                {status?.provider.endpoint ?? "—"}
              </span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-[13px] text-muted">Health</span>
              <span
                className={`max-w-[65%] text-right text-[12px] leading-5 ${
                  status?.providerHealth.available ? "text-success" : "text-warning"
                }`}
              >
                {status?.providerHealth.detail ?? "—"}
              </span>
            </div>
          </div>
          <p className="mt-3 text-[12px] leading-5 text-muted">
            Set <span className="font-mono text-[11.5px]">AI_PROVIDER</span> and the matching key in{" "}
            <span className="font-mono text-[11.5px]">.env</span> to change this. If the live model is unreachable,
            rate-limited or out of credits, the request is answered locally and a dismissible notice explains why.
          </p>
        </section>

        <section className="card p-5">
          <SectionHeader
            title="MCP endpoint"
            subtitle="Official SDK · Streamable HTTP · stateless"
            action={
              <span className="chip chip-accent">
                <Server size={12} aria-hidden="true" />
                {tools.length} tools
              </span>
            }
          />
          <dl className="mt-4 space-y-2.5 text-[13px]">
            <Row label="Endpoint" value={<span className="font-mono text-[12px]">{MCP_ENDPOINT}</span>} />
            <Row
              label="Server"
              value={<span className="font-mono text-[12px]">{serverInfo ? `${serverInfo.name} v${serverInfo.version}` : "—"}</span>}
            />
            <Row label="Transport" value="Streamable HTTP (enableJsonResponse, no session)" />
            <Row label="Health check" value={<a className="text-accent-strong hover:underline" href="/healthz" target="_blank" rel="noreferrer">GET /healthz <ExternalLink size={11} className="inline" /></a>} />
          </dl>
          <button type="button" className="btn btn-secondary btn-sm mt-4" onClick={() => void runSelfTest()} disabled={testing}>
            <Activity size={14} aria-hidden="true" />
            {testing ? "Running self-test…" : "Run MCP self-test"}
          </button>
          {testResult ? (
            <div className="mt-3 flex items-start gap-2 rounded-[8px] border border-line bg-surface-2 px-3 py-2 text-[12.5px] leading-5 text-ink-soft">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              {testResult}
            </div>
          ) : null}
          {getProtocolVersion() ? (
            <p className="mt-2 text-[11.5px] text-muted">MCP protocol {getProtocolVersion()} negotiated with the server.</p>
          ) : null}
        </section>
      </div>

      <section className="card p-5">
        <SectionHeader
          title="Resilience test"
          subtitle="One controlled request that behaves like a quota-exhausted key"
          action={
            <span className="chip">
              <PlayCircle size={12} aria-hidden="true" />
              simulated
            </span>
          }
        />
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-2">
            <p className="text-[13px] leading-6 text-ink-soft">
              Arming this test makes the very next plan request receive the same 429 /{" "}
              <span className="font-mono text-[11.5px]">RESOURCE_EXHAUSTED</span> response Google AI Studio sends when a
              key runs out of credits. The request is handled by the normal fallback path, shows the notification, and
              produces a reviewable plan — nothing is applied and the app stays usable.
            </p>
            <p className="text-[12px] leading-5 text-muted">
              No network request is made for the simulated failure and no real credits are consumed. The next request
              after that goes back to the configured provider normally.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="btn btn-secondary w-full"
              onClick={() => void runFallbackTest()}
              disabled={fallbackBusy}
            >
              <PlayCircle size={14} aria-hidden="true" />
              {fallbackBusy ? "Running test…" : "Simulate quota exhaustion"}
            </button>
            {fallbackNote ? (
              <p className="text-[12px] leading-5 text-muted">{fallbackNote}</p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="card p-5">
        <SectionHeader
          title="Registered MCP tools"
          subtitle="Discovered by this browser through tools/list — every one is callable right now"
          action={<span className="chip">{tools.length} total</span>}
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(byDomain).map(([domain, domainTools]) => (
            <div key={domain} className="rounded-[10px] border border-line bg-surface-2 p-3">
              <p className="eyebrow flex items-center gap-1.5">
                <Cpu size={11} aria-hidden="true" />
                {domain}
              </p>
              <ul className="mt-2 space-y-1">
                {domainTools.map((tool) => (
                  <li key={tool.name} className="font-mono text-[11.5px] leading-5 text-ink-soft" title={tool.description}>
                    {tool.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <SectionHeader
          title="Data &amp; reset"
          subtitle="A clean, reproducible starting point for judging"
          action={
            <span className="chip">
              <Database size={12} aria-hidden="true" />
              PostgreSQL
            </span>
          }
        />
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-2">
            <p className="text-[13px] leading-6 text-ink-soft">
              <span className="font-semibold">Demo scenario:</span> open the AI Assistant, send the suggested Saturday
              prompt, review the staged actions, approve them, then open Tasks, Schedule and Groceries to see the new
              records. Reload the page — everything is still there, because it lives in PostgreSQL rather than memory.
            </p>
            <p className="flex items-start gap-2 text-[12.5px] leading-5 text-muted">
              <PlayCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              Resetting restores the sample household and clears all tasks, events, groceries, plans and activity.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <ConfirmButton
              onConfirm={async () => {
                try {
                  await resetDemo();
                } catch (error) {
                  notify((error as Error).message, "error");
                }
              }}
              confirmTitle="Reset sample data?"
              confirmBody="This replaces the current household data with the seeded demo set. Plans, tasks, events, groceries and activity history are cleared. It cannot be undone."
              confirmLabel="Reset everything"
              className="btn btn-secondary w-full"
            >
              <RotateCcw size={14} aria-hidden="true" />
              Reset sample data
            </ConfirmButton>
          </div>
        </div>
      </section>

      <div className="flex items-start gap-2.5 rounded-[10px] border border-line bg-surface px-4 py-3 text-[12.5px] leading-5 text-muted">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        <p>
          <span className="font-semibold text-ink">Honesty note.</span> HomePilot AI is a self-hosted MCP experience
          with this web app as its demonstration client. It is not connected to an Alexa+ device or account, and no
          restricted Amazon preview tooling is used.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="max-w-[65%] break-words text-right text-ink">{value}</dd>
    </div>
  );
}

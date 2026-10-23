import { useEffect, useRef, useState } from "react";
import { ChevronRight, ListTodo, MessageSquareShare, Sparkles, Square, Volume2 } from "lucide-react";
import { useAppState } from "../state/store";
import { ActivityFeed, McpTracePanel } from "../components/Activity";
import { AssistantComposer } from "../components/AssistantComposer";
import { VoiceSettings } from "../components/VoiceSettings";
import { EmptyState, WarningBanner } from "../components/ui";
import { useSpeechOutput } from "../hooks/useSpeechOutput";
import {
  classifyAssistantCommand,
  executeAssistantCommand,
} from "../lib/assistant/commands";
import { shouldSpeakResponse, spokenErrorMessage, spokenPlanText } from "../lib/voice/speechText";
import type { Plan } from "../lib/types";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  planId?: string;
  warnings?: Plan["warnings"];
  assumptions?: string[];
  clarification?: string | null;
  /** Safe copy for text-to-speech; never contains provider diagnostics. */
  speakText?: string;
  /** Wall-clock milliseconds taken to produce the structured plan, when this is a plan message. */
  latencyMs?: number;
  ts: number;
}

/** Kept outside the component so the thread survives navigation. */
let conversation: Message[] = [];
let messageSeq = 0;

const SUGGESTIONS = [
  "Plan a relaxed Saturday for two. Add grocery items for dinner, schedule a cleaning session in the afternoon, and remind me to prepare dinner before 7 PM.",
  "Plan our weekend. We need groceries for two people, a cleaning session on Saturday, and a reminder to prepare dinner before 7 PM.",
  "We have guests on Saturday at 7 PM. We're out of rice, the living room needs cleaning, and Marcus can't help until 6 PM.",
  "Add oat milk and sourdough bread to the grocery list and remind me to call the plumber at 5 PM tomorrow.",
];

export function Assistant() {
  const {
    proposePlan,
    setView,
    setActivePlan,
    status,
    plans,
    notify,
    voice,
    updateVoice,
    runTool,
    cancelPlan,
    refreshAll,
  } = useAppState();
  const [messages, setMessages] = useState<Message[]>(() => conversation);
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const speech = useSpeechOutput(voice);
  const spokenRef = useRef<string | null>(null);
  // Answers restored from an earlier visit must never be read aloud on mount.
  const restoredIdsRef = useRef(new Set(conversation.map((message) => message.id)));

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // Auto-speak only genuinely new answers. Restored conversations stay silent
  // across re-renders, as do errors (which use calm, generic copy).
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || !last.speakText) return;
    if (restoredIdsRef.current.has(last.id)) return;
    if (
      !shouldSpeakResponse({
        mounted: true,
        autoSpeak: voice.autoSpeak,
        role: last.role,
        messageId: last.id,
        lastSpokenId: spokenRef.current,
      })
    ) {
      return;
    }
    spokenRef.current = last.id;
    speech.speak(last.id, last.speakText);
  }, [messages, voice.autoSpeak, speech]);

  const submit = async (text: string) => {
    speech.stop();
    const userMessage: Message = { id: `m_${++messageSeq}`, role: "user", text, ts: Date.now() };
    const next = [...conversation, userMessage];
    conversation = next;
    setMessages(next);
    setBusy(true);
    try {
      // Read-only questions and a few reversible commands stay out of the plan
      // workflow; everything else goes through the same proposal path.
      const intent = classifyAssistantCommand(text);
      if (intent.kind !== "none") {
        const result = await executeAssistantCommand(intent, {
          runTool,
          plans,
          cancelPlan,
          refresh: () => refreshAll({ silent: true }),
        });
        if (result) {
          const answer: Message = {
            id: `m_${++messageSeq}`,
            role: "assistant",
            text: result.text,
            speakText: result.speakText,
            ts: Date.now(),
          };
          conversation = [...conversation, answer];
          setMessages(conversation);
          return;
        }
      }

      const startedAt = performance.now();
      const plan = await proposePlan(text);
      const latencyMs = Math.round(performance.now() - startedAt);
      const assistant: Message = {
        id: `m_${++messageSeq}`,
        role: "assistant",
        text: plan.summary,
        planId: plan.id,
        warnings: plan.warnings,
        assumptions: plan.assumptions,
        clarification: plan.clarification,
        latencyMs,
        speakText: spokenPlanText({
          summary: plan.summary,
          actionCount: plan.actions.length,
          clarification: plan.clarification,
        }),
        ts: Date.now(),
      };
      conversation = [...conversation, assistant];
      setMessages(conversation);
    } catch (error) {
      notify((error as Error).message, "error");
      const assistant: Message = {
        id: `m_${++messageSeq}`,
        role: "assistant",
        text: `I could not build that plan: ${(error as Error).message}`,
        // The visual message keeps the detail; speech stays free of internals.
        speakText: spokenErrorMessage(),
        ts: Date.now(),
      };
      conversation = [...conversation, assistant];
      setMessages(conversation);
    } finally {
      setBusy(false);
    }
  };

  const openPlan = (planId: string) => {
    const plan = plans.find((candidate) => candidate.id === planId);
    if (plan) {
      setActivePlan(plan);
      setView("review");
    }
  };

  return (
    <div className="mx-auto grid max-w-[1180px] gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <header>
          <p className="eyebrow">Autonomous orchestrator</p>
          <h2 className="mt-1 text-[24px] font-semibold tracking-[-0.02em] text-ink">
            Tell HomePilot what should happen
          </h2>
          <p className="mt-1 max-w-2xl text-[13.5px] leading-6 text-muted">
            Speak or type a request. It becomes a structured plan of real MCP tool actions — you review, edit and
            approve before anything is written.
          </p>
        </header>

        <div
          ref={threadRef}
          className="card flex max-h-[52vh] min-h-[240px] flex-col gap-4 overflow-y-auto p-4"
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <EmptyState
              icon={<MessageSquareShare size={18} />}
              title="Start a planning conversation"
              description="Try one of the suggestions below, or describe your own household situation in plain language."
            />
          ) : (
            messages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="flex justify-end">
                  <p className="max-w-[85%] rounded-[12px] rounded-br-[4px] bg-ink px-3.5 py-2.5 text-[13.5px] leading-6 text-white">
                    {message.text}
                  </p>
                </div>
              ) : (
                <div key={message.id} className="max-w-[92%]">
                  <div className="flex gap-2.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-accent text-white">
                      <Sparkles size={14} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1 rounded-[12px] rounded-tl-[4px] border border-line bg-surface-2 px-3.5 py-3">
                      <p className="text-[13.5px] leading-6 text-ink">{message.text}</p>

                      {message.speakText ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => speech.toggle(message.id, message.speakText!)}
                            disabled={!speech.supported}
                            aria-pressed={speech.speakingId === message.id}
                            title={
                              speech.supported
                                ? speech.speakingId === message.id
                                  ? "Stop reading this answer"
                                  : "Read this answer aloud"
                                : (speech.supportMessage ?? "Spoken replies aren't available in this browser.")
                            }
                            className={`btn btn-ghost btn-sm h-7 px-2 text-[11.5px] ${
                              speech.speakingId === message.id ? "text-accent-strong" : ""
                            }`}
                          >
                            {speech.speakingId === message.id ? (
                              <>
                                <Square size={11} fill="currentColor" aria-hidden="true" />
                                Stop reading
                              </>
                            ) : (
                              <>
                                <Volume2 size={12} aria-hidden="true" />
                                Read aloud
                              </>
                            )}
                          </button>
                          {speech.speakingId === message.id ? (
                            <span className="voice-wave text-accent" aria-hidden="true">
                              <span />
                              <span />
                              <span />
                              <span />
                            </span>
                          ) : null}
                          {!speech.supported ? (
                            <span className="text-[11px] text-muted">Speech output unavailable in this browser</span>
                          ) : null}
                        </div>
                      ) : null}

                      {message.clarification ? (
                        <div className="mt-2">
                          <WarningBanner tone="info">
                            <p>
                              <span className="font-semibold">Question for you:</span> {message.clarification}
                            </p>
                          </WarningBanner>
                        </div>
                      ) : null}

                      {message.warnings && message.warnings.length > 0 ? (
                        <ul className="mt-2 space-y-1.5">
                          {message.warnings.slice(0, 3).map((warning, index) => (
                            <li key={index}>
                              <WarningBanner tone={warning.severity === "info" ? "info" : "warning"}>
                                <p>{warning.message}</p>
                              </WarningBanner>
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      {message.planId ? (
                        <button
                          type="button"
                          onClick={() => openPlan(message.planId!)}
                          className="mt-3 flex w-full items-center justify-between gap-2 rounded-[10px] border border-line bg-surface px-3 py-2.5 text-left transition hover:border-accent/40"
                        >
                          <span className="flex items-center gap-2 text-[13px] font-semibold text-accent-strong">
                            <ListTodo size={14} aria-hidden="true" />
                            Review the proposed plan
                          </span>
                          {typeof message.latencyMs === "number" ? (
                            <span className="shrink-0 font-mono text-[11px] text-muted">
                              {(message.latencyMs / 1000).toFixed(1)}s
                            </span>
                          ) : null}
                          <ChevronRight size={15} className="text-accent" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ),
            )
          )}
          {busy ? (
            <div className="flex items-center gap-2 text-[12.5px] text-muted">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              Asking the {status?.provider.label ?? "provider"} for a structured plan…
            </div>
          ) : null}
        </div>

        <AssistantComposer
          onSubmit={(text) => void submit(text)}
          busy={busy}
          language={voice.language}
          onLanguageChange={(language) => updateVoice({ language })}
          inputProvider={voice.inputProvider}
          onProviderChange={(inputProvider) => updateVoice({ inputProvider })}
          cloudAvailable={Boolean(status?.transcription?.available)}
          handsFree={voice.handsFree}
          onHandsFreeChange={(handsFree) => updateVoice({ handsFree })}
          speaking={speech.speakingId !== null}
          placeholder="Ask HomePilot to plan, buy, clean, remind…"
        />

        <div className="flex flex-wrap gap-2">
          <span className="eyebrow mt-1.5 mr-1">Try</span>
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => void submit(suggestion)}
              disabled={busy}
              className="chip max-w-full truncate transition hover:border-accent/40 hover:bg-accent-soft hover:text-accent-strong"
            >
              <Sparkles size={11} className="shrink-0" aria-hidden="true" />
              {suggestion.length > 52 ? `${suggestion.slice(0, 52)}…` : suggestion}
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <McpTracePanel defaultOpen />

        <VoiceSettings
          preferences={voice}
          onChange={updateVoice}
          speech={speech}
          transcription={status?.transcription}
        />

        <section className="card p-4">
          <h3 className="text-[14px] font-semibold text-ink">Household context</h3>
          <p className="mt-0.5 text-[12px] text-muted">Fed to the planner before every request</p>
          <dl className="mt-3 space-y-2.5 text-[12.5px]">
            <ContextRow label="Members" value={status?.household.members.map((m) => m.name.split(" ")[0]).join(", ") ?? "—"} />
            <ContextRow label="Diet" value={status?.household.preferences.diet ?? "—"} />
            <ContextRow label="Cleaning day" value={status?.household.preferences.cleaningDay ?? "—"} />
            <ContextRow label="Quiet hours" value={status?.household.preferences.quietHours ?? "—"} />
            <ContextRow label="Store" value={status?.household.preferences.defaultStore ?? "—"} />
          </dl>
        </section>

        <section className="card p-4">
          <h3 className="text-[14px] font-semibold text-ink">Recent plans</h3>
          <ul className="mt-3 space-y-2">
            {plans.slice(0, 5).map((plan) => (
              <li key={plan.id}>
                <button
                  type="button"
                  onClick={() => {
                    setActivePlan(plan);
                    setView("review");
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 text-left transition hover:bg-surface-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-ink">{plan.title}</span>
                    <span className="text-[11.5px] text-muted">
                      {plan.actions.length} actions · {plan.status.replace("_", " ")}
                    </span>
                  </span>
                  <ChevronRight size={14} className="shrink-0 text-faint" aria-hidden="true" />
                </button>
              </li>
            ))}
            {plans.length === 0 ? <li className="text-[12.5px] text-muted">No plans proposed yet.</li> : null}
          </ul>
        </section>

        <ActivityFeed limit={6} />
      </div>
    </div>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 leading-5 text-ink-soft">{value}</dd>
    </div>
  );
}


import type { ActivityEntry, ExecutionResult, Plan, ProposeResponse, StatusResponse } from "./types";

const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed with HTTP ${response.status}`);
  }
  return body;
}

export const api = {
  status: () => request<StatusResponse>("/api/status"),

  activity: (limit = 40) => request<{ activity: ActivityEntry[] }>(`/api/activity?limit=${limit}`),

  prompts: () => request<{ prompts: string[] }>("/api/prompts"),

  plans: () => request<{ plans: Plan[] }>("/api/plans"),

  plan: (id: string) => request<{ plan: Plan }>(`/api/plans/${id}`),

  propose: (requestText: string) =>
    request<ProposeResponse>("/api/plans", {
      method: "POST",
      body: JSON.stringify({ request: requestText }),
    }),

  simulateQuota: () =>
    request<{ ok: boolean; message: string }>("/api/provider/simulate-quota", { method: "POST" }),

  patchPlan: (
    id: string,
    body: {
      actions?: Array<{ id: string; apply?: boolean; label?: string; args?: Record<string, unknown> }>;
    },
  ) => request<{ plan: Plan; valid: boolean }>(`/api/plans/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  }),

  approvePlan: (id: string) =>
    request<ExecutionResult>(`/api/plans/${id}/approve`, { method: "POST" }),

  cancelPlan: (id: string) => request<{ plan: Plan }>(`/api/plans/${id}/cancel`, { method: "POST" }),

  resetDemo: () => request<{ ok: boolean; message: string }>("/api/demo/reset", { method: "POST" }),

  /** Explicit upload to the server's optional Google transcription adapter. */
  transcribe: async (audio: Blob, language: string): Promise<string> => {
    const response = await fetch(
      `${API_BASE}/api/transcribe?language=${encodeURIComponent(language)}`,
      {
        method: "POST",
        headers: {
          "content-type": audio.type || "audio/webm",
          "x-audio-language": language,
        },
        body: audio,
        signal: AbortSignal.timeout(45_000),
      },
    );
    const body = (await response.json().catch(() => ({}))) as { text?: string; error?: string; code?: string };
    if (!response.ok || typeof body.text !== "string") {
      throw Object.assign(new Error(body.error ?? `Transcription failed with HTTP ${response.status}`), {
        code: body.code ?? `http_${response.status}`,
      });
    }
    return body.text;
  },
};

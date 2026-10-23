import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestServer, type TestServer } from "./helpers.js";

const realFetch = globalThis.fetch.bind(globalThis);
const GEMINI_HOST = "https://generativelanguage.googleapis.com";
const UPLOAD_URL = "https://upload.example.test/session/123";

interface StubOptions {
  generateStatus?: number;
  generateBody?: string;
  onGenerate?: (body: unknown) => void;
  onDelete?: (url: string) => void;
}

function stubGoogle(options: StubOptions = {}) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.startsWith(`${GEMINI_HOST}/upload/`)) {
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("x-goog-upload-protocol")).toBe("resumable");
      expect(headers.get("x-goog-upload-header-content-type")).toBe("audio/webm");
      return new Response("{}", {
        status: 200,
        headers: { "x-goog-upload-url": UPLOAD_URL },
      });
    }

    if (url === UPLOAD_URL) {
      const headers = new Headers(init?.headers);
      expect(headers.get("x-goog-upload-command")).toBe("upload, finalize");
      return new Response(
        JSON.stringify({
          file: { name: "files/abc123", uri: `${GEMINI_HOST}/v1beta/files/abc123` },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.includes(":generateContent")) {
      options.onGenerate?.(JSON.parse(String(init?.body ?? "{}")));
      if (options.generateStatus && options.generateStatus >= 400) {
        return new Response(options.generateBody ?? "{}", { status: options.generateStatus });
      }
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Add oat milk and lemons to the grocery list." }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.includes("/files/abc123") && init?.method === "DELETE") {
      options.onDelete?.(url);
      return new Response("{}", { status: 200 });
    }

    if (url.startsWith(GEMINI_HOST)) {
      return new Response(JSON.stringify({ error: { message: "unexpected Google call" } }), { status: 500 });
    }
    return realFetch(input as Parameters<typeof realFetch>[0], init);
  });
}

function install(handler: ReturnType<typeof stubGoogle>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit) => handler(input, init)),
  );
}

async function transcribe(
  baseUrl: string,
  body: string | Buffer,
  headers: Record<string, string> = { "content-type": "audio/webm" },
  language = "en-US",
) {
  return realFetch(`${baseUrl}/api/transcribe?language=${encodeURIComponent(language)}`, {
    method: "POST",
    headers,
    body,
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google transcription endpoint", () => {
  it("explains missing configuration without calling Google", async () => {
    const ctx: TestServer = await startTestServer({ AI_PROVIDER: "demo", GEMINI_API_KEY: "" });
    const spy = vi.fn();
    install(stubGoogle({ onGenerate: spy }));
    try {
      const response = await transcribe(ctx.baseUrl, Buffer.from("audio"));
      expect(response.status).toBe(503);
      const body = (await response.json()) as { code: string; error: string; model: string };
      expect(body.code).toBe("transcription_unavailable");
      expect(body.error).toContain("GEMINI_API_KEY");
      expect(body.model).toBe("gemini-3.5-transcribe");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      await ctx.close();
    }
  });

  it("uploads short audio, sends the Bengali language hint and removes the temp file", async () => {
    const calls: string[] = [];
    let generateBody: unknown = null;
    const handler = stubGoogle({
      onGenerate: (body) => {
        generateBody = body;
      },
      onDelete: (url) => calls.push(url),
    });
    install(handler);

    const ctx = await startTestServer({ AI_PROVIDER: "demo", GEMINI_API_KEY: "test-key" });
    try {
      const response = await transcribe(ctx.baseUrl, Buffer.from("fake-webm-audio"), {
        "content-type": "audio/webm",
      }, "bn-BD");
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        text: string;
        model: string;
        language: string;
        provider: string;
      };
      expect(body.text).toContain("Add oat milk");
      expect(body.model).toBe("gemini-3.5-transcribe");
      expect(body.language).toBe("bn-BD");
      expect(body.provider).toBe("google");

      const payload = generateBody as {
        contents: Array<{ parts: Array<{ fileData?: { fileUri: string; mimeType: string } }> }>;
        generationConfig: { audioTranscriptionConfig: { languageCodes?: string[] } };
      };
      expect(payload.contents[0]?.parts[0]?.fileData?.fileUri).toContain("/files/abc123");
      expect(payload.contents[0]?.parts[0]?.fileData?.mimeType).toBe("audio/webm");
      expect(payload.generationConfig.audioTranscriptionConfig.languageCodes).toEqual(["bn-BD"]);

      // Cleanup is asynchronous; give it a tick.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls.some((url) => url.includes("/files/abc123"))).toBe(true);

      const status = (await (await realFetch(`${ctx.baseUrl}/api/status`)).json()) as {
        transcription: { available: boolean; model: string };
        tools: unknown[];
      };
      expect(status.transcription.available).toBe(true);
      expect(status.transcription.model).toBe("gemini-3.5-transcribe");
      expect(status.tools).toHaveLength(21);
    } finally {
      await ctx.close();
    }
  });

  it("uses automatic language detection when language is omitted", async () => {
    let generateBody: unknown = null;
    install(stubGoogle({ onGenerate: (body) => { generateBody = body; } }));
    const ctx = await startTestServer({ AI_PROVIDER: "demo", GEMINI_API_KEY: "test-key" });
    try {
      const response = await realFetch(`${ctx.baseUrl}/api/transcribe`, {
        method: "POST",
        headers: { "content-type": "audio/webm" },
        body: Buffer.from("audio"),
      });
      expect(response.status).toBe(200);
      const payload = generateBody as {
        generationConfig: { audioTranscriptionConfig: { languageCodes?: string[] } };
      };
      expect(payload.generationConfig.audioTranscriptionConfig.languageCodes).toBeUndefined();
    } finally {
      await ctx.close();
    }
  });

  it("maps quota exhaustion to a safe 429 without leaking the provider body", async () => {
    install(
      stubGoogle({
        generateStatus: 429,
        generateBody: JSON.stringify({
          error: { status: "RESOURCE_EXHAUSTED", message: "quota secret-ish raw detail" },
        }),
      }),
    );
    const ctx = await startTestServer({ AI_PROVIDER: "demo", GEMINI_API_KEY: "test-key" });
    try {
      const response = await transcribe(ctx.baseUrl, Buffer.from("audio"));
      expect(response.status).toBe(429);
      const body = (await response.json()) as { code: string; error: string };
      expect(body.code).toBe("quota");
      expect(body.error).not.toContain("secret-ish raw detail");
    } finally {
      await ctx.close();
    }
  });

  it("rejects empty, unsupported and oversized uploads", async () => {
    install(stubGoogle());
    const ctx = await startTestServer({ AI_PROVIDER: "demo", GEMINI_API_KEY: "test-key" });
    try {
      const empty = await transcribe(ctx.baseUrl, Buffer.alloc(0));
      expect(empty.status).toBe(400);
      expect(((await empty.json()) as { code: string }).code).toBe("empty_audio");

      const wrongType = await transcribe(ctx.baseUrl, Buffer.from("audio"), {
        "content-type": "text/plain",
      });
      expect(wrongType.status).toBe(415);

      const huge = await transcribe(ctx.baseUrl, Buffer.alloc(8 * 1024 * 1024 + 64));
      expect(huge.status).toBe(413);
    } finally {
      await ctx.close();
    }
  });
});
